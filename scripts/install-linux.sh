#!/usr/bin/env bash
# ============================================================================
# Quark Runtime — Linux 安装脚本
# ----------------------------------------------------------------------------
# 用法：
#   ./scripts/install-linux.sh <version> [build-dir]
#
# 把构建产物安装到 ~/.quark/toolchains/<version>/bin，并生成 quark shim。
# shim 通过 LD_LIBRARY_PATH 让 runtime 找到同目录下的 libquark_rt.so，
# 与 Windows 的 quark.exe（Go 代理）保持一致的命令形态。
#
# 安装完成后，把下面路径加入 PATH：
#   export PATH="$HOME/.quark/toolchains/<version>/bin:$PATH"
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$(cd "$SCRIPT_DIR/../runtime" && pwd)"

VERSION="${1:-}"
BUILD_DIR="${2:-$RUNTIME_DIR/build-linux}"

if [ -z "$VERSION" ]; then
    echo "用法：$0 <version> [build-dir]"
    echo "示例：$0 0.1.0"
    exit 1
fi

if [ ! -f "$BUILD_DIR/runtime" ] || [ ! -f "$BUILD_DIR/libquark_rt.so" ]; then
    echo "[install-linux] 未找到构建产物，请先运行 ./scripts/build-linux.sh"
    echo "  期望：$BUILD_DIR/runtime 与 $BUILD_DIR/libquark_rt.so"
    exit 1
fi

BIN_DIR="$HOME/.quark/toolchains/$VERSION/bin"
mkdir -p "$BIN_DIR"

echo "[install-linux] 安装到 $BIN_DIR"

# 1. 核心产物
install -m 0755 "$BUILD_DIR/runtime"           "$BIN_DIR/runtime"
install -m 0755 "$BUILD_DIR/libquark_rt.so"    "$BIN_DIR/libquark_rt.so"

# 2. 可选产物（存在则一并安装）
for exe in transmitter qvm_visualizer; do
    if [ -f "$BUILD_DIR/$exe" ]; then
        install -m 0755 "$BUILD_DIR/$exe" "$BIN_DIR/$exe"
    fi
done
if [ -f "$BUILD_DIR/quarkRSP/quarkRSP" ]; then
    install -m 0755 "$BUILD_DIR/quarkRSP/quarkRSP" "$BIN_DIR/quarkRSP"
fi

# 3. quark shim：让 runtime 从同目录加载 libquark_rt.so
cat > "$BIN_DIR/quark" <<'EOF'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LD_LIBRARY_PATH="$DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$DIR/runtime" "$@"
EOF
chmod +x "$BIN_DIR/quark"

# 4. 记录当前激活版本（与 Windows 的 active_version.txt 保持一致）
ACTIVE_FILE="$HOME/.quark/active_version.txt"
mkdir -p "$HOME/.quark"
printf '%s' "$VERSION" > "$ACTIVE_FILE"

echo ""
echo "[install-linux] 安装完成。"
echo "  将以下路径加入 PATH 后即可使用 'quark' 命令："
echo "    export PATH=\"$BIN_DIR:\$PATH\""
echo "  验证："
echo "    quark --daemon          # 启动守护进程"
echo "    echo -e 'PING\\nEXIT' | quark   # 交互式自检"
