// ============================================================================
// TopologyBuilder —— 多维标签函数的执行拓扑构建
//
// 把带 @layer(time, thread, coord[, cost][, deadline]) 的函数聚合为一张
// 多维执行拓扑：
//   - time   ：锚点时间（块在其 coord 时序链上的启动槽位）
//   - thread ：逻辑线程 id（同线程串行、异线程可并行）
//   - coord  ：N 维运行层坐标（块在多维拓扑空间的初始位置）
//
// 块间关系从标签自动推导：
//   coord 相同 → 叠加（stack，按 time 组成时序链）
//   coord 不同 → 平行（parallel，空间并置）
//
// 块内调用传播延迟（逻辑时钟模型）：
//   子函数启动时刻 = 父函数锚点 + 调用点之前的累计延迟 Δt
//   Δt = Σ δ(前置语句) + Σ cost(前置子函数调用)
//
// ============================================================================

import {
    Program,
    FunctionDeclaration,
    LayerTag,
    Topology,
    TopologyEdge,
    TopologyCallEdge,
} from './ast';

export interface TopologyError {
    code: string;
    message: string;
    line: number;
    column: number;
}

interface Block {
    name: string;
    layer: LayerTag;
    fn: FunctionDeclaration;
}

export class TopologyBuilder {
    private errors: TopologyError[] = [];

    public build(program: Program): { topology: Topology; errors: TopologyError[] } {
        this.errors = [];

        const blocks: Block[] = [];

        // MMI 模块（含 export 函数）：export 函数经 MMI_INVOKE 直接调用，@layer 辅助函数
        // 只是被调用的子函数、不参与拓扑调度。跳过拓扑收集与 coord 占用检查，
        // 避免组件函数之间 coord 相同的「假冲突」（如 perceive 与 chaos_drift 均 coord=0）。
        const hasExport = program.body.some(
            n => n.type === 'FunctionDeclaration' && (n as FunctionDeclaration).isExport
        );
        if (hasExport) {
            return {
                topology: { shape: { time: 1, thread: 1, coord: [] }, blocks: [], edges: [], callGraph: [] },
                errors: this.errors,
            };
        }

        // 收集 @layer 函数；显式函数必须带标签（E-TOP001）。
        // 编译器合成函数（@[undo]/@[steer] 生成的 <name>_undo/_steer）、
        // @[gate] 子函数（被调用的门单元，非拓扑入口）、以及 export 函数
        // （模块对外接口，经 MMI_INVOKE 直接调用，不参与拓扑调度）均跳过。
        for (const node of program.body) {
            if (node.type !== 'FunctionDeclaration') continue;
            const fn = node as FunctionDeclaration;
            if (fn.synthetic || fn.quantum?.isGate || fn.isExport) continue;
            if (!fn.layer) {
                this.errors.push({
                    code: 'E-TOP001',
                    message: `Topology Error: function '${fn.name}' must carry an @layer(time, thread, coord) tag.`,
                    line: fn.line,
                    column: fn.column,
                });
            } else {
                blocks.push({ name: fn.name, layer: fn.layer, fn });
            }
        }

        // 无拓扑块（脚本模式 / 全部报错）：返回空拓扑。
        if (blocks.length === 0) {
            return {
                topology: { shape: { time: 1, thread: 1, coord: [] }, blocks: [], edges: [], callGraph: [] },
                errors: this.errors,
            };
        }

        // 坐标维度一致性校验（E-TOP002）
        this.validateCoordDims(blocks);

        // 1. 运行形状聚合
        const shape = this.aggregateShape(blocks);

        // 2. 块间推导（平行 / 叠加）
        const edges = this.deriveEdges(blocks);

        // 3. 调用传播延迟累计（逻辑时钟）
        const { callGraph, finishOf } = this.buildCallGraph(blocks);

        // 4. 时间束缚校验（deadline）
        this.checkDeadlines(blocks, finishOf);

        const topology: Topology = {
            shape,
            blocks: blocks.map(b => ({ name: b.name, layer: b.layer })),
            edges,
            callGraph,
        };
        return { topology, errors: this.errors };
    }

    // ---- 校验：曲面体坐标维度（放宽原 E-TOP002）----------------------------
    // 曲面体允许 coord 维度不同：低维 ↔ 高维块构成 projection（投影）边。
    // 原 E-TOP002 强制维度一致，已放宽——不同维度的块不再报错，由 deriveEdges
    // 推导为 projection 边。此处保留占位，便于后续诊断「维度差 > 1」等异常投影。
    private validateCoordDims(blocks: Block[]): void {
        // 曲面体坐标：维度不同是合法的（投影边），无需一致性校验。
    }

    // ---- 运行形状聚合 -------------------------------------------------------
    private aggregateShape(blocks: Block[]): { time: number; thread: number; coord: number[] } {
        let maxTime = 0;
        let maxThread = 0;
        const coordMax: number[] = [];
        for (const b of blocks) {
            const t = b.layer.time ?? 0;
            if (t > maxTime) maxTime = t;
            if (b.layer.thread > maxThread) maxThread = b.layer.thread;
            for (let i = 0; i < b.layer.coord.length; i++) {
                coordMax[i] = Math.max(coordMax[i] ?? 0, b.layer.coord[i]);
            }
        }
        return { time: maxTime + 1, thread: maxThread + 1, coord: coordMax.map(c => c + 1) };
    }

