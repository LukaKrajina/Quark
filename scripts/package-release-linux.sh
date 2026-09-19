#!/usr/bin/env bash
# ============================================================================
# package-release-linux.sh - assemble the Linux release bundle and package tar.gz.
#
# Output:
#   release/quark-0.6.0-linux-x64/  (runtime + libquark_rt.so + deps)
#   release/quark-0.6.0-linux-x64.tar.gz
#
# Prerequisite: run ./scripts/build-linux.sh first (builds runtime + libquark_rt.so).
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
VERSION="0.6.0"
REL_DIR="$ROOT/release/quark-$VERSION-linux-x64"
BUILD_DIR="${1:-$ROOT/runtime/build-linux}"

if [ ! -d "$BUILD_DIR" ]; then
    echo "[package-release] build dir not found: $BUILD_DIR"
    echo "Run ./scripts/build-linux.sh first."
    exit 1
fi

mkdir -p "$REL_DIR"

# Core artifacts
cp -f "$BUILD_DIR/runtime" "$REL_DIR/" 2>/dev/null || echo "warning: runtime not found"
for so in "$BUILD_DIR"/*.so*; do
    [ -f "$so" ] && cp -f "$so" "$REL_DIR/"
done

echo "=== release contents ==="
ls -1 "$REL_DIR" | sed 's/^/  /'

# Package tar.gz
TARBALL="$ROOT/release/quark-$VERSION-linux-x64.tar.gz"
tar -czf "$TARBALL" -C "$ROOT/release" "quark-$VERSION-linux-x64"
echo ""
echo "=== packaged ==="
echo "  $TARBALL"
