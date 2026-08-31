"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const protocol_1 = require("./protocol");
(0, node_test_1.test)('protocol: encodeFrame produces length-prefixed frame', () => {
    const frame = (0, protocol_1.encodeFrame)(protocol_1.Cmd.COMPILE, 'hello IR');
    // 4 字节长度头 + 1 字节命令 + 8 字节 payload
    node_assert_1.default.strictEqual(frame.length, 4 + 1 + 8);
    node_assert_1.default.strictEqual(frame.readUInt32BE(0), 1 + 8);
    node_assert_1.default.strictEqual(frame[4], protocol_1.Cmd.COMPILE);
    node_assert_1.default.strictEqual(frame.subarray(5).toString('utf-8'), 'hello IR');
});
(0, node_test_1.test)('protocol: decodeFrames decodes response frames (no command byte)', () => {
    const f1 = (0, protocol_1.encodeResponseFrame)('RESPONSE: PONG\n');
    const f2 = (0, protocol_1.encodeResponseFrame)('RESPONSE: SUCCESS\n');
    const combined = Buffer.concat([f1, f2]);
    const { frames, rest } = (0, protocol_1.decodeFrames)(combined);
    node_assert_1.default.strictEqual(frames.length, 2);
    node_assert_1.default.strictEqual(frames[0], 'RESPONSE: PONG\n');
    node_assert_1.default.strictEqual(frames[1], 'RESPONSE: SUCCESS\n');
    node_assert_1.default.strictEqual(rest.length, 0);
});
(0, node_test_1.test)('protocol: decodeFrames handles partial frame', () => {
    const full = (0, protocol_1.encodeResponseFrame)('abc');
    const partial = full.subarray(0, 4 + 2); // 截断到长度头 + 部分 payload
    const { frames, rest } = (0, protocol_1.decodeFrames)(partial);
    node_assert_1.default.strictEqual(frames.length, 0);
    node_assert_1.default.strictEqual(rest.length, partial.length);
});
(0, node_test_1.test)('protocol: HELLO carries version', () => {
    const frame = (0, protocol_1.encodeFrame)(protocol_1.Cmd.HELLO, protocol_1.PROTOCOL_VERSION);
    node_assert_1.default.strictEqual(frame[4], protocol_1.Cmd.HELLO);
    node_assert_1.default.strictEqual(frame.subarray(5).toString('utf-8'), protocol_1.PROTOCOL_VERSION);
});
(0, node_test_1.test)('protocol: binary payload preserved exactly (no newline truncation)', () => {
    // 关键:含哨兵行(如 END_COMPILE)的 IR 也能完整往返,不会被文本协议截断
    const ir = 'define i32 @f() {\nEND_COMPILE\n  ret i32 0\n}\n';
    const frame = (0, protocol_1.encodeFrame)(protocol_1.Cmd.COMPILE, ir);
    // decodeFrames 返回完整 payload = [命令字节][IR]
    const { frames } = (0, protocol_1.decodeFrames)(frame);
    node_assert_1.default.strictEqual(frames.length, 1);
    node_assert_1.default.strictEqual(frames[0].charCodeAt(0), protocol_1.Cmd.COMPILE);
    node_assert_1.default.strictEqual(frames[0].substring(1), ir);
});
//# sourceMappingURL=protocol.test.js.map