    // ---- 块间推导（平行 / 叠加）--------------------------------------------
    private deriveEdges(blocks: Block[]): TopologyEdge[] {
        const edges: TopologyEdge[] = [];
        const key = (c: number[]) => c.join(',');

        // 按 coord 分组
        const groups = new Map<string, Block[]>();
        for (const b of blocks) {
            const k = key(b.layer.coord);
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k)!.push(b);
        }

        // 组内：叠加（按 time 组成时序链）
        for (const [, group] of groups) {
            group.sort((a, b) => (a.layer.time ?? 0) - (b.layer.time ?? 0));
            for (let i = 0; i < group.length; i++) {
                for (let j = i + 1; j < group.length; j++) {
                    const a = group[i];
                    const b = group[j];
                    const ta = a.layer.time ?? 0;
                    const tb = b.layer.time ?? 0;
                    const sameDual = !!a.layer.dual === !!b.layer.dual;
                    const sameThread = a.layer.thread === b.layer.thread;

                    // 叠加（stack）：仅同 dual 同 thread 的块构成时序链，
                    // 检查 time 冲突（E-TOP003）与 gap（E-TOP005）
                    if (sameDual && sameThread) {
                        if (ta === tb) {
                            this.errors.push({
                                code: 'E-TOP003',
                                message: `Topology Error: duplicate occupancy at coord (${key(a.layer.coord)}), time ${ta}: '${a.name}' and '${b.name}'.`,
                                line: b.fn.line,
                                column: b.fn.column,
                            });
                        } else if (tb - ta > 1) {
                            this.errors.push({
                                code: 'E-TOP005',
                                message: `Topology Error: gap in stack chain at coord (${key(a.layer.coord)}) between time ${ta} ('${a.name}') and ${tb} ('${b.name}').`,
                                line: b.fn.line,
                                column: b.fn.column,
                            });
                        }
                        edges.push({ from: a.name, to: b.name, kind: 'stack' });
                    }
                    // 曲面体几何边：反转（T-对偶，dual 标记不同）
                    if (!sameDual) {
                        edges.push({ from: a.name, to: b.name, kind: 'inversion' });
                    }
                    // 曲面体几何边：交叉（跨线程测地线交叉）
                    if (!sameThread) {
                        edges.push({ from: a.name, to: b.name, kind: 'crossing' });
                    }
                }
            }
        }

        // 跨组：曲面体几何边（投影 / 平行传输）
        for (let i = 0; i < blocks.length; i++) {
            for (let j = i + 1; j < blocks.length; j++) {
                const A = blocks[i];
                const B = blocks[j];
                if (key(A.layer.coord) !== key(B.layer.coord)) {
                    // 维度不同 → 投影（低维 ↔ 高维，指数/对数映射）
                    // 维度相同 → 平行（沿测地线平行传输）
                    const kind = A.layer.coord.length !== B.layer.coord.length
                        ? 'projection' : 'parallel';
                    edges.push({ from: A.name, to: B.name, kind });
                }
            }
        }

