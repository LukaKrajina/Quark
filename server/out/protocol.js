"use strict";
// ============================================================================
// 帧格式: [4 字节大端长度][命令字节][payload]
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROTOCOL_VERSION = exports.Cmd = void 0;
exports.encodeFrame = encodeFrame;
exports.encodeResponseFrame = encodeResponseFrame;
exports.decodeFrames = decodeFrames;
var Cmd;
(function (Cmd) {
    Cmd[Cmd["HELLO"] = 0] = "HELLO";
    Cmd[Cmd["COMPILE"] = 1] = "COMPILE";
    Cmd[Cmd["EXECUTE"] = 2] = "EXECUTE";
    Cmd[Cmd["VERIFY"] = 3] = "VERIFY";
    Cmd[Cmd["AOT_COMPILE"] = 4] = "AOT_COMPILE";
    Cmd[Cmd["LOAD_MMI"] = 5] = "LOAD_MMI";
    Cmd[Cmd["MMI_INVOKE"] = 6] = "MMI_INVOKE";
    Cmd[Cmd["MMI_UNLOAD"] = 7] = "MMI_UNLOAD";
    Cmd[Cmd["PING"] = 8] = "PING";
    Cmd[Cmd["GET_SNAPSHOT"] = 9] = "GET_SNAPSHOT";
    Cmd[Cmd["EXIT"] = 255] = "EXIT";
})(Cmd || (exports.Cmd = Cmd = {}));
exports.PROTOCOL_VERSION = 'QUARK_PROTO_V1';
// 编码一帧:[4 字节大端长度][命令字节][payload]
function encodeFrame(cmd, payload = '') {
    const body = Buffer.concat([Buffer.from([cmd]), Buffer.from(payload, 'utf-8')]);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length, 0);
    return Buffer.concat([header, body]);
}
// 编码一个无命令字节的响应帧(daemon 响应格式,也用于测试)。
function encodeResponseFrame(payload) {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(Buffer.byteLength(payload, 'utf-8'), 0);
    return Buffer.concat([header, Buffer.from(payload, 'utf-8')]);
}
// 从累积 buffer 中解码所有完整帧,返回 { frames, rest }。
// frames 是各帧的完整 payload(长度头之后的内容)。
// 请求帧 payload = [命令字节][数据];响应帧 payload = 纯文本。
function decodeFrames(buf) {
    const frames = [];
    let offset = 0;
    while (buf.length - offset >= 4) {
        const len = buf.readUInt32BE(offset);
        if (buf.length - offset < 4 + len)
            break;
        frames.push(buf.subarray(offset + 4, offset + 4 + len).toString('utf-8'));
        offset += 4 + len;
    }
    return { frames, rest: buf.subarray(offset) };
}
//# sourceMappingURL=protocol.js.map