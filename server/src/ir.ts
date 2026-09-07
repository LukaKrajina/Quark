import { Expression, Program, Statement, FunctionDeclaration, ReturnStatement, Item, FormDecl, TraitDecl, ImplDecl, TemplateDecl, FnDecl, FieldDecl, RankBlock, Param } from './ast';

function isTopLevelItem(node: any): node is Item {
    return ['ModuleDecl', 'UseDecl', 'FormDecl', 'FlavorDecl', 'ImplDecl', 'TraitDecl', 'TemplateDecl', 'ImportDecl', 'RequiresDecl'].includes(node.type);
}

interface LLVMValue {
    val: string;
    type: string;
}

interface Scope {
    symbols: Map<string, { ptr: string, type: string }>;
    temporaries: { val: string, type: string }[];
}

interface FormField {
    name: string;
    llvmType: string;
    index: number;
    rank: string;
}

export class IRGenerator {
    private output: string[] = [];
    private globalStrings: string[] = [];
    private stringConstants: Map<string, string> = new Map();
    private stringCount: number = 1;
    private regCount: number = 1;
    private scopes: Scope[] = [{ symbols: new Map(), temporaries: [] }];
    private labelCount: number = 1;
    private loopStack: { breakLabel: string; continueLabel: string }[] = [];
    private lambdaCount: number = 1;
    private lambdaIRs: string[] = [];
    private allocas: string[] = [];
    private isBlockTerminated: boolean = false;
    private forms: Map<string, FormDecl> = new Map();
    private traits: Map<string, TraitDecl> = new Map();
    private implMethods: Map<string, FnDecl[]> = new Map();
    private traitImpls: Map<string, Map<string, FnDecl[]>> = new Map();
    private templates: TemplateDecl[] = [];
    private flavorMembers: Map<string, number> = new Map();
    private typeDefs: string[] = [];
    private methodIRs: string[] = [];
    private vtableConsts: string[] = [];
    private formTypeToName: Map<string, string> = new Map();
    private userFunctions: Map<string, FunctionDeclaration> = new Map();
    private importAliases: Map<string, string> = new Map();
    private importSigs: Map<string, { params: string[]; ret: string }> = new Map();

    private nextReg(): string {
        return '%' + (this.regCount++);
    }

    private nextLabel(prefix: string): string {
        return prefix + (this.labelCount++);
    }

    private toI1(val: LLVMValue): string {
        if (val.type === 'i1') return val.val;
        const resReg = this.nextReg();
        this.emit(`${resReg} = icmp ne ${val.type} ${val.val}, 0`);
        return resReg;
    }

    private enterScope() {
        this.scopes.push({ symbols: new Map(), temporaries: [] });
    }

    private emitScopeCleanup(scope: Scope) {
        for (const [, sym] of scope.symbols.entries()) {
            if (sym.type === '%QObject*') {
                const loadReg = this.nextReg();
                this.emit(`${loadReg} = load ${sym.type}, ${sym.type}* ${sym.ptr}`);
                this.emit(`call void @qk_release_object(${sym.type} ${loadReg})`);
            } else if (sym.type === '%Qubit*') {
                const loadReg = this.nextReg();
                this.emit(`${loadReg} = load ${sym.type}, ${sym.type}* ${sym.ptr}`);
                this.emit(`call void @__quantum__rt__qubit_release(${sym.type} ${loadReg})`);
            }
        }

        for (const temp of scope.temporaries) {
            if (temp.type === '%QObject*') {
                this.emit(`call void @qk_release_object(${temp.type} ${temp.val})`);
            } else if (temp.type === '%Qubit*') {
                this.emit(`call void @__quantum__rt__qubit_release(${temp.type} ${temp.val})`);
            }
        }
    }

