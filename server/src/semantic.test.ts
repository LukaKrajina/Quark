import { test } from 'node:test';
import assert from 'node:assert';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { SemanticAnalyzer } from './semantic';

function analyze(src: string): SemanticAnalyzer {
    const parser = new Parser(new Lexer(src));
    const ast = parser.parse();
    const analyzer = new SemanticAnalyzer();
    analyzer.analyze(ast);
    return analyzer;
}

test('semantic: valid program has no errors', () => {
    const a = analyze('int32 x = 1;\nint32 y = x + 1;');
    assert.strictEqual(a.errors.length, 0);
});

test('semantic: undefined variable is flagged', () => {
    const a = analyze('auto x = undefined_var;');
    assert.ok(a.errors.some(e => e.message.includes('Undefined variable')));
});

test('semantic: Qubit cannot be cloned (No-Cloning Theorem)', () => {
    const a = analyze('auto q = alloc();\nauto q2 = q;');
    assert.ok(a.errors.some(e => e.message.includes('No-Cloning') || e.message.includes('Cannot copy Qubit')));
});

test('semantic: type mismatch is flagged', () => {
    const a = analyze('int32 x = 1;\nx = "hello";');
    assert.ok(a.errors.some(e => e.message.includes('Type Error')));
});

test('semantic: measure consumes qubit', () => {
    // measure 后 qubit 被消费,再次使用应报错
    const a = analyze('auto q = alloc();\nauto m = measure(q);\nauto m2 = measure(q);');
    assert.ok(a.errors.some(e => e.message.includes('used after measurement')));
});

test('semantic: while condition must be boolean/numeric', () => {
    const a = analyze('while ("string") { int32 i = 1; }');
    assert.ok(a.errors.some(e => e.message.includes('while condition')));
});