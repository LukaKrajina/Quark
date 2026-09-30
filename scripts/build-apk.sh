#!/usr/bin/env bash
# ============================================================================
# build-apk.sh — 把 .qk 项目构建成 Android APK（一键）
#
# 流程：
#   1. 交叉编译 Android 运行时 libquark_rt.so（QVM 核心，ARM64）
#   2. `qk compile android` 把 .qk AOT 编译成 libquark_main.so
#   3. 把两个 .so 放入 jniLibs/arm64-v8a/
#   4. Gradle 打包 APK
#
# 前置：Android SDK/NDK（sdkmanager / $ANDROID_HOME）、mise 装的 gradle、daemon 运行中。
#
# 用法：
#   ./scripts/build-apk.sh <file.qk> [--release]
#   qk build apk <file.qk> [--release]      # 等价的 CLI 命令
# ============================================================================
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
NDK_VERSION="${NDK_VERSION:-26.1.10909125}"
NDK="$ANDROID_HOME/ndk/$NDK_VERSION"
NDK_TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/linux-x86_64"

# Gradle 8.5 + AGP 8.2 需 Java 17+；本机 Java 17.0.2 有容器 cgroup 检测 bug
# （apksigner 抛 ExceptionInInitializerError），故用 Java 21。
JAVA_HOME="${JAVA_HOME:-$HOME/.local/share/mise/installs/java/21.0.2}"
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$HOME/.local/bin:$PATH"
export ANDROID_HOME

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APK_DIR="$ROOT/runtime/android/apk"

# 参数解析：<file.qk> [--release]
BUILD_TYPE="debug"
QK_FILE=""
for arg in "$@"; do
    case "$arg" in
        --release) BUILD_TYPE="release" ;;
        --debug) BUILD_TYPE="debug" ;;
        -*) ;;
        *) QK_FILE="$arg" ;;
    esac
done
if [ -z "$QK_FILE" ]; then
    echo "用法：$0 <file.qk> [--release]"
    exit 1
fi
QK_FILE="$(realpath "$QK_FILE")"
QK_NAME="$(basename "$QK_FILE" .qk)"

# ─── 1. 交叉编译 Android 运行时 ──────────────────────────
echo "[build-apk] 编译 Android 运行时 libquark_rt.so ..."
cmake --build "$ROOT/runtime/android/build-android" --parallel 8

# ─── 2. AOT 编译 qk 代码 → libquark_main.so ──────────────
echo "[build-apk] AOT 编译 $QK_NAME.qk → libquark_main.so ..."
export QUARK_ANDROID_CLANGXX="$NDK_TOOLCHAIN/bin/aarch64-linux-android21-clang++"
export QUARK_ANDROID_SYSROOT="$NDK_TOOLCHAIN/sysroot"
export QUARK_ANDROID_RT_DIR="$ROOT/runtime/android/build-android"
cd "$ROOT"
qk compile android -m "$QK_FILE"

# ─── 3. 收集 .so 到 jniLibs/arm64-v8a/ ───────────────────
JNILIBS="$APK_DIR/app/src/main/jniLibs/arm64-v8a"
mkdir -p "$JNILIBS"
cp -f "$ROOT/runtime/android/build-android/libquark_rt.so" "$JNILIBS/libquark_rt.so"
# qk compile 在 daemon 工作目录（$HOME）生成 <name>.so
cp -f "$HOME/$QK_NAME.so" "$JNILIBS/libquark_main.so"
echo "[build-apk] jniLibs/arm64-v8a/:"
ls -lh "$JNILIBS" | sed 's/^/  /'

# ─── 4. Gradle 打包 ──────────────────────────────────────
GRADLE_TASK="assembleDebug"
if [ "$BUILD_TYPE" = "release" ]; then
    GRADLE_TASK="assembleRelease"
fi
echo "[build-apk] Gradle $GRADLE_TASK ..."
cd "$APK_DIR"
gradle "$GRADLE_TASK" --no-daemon

APK_OUT="$APK_DIR/app/build/outputs/apk/$BUILD_TYPE/app-$BUILD_TYPE.apk"
if [ -f "$APK_OUT" ]; then
    echo ""
    echo "[build-apk] 完成：$APK_OUT"
    ls -lh "$APK_OUT"
else
    echo "[build-apk] 错误：未生成 APK（$BUILD_TYPE）"
    exit 1
fi