    private emitCleanup() {
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            this.emitScopeCleanup(this.scopes[i]);
        }
    }

    private exitScope() {
        const currentScope = this.scopes.pop();
        if (!currentScope) return;
        if (!this.isBlockTerminated) {
            this.emitScopeCleanup(currentScope);
        }
    }

    private setSymbol(name: string, data: { ptr: string, type: string }) {
        this.scopes[this.scopes.length - 1].symbols.set(name, data);
    }

    private getSymbol(name: string): { ptr: string, type: string } | undefined {
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            if (this.scopes[i].symbols.has(name)) return this.scopes[i].symbols.get(name);
        }
        return undefined;
    }

    private trackTemporary(val: string, type: string) {
        this.scopes[this.scopes.length - 1].temporaries.push({ val, type });
    }

    private untrackTemporary(val: string) {
        const currentScope = this.scopes[this.scopes.length - 1];
        currentScope.temporaries = currentScope.temporaries.filter(t => t.val !== val);
    }

    private emit(instruction: string) {
        this.output.push(' ' + instruction);
    }

    private addStringLiteral(str: string): string {
        return this.getOrCreateStringConstant(str);
    }

    private getOrCreateStringConstant(value: string): string {

        if (this.stringConstants.has(value)) {
            return this.stringConstants.get(value)!;
        }

        let llvmStr = "";
        let byteLength = 1;
        for (let i = 0; i < value.length; i++) {
            const charCode = value.charCodeAt(i);

            if (charCode === 34) {
                llvmStr += "\\22";
                byteLength++;
            } else if (charCode === 92) {
                llvmStr += "\\5C";
                byteLength++;
            } else if (charCode === 10) {
                llvmStr += "\\0A";
                byteLength++;
            } else if (charCode === 13) {
                llvmStr += "\\0D";
                byteLength++;
            } else {
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

    public generate(ast: Program, importSignatures?: Map<string, Map<string, { params: string[]; ret: string }>>): string {
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
            `declare %QObject* @qk_create_basis_state(double, double, i32)`,
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
            `declare i8* @qk_sys_callp(i32, i64, i64, i64)`,
            `declare void @qk_gc_free(i8*)`,
            ``,
            `; --- QMS 数值内核（算法 4）---`,
            `declare double @qk_qms_gap(i32, double, double)`,
            `declare double @qk_mix_bound(double, double, double)`,
            `declare double @qk_qms_conc(double, double)`,
            ``
        ];

        const hasExplicitFunctions = ast.body.some(node => node.type === 'FunctionDeclaration');

        if (!hasExplicitFunctions) {
            this.output.push(`define i32 @quark_main() {`);
            this.output.push(`entry:`);
            const entryIndex = this.output.length;

            for (const node of ast.body) {
                if (isTopLevelItem(node)) continue;
                this.visitStatement(node as Statement);
            }

            this.exitScope();

            if (!this.isBlockTerminated) {
                this.emit(`ret i32 0`);
                this.isBlockTerminated = true;
            }

            this.output.push(`}`);
            this.output.splice(entryIndex, 0, ...this.allocas);
        } else {
            for (const node of ast.body) {
                if (node.type === 'FunctionDeclaration') {
                    this.visitFunctionDeclaration(node as FunctionDeclaration);
                } else if (isTopLevelItem(node)) {
                    continue;
                } else {
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

    private buildImportDecls(): string[] {
        const decls: string[] = [];
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

    private resetDecls() {
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

    private collectDeclarations(items: (Statement | Item)[], prefix: string) {
        for (const node of items) {
            if (node.type === 'FormDecl') {
                const fullName = prefix ? prefix + '::' + node.name : node.name;
                this.forms.set(fullName, node);
            } else if (node.type === 'FlavorDecl') {
                node.members.forEach((m, i) => this.flavorMembers.set(m, i));
            } else if (node.type === 'TraitDecl') {
                const fullName = prefix ? prefix + '::' + node.name : node.name;
                this.traits.set(fullName, node);
            } else if (node.type === 'ImplDecl') {
                if (node.traitName) {
                    if (!this.traitImpls.has(node.traitName)) this.traitImpls.set(node.traitName, new Map());
                    this.traitImpls.get(node.traitName)!.set(node.target, node.methods);
                } else {
                    if (!this.implMethods.has(node.target)) this.implMethods.set(node.target, []);
                    this.implMethods.get(node.target)!.push(...node.methods);
                }
            } else if (node.type === 'TemplateDecl') {
                this.templates.push(node);
            } else if (node.type === 'FunctionDeclaration') {
                this.userFunctions.set(node.name, node);
            } else if (node.type === 'ImportDecl') {
                this.importAliases.set(node.alias, node.path);
            } else if (node.type === 'ModuleDecl') {
                const fullName = prefix ? prefix + '::' + node.name : node.name;
                this.collectDeclarations(node.body, fullName);
            }
        }
    }

    private mangleForm(name: string): string {
        return 'form.' + name.replace(/::/g, '__');
    }

    private mangleMethod(formName: string, methodName: string): string {
        return formName.replace(/::/g, '__') + '_' + methodName;
    }

    private getFormFields(formName: string): FormField[] {
        const form = this.forms.get(formName);
        if (!form) return [];

        const fields: FormField[] = [];
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

    private instantiateTemplate(className: string): string | null {
        const match = className.match(/^([\w]+)<(.+)>$/);
        if (!match) return null;
        const templateName = match[1];
        const typeArg = match[2];

        const template = this.templates.find(t => t.inner.type === 'FormDecl' && t.inner.name === templateName);
        if (!template) return null;

        const instName = templateName + '_' + typeArg;
        if (this.forms.has(instName)) return instName;

        const formDecl = template.inner as FormDecl;
        const instForm: FormDecl = {
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

    private preInstantiateTemplates(ast: Program) {
        const visit = (node: any) => {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'NewExpression' && typeof node.className === 'string' && node.className.includes('<')) {
                this.instantiateTemplate(node.className);
            }
            for (const key of Object.keys(node)) {
                if (key === 'line' || key === 'column' || key === 'length') continue;
                const child = node[key];
                if (Array.isArray(child)) child.forEach(visit);
                else if (child && typeof child === 'object') visit(child);
            }
        };
        visit(ast);
    }

    private generateFormTypes() {
        for (const [formName, form] of this.forms) {
            const fields = this.getFormFields(formName);
            const body = ['i8*', ...fields.map(f => f.llvmType)];
            const typeName = this.mangleForm(formName);
            this.typeDefs.push(`%${typeName} = type { ${body.join(', ')} }`);
            this.formTypeToName.set(typeName, formName);
        }
        this.typeDefs.push('');
    }

    private generateVtables() {
        for (const [traitName, impls] of this.traitImpls) {
            const trait = this.traits.get(traitName);
            if (!trait) continue;
            const methodNames: string[] = [];
            for (const rank of trait.ranks) {
                for (const m of rank.methods) methodNames.push(m.name);
            }
            if (methodNames.length === 0) continue;

            const vtableType = `%${this.mangleForm(traitName)}.vtable`;
            const slots = methodNames.map(() => `i8*`);
            this.typeDefs.push(`${vtableType} = type { ${slots.join(', ')} }`);

            for (const [formName, methods] of impls) {
                const implByName = new Map(methods.map(m => [m.name, m]));
                const entries = methodNames.map(n => {
                    const m = implByName.get(n);
                    if (!m) return 'i8* null';
                    const paramTypes = m.params.map(p => this.getLLVMType(p.type));
                    const selfType = '%' + this.mangleForm(formName) + '*';
                    const fnType = `${this.getLLVMType(m.returnType)} (${[selfType, ...paramTypes].join(', ')})*`;
                    return `i8* bitcast (${fnType} @${this.mangleMethod(formName, n)} to i8*)`;
                });
                this.vtableConsts.push(`@${this.mangleForm(formName)}.vtable = constant ${vtableType} { ${entries.join(', ')} }`);
            }
        }
        if (this.vtableConsts.length > 0) this.vtableConsts.push('');
    }

    private generateImplMethods() {
        for (const [formName, methods] of this.implMethods) {
            for (const m of methods) this.generateMethodFunction(formName, m);
        }
        for (const [, impls] of this.traitImpls) {
            for (const [formName, methods] of impls) {
                for (const m of methods) this.generateMethodFunction(formName, m);
            }
        }
    }

    private generateMethodFunction(formName: string, m: FnDecl) {
        if (!m.body) return;

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
            if (retType === 'void') this.emit('ret void');
            else this.emit(`ret ${retType} 0`);
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

    private generateLambdaFunction(lambdaName: string, params: Param[], returnType: string, body: Statement[], captured: string[], capTypes: string[]): void {
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
            if (llvmRetType === 'void') this.emit('ret void');
            else this.emit(`ret ${llvmRetType} 0`);
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
    private collectFreeVariables(body: Statement[], params: Param[]): string[] {
        const bound = new Set<string>(params.map(p => p.name));
        const free: string[] = [];
        const seen = new Set<string>();

        const markFree = (name: string) => {
            if (!bound.has(name) && !seen.has(name)) {
                seen.add(name);
                free.push(name);
            }
        };

        const visitExpr = (e: Expression) => {
            if (!e) return;
            switch (e.type) {
                case 'Identifier':
                    markFree(e.name);
                    break;
                case 'BinaryExpression':
                    visitExpr(e.left); visitExpr(e.right); break;
                case 'LogicalExpression':
                    visitExpr(e.left); visitExpr(e.right); break;
                case 'UnaryExpression':
                    visitExpr(e.argument); break;
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

        const visitStmt = (s: Statement) => {
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
                    if (s.elseBody) s.elseBody.forEach(visitStmt);
                    break;
                case 'IfStatement':
                    visitExpr(s.condition);
                    s.consequent.forEach(visitStmt);
                    if (s.alternate) s.alternate.forEach(visitStmt);
                    break;
                case 'UnsafeBlock':
                    s.body.forEach(visitStmt);
                    break;
                case 'ForStatement':
                    if (s.init) visitStmt(s.init);
                    if (s.condition) visitExpr(s.condition);
                    s.body.forEach(visitStmt);
                    if (s.update) visitStmt(s.update);
                    break;
            }
        };

        body.forEach(visitStmt);
        return free;
    }

    private getLLVMFieldType(quarkType: string): string {
        return this.getLLVMType(quarkType);
    }

    private formSizeBytes(formName: string): number {
        let size = 8; // vtable 指针（body 首个字段 i8*）
        for (const f of this.getFormFields(formName)) {
            size += this.typeSize(f.llvmType);
        }
        return size;
    }

    private typeSize(t: string): number {
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
                if (t.endsWith('*')) return 8;
                return 8;
        }
    }

    private visitStatement(stmt: Statement) {
        if (this.isBlockTerminated) return;
        if (stmt.type === 'VariableDeclaration') {
            const rhs = this.visitExpression(stmt.value);
            this.untrackTemporary(rhs.val);
            const llvmType = stmt.varType === 'auto' ? rhs.type : this.getLLVMType(stmt.varType);
            const ptrReg = '%' + stmt.identifier + '_ptr_' + (this.labelCount++);
            this.allocas.push(` ${ptrReg} = alloca ${llvmType}`);

            // int -> cap：整型地址构造能力（inttoptr）
            let storedVal = rhs.val;
            if (llvmType.endsWith('*') && !rhs.type.endsWith('*') && rhs.val !== 'null') {
                const castReg = this.nextReg();
                this.emit(`${castReg} = inttoptr ${rhs.type} ${rhs.val} to ${llvmType}`);
                storedVal = castReg;
            }

            this.emit(`store ${llvmType} ${storedVal}, ${llvmType}* ${ptrReg}`);
            this.setSymbol(stmt.identifier, { ptr: ptrReg, type: llvmType });
        }
        else if (stmt.type === 'AssignmentStatement') {
            // 指针解引用赋值：*p = v
            if (stmt.target && stmt.target.type === 'Dereference') {
                const ptr = this.visitExpression(stmt.target.target);
                const pointee = ptr.type.endsWith('*') ? ptr.type.slice(0, -1) : 'i32';
                const rhs = this.visitExpression(stmt.value);
                this.untrackTemporary(rhs.val);
                this.emit(`store ${pointee} ${rhs.val}, ${ptr.type} ${ptr.val}`);
                return;
            }
            if (stmt.target) {
                const obj = this.visitExpression((stmt.target as any).object);
                const bareType = obj.type.replace(/^%/, '').replace(/\*$/, '');
                const formName = this.formTypeToName.get(bareType);
                if (!formName) throw new Error(`IR Error: Cannot assign field of non-form type '${obj.type}'`);
                const prop = (stmt.target as any).property;
                const field = this.getFormFields(formName).find(f => f.name === prop);
                if (!field) throw new Error(`IR Error: form '${formName}' has no field '${prop}'`);
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
            if (!sym) throw new Error(`IR Error: Cannot reassign undeclared variable '${stmt.name}'`);
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
                for (const elseStmt of stmt.elseBody!) {
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
        else if (stmt.type === 'IfStatement') {
            const thenLabel = this.nextLabel('if_then_');
            const elseLabel = this.nextLabel('if_else_');
            const afterLabel = this.nextLabel('if_after_');
            const hasElse = !!stmt.alternate && stmt.alternate.length > 0;

            // 条件在当前块内求值（无需像 while 那样先跳到 cond 块）
            const cond = this.visitExpression(stmt.condition);
            const condVal = this.toI1(cond);
            this.emit(`br i1 ${condVal}, label %${thenLabel}, label %${hasElse ? elseLabel : afterLabel}`);
            this.isBlockTerminated = true;

            // then 分支
            this.output.push(`\n${thenLabel}:`);
            this.isBlockTerminated = false;
            this.enterScope();
            for (const bodyStmt of stmt.consequent) {
                this.visitStatement(bodyStmt);
            }
            this.exitScope();
            if (!this.isBlockTerminated) {
                this.emit(`br label %${afterLabel}`);
                this.isBlockTerminated = true;
            }

            // else 分支：else if 在 parser 中已表示为「只含一个 IfStatement 的
            // 数组」，递归走本分支即可自然展开，无需特判。
            if (hasElse) {
                this.output.push(`\n${elseLabel}:`);
                this.isBlockTerminated = false;
                this.enterScope();
                for (const elseStmt of stmt.alternate!) {
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
        else if (stmt.type === 'UnsafeBlock') {
            // unsafe 块在 IR 层面是透明包装：危险操作（裸指针 / MMIO / 内联汇编）
            // 由内层语句各自生成，这里按顺序生成内部语句即可。
            for (const s of stmt.body) {
                this.visitStatement(s);
            }
        }
        else if (stmt.type === 'RouteStatement') {
            const disc = this.visitExpression(stmt.discriminant);
            const caseLabels = stmt.cases.map(() => this.nextLabel('route_path_'));
            const cmpLabels = stmt.cases.map(() => this.nextLabel('route_cmp_'));
            const fallbackLabel = this.nextLabel('route_fallback_');
            const afterLabel = this.nextLabel('route_after_');
            const hasFallback = !!stmt.fallback;

            // 进入第一个比较块
            this.emit(`br label %${cmpLabels[0]}`);
            this.isBlockTerminated = true;

            // 比较链（icmp eq 逐个路径值）
            for (let i = 0; i < stmt.cases.length; i++) {
                this.output.push(`\n${cmpLabels[i]}:`);
                this.isBlockTerminated = false;
                const caseVal = this.visitExpression(stmt.cases[i].value);
                const cmpReg = this.nextReg();
                this.emit(`${cmpReg} = icmp eq ${disc.type} ${disc.val}, ${caseVal.val}`);
                const nextTarget = (i + 1 < stmt.cases.length)
                    ? cmpLabels[i + 1]
                    : (hasFallback ? fallbackLabel : afterLabel);
                this.emit(`br i1 ${cmpReg}, label %${caseLabels[i]}, label %${nextTarget}`);
                this.isBlockTerminated = true;
            }

            // 各路径体
            for (let i = 0; i < stmt.cases.length; i++) {
                this.output.push(`\n${caseLabels[i]}:`);
                this.isBlockTerminated = false;
                this.enterScope();
                for (const s of stmt.cases[i].body) {
                    this.visitStatement(s);
                }
                this.exitScope();
                if (!this.isBlockTerminated) {
                    this.emit(`br label %${afterLabel}`);
                    this.isBlockTerminated = true;
                }
            }

            // fallback（default）
            if (hasFallback) {
                this.output.push(`\n${fallbackLabel}:`);
                this.isBlockTerminated = false;
                this.enterScope();
                for (const s of stmt.fallback!) {
                    this.visitStatement(s);
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
        else if (stmt.type === 'SpinStatement') {
            const bodyLabel = this.nextLabel('spin_body_');
            const condLabel = this.nextLabel('spin_cond_');
            const afterLabel = this.nextLabel('spin_after_');

            // 先执行循环体
            this.emit(`br label %${bodyLabel}`);
            this.isBlockTerminated = true;

            this.output.push(`\n${bodyLabel}:`);
            this.isBlockTerminated = false;
            this.enterScope();
            for (const s of stmt.body) {
                this.visitStatement(s);
            }
            this.exitScope();
            if (!this.isBlockTerminated) {
                this.emit(`br label %${condLabel}`);
                this.isBlockTerminated = true;
            }

            // 再判断条件
            this.output.push(`\n${condLabel}:`);
            this.isBlockTerminated = false;
            const cond = this.visitExpression(stmt.condition);
            const condVal = this.toI1(cond);
            this.emit(`br i1 ${condVal}, label %${bodyLabel}, label %${afterLabel}`);
            this.isBlockTerminated = true;

            this.output.push(`\n${afterLabel}:`);
            this.isBlockTerminated = false;
        }
        else if (stmt.type === 'SpawnStatement') {
            // 并发线程：宿主 JIT 无并发，串行降级（内联块体）。
            // 真正的并发语义由 QCOS 调度器承载；此处仅保证 IR 可生成。
            this.emit(`; spawn { ... } (single-threaded fallback)`);
            this.enterScope();
            for (const s of stmt.body) {
                this.visitStatement(s);
            }
            this.exitScope();
        }
        else if (stmt.type === 'EntangleStatement') {
            // 纠缠声明：纯静态信息（供竞争检测），不生成运行时指令。
            this.emit(`; entangle (static entanglement declaration)`);
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
            } else {
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

    private visitExpression(expr: Expression): LLVMValue {
        if (expr.type === 'BinaryExpression') {
            const left = this.visitExpression(expr.left);
            const right = this.visitExpression(expr.right);
            const resReg = this.nextReg();
            const isFloat = left.type === 'double' || left.type === 'float';

            if (expr.operator === '+') {
                if (left.type.endsWith('*')) {
                    // 指针偏移：p + i -> getelementptr（cap<T> 的指针算术）
                    const elem = left.type.slice(0, -1);
                    this.emit(`${resReg} = getelementptr ${elem}, ${left.type} ${left.val}, i32 ${right.val}`);
                    return { val: resReg, type: left.type };
                }
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
            else if (expr.operator === '&') {
                this.emit(`${resReg} = and ${left.type} ${left.val}, ${right.val}`);
                return { val: resReg, type: left.type };
            }
            else if (expr.operator === '|') {
                this.emit(`${resReg} = or ${left.type} ${left.val}, ${right.val}`);
                return { val: resReg, type: left.type };
            }
            else if (expr.operator === '^') {
                this.emit(`${resReg} = xor ${left.type} ${left.val}, ${right.val}`);
                return { val: resReg, type: left.type };
            }
            else if (expr.operator === '<<') {
                this.emit(`${resReg} = shl ${left.type} ${left.val}, ${right.val}`);
                return { val: resReg, type: left.type };
            }
            else if (expr.operator === '>>') {
                this.emit(`${resReg} = ashr ${left.type} ${left.val}, ${right.val}`);
                return { val: resReg, type: left.type };
            }
            else if (expr.operator === '<' || expr.operator === '>' ||
                     expr.operator === '<=' || expr.operator === '>=' ||
                     expr.operator === '==' || expr.operator === '!=') {
                const cmpMap: Record<string, string> = isFloat
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
            } else {
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
            } else if ((expr.operator as string) === '~') {
                // 按位取反：xor -1
                const resReg = this.nextReg();
                this.emit(`${resReg} = xor ${arg.type} ${arg.val}, -1`);
                return { val: resReg, type: arg.type };
            } else {
                const resReg = this.nextReg();
                if (arg.type === 'double' || arg.type === 'float') {
                    this.emit(`${resReg} = fsub ${arg.type} -0.0, ${arg.val}`);
                } else {
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
                if (!sym) return;
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
            if (expr.isFloat) {
                // 整数值浮点字面量（如 0.0 / 1024.0）需显式保留小数点，
                // 否则 LLVM 会把 `double 0` 判为整数常量而报错。
                let s = expr.value.toString();
                if (!/[.eE]/.test(s)) s += '.0';
                return { val: s, type: 'double' };
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

        if (expr.type === 'NullLiteral') {
            return { val: 'null', type: 'i8*' };
        }

        if (expr.type === 'Dereference') {
            const ptr = this.visitExpression(expr.target);
            const pointee = ptr.type.endsWith('*') ? ptr.type.slice(0, -1) : 'i32';
            const resReg = this.nextReg();
            this.emit(`${resReg} = load ${pointee}, ${ptr.type} ${ptr.val}`);
            return { val: resReg, type: pointee };
        }

        if (expr.type === 'AddressOf') {
            if (expr.target.type === 'Identifier') {
                // &x（局部变量）→ 其 alloca 地址（type*）；&fn（函数名）→ 函数符号
                const sym = this.getSymbol(expr.target.name);
                if (sym) {
                    return { val: sym.ptr, type: sym.type + '*' };
                }
                return { val: '@' + expr.target.name, type: 'i8*' };
            }
            throw new Error('IR Error: address-of requires a function name');
        }

        if (expr.type === 'FuseExpression') {
            const resultTy = 'i32';
            // 先分配结果临时变量，再求值判别式——保证寄存器编号在最终 IR 中单调递增
            // （allocas 会被 splice 到函数入口，必须先于任何普通指令编号）。
            const resultPtr = this.nextReg();
            this.allocas.push(` ${resultPtr} = alloca ${resultTy}`);

            const disc = this.visitExpression(expr.discriminant);

            const armLabels = expr.arms.map(() => this.nextLabel('fuse_arm_'));
            const cmpLabels = expr.arms.map(() => this.nextLabel('fuse_cmp_'));
            const afterLabel = this.nextLabel('fuse_after_');

            this.emit(`br label %${cmpLabels[0]}`);
            this.isBlockTerminated = true;

            // 比较链
            for (let i = 0; i < expr.arms.length; i++) {
                const arm = expr.arms[i];
                this.output.push(`\n${cmpLabels[i]}:`);
                this.isBlockTerminated = false;
                if (arm.pattern === null) {
                    this.emit(`br label %${armLabels[i]}`);
                    this.isBlockTerminated = true;
                } else {
                    const pat = this.visitExpression(arm.pattern);
                    const cmpReg = this.nextReg();
                    this.emit(`${cmpReg} = icmp eq ${disc.type} ${disc.val}, ${pat.val}`);
                    const nextTarget = (i + 1 < expr.arms.length) ? cmpLabels[i + 1] : afterLabel;
                    this.emit(`br i1 ${cmpReg}, label %${armLabels[i]}, label %${nextTarget}`);
                    this.isBlockTerminated = true;
                }
            }

            // 各 arm 求值 + 存储结果
            for (let i = 0; i < expr.arms.length; i++) {
                this.output.push(`\n${armLabels[i]}:`);
                this.isBlockTerminated = false;
                const val = this.visitExpression(expr.arms[i].value);
                this.emit(`store ${resultTy} ${val.val}, ${resultTy}* ${resultPtr}`);
                this.emit(`br label %${afterLabel}`);
                this.isBlockTerminated = true;
            }

            // 汇聚：加载结果
            this.output.push(`\n${afterLabel}:`);
            this.isBlockTerminated = false;
            const resReg = this.nextReg();
            this.emit(`${resReg} = load ${resultTy}, ${resultTy}* ${resultPtr}`);
            return { val: resReg, type: resultTy };
        }

        if (expr.type === 'NativeExpression') {
            this.emit(`call void asm sideeffect "${expr.template}", ""()`);
            return { val: 'void', type: 'void' };
        }

        if (expr.type === 'Identifier') {
            if (this.flavorMembers.has(expr.name)) {
                // 味成员：直接内联整数值
                return { val: String(this.flavorMembers.get(expr.name)), type: 'i32' };
            }
            const sym = this.getSymbol(expr.name);
            if (!sym) throw new Error(`IR Error: Unresolved variable '${expr.name}'`);
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
                if (inst) actualName = inst;
            }

            if (this.forms.has(actualName)) {
                const formType = '%' + this.mangleForm(actualName);
                const objReg = '%form_obj_' + (this.regCount++);
                if (expr.heapAlloc) {
                    const sizeBytes = this.formSizeBytes(actualName);
                    const raw = this.nextReg();
                    this.emit(`${raw} = call i8* @qk_gc_alloc(i64 ${sizeBytes})`);
                    this.emit(`${objReg} = bitcast i8* ${raw} to ${formType}*`);
                } else {
                    this.allocas.push(` ${objReg} = alloca ${formType}`);
                }
                let vtType: string | null = null;
                for (const [traitName, impls] of this.traitImpls) {
                    if (impls.has(actualName)) { vtType = '%' + this.mangleForm(traitName) + '.vtable'; break; }
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

            // 任意基构建量子态：basis_state(theta, phi, value)
            if (expr.name === 'basis_state') {
                const thetaArg = this.visitExpression(expr.arguments[0]);
                const phiArg = this.visitExpression(expr.arguments[1]);
                const valueArg = this.visitExpression(expr.arguments[2]);
                const thetaVal = thetaArg.type === 'i32' ? `${thetaArg.val}.0` : thetaArg.val;
                const phiVal = phiArg.type === 'i32' ? `${phiArg.val}.0` : phiArg.val;
                const resReg = this.nextReg();
                this.emit(`${resReg} = call %QObject* @qk_create_basis_state(double ${thetaVal}, double ${phiVal}, i32 ${valueArg.val})`);
                this.trackTemporary(resReg, '%QObject*');
                return { val: resReg, type: '%QObject*' };
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

            // QMS 数值内核（算法 4）
            if (expr.name === 'qk_qms_gap') {
                const args = expr.arguments.map(a => this.visitExpression(a));
                const resReg = this.nextReg();
                this.emit(`${resReg} = call double @qk_qms_gap(i32 ${args[0].val}, double ${args[1].val}, double ${args[2].val})`);
                return { val: resReg, type: 'double' };
            }
            if (expr.name === 'qk_mix_bound') {
                const args = expr.arguments.map(a => this.visitExpression(a));
                const resReg = this.nextReg();
                this.emit(`${resReg} = call double @qk_mix_bound(double ${args[0].val}, double ${args[1].val}, double ${args[2].val})`);
                return { val: resReg, type: 'double' };
            }
            if (expr.name === 'qk_qms_conc') {
                const args = expr.arguments.map(a => this.visitExpression(a));
                const resReg = this.nextReg();
                this.emit(`${resReg} = call double @qk_qms_conc(double ${args[0].val}, double ${args[1].val})`);
                return { val: resReg, type: 'double' };
            }

            // 同步内存事件（系统级：自旋锁 / 计数器；语义源自弱内存模型）
            if (expr.name === 'sync_load') {
                const p = this.visitExpression(expr.arguments[0]);
                const pointee = p.type.endsWith('*') ? p.type.slice(0, -1) : 'i32';
                const resReg = this.nextReg();
                this.emit(`${resReg} = load atomic ${pointee}, ${p.type} ${p.val} seq_cst, align 4`);
                return { val: resReg, type: pointee };
            }
            if (expr.name === 'sync_store') {
                const p = this.visitExpression(expr.arguments[0]);
                const v = this.visitExpression(expr.arguments[1]);
                const pointee = p.type.endsWith('*') ? p.type.slice(0, -1) : 'i32';
                this.emit(`store atomic ${pointee} ${v.val}, ${p.type} ${p.val} seq_cst, align 4`);
                return { val: 'void', type: 'void' };
            }
            if (expr.name === 'sync_add') {
                const p = this.visitExpression(expr.arguments[0]);
                const v = this.visitExpression(expr.arguments[1]);
                const resReg = this.nextReg();
                this.emit(`${resReg} = atomicrmw add ${p.type} ${p.val}, i32 ${v.val} seq_cst`);
                return { val: resReg, type: 'i32' };
            }
            if (expr.name === 'sync_cas') {
                const p = this.visitExpression(expr.arguments[0]);
                const oldV = this.visitExpression(expr.arguments[1]);
                const newV = this.visitExpression(expr.arguments[2]);
                const pointee = p.type.endsWith('*') ? p.type.slice(0, -1) : 'i32';
                const tmpReg = this.nextReg();
                const resReg = this.nextReg();
                this.emit(`${tmpReg} = cmpxchg ${p.type} ${p.val}, ${pointee} ${oldV.val}, ${pointee} ${newV.val} seq_cst seq_cst`);
                this.emit(`${resReg} = extractvalue { ${pointee}, i1 } ${tmpReg}, 0`);
                return { val: resReg, type: pointee };
            }

            // 端口 I/O（x86 内联汇编：outb/inb，值在 AL、端口在 DX）
            // 内联汇编要求端口为 i16、值为 i8，而 qk 整型默认 i32：
            // 字面量直接拼写即可；变量（%N）需先 trunc 到目标宽度，
            // 否则出现 `i8 %5` 而 %5 实为 i32 的类型不匹配。
            if (expr.name === 'outb') {
                const port = this.visitExpression(expr.arguments[0]);
                const value = this.visitExpression(expr.arguments[1]);
                let portVal = port.val;
                if (port.val.startsWith('%')) {
                    const t = this.nextReg();
                    this.emit(`${t} = trunc ${port.type} ${port.val} to i16`);
                    portVal = t;
                }
                let valueVal = value.val;
                if (value.val.startsWith('%')) {
                    const t = this.nextReg();
                    this.emit(`${t} = trunc ${value.type} ${value.val} to i8`);
                    valueVal = t;
                }
                const tpl = 'outb ${0:b}, ${1:w}';
                this.emit(`call void asm sideeffect "${tpl}", "{ax},{dx},~{dirflag},~{fpsr},~{flags}"(i8 ${valueVal}, i16 ${portVal})`);
                return { val: 'void', type: 'void' };
            }
            if (expr.name === 'inb') {
                const port = this.visitExpression(expr.arguments[0]);
                let portVal = port.val;
                if (port.val.startsWith('%')) {
                    const t = this.nextReg();
                    this.emit(`${t} = trunc ${port.type} ${port.val} to i16`);
                    portVal = t;
                }
                const tmpReg = this.nextReg();
                const resReg = this.nextReg();
                const tpl = 'inb ${1:w}, ${0:b}';
                this.emit(`${tmpReg} = call i8 asm sideeffect "${tpl}", "={ax},{dx},~{dirflag},~{fpsr},~{flags}"(i16 ${portVal})`);
                this.emit(`${resReg} = zext i8 ${tmpReg} to i32`);
                return { val: resReg, type: 'i32' };
            }
            if (expr.name === 'qk_gc_alloc') {
                const size = this.visitExpression(expr.arguments[0]);
                const zReg = this.nextReg();
                const rawReg = this.nextReg();
                const resReg = this.nextReg();
                this.emit(`${zReg} = zext i32 ${size.val} to i64`);
                this.emit(`${rawReg} = call i8* @qk_gc_alloc(i64 ${zReg})`);
                // 以 int32 字为单位看待原始内存
                this.emit(`${resReg} = bitcast i8* ${rawReg} to i32*`);
                return { val: resReg, type: 'i32*' };
            }
            if (expr.name === 'qk_sys_callp') {
                const args = expr.arguments.map(a => this.visitExpression(a));
                const z0 = this.nextReg(), z1 = this.nextReg(), z2 = this.nextReg();
                this.emit(`${z0} = zext i32 ${args[1].val} to i64`);
                this.emit(`${z1} = zext i32 ${args[2].val} to i64`);
                this.emit(`${z2} = zext i32 ${args[3].val} to i64`);
                const resReg = this.nextReg();
                this.emit(`${resReg} = call i8* @qk_sys_callp(i32 ${args[0].val}, i64 ${z0}, i64 ${z1}, i64 ${z2})`);
                return { val: resReg, type: 'i8*' };
            }
            if (expr.name === 'qk_gc_free') {
                const p = this.visitExpression(expr.arguments[0]);
                const bc = this.nextReg();
                this.emit(`${bc} = bitcast ${p.type} ${p.val} to i8*`);
                this.emit(`call void @qk_gc_free(i8* ${bc})`);
                return { val: 'void', type: 'void' };
            }
            if (expr.name === 'addr') {
                const p = this.visitExpression(expr.arguments[0]);
                const resReg = this.nextReg();
                this.emit(`${resReg} = ptrtoint ${p.type} ${p.val} to i32`);
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
                const basis = expr.name === 'measure_x' ? 88 : 89;  // 'X' / 'Y'
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

            const scalarMathFns: Record<string, string[]> = {
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
                    if (want === 'double' && a.type === 'i32') return `double ${a.val}.0`;
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
                    if (!impls.has(formName)) continue;
                    const trait = this.traits.get(traitName);
                    if (!trait) continue;
                    const traitMethods: FnDecl[] = [];
                    for (const rank of trait.ranks) traitMethods.push(...rank.methods);
                    const slot = traitMethods.findIndex(m => m.name === methodName);
                    if (slot < 0) continue;
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

    private visitFunctionDeclaration(func: FunctionDeclaration) {
        const llvmRetType = this.getLLVMType(func.returnType);
        const paramTypes = func.params.map(p => this.getLLVMType(p.type));

        this.output.push(``);
        const paramsStr = paramTypes.map((t, i) => `${t} %arg${i}`).join(', ');

        // 函数属性（系统级）：@[section(".text.boot")] -> section "...", @[naked] -> naked
        let fnAttrs = '';
        if (func.attributes && func.attributes.length > 0) {
            const parts = func.attributes
                .map(a => {
                    if (a.name === 'place' && a.value) return `section "${a.value}"`;
                    if (a.name === 'raw') return 'naked';
                    return '';
                })
                .filter(s => s !== '');
            if (parts.length > 0) fnAttrs = ' ' + parts.join(' ');
        }
        this.output.push(`define ${llvmRetType} @${func.name}(${paramsStr})${fnAttrs} {`);
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
            if (llvmRetType === 'void') this.emit(`ret void`);
            else this.emit(`ret ${llvmRetType} 0`);
            this.isBlockTerminated = true;
        }

        this.output.splice(entryIndex, 0, ...this.allocas);
        this.output.push(`}`);
    }

    private getLLVMType(quarkType: string): string {
        switch (quarkType) {
            case 'int8': case 'uint8': case 'char': return 'i8';
            case 'int16': case 'uint16': return 'i16';
            case 'int': case 'int32': case 'uint32': return 'i32';
            case 'int64': case 'uint64': return 'i64';
            case 'float': return 'float';
            case 'double': return 'double';
            case 'string': return 'i8*';
            case 'Qubit': return '%Qubit*';
            case 'QObject': return '%QObject*';
            case 'QModel': return '%QModel*';
            default:
                if (quarkType.startsWith('cap<')) {
                    const inner = quarkType.slice(4, -1);
                    return this.getLLVMType(inner) + '*'; // 能力（typed pointer）
                }
                if (this.forms.has(quarkType)) return '%' + this.mangleForm(quarkType) + '*';
                if (quarkType.startsWith('(') && quarkType.includes(')->')) return 'i8*'; // 函数类型
                throw new Error(`IR Error: Unknown type '${quarkType}'`);
        }
    }
}