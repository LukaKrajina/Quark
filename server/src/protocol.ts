// ============================================================================
// 帧格式: [4 字节大端长度][命令字节][payload]
// ============================================================================

export enum Cmd {
    HELLO = 0x00,        // 握手: payload = "QUARK_PROTO_V1"
    COMPILE = 0x01,      // payload = LLVM IR
    EXECUTE = 0x02,      // payload = "return_type func_name"
    VERIFY = 0x03,       // payload = VC protocol
    AOT_COMPILE = 0x04,  // payload = "arch mode name\nIR"
    LOAD_MMI = 0x05,     // payload = path
    MMI_INVOKE = 0x06,   // payload = "id func_name args_json"
    MMI_UNLOAD = 0x07,   // payload = "id"
    PING = 0x08,
    GET_SNAPSHOT = 0x09,
    EXIT = 0xff
}

export const PROTOCOL_VERSION = 'QUARK_PROTO_V1';

// 编码一帧:[4 字节大端长度][命令字节][payload]
export function encodeFrame(cmd: Cmd, payload: string = ''): Buffer {
    const body = Buffer.concat([Buffer.from([cmd]), Buffer.from(payload, 'utf-8')]);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length, 0);
    return Buffer.concat([header, body]);
}

// 编码一个无命令字节的响应帧(daemon 响应格式,也用于测试)。
export function encodeResponseFrame(payload: string): Buffer {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(Buffer.byteLength(payload, 'utf-8'), 0);
    return Buffer.concat([header, Buffer.from(payload, 'utf-8')]);
}

// 从累积 buffer 中解码所有完整帧,返回 { frames, rest }。
// frames 是各帧的完整 payload(长度头之后的内容)。
// 请求帧 payload = [命令字节][数据];响应帧 payload = 纯文本。
export function decodeFrames(buf: Buffer): { frames: string[]; rest: Buffer } {
    const frames: string[] = [];
    let offset = 0;
    while (buf.length - offset >= 4) {
        const len = buf.readUInt32BE(offset);
        if (buf.length - offset < 4 + len) break;
        frames.push(buf.subarray(offset + 4, offset + 4 + len).toString('utf-8'));
        offset += 4 + len;
    }
    return { frames, rest: buf.subarray(offset) };
}