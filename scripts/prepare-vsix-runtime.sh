#!/usr/bin/env bash
# ============================================================================
# prepare-vsix-runtime.sh — 把 runtime 构建产物复制到扩展 bin/ 目录，
# 使其随 vsix 打包，安装扩展后即可开箱运行/编译/构建 qk 代码。
#
# 前置：已用 build-linux.sh 构建 runtime（生成 runtime + libquark_rt.so）。
# 用法：./scripts/prepare-vsix-runtime.sh [build-dir]
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${1:-$SCRIPT_DIR/../runtime/build-linux}"
EXT_BIN="$SCRIPT_DIR/../bin"

mkdir -p "$EXT_BIN"

if [ ! -d "$BUILD_DIR" ]; then
    echo "[prepare-vsix-runtime] 未找到构建目录：$BUILD_DIR"
    echo "请先运行 ./scripts/build-linux.sh 构建 runtime，再执行本脚本。"
    exit 1
fi

# 1. 核心可执行
if [ -f "$BUILD_DIR/runtime" ]; then
    cp -f "$BUILD_DIR/runtime" "$EXT_BIN/runtime"
    echo "[prepare-vsix-runtime] runtime -> bin/"
else
    echo "[prepare-vsix-runtime] 警告：未找到 runtime"
fi

# 2. 核心共享库 + 依赖 .so
copied=0
for so in "$BUILD_DIR"/*.so*; do
    [ -f "$so" ] || continue
    cp -f "$so" "$EXT_BIN/"
    copied=$((copied+1))
done
echo "[prepare-vsix-runtime] 复制 $copied 个 .so -> bin/"

# 3. 列出 bin/ 目录
echo ""
echo "[prepare-vsix-runtime] bin/ 目录："
ls -1 "$EXT_BIN" | sed 's/^/  /'

echo ""
echo "[prepare-vsix-runtime] 完成。运行 'npx vsce package' 时 bin/ 会自动包含在内。"
