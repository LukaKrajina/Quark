// ============================================================================
// 编译产物缓存（增量编译）
//
// 以「源内容 SHA-256 + 各 import 依赖（.mmi）的 mtime」为 key，把编译出的
// LLVM IR 持久化到磁盘。命中则跳过 lexer/parser/semantic/IR 全链路，仅在大
// 项目（多 include / 多 import）下带来可观的编译提速。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export interface CacheDependency {
    path: string;
    mtimeMs: number;
}

export class CompileCache {
    private dir: string;
    private enabled: boolean;

    constructor(dir: string, enabled: boolean = true) {
        this.dir = dir;
        this.enabled = enabled;
    }

    /** 缓存 key = hash(srcPath ‖ source ‖ dep0:path:mt ‖ dep1:... ) */
    private computeKey(srcPath: string, source: string, deps: CacheDependency[]): string {
        const h = createHash('sha256');
        h.update(srcPath);
        h.update('\u0000');
        h.update(source);
        for (const d of deps) {
            h.update('\u0000');
            h.update(d.path);
            h.update(':');
            h.update(String(d.mtimeMs));
        }
        return h.digest('hex');
    }

    get(srcPath: string, source: string, deps: CacheDependency[]): string | null {
        if (!this.enabled) return null;
        const f = path.join(this.dir, this.computeKey(srcPath, source, deps) + '.ir');
        try {
            if (fs.existsSync(f)) return fs.readFileSync(f, 'utf-8');
        } catch {
            /* 缓存读取失败视为未命中 */
        }
        return null;
    }

    set(srcPath: string, source: string, deps: CacheDependency[], ir: string): void {
        if (!this.enabled) return;
        try {
            fs.mkdirSync(this.dir, { recursive: true });
            fs.writeFileSync(path.join(this.dir, this.computeKey(srcPath, source, deps) + '.ir'), ir);
        } catch {
            /* 缓存写入失败不影响编译 */
        }
    }

    /** 清空缓存目录 */
    clear(): void {
        try {
            if (fs.existsSync(this.dir)) {
                for (const f of fs.readdirSync(this.dir)) {
                    fs.unlinkSync(path.join(this.dir, f));
                }
            }
        } catch {
            /* ignore */
        }
    }
}
