#!/usr/bin/env bash
# ============================================================================
# install-system.sh — 把 Quark（runtime 二进制 + qk CLI）安装到标准位置，
#                     注册到 PATH，并配置 runtime 后台常驻（systemd user service）。
#
# 安装布局（默认用户级，无需 root，符合 XDG）：
#   ~/.local/lib/quark/<version>/
#       ├── bin/runtime            （runtime 二进制 daemon）
#       ├── bin/libquark_rt.so     （量子核心共享库）
#       ├── bin/libkokkos*.so*     （Kokkos 运行时）
#       ├── quark                  （shim：设置 LD_LIBRARY_PATH 后 exec runtime）
#       └── qk                     （qk CLI 单文件 bundle，node shebang）
#   ~/.local/bin/quark -> ...      （PATH 注册，立即可用）
#   ~/.local/bin/qk    -> ...
#
# 后台常驻：调用 `runtime --install-autostart`，写入
#   ~/.config/systemd/user/quark-runtime.service
# 并 enable + start + loginctl enable-linger（注销后仍常驻）。
#
# 用法：
#   ./scripts/install-system.sh [version] [build-dir]
#   ./scripts/install-system.sh --uninstall         # 卸载（停服务 + 删文件）
#   ./scripts/install-system.sh --status            # 查看 daemon 状态
#
# 环境变量：
#   INSTALL_ROOT    安装根目录（默认 ~/.local/lib/quark/<version>）
#   BIN_LINK_DIR    命令软链目录（默认 ~/.local/bin，需在 PATH 中）
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

VERSION="$(node -p "require('$ROOT/package.json').version")"
if [ "${1:-}" = "--uninstall" ] || [ "${1:-}" = "--status" ]; then
    : # 版本仍从 package.json 取
else
    VERSION="${1:-$VERSION}"
fi

BUILD_DIR="${2:-$ROOT/runtime/build-linux}"
INSTALL_ROOT="${INSTALL_ROOT:-$HOME/.local/lib/quark/$VERSION}"
BIN_LINK_DIR="${BIN_LINK_DIR:-$HOME/.local/bin}"

# Kokkos 共享库目录
KOKKOS_LIB_DIR="${KOKKOS_LIB_DIR:-}"
if [ -z "$KOKKOS_LIB_DIR" ]; then
    if [ -d "$HOME/.local/kokkos-install/lib" ]; then
        KOKKOS_LIB_DIR="$HOME/.local/kokkos-install/lib"
    else
        KOKKOS_LIB_DIR="$ROOT/.deps/kokkos-install-lazy/lib"
    fi
fi

# ─────────────────────────────────────────────────────────
# 状态查询
# ─────────────────────────────────────────────────────────
if [ "${1:-}" = "--status" ]; then
    echo "=== 安装位置 ==="
    [ -d "$INSTALL_ROOT" ] && echo "  $INSTALL_ROOT" || echo "  未安装（$INSTALL_ROOT 不存在）"
    echo "=== PATH 注册 ==="
    ls -l "$BIN_LINK_DIR/quark" "$BIN_LINK_DIR/qk" 2>/dev/null || echo "  未注册"
    echo "=== daemon 状态 ==="
    systemctl --user status quark-runtime.service 2>&1 | head -8 || echo "  服务未安装"
    exit 0
fi

# ─────────────────────────────────────────────────────────
# 卸载
# ─────────────────────────────────────────────────────────
if [ "${1:-}" = "--uninstall" ]; then
    echo "[install-system] 卸载 Quark $VERSION ..."
    if [ -x "$INSTALL_ROOT/bin/runtime" ]; then
        # runtime 需 LD_LIBRARY_PATH 才能加载同目录的 libquark_rt.so
        LD_LIBRARY_PATH="$INSTALL_ROOT/bin${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
            "$INSTALL_ROOT/bin/runtime" --uninstall-autostart || true
    else
        systemctl --user stop quark-runtime.service 2>/dev/null || true
        systemctl --user disable quark-runtime.service 2>/dev/null || true
    fi
    rm -f "$BIN_LINK_DIR/quark" "$BIN_LINK_DIR/qk"
    rm -rf "$INSTALL_ROOT"
    echo "[install-system] 卸载完成。"
    exit 0
fi

