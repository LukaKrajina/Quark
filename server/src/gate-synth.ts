// ============================================================================
// 门合成（可逆编织 Reversible Weaving 范式）
//
// 在 AST 层自动合成量子门的两种变换版本：
//   @[undo]  → 合成可逆对偶 <name>_undo（门序反转 + 逐门取逆，U†）
//   @[steer] → 合成相干控制版本 <name>_steer（额外控制位，受控化 Λ(U)）
//
// 理论映射：
//   - undo  ← 量子临时值的「块级撤销」，而非单门伴随。
//   - steer ← 控制位在叠加态上「导引」目标门，而非经典的条件分支。
//
// 合成在 AST 层完成（semantic 校验之后、mir/ir 之前），使生成的合成函数
// 被后续借用检查、竞争检测、代码生成统一处理。
// ============================================================================

import { Program, Statement, Expression, FunctionDeclaration, FunctionCall, Param } from './ast';

/** 内建量子门（与 mir.ts 的 GATE_FNS 对齐） */
const INTRINSIC_GATES = new Set(['h', 'x', 'rz', 'cnot', 'toffoli', 'swap', 'qft', 'braid']);

/** 自逆门：U† = U（dagger 后不变） */
const SELF_INVERSE = new Set(['h', 'x', 'cnot', 'toffoli', 'swap', 'braid']);

/** 受控门名映射（steer 时基础门 → 受控门，均有 QIR 内建） */
const STEER_MAP: Record<string, string> = {
    x: 'cx',           // 受控 X = CNOT
    h: 'ch',           // 受控 H
    rz: 'crz',         // 受控 Rz
    cnot: 'toffoli',   // 受控 CNOT = Toffoli
    swap: 'cswap',     // 受控 SWAP（Fredkin）
    toffoli: 'c_toffoli', // 受控 Toffoli = C³X（Barenco 分解）
    qft: 'cqft',       // 受控 QFT（apply_cqft 分解）
    braid: 'cbraid',   // 受控 braid（默认 = 受控 swap，与 braid 默认 = swap 一致）
};

function makeExprStmt(fn: FunctionDeclaration, expr: Expression): Statement {
    return {
        type: 'ExpressionStatement',
        expression: expr,
        line: fn.line,
        column: fn.column,
        length: fn.name.length,
    };
}

function makeFn(
    name: string,
    src: FunctionDeclaration,
    body: Statement[],
    extraParams: Param[],
    returnType: string,
): FunctionDeclaration {
    return {
        type: 'FunctionDeclaration',
        returnType,
        name,
        params: [...extraParams, ...src.params],
        receiver: null,
        isPub: false,
        isExport: false,
        requires: [],
        ensures: [],
        body,
        // 合成函数本身仍是可组合门（参与进一步的 undo/steer）
        quantum: { isGate: true, undo: false, steer: false, unitary: false, measure: false },
        // 标记为编译器合成：不参与拓扑入口（无需 @layer）
        synthetic: true,
        line: src.line,
        column: src.column,
        length: src.name.length,
    };
}

/**
 * 提取函数体内的「直线门序列」（按执行顺序）。
 * 首版仅支持直线门序列（无控制流）；变量声明 / 赋值 / 分支等非门语句被忽略。
 */
function extractGateSequence(body: Statement[], userGates: Set<string>): FunctionCall[] {
    const gates: FunctionCall[] = [];
    for (const stmt of body) {
        if (stmt.type === 'ExpressionStatement') {
            const e = stmt.expression;
            if (e.type === 'FunctionCall' && (INTRINSIC_GATES.has(e.name) || userGates.has(e.name))) {
                gates.push(e);
            }
        }
    }
    return gates;
}

/** 控制流语句：可逆编织（门序反转/受控化）要求直线门序列 */
const CONTROL_FLOW = new Set(['IfStatement', 'WhileStatement', 'ForStatement', 'SpinStatement']);

function hasControlFlow(body: Statement[]): boolean {
    return body.some(s => CONTROL_FLOW.has(s.type));
}

