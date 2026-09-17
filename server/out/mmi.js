"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.packMMI = packMMI;
exports.unpackMMI = unpackMMI;
exports.collectModuleInfo = collectModuleInfo;
exports.readMMIExports = readMMIExports;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const MAGIC = 'QKMM';
const FORMAT_VERSION = 2; // QOBF v2（加密 + 二进制序列化）
// ─── QOBF v2：内嵌主盐（32 字节，与 C++ 侧 qhal::qcrypt::master_salt 一致）───
const MASTER_SALT = Buffer.from([
    0x51, 0x55, 0x41, 0x52, 0x4b, 0x2d, 0x51, 0x4d, // "QUARK-QM"
    0x4d, 0x49, 0x2d, 0x51, 0x4f, 0x42, 0x46, 0x2d, // "MI-QOBF-"
    0x56, 0x32, 0x2d, 0x4d, 0x41, 0x53, 0x54, 0x45, // "V2-MASTE"
    0x52, 0x2d, 0x53, 0x41, 0x4c, 0x54, 0x2d, 0x4b // "R-SALT-K"
]);
const KDF_INFO = 'qk-mmi-obf-v2';
// ─── 类型标签（与 C++ 侧 qhal::TypeTag 对称）─────────────────────────
const TypeTag = {
    I8: 0, I16: 1, I32: 2, I64: 3,
    U8: 4, U16: 5, U32: 6, U64: 7,
    FLOAT: 8, DOUBLE: 9, VOID: 10, CHAR: 11,
    I8P: 12, QUBITP: 13, QOBJECTP: 14, QMODELP: 15, LATTICEP: 16, FORMP: 17
};
function typeTag(llvmType) {
    switch (llvmType) {
        case 'i8': return { tag: TypeTag.I8 };
        case 'i16': return { tag: TypeTag.I16 };
        case 'i32': return { tag: TypeTag.I32 };
        case 'i64': return { tag: TypeTag.I64 };
        case 'uint8': return { tag: TypeTag.U8 };
        case 'uint16': return { tag: TypeTag.U16 };
        case 'uint32': return { tag: TypeTag.U32 };
        case 'uint64': return { tag: TypeTag.U64 };
        case 'float': return { tag: TypeTag.FLOAT };
        case 'double': return { tag: TypeTag.DOUBLE };
        case 'void': return { tag: TypeTag.VOID };
        case 'char': return { tag: TypeTag.CHAR };
        case 'i8*': return { tag: TypeTag.I8P };
        case '%Qubit*': return { tag: TypeTag.QUBITP };
        case '%QObject*': return { tag: TypeTag.QOBJECTP };
        case '%QModel*': return { tag: TypeTag.QMODELP };
        case '%Lattice*': return { tag: TypeTag.LATTICEP };
        default:
            if (llvmType.startsWith('%form.')) {
                return { tag: TypeTag.FORMP, form: llvmType.slice('%form.'.length, -1) };
            }
            throw new Error(`MMI Error: unknown LLVM type '${llvmType}'`);
    }
}
function llvmFromTag(tag, form) {
    switch (tag) {
        case TypeTag.I8: return 'i8';
        case TypeTag.I16: return 'i16';
        case TypeTag.I32: return 'i32';
        case TypeTag.I64: return 'i64';
        case TypeTag.U8: return 'uint8';
        case TypeTag.U16: return 'uint16';
        case TypeTag.U32: return 'uint32';
        case TypeTag.U64: return 'uint64';
        case TypeTag.FLOAT: return 'float';
        case TypeTag.DOUBLE: return 'double';
        case TypeTag.VOID: return 'void';
        case TypeTag.CHAR: return 'char';
        case TypeTag.I8P: return 'i8*';
        case TypeTag.QUBITP: return '%Qubit*';
        case TypeTag.QOBJECTP: return '%QObject*';
        case TypeTag.QMODELP: return '%QModel*';
        case TypeTag.LATTICEP: return '%Lattice*';
        case TypeTag.FORMP: return `%form.${form}*`;
        default: throw new Error(`MMI Error: unknown type tag ${tag}`);
    }
}
function quarkToLLVM(quarkType, forms) {
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
        case 'void': return 'void';
        default:
            if (quarkType.startsWith('lattice<'))
                return '%Lattice*';
            if (quarkType.startsWith('cap<'))
                return 'i8*';
            if (forms && forms.has(quarkType))
                return '%form.' + quarkType.replace(/::/g, '__') + '*';
            throw new Error(`MMI Error: Unknown type '${quarkType}'`);
    }
}
// ─── 二进制 writer / reader（小端；字符串 = u16 长度前缀 + utf8）─────
class BinaryWriter {
    constructor() {
        this.chunks = [];
    }
    u8(v) { this.chunks.push(Buffer.from([v & 0xFF])); }
    u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v, 0); this.chunks.push(b); }
    u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v, 0); this.chunks.push(b); }
    str(s) { const b = Buffer.from(s, 'utf8'); this.u16(b.length); this.chunks.push(b); }
    bytes(b) { this.chunks.push(b); }
    done() { return Buffer.concat(this.chunks); }
}
class BinaryReader {
    constructor(data) {
        this.data = data;
        this.off = 0;
    }
    u8() {
        if (this.off >= this.data.length)
            throw new Error('MMI: truncated binary header');
        return this.data[this.off++];
    }
    u16() {
        if (this.off + 2 > this.data.length)
            throw new Error('MMI: truncated binary header');
        const v = this.data.readUInt16LE(this.off);
        this.off += 2;
        return v;
    }
    str() {
        const n = this.u16();
        if (this.off + n > this.data.length)
            throw new Error('MMI: truncated binary header');
        const s = this.data.slice(this.off, this.off + n).toString('utf8');
        this.off += n;
        return s;
    }
}
// ─── 加密原语（ChaCha20 手动实现，HKDF 用 node:crypto HMAC）──────────
function chacha20Xor(key, nonce, data) {
    const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
    const quarter = (s, a, b, c, d) => {
        s[a] = (s[a] + s[b]) >>> 0;
        s[d] ^= s[a];
        s[d] = rotl(s[d], 16);
        s[c] = (s[c] + s[d]) >>> 0;
        s[b] ^= s[c];
        s[b] = rotl(s[b], 12);
        s[a] = (s[a] + s[b]) >>> 0;
        s[d] ^= s[a];
        s[d] = rotl(s[d], 8);
        s[c] = (s[c] + s[d]) >>> 0;
        s[b] ^= s[c];
        s[b] = rotl(s[b], 7);
    };
    const out = Buffer.alloc(data.length);
    const constants = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
    let ctr = 0;
    let pos = 0;
    while (pos < data.length) {
        const state = new Uint32Array(16);
        state[0] = constants[0];
        state[1] = constants[1];
        state[2] = constants[2];
        state[3] = constants[3];
        for (let i = 0; i < 8; i++)
            state[4 + i] = key.readUInt32LE(i * 4);
        state[12] = ctr;
        for (let i = 0; i < 3; i++)
            state[13 + i] = nonce.readUInt32LE(i * 4);
        const x = new Uint32Array(state);
        for (let r = 0; r < 10; r++) {
            quarter(x, 0, 4, 8, 12);
            quarter(x, 1, 5, 9, 13);
            quarter(x, 2, 6, 10, 14);
            quarter(x, 3, 7, 11, 15);
            quarter(x, 0, 5, 10, 15);
            quarter(x, 1, 6, 11, 12);
            quarter(x, 2, 7, 8, 13);
            quarter(x, 3, 4, 9, 14);
        }
        for (let i = 0; i < 16; i++)
            x[i] = (x[i] + state[i]) >>> 0;
        for (let i = 0; i < 16 && pos < data.length; i++) {
            for (let b = 0; b < 4 && pos < data.length; b++) {
                out[pos] = data[pos] ^ ((x[i] >>> (8 * b)) & 0xFF);
                pos++;
            }
        }
        ctr++;
    }
    return out;
}
function hkdfSha256(ikm, salt, info, outLen) {
    const prk = (0, crypto_1.createHmac)('sha256', salt).update(ikm).digest();
    const okm = [];
    let prev = Buffer.alloc(0);
    let counter = 1;
    let total = 0;
    while (total < outLen) {
        prev = (0, crypto_1.createHmac)('sha256', prk)
            .update(Buffer.concat([prev, info, Buffer.from([counter])]))
            .digest();
        okm.push(prev);
        total += prev.length;
        counter++;
    }
    return Buffer.concat(okm).subarray(0, outLen);
}
function deriveModuleKey(name, kdfSalt) {
    const ikm = Buffer.concat([MASTER_SALT, Buffer.from(name, 'utf8')]);
    const info = Buffer.from(KDF_INFO, 'utf8');
    return hkdfSha256(ikm, kdfSalt, info, 64);
}
// ─── 二进制 header 序列化 / 反序列化 ─────────────────────────────────
function serializeHeader(header) {
    const w = new BinaryWriter();
    w.str(header.version);
    w.u16(header.exports.length);
    for (const e of header.exports) {
        w.str(e.name);
        const rt = typeTag(e.ret);
        w.u8(rt.tag);
        if (rt.form !== undefined)
            w.str(rt.form);
        w.u8(e.params.length);
        for (const p of e.params) {
            const pt = typeTag(p);
            w.u8(pt.tag);
            if (pt.form !== undefined)
                w.str(pt.form);
        }
    }
    w.u16(header.permissions.length);
    for (const p of header.permissions)
        w.str(p);
    w.u16(header.imports.length);
    for (const i of header.imports) {
        w.str(i.alias);
        w.str(i.path);
    }
    return w.done();
}
function readType(r) {
    const tag = r.u8();
    if (tag === TypeTag.FORMP)
        return `%form.${r.str()}*`;
    return llvmFromTag(tag);
}
function deserializeHeader(r) {
    const version = r.str();
    const exports = [];
    const exportCount = r.u16();
    for (let i = 0; i < exportCount; i++) {
        const name = r.str();
        const ret = readType(r);
        const pc = r.u8();
        const params = [];
        for (let j = 0; j < pc; j++)
            params.push(readType(r));
        exports.push({ name, params, ret });
    }
    const permissions = [];
    const permCount = r.u16();
    for (let i = 0; i < permCount; i++)
        permissions.push(r.str());
    const imports = [];
    const importCount = r.u16();
    for (let i = 0; i < importCount; i++)
        imports.push({ alias: r.str(), path: r.str() });
    return { version, exports, permissions, imports };
}
// ─── QOBF v2 打包 / 解包 ─────────────────────────────────────────────
function packMMI(header, ir) {
    const binaryHeader = serializeHeader(header);
    const payload = Buffer.concat([binaryHeader, Buffer.from(ir, 'utf8')]);
    const kdfSalt = (0, crypto_1.randomBytes)(16);
    const nonce = (0, crypto_1.randomBytes)(12);
    const key = deriveModuleKey(header.name, kdfSalt);
    const ciphertext = chacha20Xor(key.subarray(0, 32), nonce, payload);
    const tag = (0, crypto_1.createHmac)('sha256', key.subarray(32)).update(Buffer.concat([nonce, ciphertext])).digest();
    const nameBuf = Buffer.from(header.name, 'utf8');
    const w = new BinaryWriter();
    w.bytes(Buffer.from(MAGIC, 'ascii'));
    w.u32(FORMAT_VERSION);
    w.u32(0); // flags（bit0=ChaCha20；bit1=时空第二层，预留）
    w.u16(nameBuf.length);
    w.bytes(nameBuf);
    w.bytes(nonce);
    w.bytes(kdfSalt);
    w.u32(ciphertext.length);
    w.bytes(ciphertext);
    w.bytes(tag);
    return w.done();
}
function unpackMMI(data) {
    if (data.length < 18)
        throw new Error('Invalid .mmi: file too short');
    if (data.slice(0, 4).toString('ascii') !== MAGIC)
        throw new Error('Invalid .mmi: bad magic');
    const version = data.readUInt32LE(4);
    if (version !== FORMAT_VERSION)
        throw new Error(`Unsupported .mmi version ${version}`);
    const flags = data.readUInt32LE(8);
    if (flags !== 0)
        throw new Error('Unsupported .mmi encryption flags');
    let off = 12;
    const nameLen = data.readUInt16LE(off);
    off += 2;
    if (off + nameLen > data.length)
        throw new Error('Invalid .mmi: bad name length');
    const name = data.slice(off, off + nameLen).toString('utf8');
    off += nameLen;
    const nonce = data.slice(off, off + 12);
    off += 12;
    const kdfSalt = data.slice(off, off + 16);
    off += 16;
    const ctLen = data.readUInt32LE(off);
    off += 4;
    if (off + ctLen + 32 !== data.length)
        throw new Error('Invalid .mmi: bad ciphertext length');
    const ciphertext = data.slice(off, off + ctLen);
    off += ctLen;
    const tag = data.slice(off, off + 32);
    const key = deriveModuleKey(name, kdfSalt);
    const expect = (0, crypto_1.createHmac)('sha256', key.subarray(32)).update(Buffer.concat([nonce, ciphertext])).digest();
    if (expect.length !== tag.length || !(0, crypto_1.timingSafeEqual)(expect, tag)) {
        throw new Error('MMI: integrity check failed (tampered)');
    }
    const plain = chacha20Xor(key.subarray(0, 32), nonce, ciphertext);
    const r = new BinaryReader(plain);
    const { version: hdrVersion, exports, permissions, imports } = deserializeHeader(r);
    const ir = plain.slice(r.off).toString('utf8');
    return { header: { name, version: hdrVersion, exports, permissions, imports }, ir };
}
function collectModuleInfo(ast) {
    const exports = [];
    const permissions = [];
    const imports = [];
    const forms = new Set();
    // 先收集 form 定义（用于 form 类型映射为 %form.X*）
    for (const node of ast.body) {
        if (node.type === 'FormDecl') {
            forms.add(node.name);
        }
    }
    for (const node of ast.body) {
        if (node.type === 'RequiresDecl') {
            permissions.push(node.permission);
        }
        else if (node.type === 'ImportDecl') {
            imports.push({ alias: node.alias, path: node.path });
        }
        else if (node.type === 'FunctionDeclaration' && node.isExport) {
            exports.push({
                name: node.name,
                params: node.params.map(p => quarkToLLVM(p.type, forms)),
                ret: quarkToLLVM(node.returnType, forms)
            });
        }
    }
    return { exports, permissions, imports };
}
function readMMIExports(mmiPath, baseDir) {
    const resolved = path.isAbsolute(mmiPath) ? mmiPath : path.join(baseDir, mmiPath);
    const data = fs.readFileSync(resolved);
    const { header } = unpackMMI(data);
    return header.exports;
}
//# sourceMappingURL=mmi.js.map