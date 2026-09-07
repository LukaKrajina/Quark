#!/usr/bin/env bash
# ============================================================================
# Linux 构建脚本
# ----------------------------------------------------------------------------
# 用法：
#   ./scripts/build-linux.sh [--cuda] [build-dir]
#
#   默认        ：CPU 版（系统 Kokkos + clang++）
#   --cuda      ：CUDA 版（Kokkos CUDA 后端 + nvcc_wrapper + /opt/cuda）
#
# 前置依赖（系统级，需自行安装）：
#   - cmake >= 3.20, ninja, clang / gcc（C++20）
#   - LLVM 开发包（提供 LLVMConfig.cmake）
#   - Vulkan SDK（提供 find_package(Vulkan)）
#   - Kokkos（CPU 版：系统包 /usr/lib/cmake/Kokkos；
#             CUDA 版：安装到 /usr/local，见 --cuda 说明）
#   - GLFW（系统包 glfw）
#
# --cuda 模式额外前置：
#   - CUDA Toolkit 已安装（/opt/cuda，nvcc 可用）
#   - Kokkos 已用 CUDA 后端编译并安装到 /usr/local（lib/cmake/Kokkos + bin/nvcc_wrapper）
#     编译方法（在 kokkos 源码目录）：
#       export PATH=/opt/cuda/bin:$PATH
#       cmake -B build -S . -DBUILD_SHARED_LIBS=ON -DCMAKE_CXX_COMPILER=<kokkos>/bin/nvcc_wrapper \
#             -DKokkos_ENABLE_CUDA=ON -DKokkos_ARCH_AMPERE86=ON
#       sudo cmake --build build --target install --prefix /usr/local
#       sudo ldconfig
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$(cd "$SCRIPT_DIR/../runtime" && pwd)"

USE_CUDA=0
BUILD_DIR="$RUNTIME_DIR/build-linux"

# 解析参数
while [[ $# -gt 0 ]]; do
    case "$1" in
        --cuda) USE_CUDA=1; shift ;;
        *) BUILD_DIR="$1"; shift ;;
    esac
done

# ---------------------------------------------------------------------------
# 选择编译器与 Kokkos
# ---------------------------------------------------------------------------
if [ "$USE_CUDA" -eq 1 ]; then
    export PATH="/opt/cuda/bin:$PATH"
    CXX_COMPILER="$(command -v nvcc_wrapper || true)"
    if [ -z "$CXX_COMPILER" ]; then
        echo "[build-linux] 未找到 nvcc_wrapper，请确认 Kokkos CUDA 版已安装到 /usr/local（或 /usr/local/bin 在 PATH 中）"
        exit 1
    fi
    KOKKOS_DIR="/usr/local/lib/cmake/Kokkos"
    echo "[build-linux] 模式：CUDA（nvcc_wrapper + Kokkos CUDA 后端）"
else
    CXX_COMPILER="clang++"
    KOKKOS_DIR="/usr/lib/cmake/Kokkos"
    echo "[build-linux] 模式：CPU（clang++ + 系统 Kokkos）"
fi

# ---------------------------------------------------------------------------
# CMake 配置
# ---------------------------------------------------------------------------
echo "[build-linux] CMake 配置..."
cmake -B "$BUILD_DIR" -S "$RUNTIME_DIR" \
    -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_COMPILER=gcc \
    -DCMAKE_CXX_COMPILER="$CXX_COMPILER" \
    -DKokkos_DIR="$KOKKOS_DIR"

# ---------------------------------------------------------------------------
# 构建
# ---------------------------------------------------------------------------
echo "[build-linux] 构建..."
cmake --build "$BUILD_DIR" --config Release --parallel

echo ""
echo "[build-linux] 完成。产物："
ls -lh "$BUILD_DIR"/runtime "$BUILD_DIR"/libquark_rt.so 2>/dev/null || true
ls -lh "$BUILD_DIR"/transmitter "$BUILD_DIR"/qvm_visualizer 2>/dev/null || true
ls -lh "$BUILD_DIR"/quarkRSP/quarkRSP 2>/dev/null || true
echo ""
echo "  下一步：./scripts/install-linux.sh <version> $BUILD_DIR 将产物安装到 ~/.quark"