/** 门取逆（dagger）：自逆门不变，rz 取负角，用户门递归取 undo */
function daggerGate(g: FunctionCall, userGates: Set<string>): FunctionCall {
    if (g.name === 'rz') {
        // rz(q, θ)† = rz(q, -θ)
        const negTheta: Expression = {
            type: 'UnaryExpression',
            operator: '-',
            argument: g.arguments[0],
            line: g.line,
            column: g.column,
            length: 1,
        };
        return { ...g, arguments: [g.arguments[0], negTheta] };
    }
    if (g.name === 'qft') {
        // qft† = iqft（逆 QFT，IQuantumBackend::apply_iqft）
        return { ...g, name: 'iqft' };
    }
    if (userGates.has(g.name)) {
        // 用户门 U 的可逆对偶是 U_undo（递归）
        return { ...g, name: g.name + '_undo' };
    }
    if (SELF_INVERSE.has(g.name)) {
        return g;
    }
    // 未知门（无取逆规则）：保守保持原门
    return g;
}

/** 门受控化（steer）：加控制位，基础门映射到受控门 */
function steerGate(g: FunctionCall, userGates: Set<string>): FunctionCall {
    const ctrl: Expression = {
        type: 'Identifier',
        name: '__ctrl',
        line: g.line,
        column: g.column,
        length: 1,
    };
    if (userGates.has(g.name)) {
        return { ...g, name: g.name + '_steer', arguments: [ctrl, ...g.arguments] };
    }
    const mapped = STEER_MAP[g.name];
    if (!mapped) {
        // 无受控内建的门（toffoli/qft/braid）：首版降级为原门（忽略控制位，语义近似）
        return g;
    }
    return { ...g, name: mapped, arguments: [ctrl, ...g.arguments] };
}

/** @[undo]：合成可逆对偶 <name>_undo（门序反转 + 逐门取逆） */
function synthUndo(fn: FunctionDeclaration, userGates: Set<string>): FunctionDeclaration {
    const gates = extractGateSequence(fn.body, userGates);
    const body = gates
        .reverse()
        .map(g => daggerGate(g, userGates))
        .map(g => makeExprStmt(fn, g));
    return makeFn(fn.name + '_undo', fn, body, [], fn.returnType);
}

/** @[steer]：合成相干控制版本 <name>_steer（额外控制位 + 受控化） */
function synthSteer(fn: FunctionDeclaration, userGates: Set<string>): FunctionDeclaration {
    const gates = extractGateSequence(fn.body, userGates);
    const body = gates
        .map(g => steerGate(g, userGates))
        .map(g => makeExprStmt(fn, g));
    const ctrlParam: Param = { name: '__ctrl', type: 'Qubit' };
    return makeFn(fn.name + '_steer', fn, body, [ctrlParam], fn.returnType);
}

/**
 * 门合成入口：对带 @[undo]/@[steer] 的函数生成合成版本，追加到 program.body。
 * 需在语义校验（E-QSYN 已保证 undo/steer 以 @[gate]/@[unitary] 为前提）之后调用。
 * 返回警告列表（如控制流门序列无法合成，供 semantic 层转为错误）。
 */
export function synthesizeGates(program: Program): string[] {
    const warnings: string[] = [];
    const userGates = new Set<string>();
    for (const n of program.body) {
        if (n.type === 'FunctionDeclaration' && n.quantum?.isGate) {
            userGates.add(n.name);
        }
    }

    const newFns: FunctionDeclaration[] = [];
    for (const n of program.body) {
        if (n.type !== 'FunctionDeclaration') continue;
        const fn = n as FunctionDeclaration;
        // 控制流门序列：可逆编织要求直线门序列，显式报错而非静默忽略
        if ((fn.quantum?.undo || fn.quantum?.steer) && hasControlFlow(fn.body)) {
            const tag = fn.quantum?.undo ? '@[undo]' : '@[steer]';
            warnings.push(`[E-QCTRL] ${tag} on '${fn.name}' contains control flow; reversible weaving requires a linear gate sequence`);
            continue;
        }
        if (fn.quantum?.undo) newFns.push(synthUndo(fn, userGates));
        if (fn.quantum?.steer) newFns.push(synthSteer(fn, userGates));
    }
    program.body.push(...newFns);
    return warnings;
}
