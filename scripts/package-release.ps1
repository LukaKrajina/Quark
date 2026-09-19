# ============================================================================
# package-release.ps1 - assemble the Windows release bundle and package a zip.
#
# Output:
#   release/quark-0.6.0-windows-x64/  (runtime.exe + quark_rt.dll + deps)
#   release/quark-0.6.0-windows-x64.zip
# ============================================================================
$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$version = "0.6.0"
$relDir = Join-Path $root "release\quark-$version-windows-x64"
$buildDir = Join-Path $root "runtime\build"

New-Item -ItemType Directory -Force -Path $relDir | Out-Null

if (-not (Test-Path $buildDir)) {
    Write-Warning "runtime/build not found. Run build.bat first."
    exit 1
}

# Core artifacts
Copy-Item (Join-Path $buildDir "runtime.exe") $relDir -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $buildDir "quark_rt.dll") $relDir -Force -ErrorAction SilentlyContinue

# Dependency DLLs
Copy-Item "C:\Program Files\LLVM\bin\libomp.dll" $relDir -Force -ErrorAction SilentlyContinue
Copy-Item "C:\Libraries\zlib\bin\zlib.dll" $relDir -Force -ErrorAction SilentlyContinue

Write-Host "=== release contents ==="
Get-ChildItem $relDir | ForEach-Object { Write-Host ("  " + $_.Name) }

# Package zip
$zip = Join-Path $root "release\quark-$version-windows-x64.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $relDir "*") -DestinationPath $zip
Write-Host ""
Write-Host "=== packaged ==="
Write-Host "  $zip"
