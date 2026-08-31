import { Program } from './ast';
import * as fs from 'fs';
import * as path from 'path';

export interface MMIExport {
    name: string;
    params: string[];
    ret: string;
}

export interface MMIImport {
    alias: string;
    path: string;
}

export interface MMIHeader {
    name: string;
    version: string;
    exports: MMIExport[];
    permissions: string[];
    imports: MMIImport[];
}

const MAGIC = 'QKMM';
const FORMAT_VERSION = 1;

function quarkToLLVM(quarkType: string): string {
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
            throw new Error(`MMI Error: Unknown type '${quarkType}'`);
    }
}

export function packMMI(header: MMIHeader, ir: string): Buffer {
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    const payload = Buffer.from(ir, 'utf8');

    const magic = Buffer.from(MAGIC, 'ascii');
    const version = Buffer.alloc(4);
    version.writeUInt32LE(FORMAT_VERSION, 0);
    const headerLen = Buffer.alloc(4);
    headerLen.writeUInt32LE(headerBytes.length, 0);

    return Buffer.concat([magic, version, headerLen, headerBytes, payload]);
}

export function unpackMMI(data: Buffer): { header: MMIHeader; ir: string } {
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
    const header = JSON.parse(data.slice(12, 12 + headerLen).toString('utf8')) as MMIHeader;
    const ir = data.slice(12 + headerLen).toString('utf8');
    return { header, ir };
}

export function collectModuleInfo(ast: Program): { exports: MMIExport[]; permissions: string[]; imports: MMIImport[] } {
    const exports: MMIExport[] = [];
    const permissions: string[] = [];
    const imports: MMIImport[] = [];

    for (const node of ast.body) {
        if (node.type === 'RequiresDecl') {
            permissions.push(node.permission);
        } else if (node.type === 'ImportDecl') {
            imports.push({ alias: node.alias, path: node.path });
        } else if (node.type === 'FunctionDeclaration' && node.isExport) {
            exports.push({
                name: node.name,
                params: node.params.map(p => quarkToLLVM(p.type)),
                ret: quarkToLLVM(node.returnType)
            });
        }
    }

    return { exports, permissions, imports };
}

export function readMMIExports(mmiPath: string, baseDir: string): MMIExport[] {
    const resolved = path.isAbsolute(mmiPath) ? mmiPath : path.join(baseDir, mmiPath);
    const data = fs.readFileSync(resolved);
    const { header } = unpackMMI(data);
    return header.exports;
}
