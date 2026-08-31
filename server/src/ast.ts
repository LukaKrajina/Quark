<<<<<<< HEAD
export interface ASTNode {
    type: string;
    line: number;
    column: number;
    length: number;
}

export interface Program extends ASTNode {
    type: 'Program';
    body: (Statement | Item)[];
}

export type Statement = 
    |VariableDeclaration 
    | ExpressionStatement 
    | WhileStatement 
    | AssignmentStatement
    | FunctionDeclaration 
    | ReturnStatement;

export interface VariableDeclaration extends ASTNode {
    type: 'VariableDeclaration';
    varType: string;
    identifier: string;
    value: Expression;
}

export interface ExpressionStatement extends ASTNode {
    type: 'ExpressionStatement';
    expression: Expression;
}

export interface BinaryExpression  extends ASTNode {
    type: 'BinaryExpression';
    operator: string;
    left: Expression;
    right: Expression;
}

export interface WhileStatement extends ASTNode {
    type: 'WhileStatement';
    condition: Expression;
    body: Statement[];
}

export interface AssignmentStatement extends ASTNode {
    type: 'AssignmentStatement';
    name: string;
    value: Expression;
}

// ============================================================================
// 表达式
// ============================================================================
export type Expression =
    | NumberLiteral 
    | StringLiteral
    | CharLiteral
    | Identifier 
    | FunctionCall
    | NewExpression
    | MemberExpression
    | BinaryExpression

export interface NumberLiteral extends ASTNode {
    type: 'NumberLiteral';
    value: number;
}

export interface CharLiteral extends ASTNode {
    type: 'CharLiteral';
    value: string;
}

export interface StringLiteral extends ASTNode {
    type: 'StringLiteral';
    value: string;
}

export interface Identifier extends ASTNode {
    type: 'Identifier';
    name: string;
}

export interface FunctionCall extends ASTNode {
    type: 'FunctionCall';
    name: string;             // 简单名，或完整路径 'a::b::fn'
    arguments: Expression[];
}

export interface NewExpression extends ASTNode {
    type: 'NewExpression';
    className: string;
    arguments: Expression[];
}

export interface MemberExpression extends ASTNode {
    type: 'MemberExpression';
    object: Expression;
    property: string;
    isMethodCall: boolean;
    arguments: Expression[];
}

export type Item =
    | ModuleDecl
    | UseDecl
    | FormDecl
    | ImplDecl
    | TraitDecl
    | TemplateDecl
    | ImportDecl
    | RequiresDecl;

export interface Param {
    name: string;
    type: string;
}

export interface FieldDecl {
    name: string;
    type: string;
    isPub: boolean;
}


export interface FnDecl {
    name: string;
    receiver: string | null;
    params: Param[];
    returnType: string;
    isPub: boolean;
    body: Statement[] | null;
    line: number;
    column: number;
    length: number;
}

export interface RankBlock {
    name: string;
    fields: FieldDecl[];
    methods: FnDecl[];
}

export interface InheritClause {
    base: string;
    ranks: string[];
}

export interface ModuleDecl extends ASTNode {
    type: 'ModuleDecl';
    name: string;
    body: Item[];
}

export interface UseDecl extends ASTNode {
    type: 'UseDecl';
    path: string[];
}

export interface FormDecl extends ASTNode {
    type: 'FormDecl';
    name: string;
    isPub: boolean;
    isExport: boolean;
    inherits: InheritClause | null;
    ranks: RankBlock[];
}

export interface ImplDecl extends ASTNode {
    type: 'ImplDecl';
    target: string;
    traitName: string | null;
    rank: string | null;
    methods: FnDecl[];
}

export interface TraitDecl extends ASTNode {
    type: 'TraitDecl';
    name: string;
    isPub: boolean;
    inherits: InheritClause | null;
    ranks: RankBlock[];
}

export interface TemplateDecl extends ASTNode {
    type: 'TemplateDecl';
    params: string[];
    inner: FormDecl | ImplDecl;
}

export interface ImportDecl extends ASTNode {
    type: 'ImportDecl';
    alias: string;
    path: string;
}

export interface RequiresDecl extends ASTNode {
    type: 'RequiresDecl';
    permission: string;
}

export interface FunctionDeclaration extends ASTNode {
    type: 'FunctionDeclaration';
    returnType: string;
    name: string;
    params: Param[];
    receiver: string | null;
    isPub: boolean;
    isExport: boolean;
    body: Statement[];
}

