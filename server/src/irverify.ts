// ============================================================================
// IR 自校验：对 ir.ts 生成的 LLVM IR 文本做结构化校验。
//
// 覆盖的不变量：
//   每个 `define` 函数含 `entry:` 基本块；
//   每个基本块以终结符（ret/br/switch/indirectbr/unreachable）结束；
//   SSA 支配性质：每个 `%N` 使用点之前必有 `%N = ...` 定义（按文本顺序近似）；
//   指令目标寄存器（`%N = ...`）不与既有定义重复（SSA 单赋值）。
//
// 目的是在生成期就捕获字符串拼错/基本块漏终结符等错误，而非让 daemon 的
// LLVM parse 兜底。
// ============================================================================

export interface IRDiagnostic {
    line: number;
    message: string;
}

const TERMINATORS = new Set(['ret', 'br', 'switch', 'indirectbr', 'unreachable', 'resume']);

// 命名类型（opaque / 晶格 / form / 闭包 / env）在函数体内以 `%Name*` 出现，不是寄存器。
const TYPE_NAMES = new Set(['Qubit', 'QObject', 'QModel', 'QReservoir', 'Lattice']);
const isTypeRef = (raw: string): boolean => {
    const name = raw.startsWith('%') ? raw.slice(1) : raw;
    return TYPE_NAMES.has(name) || name.startsWith('form.') || name.startsWith('closure.') || name.startsWith('env.');
};

export function verifyIR(ir: string): IRDiagnostic[] {
    const diagnostics: IRDiagnostic[] = [];
    const lines = ir.split('\n');

    // 第一遍：收集所有基本块标签名（用于区分 `br label %X` 中的标签 vs 寄存器）
    const allLabels = new Set<string>();
    for (const raw of lines) {
        const s = raw.trim();
        const lm = s.match(/^([\w.]+):$/);
        if (lm && lm[1] !== 'entry') allLabels.add(lm[1]);
    }

    let inFunction = false;
    let fnName = '';
    let fnStartLine = 0;
    let hasEntry = false;
    let blockTerminated = false;
    let blockHasInstruction = false;
    const definedRegs = new Set<string>();

    const flushBlock = (line: number) => {
        // 一个基本块结束（下一个 label 或函数结束）时，校验终结符
        if (!blockTerminated && blockHasInstruction) {
            diagnostics.push({
                line,
                message: `block in function '${fnName}' is not terminated (missing ret/br/...)`,
            });
        }
        blockTerminated = false;
        blockHasInstruction = false;
    };

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const line = i + 1;
        const s = raw.trim();

        // 函数定义：define [linkage] ret @name(...) {
        const defMatch = s.match(/^define\s+[\w%*.\-\[\]]+\s+@([\w.]+)\s*\(/);
        if (defMatch) {
            if (inFunction) flushBlock(line);
            inFunction = true;
            fnName = defMatch[1];
            fnStartLine = line;
            hasEntry = false;
            blockTerminated = false;
            blockHasInstruction = false;
            definedRegs.clear();
            // 函数参数（%arg0, %arg1, ...）在函数入口即已定义，加入 definedRegs，
            // 否则参数在 store 到 alloca 时会被误报 "used before definition"。
            // 精确匹配 %argN 参数名，避免误匹配命名类型（如 %Qubit*）。
            // lambda/spawn 线程函数的闭包环境参数 %env 也视为已定义。
            const args = s.match(/%arg\d+/g);
            if (args) for (const a of args) definedRegs.add(a);
            if (s.includes('%env')) definedRegs.add('%env');
            continue;
        }

        // declare 等全局声明：跳过
        if (s.startsWith('declare ') || s.startsWith('@') || s.startsWith('source_filename') || s.startsWith(';') || s.startsWith('target ') || s.startsWith('attributes ') || s.startsWith('module ') || s.startsWith('!')) {
            continue;
        }

        // 类型定义 / 全局变量：跳过
        if (s.startsWith('%') && s.includes('= type ') && !inFunction) continue;
        if (s.startsWith('@') && s.includes('= private') && !inFunction) continue;
        if (s.startsWith('@') && s.includes('= constant') && !inFunction) continue;
        if (s.startsWith('@') && s.includes('= global') && !inFunction) continue;
        if (s.startsWith('@') && s.includes('= linkonce') && !inFunction) continue;
        if (s.startsWith('@') && s.includes('= internal') && !inFunction) continue;

        if (!inFunction) continue;

        // 函数结束
        if (s === '}') {
            flushBlock(line);
            if (!hasEntry) {
                diagnostics.push({ line: fnStartLine, message: `function '${fnName}' is missing an 'entry:' block` });
            }
            inFunction = false;
            continue;
        }

        // 基本块标签：label:
        const labelMatch = s.match(/^([\w.]+):$/);
        if (labelMatch) {
            flushBlock(line);
            if (labelMatch[1] === 'entry') hasEntry = true;
            blockHasInstruction = false;
            blockTerminated = false;
            continue;
        }

        // 指令
        const instruction = s;
        const firstToken = instruction.split(/\s+/)[0];

        // 定义形如 %N = ... ：SSA 单赋值检查 + 记录定义
        const dm = instruction.match(/^(%\w+)\s*=/);
        let definedName = '';
        if (dm) {
            definedName = dm[1];
            if (definedRegs.has(definedName)) {
                diagnostics.push({ line, message: `SSA violation: register '${definedName}' defined more than once` });
            }
            definedRegs.add(definedName);
        }

        // 使用：扫描指令中的 %N（排除定义位置本身与命名类型引用）。
        // 用 %[\w.]+ 匹配，使 `%env.XXX`/`%closure.XXX` 等带点类型名作为整体识别，
        // 而非被拆成 `%env` 误判为寄存器。
        const uses = instruction.match(/%[\w.]+/g) ?? [];
        for (const u of uses) {
            if (u === definedName) continue; // 定义位置
            if (isTypeRef(u)) continue;       // 命名类型（%Qubit* 等），非寄存器
            if (allLabels.has(u.slice(1))) continue; // 基本块标签（br label %X）
            if (!definedRegs.has(u)) {
                diagnostics.push({ line, message: `SSA violation: register '${u}' used before definition in function '${fnName}'` });
            }
        }

        // 终结符判定
        if (TERMINATORS.has(firstToken)) {
            blockTerminated = true;
        }
        blockHasInstruction = true;
    }

    if (inFunction) {
        flushBlock(lines.length);
        if (!hasEntry) {
            diagnostics.push({ line: fnStartLine, message: `function '${fnName}' is missing an 'entry:' block` });
        }
    }

    return diagnostics;
}