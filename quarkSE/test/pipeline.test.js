const { test } = require('node:test');
const assert = require('node:assert');
const { compileQk } = require('../dist/quarkSE/src/pipeline.js');

test('valid qk compiles to LLVM IR', () => {
    const res = compileQk('int32 quark_main() {\n    return 0;\n}\n');
    assert.strictEqual(res.ok, true);
    assert.ok(res.llvmIR && res.llvmIR.length > 0);
    assert.deepStrictEqual(res.errors, []);
});

test('invalid qk reports errors', () => {
    const res = compileQk('this is not valid qk @@@');
    assert.strictEqual(res.ok, false);
    assert.ok(Array.isArray(res.errors) && res.errors.length > 0);
});