export interface ReturnStatement extends ASTNode {
    type: 'ReturnStatement';
    argument: Expression;
=======
export interface ASTNode {
    type: string;
    line: number;
    column: number;
    length: number;
}

export interface Program extends ASTNode {
    type: 'Program';
    body: (Statement | Item)[];
}

export type Statement = 
    |VariableDeclaration 
    | ExpressionStatement 
    | WhileStatement 
    | ForStatement
    | BreakStatement
    | ContinueStatement
    | AssignmentStatement
    | FunctionDeclaration 
    | ReturnStatement;

export interface VariableDeclaration extends ASTNode {
    type: 'VariableDeclaration';
    varType: string;
    identifier: string;
    value: Expression;
}

export interface ExpressionStatement extends ASTNode {
    type: 'ExpressionStatement';
    expression: Expression;
}

export interface BinaryExpression  extends ASTNode {
    type: 'BinaryExpression';
    operator: string;
    left: Expression;
    right: Expression;
}

export interface LogicalExpression extends ASTNode {
    type: 'LogicalExpression';
    operator: '&&' | '||';
    left: Expression;
    right: Expression;
}

export interface UnaryExpression extends ASTNode {
    type: 'UnaryExpression';
    operator: '!' | '-';
    argument: Expression;
}

export interface ResultExpr extends ASTNode {
    type: 'ResultExpr';
}

export interface FunctionExpression extends ASTNode {
    type: 'FunctionExpression';
    params: Param[];
    returnType: string | null;
    body: Statement[];
}

export interface WhileStatement extends ASTNode {
    type: 'WhileStatement';
    condition: Expression;
    body: Statement[];
    elseBody?: Statement[];
    invariant?: Expression[];
}

export interface ForStatement extends ASTNode {
    type: 'ForStatement';
    init: Statement | null;
    condition: Expression | null;
    update: Statement | null;
    body: Statement[];
}

export interface BreakStatement extends ASTNode {
    type: 'BreakStatement';
}

export interface ContinueStatement extends ASTNode {
    type: 'ContinueStatement';
}

export interface AssignmentStatement extends ASTNode {
    type: 'AssignmentStatement';
    name: string;
    target?: Expression;
    value: Expression;
}

// ============================================================================
// 表达式
// ============================================================================
export type Expression =
    | NumberLiteral 
    | StringLiteral
    | CharLiteral
    | Identifier 
    | FunctionCall
    | NewExpression
    | MemberExpression
    | BinaryExpression
    | LogicalExpression
    | UnaryExpression
    | ResultExpr
    | FunctionExpression

export interface NumberLiteral extends ASTNode {
    type: 'NumberLiteral';
    value: number;
}

export interface CharLiteral extends ASTNode {
    type: 'CharLiteral';
    value: string;
}

export interface StringLiteral extends ASTNode {
    type: 'StringLiteral';
    value: string;
}

export interface Identifier extends ASTNode {
    type: 'Identifier';
    name: string;
}

export interface FunctionCall extends ASTNode {
    type: 'FunctionCall';
    name: string;             // 简单名，或完整路径 'a::b::fn'
    arguments: Expression[];
}

export interface NewExpression extends ASTNode {
    type: 'NewExpression';
    className: string;
    arguments: Expression[];
    heapAlloc?: boolean;
}

export interface MemberExpression extends ASTNode {
    type: 'MemberExpression';
    object: Expression;
    property: string;
    isMethodCall: boolean;
    arguments: Expression[];
}

export type Item =
    | ModuleDecl
    | UseDecl
    | FormDecl
    | ImplDecl
    | TraitDecl
    | TemplateDecl
    | ImportDecl
    | RequiresDecl;

export interface Param {
    name: string;
    type: string;
}

export interface FieldDecl {
    name: string;
    type: string;
    isPub: boolean;
}


export interface FnDecl {
    name: string;
    receiver: string | null;
    params: Param[];
    returnType: string;
    isPub: boolean;
    body: Statement[] | null;
    line: number;
    column: number;
    length: number;
}

export interface RankBlock {
    name: string;
    fields: FieldDecl[];
    methods: FnDecl[];
}

export interface InheritClause {
    base: string;
    ranks: string[];
}

export interface ModuleDecl extends ASTNode {
    type: 'ModuleDecl';
    name: string;
    body: Item[];
}

export interface UseDecl extends ASTNode {
    type: 'UseDecl';
    path: string[];
}

export interface FormDecl extends ASTNode {
    type: 'FormDecl';
    name: string;
    isPub: boolean;
    isExport: boolean;
    inherits: InheritClause | null;
    ranks: RankBlock[];
}

export interface ImplDecl extends ASTNode {
    type: 'ImplDecl';
    target: string;
    traitName: string | null;
    rank: string | null;
    methods: FnDecl[];
}

export interface TraitDecl extends ASTNode {
    type: 'TraitDecl';
    name: string;
    isPub: boolean;
    inherits: InheritClause | null;
    ranks: RankBlock[];
}

export interface TemplateDecl extends ASTNode {
    type: 'TemplateDecl';
    params: string[];
    inner: FormDecl | ImplDecl;
}

export interface ImportDecl extends ASTNode {
    type: 'ImportDecl';
    alias: string;
    path: string;
}

export interface RequiresDecl extends ASTNode {
    type: 'RequiresDecl';
    permission: string;
}

export interface FunctionDeclaration extends ASTNode {
    type: 'FunctionDeclaration';
    returnType: string;
    name: string;
    params: Param[];
    receiver: string | null;
    isPub: boolean;
    isExport: boolean;
    requires: Expression[];
    ensures: Expression[];
    body: Statement[];
}

export interface ReturnStatement extends ASTNode {
    type: 'ReturnStatement';
    argument: Expression;
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
}