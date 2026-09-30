# ============================================================================
# prepare-vsix-runtime.ps1 - copy runtime build artifacts into extension bin/,
# so they ship with the vsix (run/compile/build qk out of the box).
#
# Prerequisite: build runtime first via build.bat (runtime.exe + quark_rt.dll).
# Usage: ./scripts/prepare-vsix-runtime.ps1 [-BuildDir runtime/build]
# ============================================================================
param(
    [string]$BuildDir = "runtime/build"
)

$ErrorActionPreference = "Continue"
$extBin = Join-Path $PSScriptRoot "..\bin"
New-Item -ItemType Directory -Force -Path $extBin | Out-Null

if (-not (Test-Path $BuildDir)) {
    Write-Warning "[prepare-vsix-runtime] build dir not found: $BuildDir"
    Write-Host "Run build.bat first, then re-run this script."
    exit 1
}

# 1. Core executable
$exe = Join-Path $BuildDir "runtime.exe"
if (Test-Path $exe) {
    Copy-Item $exe $extBin -Force
    Write-Host "[prepare-vsix-runtime] runtime.exe -> bin/"
} else {
    Write-Warning "[prepare-vsix-runtime] runtime.exe not found"
}

# 2. Core shared lib + dependency DLLs
$dlls = Get-ChildItem $BuildDir -Filter "*.dll" -ErrorAction SilentlyContinue
$copied = 0
foreach ($dll in $dlls) {
    Copy-Item $dll.FullName $extBin -Force
    $copied++
}
Write-Host "[prepare-vsix-runtime] copied $copied DLL(s) -> bin/"

# 3. List bin/ contents
Write-Host ""
Write-Host "[prepare-vsix-runtime] bin/ contents:"
Get-ChildItem $extBin | ForEach-Object { Write-Host ("  " + $_.Name) }

Write-Host ""
Write-Host "[prepare-vsix-runtime] done. Run 'npx vsce package' to bundle bin/ into the vsix."
