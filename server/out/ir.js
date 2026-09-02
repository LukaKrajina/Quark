"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IRGenerator = void 0;
function isTopLevelItem(node) {
    return ['ModuleDecl', 'UseDecl', 'FormDecl', 'ImplDecl', 'TraitDecl', 'TemplateDecl', 'ImportDecl', 'RequiresDecl'].includes(node.type);
}
class IRGenerator {
    constructor() {
        this.output = [];
        this.globalStrings = [];
        this.stringConstants = new Map();
        this.stringCount = 1;
        this.regCount = 1;
        this.scopes = [{ symbols: new Map(), temporaries: [] }];
        this.labelCount = 1;
        this.loopStack = [];
        this.lambdaCount = 1;
        this.lambdaIRs = [];
        this.allocas = [];
        this.isBlockTerminated = false;
        this.forms = new Map();
        this.traits = new Map();
        this.implMethods = new Map();
        this.traitImpls = new Map();
        this.templates = [];
        this.typeDefs = [];
        this.methodIRs = [];
        this.vtableConsts = [];
        this.formTypeToName = new Map();
        this.userFunctions = new Map();
        this.importAliases = new Map();
        this.importSigs = new Map();
    }
    nextReg() {
        return '%' + (this.regCount++);
    }
    nextLabel(prefix) {
        return prefix + (this.labelCount++);
    }
    toI1(val) {
        if (val.type === 'i1')
            return val.val;
        const resReg = this.nextReg();
        this.emit(`${resReg} = icmp ne ${val.type} ${val.val}, 0`);
        return resReg;
    }
    enterScope() {
        this.scopes.push({ symbols: new Map(), temporaries: [] });
    }
    emitScopeCleanup(scope) {
        for (const [, sym] of scope.symbols.entries()) {
            if (sym.type === '%QObject*') {
                const loadReg = this.nextReg();
                this.emit(`${loadReg} = load ${sym.type}, ${sym.type}* ${sym.ptr}`);
                this.emit(`call void @qk_release_object(${sym.type} ${loadReg})`);
            }
            else if (sym.type === '%Qubit*') {
                const loadReg = this.nextReg();
                this.emit(`${loadReg} = load ${sym.type}, ${sym.type}* ${sym.ptr}`);
                this.emit(`call void @__quantum__rt__qubit_release(${sym.type} ${loadReg})`);
            }
        }
        for (const temp of scope.temporaries) {
            if (temp.type === '%QObject*') {
                this.emit(`call void @qk_release_object(${temp.type} ${temp.val})`);
            }
            else if (temp.type === '%Qubit*') {
                this.emit(`call void @__quantum__rt__qubit_release(${temp.type} ${temp.val})`);
            }
        }
    }
    emitCleanup() {
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            this.emitScopeCleanup(this.scopes[i]);
        }
    }
    exitScope() {
        const currentScope = this.scopes.pop();
        if (!currentScope)
            return;
        if (!this.isBlockTerminated) {
            this.emitScopeCleanup(currentScope);
        }
    }
    setSymbol(name, data) {
        this.scopes[this.scopes.length - 1].symbols.set(name, data);
    }
    getSymbol(name) {
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            if (this.scopes[i].symbols.has(name))
                return this.scopes[i].symbols.get(name);
        }
        return undefined;
    }
    trackTemporary(val, type) {
        this.scopes[this.scopes.length - 1].temporaries.push({ val, type });
    }
    untrackTemporary(val) {
        const currentScope = this.scopes[this.scopes.length - 1];
        currentScope.temporaries = currentScope.temporaries.filter(t => t.val !== val);
    }
    emit(instruction) {
        this.output.push(' ' + instruction);
    }
    addStringLiteral(str) {
        return this.getOrCreateStringConstant(str);
    }
    getOrCreateStringConstant(value) {
        if (this.stringConstants.has(value)) {
            return this.stringConstants.get(value);
        }
        let llvmStr = "";
        let byteLength = 1;
        for (let i = 0; i < value.length; i++) {
            const charCode = value.charCodeAt(i);
            if (charCode === 34) {
                llvmStr += "\\22";
                byteLength++;
            }
            else if (charCode === 92) {
                llvmStr += "\\5C";
                byteLength++;
            }
            else if (charCode === 10) {
                llvmStr += "\\0A";
                byteLength++;
            }
            else if (charCode === 13) {
                llvmStr += "\\0D";
                byteLength++;
            }
            else {
                llvmStr += value[i];
                byteLength++;
            }
        }
        const globalName = `@.str.${this.stringCount++}`;
        const llvmStringDef = `${globalName} = private unnamed_addr constant [${byteLength} x i8] c"${llvmStr}\\00", align 1`;
        this.stringConstants.set(value, globalName);
        this.globalStrings.push(llvmStringDef);
        return globalName;
    }
    generate(ast, importSignatures) {
        this.output = [];
        this.globalStrings = [];
        this.stringConstants.clear();
        this.stringCount = 1;
        this.regCount = 1;
        this.scopes = [{ symbols: new Map(), temporaries: [] }];
        this.allocas = [];
        this.isBlockTerminated = false;
        this.resetDecls();
        this.importSigs.clear();
        if (importSignatures) {
            for (const [alias, funcs] of importSignatures) {
                for (const [funcName, sig] of funcs) {
                    this.importSigs.set(alias + '::' + funcName, sig);
                }
            }
        }
        this.collectDeclarations(ast.body, '');
        this.preInstantiateTemplates(ast);
        this.generateFormTypes();
        this.generateImplMethods();
        this.generateVtables();
        const header = [
            `; ModuleID = 'quark_module'`,
            `source_filename = "quark_script.qk"`,
            ``
        ];
        const types = [
            `; --- QIR Standard Library ---`,
            `%Qubit = type opaque`,
            `%QObject = type opaque`,
            `%QModel = type opaque`,
            ``
        ];
        const declarations = [
            `declare %QObject* @qk_create_DiracState(i32)`,
            `declare %QObject* @qk_create_BellState()`,
            `declare %QObject* @qk_create_QuantumRegister(i32)`,
            `declare %Qubit* @__quantum__rt__qubit_allocate()`,
            `declare void @__quantum__rt__qubit_release(%Qubit*)`,
            `declare i32 @__quantum__qis__measure_int(%Qubit*)`,
            ``,
            `; --- 扩展量子门（论文3 Hadamard/QFT/MUB + 论文5 Yang-Baxter braid）---`,
            `declare void @__quantum__qis__h(%Qubit*)`,
            `declare void @__quantum__qis__x(%Qubit*)`,
            `declare void @__quantum__qis__rz(double, %Qubit*)`,
            `declare void @__quantum__qis__cnot(%Qubit*, %Qubit*)`,
            `declare void @__quantum__qis__toffoli(%Qubit*, %Qubit*, %Qubit*)`,
            `declare void @__quantum__qis__swap(%Qubit*, %Qubit*)`,
            `declare void @__quantum__qis__qft(i32)`,
            `declare void @__quantum__qis__braid(%Qubit*, %Qubit*)`,
            `declare i32 @__quantum__qis__measure_basis(%Qubit*, i8)`,
            `declare i32 @qk_measure_object(%QObject*)`,
            `declare %QObject* @qk_extract_qubit(%QObject*, i32)`,
            `declare void @qk_release_object(%QObject*)`,
            ``,
            `; --- QML&QKM Native Trampolines ---`,
            `declare %QObject* @qk_encode_text(i8*)`,
            `declare %QModel* @qk_qlm_invoke(%QObject*, i32, double)`,
            `declare void @qk_qkm_export(%QModel*, i8*)`,
            ``,
            `; --- Quark AI Standard Library ABI ---`,
            `declare %QModel* @qk_qlm_load(i8*)`,
            `declare void @qk_qlm_forward(%QModel*, %QObject*)`,
            `declare %QObject* @qk_encode_string(i8*)`,
            `declare i8* @qk_decode_string(%QObject*)`,
            ``,
            `; --- QBNS Mind-Controlled Programming Trampolines ---`,
            `declare %QObject* @qk_mind_read(i8*)`,
            `declare void @qk_mind_train(%QObject*, i32, double)`,
            `declare void @qk_mind_feedback(%QObject*)`,
            ``,
            `; --- VedaROS QLM Trampolines ---`,
            `declare void @qk_veda_qlm_train(%QObject*, i32, double)`,
            ``,
            `; --- Other ---`,
            `declare double @qk_surrogate(double, double, double)`,
            `declare double @qk_tanh_quantize(double, double, i32)`,
            `declare double @qk_lif_step(double, double, double, double)`,
            `declare double @qk_mellowmax2(double, double, double)`,
            `declare double @qk_logsumexp2(double, double, double)`,
            `declare double @qk_boltzmann2(double, double, double)`,
            `declare double @qk_tnorm_luk(double, double)`,
            `declare double @qk_tnorm_prod(double, double)`,
            `declare double @qk_tnorm_godel(double, double)`,
            `declare double @qk_polymer_weight(double, double, double)`,
            `declare double @qk_polymer_mix_bound(double, double)`,
            `declare i8* @malloc(i64)`,
            ``,
            `; --- QCOS Syscall ABI + Heap ---`,
            `declare i32 @qk_sys_call(i32, i32, i32, i32)`,
            `declare double @qk_sys_calld(i32, double, double)`,
            `declare void @qk_sys_log(i32, i8*)`,
            `declare i32 @qk_sys_logi(i32, i32)`,
            `declare i8* @qk_gc_alloc(i64)`,
            ``
        ];
        const hasExplicitFunctions = ast.body.some(node => node.type === 'FunctionDeclaration');
        if (!hasExplicitFunctions) {
            this.output.push(`define i32 @quark_main() {`);
            this.output.push(`entry:`);
            const entryIndex = this.output.length;
            for (const node of ast.body) {
                if (isTopLevelItem(node))
                    continue;
                this.visitStatement(node);
            }
            this.exitScope();
            if (!this.isBlockTerminated) {
                this.emit(`ret i32 0`);
                this.isBlockTerminated = true;
            }
            this.output.push(`}`);
            this.output.splice(entryIndex, 0, ...this.allocas);
        }
        else {
            for (const node of ast.body) {
                if (node.type === 'FunctionDeclaration') {
                    this.visitFunctionDeclaration(node);
                }
                else if (isTopLevelItem(node)) {
                    continue;
                }
                else {
                    throw new Error(`IR Error: Top-level statements are not allowed when explicit functions are defined.`);
                }
            }
        }
        return [
            ...header,
            ...types,
            ...this.typeDefs,
            ...this.globalStrings,
            ...(this.globalStrings.length > 0 ? [``] : []),
            ...declarations,
            ...this.buildImportDecls(),
            ...this.vtableConsts,
            ...this.methodIRs,
            ...this.lambdaIRs,
            ...this.output
        ].join('\n');
    }
    buildImportDecls() {
        const decls = [];
        for (const [alias, mmiPath] of this.importAliases) {
            for (const [key, sig] of this.importSigs) {
                if (key.startsWith(alias + '::')) {
                    const funcName = key.slice(alias.length + 2);
                    const symbol = alias + '_' + funcName;
                    decls.push(`declare ${sig.ret} @${symbol}(${sig.params.join(', ')})`);
                }
            }
        }
        return decls;
    }
    resetDecls() {
        this.forms.clear();
        this.traits.clear();
        this.implMethods.clear();
        this.traitImpls.clear();
        this.templates = [];
        this.typeDefs = [];
        this.methodIRs = [];
        this.vtableConsts = [];
        this.lambdaIRs = [];
        this.userFunctions.clear();
        this.importAliases.clear();
    }
    collectDeclarations(items, prefix) {
        for (const node of items) {
            if (node.type === 'FormDecl') {
                const fullName = prefix ? prefix + '::' + node.name : node.name;
                this.forms.set(fullName, node);
            }
            else if (node.type === 'TraitDecl') {
                const fullName = prefix ? prefix + '::' + node.name : node.name;
                this.traits.set(fullName, node);
            }
            else if (node.type === 'ImplDecl') {
                if (node.traitName) {
                    if (!this.traitImpls.has(node.traitName))
                        this.traitImpls.set(node.traitName, new Map());
                    this.traitImpls.get(node.traitName).set(node.target, node.methods);
                }
                else {
                    if (!this.implMethods.has(node.target))
                        this.implMethods.set(node.target, []);
                    this.implMethods.get(node.target).push(...node.methods);
                }
            }
            else if (node.type === 'TemplateDecl') {
                this.templates.push(node);
            }
            else if (node.type === 'FunctionDeclaration') {
                this.userFunctions.set(node.name, node);
            }
            else if (node.type === 'ImportDecl') {
                this.importAliases.set(node.alias, node.path);
            }
            else if (node.type === 'ModuleDecl') {
                const fullName = prefix ? prefix + '::' + node.name : node.name;
                this.collectDeclarations(node.body, fullName);
            }
        }
    }
    mangleForm(name) {
        return 'form.' + name.replace(/::/g, '__');
    }
    mangleMethod(formName, methodName) {
        return formName.replace(/::/g, '__') + '_' + methodName;
    }
    getFormFields(formName) {
        const form = this.forms.get(formName);
        if (!form)
            return [];
        const fields = [];
        if (form.inherits) {
            const parentFields = this.getFormFields(form.inherits.base);
            const filter = form.inherits.ranks;
            for (const pf of parentFields) {
                if (filter.length === 0 || filter.includes(pf.rank)) {
                    fields.push({ ...pf });
                }
            }
        }
        for (const rank of form.ranks) {
            for (const f of rank.fields) {
                fields.push({ name: f.name, llvmType: this.getLLVMFieldType(f.type), index: 0, rank: rank.name });
            }
        }
        fields.forEach((f, i) => { f.index = i + 1; });
        return fields;
    }
    instantiateTemplate(className) {
        const match = className.match(/^([\w]+)<(.+)>$/);
        if (!match)
            return null;
        const templateName = match[1];
        const typeArg = match[2];
        const template = this.templates.find(t => t.inner.type === 'FormDecl' && t.inner.name === templateName);
        if (!template)
            return null;
        const instName = templateName + '_' + typeArg;
        if (this.forms.has(instName))
            return instName;
        const formDecl = template.inner;
        const instForm = {
            ...formDecl,
            name: instName,
            ranks: formDecl.ranks.map(rank => ({
                ...rank,
                fields: rank.fields.map(f => ({
                    ...f,
                    type: f.type === template.params[0] ? typeArg : f.type
                }))
            }))
        };
        this.forms.set(instName, instForm);
        return instName;
    }
    preInstantiateTemplates(ast) {
        const visit = (node) => {
            if (!node || typeof node !== 'object')
                return;
            if (node.type === 'NewExpression' && typeof node.className === 'string' && node.className.includes('<')) {
                this.instantiateTemplate(node.className);
            }
            for (const key of Object.keys(node)) {
                if (key === 'line' || key === 'column' || key === 'length')
                    continue;
                const child = node[key];
                if (Array.isArray(child))
                    child.forEach(visit);
                else if (child && typeof child === 'object')
                    visit(child);
            }
        };
        visit(ast);
    }
    generateFormTypes() {
        for (const [formName, form] of this.forms) {
            const fields = this.getFormFields(formName);
            const body = ['i8*', ...fields.map(f => f.llvmType)];
            const typeName = this.mangleForm(formName);
            this.typeDefs.push(`%${typeName} = type { ${body.join(', ')} }`);
            this.formTypeToName.set(typeName, formName);
        }
        this.typeDefs.push('');
    }
    generateVtables() {
        for (const [traitName, impls] of this.traitImpls) {
            const trait = this.traits.get(traitName);
            if (!trait)
                continue;
            const methodNames = [];
            for (const rank of trait.ranks) {
                for (const m of rank.methods)
                    methodNames.push(m.name);
            }
            if (methodNames.length === 0)
                continue;
            const vtableType = `%${this.mangleForm(traitName)}.vtable`;
            const slots = methodNames.map(() => `i8*`);
            this.typeDefs.push(`${vtableType} = type { ${slots.join(', ')} }`);
            for (const [formName, methods] of impls) {
                const implByName = new Map(methods.map(m => [m.name, m]));
                const entries = methodNames.map(n => {
                    const m = implByName.get(n);
                    if (!m)
                        return 'i8* null';
                    const paramTypes = m.params.map(p => this.getLLVMType(p.type));
                    const selfType = '%' + this.mangleForm(formName) + '*';
                    const fnType = `${this.getLLVMType(m.returnType)} (${[selfType, ...paramTypes].join(', ')})*`;
                    return `i8* bitcast (${fnType} @${this.mangleMethod(formName, n)} to i8*)`;
                });
                this.vtableConsts.push(`@${this.mangleForm(formName)}.vtable = constant ${vtableType} { ${entries.join(', ')} }`);
            }
        }
        if (this.vtableConsts.length > 0)
            this.vtableConsts.push('');
    }
    generateImplMethods() {
        for (const [formName, methods] of this.implMethods) {
            for (const m of methods)
                this.generateMethodFunction(formName, m);
        }
        for (const [, impls] of this.traitImpls) {
            for (const [formName, methods] of impls) {
                for (const m of methods)
                    this.generateMethodFunction(formName, m);
            }
        }
    }
    generateMethodFunction(formName, m) {
        if (!m.body)
            return;
        const selfType = '%' + this.mangleForm(formName) + '*';
        const retType = this.getLLVMType(m.returnType);
        const paramTypes = m.params.map(p => this.getLLVMType(p.type));
        const savedOutput = this.output;
        const savedScopes = this.scopes;
        const savedAllocas = this.allocas;
        const savedReg = this.regCount;
        const savedTerminated = this.isBlockTerminated;
        const savedLabel = this.labelCount;
        this.output = [];
        this.scopes = [{ symbols: new Map(), temporaries: [] }];
        this.allocas = [];
        this.regCount = 1;
        this.isBlockTerminated = false;
        const fullTypes = [selfType, ...paramTypes];
        const paramsStr = fullTypes.map((t, i) => `${t} %arg${i}`).join(', ');
        const sig = `define ${retType} @${this.mangleMethod(formName, m.name)}(${paramsStr})`;
        this.methodIRs.push('');
        this.methodIRs.push(sig + ' {');
        this.methodIRs.push('entry:');
        const entryIndex = this.output.length;
        const selfPtr = '%self_ptr';
        this.allocas.push(` ${selfPtr} = alloca ${selfType}`);
        this.emit(`store ${selfType} %arg0, ${selfType}* ${selfPtr}`);
        this.setSymbol('self', { ptr: selfPtr, type: selfType });
        m.params.forEach((p, i) => {
            const ptr = '%' + p.name + '_ptr';
            this.allocas.push(` ${ptr} = alloca ${paramTypes[i]}`);
            this.emit(`store ${paramTypes[i]} %arg${i + 1}, ${paramTypes[i]}* ${ptr}`);
            this.setSymbol(p.name, { ptr: ptr, type: paramTypes[i] });
        });
        for (const stmt of m.body) {
            this.visitStatement(stmt);
        }
        this.exitScope();
        if (!this.isBlockTerminated) {
            if (retType === 'void')
                this.emit('ret void');
            else
                this.emit(`ret ${retType} 0`);
            this.isBlockTerminated = true;
        }
        this.output.splice(entryIndex, 0, ...this.allocas);
        this.methodIRs.push(...this.output);
        this.methodIRs.push('}');
        this.output = savedOutput;
        this.scopes = savedScopes;
        this.allocas = savedAllocas;
        this.regCount = savedReg;
        this.isBlockTerminated = savedTerminated;
        this.labelCount = savedLabel;
    }
    generateLambdaFunction(lambdaName, params, returnType, body, captured, capTypes) {
        const llvmRetType = this.getLLVMType(returnType);
        const paramTypes = params.map(p => this.getLLVMType(p.type));
        const savedOutput = this.output;
        const savedScopes = this.scopes;
        const savedAllocas = this.allocas;
        const savedReg = this.regCount;
        const savedTerminated = this.isBlockTerminated;
        const savedLabel = this.labelCount;
        this.output = [];
        this.scopes = [{ symbols: new Map(), temporaries: [] }];
        this.allocas = [];
        this.regCount = 1;
        this.isBlockTerminated = false;
        // thunk 签名：ret @lambda_N(i8* %env, args...)
        const closureTypeName = 'closure.' + lambdaName;
        const paramsStr = ['i8* %env', ...paramTypes.map((t, i) => `${t} %arg${i}`)].join(', ');
        this.lambdaIRs.push('');
        this.lambdaIRs.push(`define ${llvmRetType} @${lambdaName}(${paramsStr}) {`);
        this.lambdaIRs.push('entry:');
        const entryIndex = this.output.length;
        // 从 env（闭包对象）读捕获变量
        if (captured.length > 0) {
            const envTyped = this.nextReg();
            this.emit(`${envTyped} = bitcast i8* %env to %${closureTypeName}*`);
            captured.forEach((capName, i) => {
                const fieldPtr = this.nextReg();
                this.emit(`${fieldPtr} = getelementptr %${closureTypeName}, %${closureTypeName}* ${envTyped}, i32 0, i32 ${i + 1}`);
                const capPtr = '%' + capName + '_cap_ptr';
                this.allocas.push(` ${capPtr} = alloca ${capTypes[i]}`);
                const capVal = this.nextReg();
                this.emit(`${capVal} = load ${capTypes[i]}, ${capTypes[i]}* ${fieldPtr}`);
                this.emit(`store ${capTypes[i]} ${capVal}, ${capTypes[i]}* ${capPtr}`);
                this.setSymbol(capName, { ptr: capPtr, type: capTypes[i] });
            });
        }
        params.forEach((p, i) => {
            const ptr = '%' + p.name + '_ptr';
            this.allocas.push(` ${ptr} = alloca ${paramTypes[i]}`);
            this.emit(`store ${paramTypes[i]} %arg${i}, ${paramTypes[i]}* ${ptr}`);
            this.setSymbol(p.name, { ptr: ptr, type: paramTypes[i] });
        });
        for (const stmt of body) {
            this.visitStatement(stmt);
        }
        this.exitScope();
        if (!this.isBlockTerminated) {
            if (llvmRetType === 'void')
                this.emit('ret void');
            else
                this.emit(`ret ${llvmRetType} 0`);
            this.isBlockTerminated = true;
        }
        this.output.splice(entryIndex, 0, ...this.allocas);
        this.lambdaIRs.push(...this.output);
        this.lambdaIRs.push('}');
        this.output = savedOutput;
        this.scopes = savedScopes;
        this.allocas = savedAllocas;
        this.regCount = savedReg;
        this.isBlockTerminated = savedTerminated;
        this.labelCount = savedLabel;
    }
    // 收集 lambda 的自由变量（得要捕获的外部变量）
    collectFreeVariables(body, params) {
        const bound = new Set(params.map(p => p.name));
        const free = [];
        const seen = new Set();
        const markFree = (name) => {
            if (!bound.has(name) && !seen.has(name)) {
                seen.add(name);
                free.push(name);
            }
        };
        const visitExpr = (e) => {
            if (!e)
                return;
            switch (e.type) {
                case 'Identifier':
                    markFree(e.name);
                    break;
                case 'BinaryExpression':
                    visitExpr(e.left);
                    visitExpr(e.right);
                    break;
                case 'LogicalExpression':
                    visitExpr(e.left);
                    visitExpr(e.right);
                    break;
                case 'UnaryExpression':
                    visitExpr(e.argument);
                    break;
                case 'FunctionCall':
                    e.arguments.forEach(visitExpr);
                    break;
                case 'MemberExpression':
                    visitExpr(e.object);
                    e.arguments.forEach(visitExpr);
                    break;
                case 'NewExpression':
                    e.arguments.forEach(visitExpr);
                    break;
            }
        };
        const visitStmt = (s) => {
            switch (s.type) {
                case 'VariableDeclaration':
                    visitExpr(s.value);
                    bound.add(s.identifier);
                    break;
                case 'AssignmentStatement':
                    markFree(s.name);
                    visitExpr(s.value);
                    break;
                case 'ExpressionStatement':
                    visitExpr(s.expression);
                    break;
                case 'ReturnStatement':
                    visitExpr(s.argument);
                    break;
                case 'WhileStatement':
                    visitExpr(s.condition);
                    s.body.forEach(visitStmt);
                    if (s.elseBody)
                        s.elseBody.forEach(visitStmt);
                    break;
                case 'ForStatement':
                    if (s.init)
                        visitStmt(s.init);
                    if (s.condition)
                        visitExpr(s.condition);
                    s.body.forEach(visitStmt);
                    if (s.update)
                        visitStmt(s.update);
                    break;
            }
        };
        body.forEach(visitStmt);
        return free;
    }
    getLLVMFieldType(quarkType) {
        return this.getLLVMType(quarkType);
    }
    formSizeBytes(formName) {
        let size = 8; // vtable 指针（body 首个字段 i8*）
        for (const f of this.getFormFields(formName)) {
            size += this.typeSize(f.llvmType);
        }
        return size;
    }
    typeSize(t) {
        switch (t) {
            case 'i8': return 1;
            case 'i16': return 2;
            case 'i32': return 4;
            case 'i64': return 8;
            case 'float': return 4;
            case 'double': return 8;
            case 'i1': return 1;
            case 'i8*': return 8;
            default:
                if (t.endsWith('*'))
                    return 8;
                return 8;
        }
    }
    visitStatement(stmt) {
        if (this.isBlockTerminated)
            return;
        if (stmt.type === 'VariableDeclaration') {
            const rhs = this.visitExpression(stmt.value);
            this.untrackTemporary(rhs.val);
            const llvmType = stmt.varType === 'auto' ? rhs.type : this.getLLVMType(stmt.varType);
            const ptrReg = '%' + stmt.identifier + '_ptr_' + (this.labelCount++);
            this.allocas.push(` ${ptrReg} = alloca ${llvmType}`);
            this.emit(`store ${llvmType} ${rhs.val}, ${llvmType}* ${ptrReg}`);
            this.setSymbol(stmt.identifier, { ptr: ptrReg, type: llvmType });
        }
        else if (stmt.type === 'AssignmentStatement') {
            if (stmt.target) {
                const obj = this.visitExpression(stmt.target.object);
                const bareType = obj.type.replace(/^%/, '').replace(/\*$/, '');
                const formName = this.formTypeToName.get(bareType);
                if (!formName)
                    throw new Error(`IR Error: Cannot assign field of non-form type '${obj.type}'`);
                const prop = stmt.target.property;
                const field = this.getFormFields(formName).find(f => f.name === prop);
                if (!field)
                    throw new Error(`IR Error: form '${formName}' has no field '${prop}'`);
                const rhs = this.visitExpression(stmt.value);
                this.untrackTemporary(rhs.val);
                const gep = this.nextReg();
                this.emit(`${gep} = getelementptr %${bareType}, ${obj.type} ${obj.val}, i32 0, i32 ${field.index}`);
                this.emit(`store ${field.llvmType} ${rhs.val}, ${field.llvmType}* ${gep}`);
                return;
            }
            const rhs = this.visitExpression(stmt.value);
            this.untrackTemporary(rhs.val);
            const sym = this.getSymbol(stmt.name);
            if (!sym)
                throw new Error(`IR Error: Cannot reassign undeclared variable '${stmt.name}'`);
            this.emit(`store ${rhs.type} ${rhs.val}, ${sym.type}* ${sym.ptr}`);
        }
        else if (stmt.type === 'ReturnStatement') {
            const expr = this.visitExpression(stmt.argument);
            this.untrackTemporary(expr.val);
            this.emitCleanup();
            this.emit(`ret ${expr.type} ${expr.val}`);
            this.isBlockTerminated = true;
        }
        else if (stmt.type === 'WhileStatement') {
            const condLabel = this.nextLabel('while_cond_');
            const bodyLabel = this.nextLabel('while_body_');
            const afterLabel = this.nextLabel('while_after_');
            const hasElse = !!stmt.elseBody && stmt.elseBody.length > 0;
            const elseLabel = hasElse ? this.nextLabel('while_else_') : afterLabel;
            this.loopStack.push({ breakLabel: afterLabel, continueLabel: condLabel });
            if (!this.isBlockTerminated) {
                this.emit(`br label %${condLabel}`);
            }
            this.output.push(`\n${condLabel}:`);
            this.isBlockTerminated = false;
            const cond = this.visitExpression(stmt.condition);
            const condVal = this.toI1(cond);
            this.emit(`br i1 ${condVal}, label %${bodyLabel}, label %${elseLabel}`);
            this.isBlockTerminated = true;
            this.output.push(`\n${bodyLabel}:`);
            this.isBlockTerminated = false;
            this.enterScope();
            for (const bodyStmt of stmt.body) {
                this.visitStatement(bodyStmt);
            }
            this.exitScope();
            if (!this.isBlockTerminated) {
                this.emit(`br label %${condLabel}`);
                this.isBlockTerminated = true;
            }
            this.loopStack.pop();
            if (hasElse) {
                this.output.push(`\n${elseLabel}:`);
                this.isBlockTerminated = false;
                this.enterScope();
                for (const elseStmt of stmt.elseBody) {
                    this.visitStatement(elseStmt);
                }
                this.exitScope();
                if (!this.isBlockTerminated) {
                    this.emit(`br label %${afterLabel}`);
                    this.isBlockTerminated = true;
                }
            }
            this.output.push(`\n${afterLabel}:`);
            this.isBlockTerminated = false;
        }
        else if (stmt.type === 'ForStatement') {
            const condLabel = this.nextLabel('for_cond_');
            const bodyLabel = this.nextLabel('for_body_');
            const updateLabel = this.nextLabel('for_update_');
            const afterLabel = this.nextLabel('for_after_');
            this.enterScope();
            if (stmt.init) {
                this.visitStatement(stmt.init);
            }
            this.loopStack.push({ breakLabel: afterLabel, continueLabel: updateLabel });
            if (!this.isBlockTerminated) {
                this.emit(`br label %${condLabel}`);
            }
            this.output.push(`\n${condLabel}:`);
            this.isBlockTerminated = false;
            if (stmt.condition) {
                const cond = this.visitExpression(stmt.condition);
                const condVal = this.toI1(cond);
                this.emit(`br i1 ${condVal}, label %${bodyLabel}, label %${afterLabel}`);
            }
            else {
                this.emit(`br label %${bodyLabel}`);
            }
            this.isBlockTerminated = true;
            this.output.push(`\n${bodyLabel}:`);
            this.isBlockTerminated = false;
            for (const bodyStmt of stmt.body) {
                this.visitStatement(bodyStmt);
            }
            if (!this.isBlockTerminated) {
                this.emit(`br label %${updateLabel}`);
                this.isBlockTerminated = true;
            }
            this.output.push(`\n${updateLabel}:`);
            this.isBlockTerminated = false;
            if (stmt.update) {
                this.visitStatement(stmt.update);
            }
            if (!this.isBlockTerminated) {
                this.emit(`br label %${condLabel}`);
                this.isBlockTerminated = true;
            }
            this.loopStack.pop();
            this.output.push(`\n${afterLabel}:`);
            this.isBlockTerminated = false;
            this.exitScope();
        }
        else if (stmt.type === 'BreakStatement') {
            if (this.loopStack.length === 0) {
                throw new Error(`IR Error: 'break' outside of loop`);
            }
            const target = this.loopStack[this.loopStack.length - 1].breakLabel;
            this.emit(`br label %${target}`);
            this.isBlockTerminated = true;
        }
        else if (stmt.type === 'ContinueStatement') {
            if (this.loopStack.length === 0) {
                throw new Error(`IR Error: 'continue' outside of loop`);
            }
            const target = this.loopStack[this.loopStack.length - 1].continueLabel;
            this.emit(`br label %${target}`);
            this.isBlockTerminated = true;
        }
        else if (stmt.type === 'ExpressionStatement') {
            this.visitExpression(stmt.expression);
        }
    }
    visitExpression(expr) {
        if (expr.type === 'BinaryExpression') {
            const left = this.visitExpression(expr.left);
            const right = this.visitExpression(expr.right);
            const resReg = this.nextReg();
            const isFloat = left.type === 'double' || left.type === 'float';
            if (expr.operator === '+') {
                this.emit(`${resReg} = ${isFloat ? 'fadd' : 'add'} ${left.type} ${left.val}, ${right.val}`);
                return { val: resReg, type: left.type };
            }
            else if (expr.operator === '-') {
                this.emit(`${resReg} = ${isFloat ? 'fsub' : 'sub'} ${left.type} ${left.val}, ${right.val}`);
                return { val: resReg, type: left.type };
            }
            else if (expr.operator === '*') {
                this.emit(`${resReg} = ${isFloat ? 'fmul' : 'mul'} ${left.type} ${left.val}, ${right.val}`);
                return { val: resReg, type: left.type };
            }
            else if (expr.operator === '/') {
                this.emit(`${resReg} = ${isFloat ? 'fdiv' : 'sdiv'} ${left.type} ${left.val}, ${right.val}`);
                return { val: resReg, type: left.type };
            }
            else if (expr.operator === '<' || expr.operator === '>' ||
                expr.operator === '<=' || expr.operator === '>=' ||
                expr.operator === '==' || expr.operator === '!=') {
                const cmpMap = isFloat
                    ? { '<': 'olt', '>': 'ogt', '<=': 'ole', '>=': 'oge', '==': 'oeq', '!=': 'one' }
                    : { '<': 'slt', '>': 'sgt', '<=': 'sle', '>=': 'sge', '==': 'eq', '!=': 'ne' };
                const instr = isFloat ? 'fcmp' : 'icmp';
                this.emit(`${resReg} = ${instr} ${cmpMap[expr.operator]} ${left.type} ${left.val}, ${right.val}`);
                return { val: resReg, type: 'i1' };
            }
            throw new Error(`IR Error: Unsupported operator '${expr.operator}'`);
        }
        if (expr.type === 'LogicalExpression') {
            const resPtr = this.nextReg();
            this.allocas.push(` ${resPtr} = alloca i1`);
            const endLabel = this.nextLabel('logic_end_');
            const shortLabel = this.nextLabel('logic_short_');
            const evalLabel = this.nextLabel('logic_eval_');
            const left = this.visitExpression(expr.left);
            const leftCond = this.toI1(left);
            if (expr.operator === '&&') {
                this.emit(`br i1 ${leftCond}, label %${evalLabel}, label %${shortLabel}`);
            }
            else {
                this.emit(`br i1 ${leftCond}, label %${shortLabel}, label %${evalLabel}`);
            }
            this.output.push(`\n${shortLabel}:`);
            this.emit(`store i1 ${expr.operator === '&&' ? 'false' : 'true'}, i1* ${resPtr}`);
            this.emit(`br label %${endLabel}`);
            this.output.push(`\n${evalLabel}:`);
            const right = this.visitExpression(expr.right);
            const rightCond = this.toI1(right);
            this.emit(`store i1 ${rightCond}, i1* ${resPtr}`);
            this.emit(`br label %${endLabel}`);
            this.output.push(`\n${endLabel}:`);
            const resReg = this.nextReg();
            this.emit(`${resReg} = load i1, i1* ${resPtr}`);
            return { val: resReg, type: 'i1' };
        }
        if (expr.type === 'UnaryExpression') {
            const arg = this.visitExpression(expr.argument);
            if (expr.operator === '!') {
                const argCond = this.toI1(arg);
                const resReg = this.nextReg();
                this.emit(`${resReg} = xor i1 ${argCond}, true`);
                return { val: resReg, type: 'i1' };
            }
            else {
                const resReg = this.nextReg();
                if (arg.type === 'double' || arg.type === 'float') {
                    this.emit(`${resReg} = fsub ${arg.type} -0.0, ${arg.val}`);
                }
                else {
                    this.emit(`${resReg} = sub ${arg.type} 0, ${arg.val}`);
                }
                return { val: resReg, type: arg.type };
            }
        }
        if (expr.type === 'FunctionExpression') {
            const lambdaName = 'lambda_' + (this.lambdaCount++);
            const retTypeStr = expr.returnType ?? 'int32';
            const retType = this.getLLVMType(retTypeStr);
            const paramTypes = expr.params.map(p => this.getLLVMType(p.type));
            // 收集自由变量（同样得捕获的外部变量）
            const captured = this.collectFreeVariables(expr.body, expr.params);
            const capTypes = captured.map(c => this.getSymbol(c)?.type ?? 'i32');
            // 定义闭包 struct 类型：{ i8* fn_ptr, cap_types... }
            const closureTypeName = 'closure.' + lambdaName;
            const capFields = capTypes.join(', ');
            this.typeDefs.push(`%${closureTypeName} = type { ${capFields ? 'i8*, ' + capFields : 'i8*'} }`);
            // 生成 thunk（含 env + 捕获变量读取）
            this.generateLambdaFunction(lambdaName, expr.params, retTypeStr, expr.body, captured, capTypes);
            // malloc 闭包对象
            const totalSize = 8 + capTypes.reduce((s, t) => s + this.typeSize(t), 0);
            const mallocRes = this.nextReg();
            this.emit(`${mallocRes} = call i8* @malloc(i64 ${totalSize})`);
            const closurePtr = this.nextReg();
            this.emit(`${closurePtr} = bitcast i8* ${mallocRes} to %${closureTypeName}*`);
            // store fn_ptr（field 0）
            const fnPtrField = this.nextReg();
            this.emit(`${fnPtrField} = getelementptr %${closureTypeName}, %${closureTypeName}* ${closurePtr}, i32 0, i32 0`);
            const thunkPtr = this.nextReg();
            this.emit(`${thunkPtr} = bitcast ${retType} (i8*, ${paramTypes.join(', ')})* @${lambdaName} to i8*`);
            this.emit(`store i8* ${thunkPtr}, i8** ${fnPtrField}`);
            // store 捕获变量（field 1..n）
            captured.forEach((capName, i) => {
                const sym = this.getSymbol(capName);
                if (!sym)
                    return;
                const capVal = this.nextReg();
                this.emit(`${capVal} = load ${capTypes[i]}, ${capTypes[i]}* ${sym.ptr}`);
                const fieldPtr = this.nextReg();
                this.emit(`${fieldPtr} = getelementptr %${closureTypeName}, %${closureTypeName}* ${closurePtr}, i32 0, i32 ${i + 1}`);
                this.emit(`store ${capTypes[i]} ${capVal}, ${capTypes[i]}* ${fieldPtr}`);
            });
            // 返回闭包对象指针（i8*）
            const resultPtr = this.nextReg();
            this.emit(`${resultPtr} = bitcast %${closureTypeName}* ${closurePtr} to i8*`);
            return { val: resultPtr, type: 'i8*' };
        }
        if (expr.type === 'NumberLiteral') {
            if (expr.value % 1 !== 0) {
                return { val: expr.value.toString(), type: 'double' };
            }
            return { val: expr.value.toString(), type: 'i32' };
        }
        if (expr.type === 'StringLiteral') {
            const strGlobal = this.addStringLiteral(expr.value);
            const strLen = expr.value.length + 1;
            const resReg = this.nextReg();
            this.emit(`${resReg} = getelementptr inbounds [${strLen} x i8], [${strLen} x i8]* ${strGlobal}, i64 0, i64 0`);
            return { val: resReg, type: 'i8*' };
        }
        if (expr.type === 'Identifier') {
            const sym = this.getSymbol(expr.name);
            if (!sym)
                throw new Error(`IR Error: Unresolved variable '${expr.name}'`);
            const loadReg = this.nextReg();
            this.emit(`${loadReg} = load ${sym.type}, ${sym.type}* ${sym.ptr}`);
            return { val: loadReg, type: sym.type };
        }
        if (expr.type === 'NewExpression') {
            const resReg = this.nextReg();
            if (expr.className === 'BellState') {
                this.emit(`${resReg} = call %QObject* @qk_create_BellState()`);
                this.trackTemporary(resReg, '%QObject*');
                return { val: resReg, type: '%QObject*' };
            }
            if (expr.className === 'DiracState') {
                const arg = expr.arguments.length > 0 ? this.visitExpression(expr.arguments[0]).val : '0';
                this.emit(`${resReg} = call %QObject* @qk_create_DiracState(i32 ${arg})`);
                this.trackTemporary(resReg, '%QObject*');
                return { val: resReg, type: '%QObject*' };
            }
            if (expr.className === 'QuantumRegister') {
                const arg = this.visitExpression(expr.arguments[0]).val;
                this.emit(`${resReg} = call %QObject* @qk_create_QuantumRegister(i32 ${arg})`);
                this.trackTemporary(resReg, '%QObject*');
                return { val: resReg, type: '%QObject*' };
            }
            let actualName = expr.className.split('<')[0];
            if (expr.className.includes('<')) {
                const inst = this.instantiateTemplate(expr.className);
                if (inst)
                    actualName = inst;
            }
            if (this.forms.has(actualName)) {
                const formType = '%' + this.mangleForm(actualName);
                const objReg = '%form_obj_' + (this.regCount++);
                if (expr.heapAlloc) {
                    const sizeBytes = this.formSizeBytes(actualName);
                    const raw = this.nextReg();
                    this.emit(`${raw} = call i8* @qk_gc_alloc(i64 ${sizeBytes})`);
                    this.emit(`${objReg} = bitcast i8* ${raw} to ${formType}*`);
                }
                else {
                    this.allocas.push(` ${objReg} = alloca ${formType}`);
                }
                let vtType = null;
                for (const [traitName, impls] of this.traitImpls) {
                    if (impls.has(actualName)) {
                        vtType = '%' + this.mangleForm(traitName) + '.vtable';
                        break;
                    }
                }
                if (vtType) {
                    const vtPtr = this.nextReg();
                    this.emit(`${vtPtr} = getelementptr ${formType}, ${formType}* ${objReg}, i32 0, i32 0`);
                    this.emit(`store i8* bitcast (${vtType}* @${this.mangleForm(actualName)}.vtable to i8*), i8** ${vtPtr}`);
                }
                return { val: objReg, type: formType + '*' };
            }
        }
        if (expr.type === 'FunctionCall') {
            if (expr.name === 'alloc') {
                const resReg = this.nextReg();
                this.emit(`${resReg} = call %Qubit* @__quantum__rt__qubit_allocate()`);
                this.trackTemporary(resReg, '%Qubit*');
                return { val: resReg, type: '%Qubit*' };
            }
            if (expr.name === 'qk_sys_call') {
                const args = expr.arguments.map(a => this.visitExpression(a));
                const resReg = this.nextReg();
                this.emit(`${resReg} = call i32 @qk_sys_call(${args.map(a => `i32 ${a.val}`).join(', ')})`);
                return { val: resReg, type: 'i32' };
            }
            if (expr.name === 'qk_sys_calld') {
                const args = expr.arguments.map(a => this.visitExpression(a));
                const resReg = this.nextReg();
                this.emit(`${resReg} = call double @qk_sys_calld(i32 ${args[0].val}, double ${args[1].val}, double ${args[2].val})`);
                return { val: resReg, type: 'double' };
            }
            if (expr.name === 'qk_sys_log') {
                const level = this.visitExpression(expr.arguments[0]);
                const msg = this.visitExpression(expr.arguments[1]);
                this.emit(`call void @qk_sys_log(i32 ${level.val}, i8* ${msg.val})`);
                return { val: 'void', type: 'void' };
            }
            if (expr.name === 'qk_sys_logi') {
                const level = this.visitExpression(expr.arguments[0]);
                const v = this.visitExpression(expr.arguments[1]);
                const resReg = this.nextReg();
                this.emit(`${resReg} = call i32 @qk_sys_logi(i32 ${level.val}, i32 ${v.val})`);
                return { val: resReg, type: 'i32' };
            }
            if (expr.name === 'measure') {
                const arg = this.visitExpression(expr.arguments[0]);
                const resReg = this.nextReg();
                this.emit(`${resReg} = call i32 @__quantum__qis__measure_int(${arg.type} ${arg.val})`);
                return { val: resReg, type: 'i32' };
            }
            if (expr.name === 'h' || expr.name === 'x') {
                const arg = this.visitExpression(expr.arguments[0]);
                this.emit(`call void @__quantum__qis__${expr.name}(${arg.type} ${arg.val})`);
                return { val: 'void', type: 'void' };
            }
            if (expr.name === 'rz') {
                const q = this.visitExpression(expr.arguments[0]);
                const angle = this.visitExpression(expr.arguments[1]);
                const angleVal = angle.type === 'i32' ? `${angle.val}.0` : angle.val;
                this.emit(`call void @__quantum__qis__rz(double ${angleVal}, ${q.type} ${q.val})`);
                return { val: 'void', type: 'void' };
            }
            if (expr.name === 'cnot' || expr.name === 'swap' || expr.name === 'braid') {
                const a = this.visitExpression(expr.arguments[0]);
                const b = this.visitExpression(expr.arguments[1]);
                this.emit(`call void @__quantum__qis__${expr.name}(${a.type} ${a.val}, ${b.type} ${b.val})`);
                return { val: 'void', type: 'void' };
            }
            if (expr.name === 'toffoli') {
                const c1 = this.visitExpression(expr.arguments[0]);
                const c2 = this.visitExpression(expr.arguments[1]);
                const t = this.visitExpression(expr.arguments[2]);
                this.emit(`call void @__quantum__qis__toffoli(${c1.type} ${c1.val}, ${c2.type} ${c2.val}, ${t.type} ${t.val})`);
                return { val: 'void', type: 'void' };
            }
            if (expr.name === 'qft') {
                const n = this.visitExpression(expr.arguments[0]);
                this.emit(`call void @__quantum__qis__qft(i32 ${n.val})`);
                return { val: 'void', type: 'void' };
            }
            if (expr.name === 'measure_x' || expr.name === 'measure_y') {
                const arg = this.visitExpression(expr.arguments[0]);
                const basis = expr.name === 'measure_x' ? 88 : 89; // 'X' / 'Y'
                const resReg = this.nextReg();
                this.emit(`${resReg} = call i32 @__quantum__qis__measure_basis(${arg.type} ${arg.val}, i8 ${basis})`);
                return { val: resReg, type: 'i32' };
            }
            if (expr.name === 'encode_text') {
                const arg = this.visitExpression(expr.arguments[0]);
                const resReg = this.nextReg();
                this.emit(`${resReg} = call %QObject* @qk_encode_text(i8* ${arg.val})`);
                this.trackTemporary(resReg, '%QObject*');
                return { val: resReg, type: '%QObject*' };
            }
            if (expr.name === 'qlm_invoke') {
                const dataArg = this.visitExpression(expr.arguments[0]);
                const epochsArg = this.visitExpression(expr.arguments[1]);
                const lrArg = this.visitExpression(expr.arguments[2]);
                const lrVal = lrArg.type === 'i32' ? `${lrArg.val}.0` : lrArg.val;
                const resReg = this.nextReg();
                this.emit(`${resReg} = call %QModel* @qk_qlm_invoke(%QObject* ${dataArg.val}, i32 ${epochsArg.val}, double ${lrVal})`);
                return { val: resReg, type: '%QModel*' };
            }
            if (expr.name === 'qlm_load') {
                const arg = this.visitExpression(expr.arguments[0]);
                const resReg = this.nextReg();
                this.emit(`${resReg} = call %QModel* @qk_qlm_load(i8* ${arg.val})`);
                return { val: resReg, type: '%QModel*' };
            }
            if (expr.name === 'qk_encode_string') {
                const arg = this.visitExpression(expr.arguments[0]);
                const resReg = this.nextReg();
                this.emit(`${resReg} = call %QObject* @qk_encode_string(i8* ${arg.val})`);
                this.trackTemporary(resReg, '%QObject*');
                return { val: resReg, type: '%QObject*' };
            }
            if (expr.name === 'qlm_forward') {
                const modelArg = this.visitExpression(expr.arguments[0]);
                const inputArg = this.visitExpression(expr.arguments[1]);
                const resReg = this.nextReg();
                this.emit(`call void @qk_qlm_forward(%QModel* ${modelArg.val}, %QObject* ${inputArg.val})`);
                return { val: 'void', type: 'void' };
            }
            if (expr.name === 'qk_decode_string') {
                const arg = this.visitExpression(expr.arguments[0]);
                const resReg = this.nextReg();
                this.emit(`${resReg} = call i8* @qk_decode_string(%QObject* ${arg.val})`);
                return { val: resReg, type: 'i8*' };
            }
            if (expr.name === 'mind_read') {
                const arg = this.visitExpression(expr.arguments[0]);
                const resReg = this.nextReg();
                this.emit(`${resReg} = call %QObject* @qk_mind_read(i8* ${arg.val})`);
                this.trackTemporary(resReg, '%QObject*');
                return { val: resReg, type: '%QObject*' };
            }
            if (expr.name === 'mind_train') {
                const dataArg = this.visitExpression(expr.arguments[0]);
                const epochsArg = this.visitExpression(expr.arguments[1]);
                const lrArg = this.visitExpression(expr.arguments[2]);
                const lrVal = lrArg.type === 'i32' ? `${lrArg.val}.0` : lrArg.val;
                this.emit(`call void @qk_mind_train(%QObject* ${dataArg.val}, i32 ${epochsArg.val}, double ${lrVal})`);
                return { val: 'void', type: 'void' };
            }
            if (expr.name === 'mind_feedback') {
                const arg = this.visitExpression(expr.arguments[0]);
                this.emit(`call void @qk_mind_feedback(%QObject* ${arg.val})`);
                return { val: 'void', type: 'void' };
            }
            if (expr.name === 'veda_qlm_train') {
                const dataArg = this.visitExpression(expr.arguments[0]);
                const epochsArg = this.visitExpression(expr.arguments[1]);
                const lrArg = this.visitExpression(expr.arguments[2]);
                const lrVal = lrArg.type === 'i32' ? `${lrArg.val}.0` : lrArg.val;
                this.emit(`call void @qk_veda_qlm_train(%QObject* ${dataArg.val}, i32 ${epochsArg.val}, double ${lrVal})`);
                return { val: 'void', type: 'void' };
            }
            const scalarMathFns = {
                surrogate: ['double', 'double', 'double'],
                tanh_quantize: ['double', 'double', 'i32'],
                lif_step: ['double', 'double', 'double', 'double'],
                mellowmax2: ['double', 'double', 'double'],
                logsumexp2: ['double', 'double', 'double'],
                boltzmann2: ['double', 'double', 'double'],
                tnorm_luk: ['double', 'double'],
                tnorm_prod: ['double', 'double'],
                tnorm_godel: ['double', 'double'],
                polymer_weight: ['double', 'double', 'double'],
                polymer_mix_bound: ['double', 'double'],
            };
            const sfTypes = scalarMathFns[expr.name];
            if (sfTypes) {
                const argVals = expr.arguments.map(a => this.visitExpression(a));
                const callArgs = argVals.map((a, i) => {
                    const want = sfTypes[i];
                    if (want === 'double' && a.type === 'i32')
                        return `double ${a.val}.0`;
                    return `${want} ${a.val}`;
                }).join(', ');
                const res = this.nextReg();
                this.emit(`${res} = call double @qk_${expr.name}(${callArgs})`);
                return { val: res, type: 'double' };
            }
            if (expr.name.includes('::')) {
                const segs = expr.name.split('::');
                if (segs.length === 2 && this.importAliases.has(segs[0])) {
                    const alias = segs[0];
                    const funcName = segs[1];
                    const symbol = alias + '_' + funcName;
                    const sig = this.importSigs.get(expr.name);
                    const retType = sig ? sig.ret : 'i32';
                    const argVals = expr.arguments.map(a => this.visitExpression(a));
                    const paramTypes = sig
                        ? sig.params
                        : argVals.map(a => a.type);
                    const callArgs = argVals.map((a, i) => `${paramTypes[i]} ${a.val}`).join(', ');
                    if (retType === 'void') {
                        this.emit(`call void @${symbol}(${callArgs})`);
                        return { val: 'void', type: 'void' };
                    }
                    const res = this.nextReg();
                    this.emit(`${res} = call ${retType} @${symbol}(${callArgs})`);
                    return { val: res, type: retType };
                }
            }
            const userFn = this.userFunctions.get(expr.name);
            if (userFn) {
                const retType = this.getLLVMType(userFn.returnType);
                const paramTypes = userFn.params.map(p => this.getLLVMType(p.type));
                const argVals = expr.arguments.map(a => this.visitExpression(a));
                const callArgs = argVals.map((a, i) => `${paramTypes[i]} ${a.val}`).join(', ');
                if (retType === 'void') {
                    this.emit(`call void @${expr.name}(${callArgs})`);
                    return { val: 'void', type: 'void' };
                }
                const res = this.nextReg();
                this.emit(`${res} = call ${retType} @${expr.name}(${callArgs})`);
                return { val: res, type: retType };
            }
            // 函数变量间接调用（lambda / 闭包）
            const fnSym = this.getSymbol(expr.name);
            if (fnSym && fnSym.type === 'i8*') {
                const argVals = expr.arguments.map(a => this.visitExpression(a));
                const argTypes = argVals.map(a => a.type);
                // 闭包对象指针（fnSym.ptr 存的是 i8* 闭包对象指针）
                const closurePtr = this.nextReg();
                this.emit(`${closurePtr} = load i8*, i8** ${fnSym.ptr}`);
                // fn_ptr 在闭包对象 offset 0（i8* 字段）
                const fnPtrPtr = this.nextReg();
                this.emit(`${fnPtrPtr} = bitcast i8* ${closurePtr} to i8**`);
                const fnRaw = this.nextReg();
                this.emit(`${fnRaw} = load i8*, i8** ${fnPtrPtr}`);
                const fnTyped = this.nextReg();
                this.emit(`${fnTyped} = bitcast i8* ${fnRaw} to i32 (i8*, ${argTypes.join(', ')})*`);
                const res = this.nextReg();
                this.emit(`${res} = call i32 ${fnTyped}(i8* ${closurePtr}, ${argVals.map(a => a.type + ' ' + a.val).join(', ')})`);
                return { val: res, type: 'i32' };
            }
            throw new Error(`IR Error: Unknown function '${expr.name}'`);
        }
        if (expr.type === 'MemberExpression') {
            const obj = this.visitExpression(expr.object);
            const bareType = obj.type.replace(/^%/, '').replace(/\*$/, '');
            const formName = this.formTypeToName.get(bareType);
            if (formName) {
                const fields = this.getFormFields(formName);
                const field = fields.find(f => f.name === expr.property);
                if (field && !expr.isMethodCall) {
                    const gep = this.nextReg();
                    this.emit(`${gep} = getelementptr %${bareType}, ${obj.type} ${obj.val}, i32 0, i32 ${field.index}`);
                    const loadReg = this.nextReg();
                    this.emit(`${loadReg} = load ${field.llvmType}, ${field.llvmType}* ${gep}`);
                    return { val: loadReg, type: field.llvmType };
                }
                const methodName = expr.property;
                const inherent = this.implMethods.get(formName) || [];
                const inherentMethod = inherent.find(m => m.name === methodName);
                if (inherentMethod && inherentMethod.body) {
                    const retType = this.getLLVMType(inherentMethod.returnType);
                    const argVals = expr.arguments.map(a => this.visitExpression(a));
                    const argTypes = [obj.type, ...inherentMethod.params.map(p => this.getLLVMType(p.type))];
                    const callArgs = [obj.type + ' ' + obj.val, ...argVals.map((a, i) => argTypes[i + 1] + ' ' + a.val)].join(', ');
                    if (retType === 'void') {
                        this.emit(`call void @${this.mangleMethod(formName, methodName)}(${callArgs})`);
                        return { val: 'void', type: 'void' };
                    }
                    const res = this.nextReg();
                    this.emit(`${res} = call ${retType} @${this.mangleMethod(formName, methodName)}(${callArgs})`);
                    return { val: res, type: retType };
                }
                for (const [traitName, impls] of this.traitImpls) {
                    if (!impls.has(formName))
                        continue;
                    const trait = this.traits.get(traitName);
                    if (!trait)
                        continue;
                    const traitMethods = [];
                    for (const rank of trait.ranks)
                        traitMethods.push(...rank.methods);
                    const slot = traitMethods.findIndex(m => m.name === methodName);
                    if (slot < 0)
                        continue;
                    const tm = traitMethods[slot];
                    const retType = this.getLLVMType(tm.returnType);
                    const vtType = '%' + this.mangleForm(traitName) + '.vtable';
                    const vtPtrPtr = this.nextReg();
                    this.emit(`${vtPtrPtr} = getelementptr %${bareType}, ${obj.type} ${obj.val}, i32 0, i32 0`);
                    const vtRaw = this.nextReg();
                    this.emit(`${vtRaw} = load i8*, i8** ${vtPtrPtr}`);
                    const vtTyped = this.nextReg();
                    this.emit(`${vtTyped} = bitcast i8* ${vtRaw} to ${vtType}*`);
                    const slotPtr = this.nextReg();
                    this.emit(`${slotPtr} = getelementptr ${vtType}, ${vtType}* ${vtTyped}, i32 0, i32 ${slot}`);
                    const fnRaw = this.nextReg();
                    this.emit(`${fnRaw} = load i8*, i8** ${slotPtr}`);
                    const selfType = '%' + this.mangleForm(formName) + '*';
                    const paramTypes = tm.params.map(p => this.getLLVMType(p.type));
                    const fnType = `${retType} (${[selfType, ...paramTypes].join(', ')})*`;
                    const fnTyped = this.nextReg();
                    this.emit(`${fnTyped} = bitcast i8* ${fnRaw} to ${fnType}`);
                    const argVals = expr.arguments.map(a => this.visitExpression(a));
                    const callArgs = [selfType + ' ' + obj.val, ...argVals.map((a, i) => paramTypes[i] + ' ' + a.val)].join(', ');
                    if (retType === 'void') {
                        this.emit(`call void ${fnTyped}(${callArgs})`);
                        return { val: 'void', type: 'void' };
                    }
                    const res = this.nextReg();
                    this.emit(`${res} = call ${retType} ${fnTyped}(${callArgs})`);
                    return { val: res, type: retType };
                }
            }
            if (expr.property === 'export') {
                const pathArg = this.visitExpression(expr.arguments[0]);
                this.emit(`call void @qk_qkm_export(${obj.type} ${obj.val}, i8* ${pathArg.val})`);
                return { val: 'void', type: 'void' };
            }
            if (expr.property === 'measure') {
                const resReg = this.nextReg();
                this.emit(`${resReg} = call i32 @qk_measure_object(%QObject* ${obj.val})`);
                return { val: resReg, type: 'i32' };
            }
        }
        throw new Error(`IR Error: Unknown expression type '${expr.type}'`);
    }
    visitFunctionDeclaration(func) {
        const llvmRetType = this.getLLVMType(func.returnType);
        const paramTypes = func.params.map(p => this.getLLVMType(p.type));
        this.output.push(``);
        const paramsStr = paramTypes.map((t, i) => `${t} %arg${i}`).join(', ');
        this.output.push(`define ${llvmRetType} @${func.name}(${paramsStr}) {`);
        this.output.push(`entry:`);
        this.scopes = [{ symbols: new Map(), temporaries: [] }];
        this.regCount = 1;
        this.allocas = [];
        this.isBlockTerminated = false;
        const entryIndex = this.output.length;
        func.params.forEach((p, i) => {
            const ptr = '%' + p.name + '_ptr';
            this.allocas.push(` ${ptr} = alloca ${paramTypes[i]}`);
            this.emit(`store ${paramTypes[i]} %arg${i}, ${paramTypes[i]}* ${ptr}`);
            this.setSymbol(p.name, { ptr: ptr, type: paramTypes[i] });
        });
        for (const stmt of func.body) {
            this.visitStatement(stmt);
        }
        this.exitScope();
        if (!this.isBlockTerminated) {
            if (llvmRetType === 'void')
                this.emit(`ret void`);
            else
                this.emit(`ret ${llvmRetType} 0`);
            this.isBlockTerminated = true;
        }
        this.output.splice(entryIndex, 0, ...this.allocas);
        this.output.push(`}`);
    }
    getLLVMType(quarkType) {
        switch (quarkType) {
            case 'int8':
            case 'uint8':
            case 'char': return 'i8';
            case 'int16':
            case 'uint16': return 'i16';
            case 'int':
            case 'int32':
            case 'uint32': return 'i32';
            case 'int64':
            case 'uint64': return 'i64';
            case 'float': return 'float';
            case 'double': return 'double';
            case 'string': return 'i8*';
            case 'Qubit': return '%Qubit*';
            case 'QObject': return '%QObject*';
            case 'QModel': return '%QModel*';
            default:
                if (this.forms.has(quarkType))
                    return '%' + this.mangleForm(quarkType) + '*';
                if (quarkType.startsWith('(') && quarkType.includes(')->'))
                    return 'i8*'; // 函数类型
                throw new Error(`IR Error: Unknown type '${quarkType}'`);
        }
    }
}
exports.IRGenerator = IRGenerator;
//# sourceMappingURL=ir.js.map