# ─────────────────────────────────────────────────────────
# 安装
# ─────────────────────────────────────────────────────────
echo "======================================================"
echo "[install-system] 安装 Quark $VERSION"
echo "  安装位置：$INSTALL_ROOT"
echo "  命令目录：$BIN_LINK_DIR"
echo "======================================================"

# 0. 前置检查：构建产物
if [ ! -f "$BUILD_DIR/runtime" ] || [ ! -f "$BUILD_DIR/libquark_rt.so" ]; then
    echo "[install-system] 未找到 Linux 构建产物，请先运行 ./scripts/build-linux.sh"
    echo "  期望：$BUILD_DIR/runtime 与 $BUILD_DIR/libquark_rt.so"
    exit 1
fi

# qk CLI 单文件 bundle（esbuild 产物）
if [ ! -f "$ROOT/server/out/qk.js" ]; then
    echo "[install-system] 未找到 qk CLI（server/out/qk.js），请先运行 npm run compile"
    exit 1
fi

# 1. 安装 runtime 二进制与共享库
echo "[install-system] 安装 runtime + libquark_rt.so ..."
mkdir -p "$INSTALL_ROOT/bin"
install -m 0755 "$BUILD_DIR/runtime"        "$INSTALL_ROOT/bin/runtime"
install -m 0755 "$BUILD_DIR/libquark_rt.so" "$INSTALL_ROOT/bin/libquark_rt.so"

# Kokkos 共享库（含符号链接链，保留 SONAME）
echo "[install-system] 安装 Kokkos 共享库（来自 $KOKKOS_LIB_DIR）..."
for so in "$KOKKOS_LIB_DIR"/libkokkos*.so*; do
    [ -e "$so" ] && cp -a "$so" "$INSTALL_ROOT/bin/"
done

# 2. 安装 qk CLI（单文件，自带 node shebang）
echo "[install-system] 安装 qk CLI ..."
install -m 0755 "$ROOT/server/out/qk.js" "$INSTALL_ROOT/qk"

# 3. quark shim：让 runtime 从同目录的 bin/ 加载 libquark_rt.so
cat > "$INSTALL_ROOT/quark" <<'EOF'
#!/usr/bin/env bash
# Quark runtime shim：注入 LD_LIBRARY_PATH 后启动 runtime
DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
export LD_LIBRARY_PATH="$DIR/bin${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$DIR/bin/runtime" "$@"
EOF
chmod +x "$INSTALL_ROOT/quark"

# 4. 注册到 PATH（软链到 ~/.local/bin）
echo "[install-system] 注册命令到 $BIN_LINK_DIR ..."
mkdir -p "$BIN_LINK_DIR"
ln -sf "$INSTALL_ROOT/quark" "$BIN_LINK_DIR/quark"
ln -sf "$INSTALL_ROOT/qk"    "$BIN_LINK_DIR/qk"

# 5. 后台常驻（systemd user service + enable-linger）
echo "[install-system] 配置 runtime 后台常驻（systemd --user）..."
# 同卸载：注入 LD_LIBRARY_PATH，让 runtime 能加载 libquark_rt.so
LD_LIBRARY_PATH="$INSTALL_ROOT/bin${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    "$INSTALL_ROOT/bin/runtime" --install-autostart

# 6. 验证
echo ""
echo "======================================================"
echo "[install-system] 安装完成，验证中..."
echo "======================================================"
sleep 2
echo "=== 命令位置 ==="
which quark qk 2>/dev/null || echo "  （若未找到，请把 $BIN_LINK_DIR 加入 PATH）"
echo "=== daemon 状态 ==="
systemctl --user is-active quark-runtime.service 2>&1 || true
echo "=== 端口 50052 ==="
(ss -ltnp 2>/dev/null | grep 50052 || netstat -ltnp 2>/dev/null | grep 50052 || echo "  （需安装 ss/netstat 才能查看）")
echo "=== 自检（PING）==="
printf 'PING\nEXIT\n' | "$INSTALL_ROOT/quark" 2>&1 | head -3
echo ""
echo "常用命令："
echo "  qk run <file.qk>            运行 qk 脚本（自动连接常驻 daemon）"
echo "  qk compile x64 -m <file.qk> 编译为原生二进制"
echo "  systemctl --user status quark-runtime.service   查看 daemon"
echo "  ./scripts/install-system.sh --status            查看安装状态"
echo "  ./scripts/install-system.sh --uninstall         卸载"