        return edges;
    }

    // ---- 调用传播延迟累计（逻辑时钟模型，核心）----------------------------
    private buildCallGraph(blocks: Block[]): { callGraph: TopologyCallEdge[]; finishOf: Map<string, number> } {
        const callGraph: TopologyCallEdge[] = [];
        const finishOf = new Map<string, number>();

        const costOf = new Map<string, number>();
        const anchor = new Map<string, number>();
        const nameSet = new Set<string>();
        for (const b of blocks) {
            costOf.set(b.name, b.layer.cost ?? 1);
            anchor.set(b.name, b.layer.time ?? 0);
            nameSet.add(b.name);
        }

        const propagateExpr = (owner: string, expr: any, τ: number): number => {
            if (!expr) return τ;
            switch (expr.type) {
                case 'FunctionCall': {
                    // 先求值实参（可能推进 τ），再调用函数本身
                    for (const a of expr.arguments) τ = propagateExpr(owner, a, τ);
                    if (nameSet.has(expr.name)) {
                        callGraph.push({
                            caller: owner,
                            callee: expr.name,
                            startAt: τ,
                            deltaT: τ - (anchor.get(owner) ?? 0),
                        });
                        return τ + (costOf.get(expr.name) ?? 1);
                    }
                    return τ;
                }
                case 'BinaryExpression':
                    τ = propagateExpr(owner, expr.left, τ);
                    return propagateExpr(owner, expr.right, τ);
                case 'LogicalExpression':
                    τ = propagateExpr(owner, expr.left, τ);
                    return propagateExpr(owner, expr.right, τ);
                case 'UnaryExpression':
                    return propagateExpr(owner, expr.argument, τ);
                case 'Dereference':
                    return propagateExpr(owner, expr.target, τ);
                case 'AddressOf':
                    return propagateExpr(owner, expr.target, τ);
                case 'MemberExpression':
                    for (const a of expr.arguments) τ = propagateExpr(owner, a, τ);
                    return propagateExpr(owner, expr.object, τ);
                case 'NewExpression':
                    for (const a of expr.arguments) τ = propagateExpr(owner, a, τ);
                    return τ;
                case 'IndexExpression':
                    for (const a of expr.indices) τ = propagateExpr(owner, a, τ);
                    return propagateExpr(owner, expr.object, τ);
                case 'FuseExpression':
                    τ = propagateExpr(owner, expr.discriminant, τ);
                    for (const arm of expr.arms) {
                        if (arm.pattern) τ = propagateExpr(owner, arm.pattern, τ);
                        τ = propagateExpr(owner, arm.value, τ);
                    }
                    return τ;
                case 'FunctionExpression':
                    return propagateStmts(owner, expr.body, τ);
                default:
                    return τ; // 字面量 / 标识符 / native / result 等叶子
            }
        };

        const propagateStmts = (owner: string, stmts: any[], τ: number): number => {
            for (const s of stmts) {
                if (!s) continue;
                switch (s.type) {
                    case 'VariableDeclaration':
                        τ = propagateExpr(owner, s.value, τ) + 1;
                        break;
                    case 'VariableDeclarationList':
                        for (const d of s.declarations) τ = propagateExpr(owner, d.value, τ) + 1;
                        break;
                    case 'ExpressionStatement':
                        τ = propagateExpr(owner, s.expression, τ);
                        break;
                    case 'AssignmentStatement':
                        if (s.target) τ = propagateExpr(owner, s.target, τ);
                        τ = propagateExpr(owner, s.value, τ) + 1;
                        break;
                    case 'ReturnStatement':
                        τ = propagateExpr(owner, s.argument, τ);
                        break;
                    case 'IfStatement': {
                        τ = propagateExpr(owner, s.condition, τ);
                        const c = propagateStmts(owner, s.consequent, τ);
                        const a = s.alternate ? propagateStmts(owner, s.alternate, τ) : τ;
                        τ = Math.max(c, a);
                        break;
                    }
                    case 'WhileStatement':
                        τ = propagateExpr(owner, s.condition, τ);
                        τ = propagateStmts(owner, s.body, τ);          // 保守：单次迭代
                        if (s.elseBody) τ = propagateStmts(owner, s.elseBody, τ);
                        break;
                    case 'ForStatement':
                        if (s.init) τ = propagateStmts(owner, [s.init], τ);
                        if (s.condition) τ = propagateExpr(owner, s.condition, τ);
                        τ = propagateStmts(owner, s.body, τ);
                        if (s.update) τ = propagateStmts(owner, [s.update], τ);
                        break;
                    case 'RouteStatement': {
                        τ = propagateExpr(owner, s.discriminant, τ);
                        let worst = τ;
                        for (const c of s.cases) worst = Math.max(worst, propagateStmts(owner, c.body, τ));
                        if (s.fallback) worst = Math.max(worst, propagateStmts(owner, s.fallback, τ));
                        τ = worst;
                        break;
                    }
                    case 'SpinStatement':
                        τ = propagateStmts(owner, s.body, τ);
                        τ = propagateExpr(owner, s.condition, τ);
                        break;
                    case 'UnsafeBlock':
                        τ = propagateStmts(owner, s.body, τ);
                        break;
                    case 'SpawnStatement':
                        τ = propagateStmts(owner, s.body, τ);
                        break;
                    case 'EntangleStatement':
                        τ = propagateExpr(owner, s.left, τ);
                        τ = propagateExpr(owner, s.right, τ) + 1;
                        break;
                    case 'BreakStatement':
                    case 'ContinueStatement':
                    case 'FunctionDeclaration':
                        break;
                    default:
                        break;
                }
            }
            return τ;
        };

        for (const b of blocks) {
            const finish = propagateStmts(b.name, b.fn.body, b.layer.time ?? 0);
            finishOf.set(b.name, finish);
        }

        return { callGraph, finishOf };
    }

    // ---- 时间束缚校验（E-TOP006）-------------------------------------------
    private checkDeadlines(blocks: Block[], finishOf: Map<string, number>): void {
        for (const b of blocks) {
            const deadline = b.layer.deadline;
            if (deadline === undefined) continue;
            const start = b.layer.time ?? 0;
            const finish = finishOf.get(b.name) ?? start;
            if (finish - start > deadline) {
                this.errors.push({
                    code: 'E-TOP006',
                    message: `Topology Error: block '${b.name}' exceeds deadline ${deadline} (finishes at τ=${finish}, anchor=${start}).`,
                    line: b.fn.line,
                    column: b.fn.column,
                });
            }
        }
    }
}

/** 便捷入口：AST -> Topology */
export function buildTopology(program: Program): { topology: Topology; errors: TopologyError[] } {
    return new TopologyBuilder().build(program);
}