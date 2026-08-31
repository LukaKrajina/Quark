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
const MAGIC = 'QKMM';
const FORMAT_VERSION = 1;
function quarkToLLVM(quarkType) {
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
<<<<<<< HEAD
        default: return 'i32';
=======
        default:
            throw new Error(`MMI Error: Unknown type '${quarkType}'`);
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
    }
}
function packMMI(header, ir) {
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    const payload = Buffer.from(ir, 'utf8');
    const magic = Buffer.from(MAGIC, 'ascii');
    const version = Buffer.alloc(4);
    version.writeUInt32LE(FORMAT_VERSION, 0);
    const headerLen = Buffer.alloc(4);
    headerLen.writeUInt32LE(headerBytes.length, 0);
    return Buffer.concat([magic, version, headerLen, headerBytes, payload]);
}
function unpackMMI(data) {
    if (data.length < 12) {
        throw new Error('Invalid .mmi: file too short');
    }
    if (data.slice(0, 4).toString('ascii') !== MAGIC) {
        throw new Error('Invalid .mmi: bad magic');
    }
    const version = data.readUInt32LE(4);
    if (version !== FORMAT_VERSION) {
        throw new Error(`Unsupported .mmi version ${version}`);
    }
    const headerLen = data.readUInt32LE(8);
    if (12 + headerLen > data.length) {
        throw new Error('Invalid .mmi: header length out of bounds');
    }
    const header = JSON.parse(data.slice(12, 12 + headerLen).toString('utf8'));
    const ir = data.slice(12 + headerLen).toString('utf8');
    return { header, ir };
}
function collectModuleInfo(ast) {
    const exports = [];
    const permissions = [];
    const imports = [];
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
                params: node.params.map(p => quarkToLLVM(p.type)),
                ret: quarkToLLVM(node.returnType)
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