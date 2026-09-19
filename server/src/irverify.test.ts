import { test } from 'node:test';
import assert from 'node:assert';
import { verifyIR } from './irverify';

test('irverify: valid IR passes', () => {
    const ir = [
        'define i32 @quark_main() {',
        'entry:',
        '  ret i32 0',
        '}'
    ].join('\n');
    assert.deepStrictEqual(verifyIR(ir), []);
});

test('irverify: function missing entry is flagged', () => {
    const ir = [
        'define i32 @foo() {',
        '  ret i32 0',
        '}'
    ].join('\n');
    const d = verifyIR(ir);
    assert.ok(d.some(x => x.message.includes("missing an 'entry:'")));
});

test('irverify: unterminated block is flagged', () => {
    const ir = [
        'define i32 @foo() {',
        'entry:',
        '  %1 = add i32 1, 2',
        '}'
    ].join('\n');
    const d = verifyIR(ir);
    assert.ok(d.some(x => x.message.includes('not terminated')));
});

test('irverify: register used before definition is flagged', () => {
    const ir = [
        'define i32 @foo() {',
        'entry:',
        '  %2 = add i32 %1, 1',
        '  ret i32 %2',
        '}'
    ].join('\n');
    const d = verifyIR(ir);
    assert.ok(d.some(x => x.message.includes("'%1' used before definition")));
});

test('irverify: duplicate SSA definition is flagged', () => {
    const ir = [
        'define i32 @foo() {',
        'entry:',
        '  %1 = add i32 1, 2',
        '  %1 = add i32 3, 4',
        '  ret i32 %1',
        '}'
    ].join('\n');
    const d = verifyIR(ir);
    assert.ok(d.some(x => x.message.includes("'%1' defined more than once")));
});

test('irverify: named types and block labels are not mistaken for registers', () => {
    const ir = [
        '%Qubit = type opaque',
        'define i32 @foo() {',
        'entry:',
        '  br label %loop',
        'loop:',
        '  %q = alloca %Qubit*',
        '  br label %loop',
        '}'
    ].join('\n');
    const d = verifyIR(ir);
    assert.ok(!d.some(x => x.message.includes("'%Qubit'")), 'type name not flagged');
    assert.ok(!d.some(x => x.message.includes("'%loop'")), 'label not flagged');
});
