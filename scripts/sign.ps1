<<<<<<< HEAD
# ============================================================================
# sign.ps1 - code signing using self-signed certificate
# ============================================================================
param(
    [Parameter(Mandatory=$true)]
    [string[]]$Targets,
    [string]$PfxPath = "D:\BH_Project\quark-vscode\scripts\certs\quark-codesign.pfx",
    [string]$Password = "quark"
)

$ErrorActionPreference = "Stop"

# locate signtool (Windows SDK version varies)
$signtool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" `
    -Filter "signtool.exe" -Recurse -ErrorAction SilentlyContinue `
    | Where-Object { $_.FullName -match "x64" } `
    | Sort-Object FullName -Descending `
    | Select-Object -First 1 -ExpandProperty FullName

if (-not $signtool) { throw "signtool.exe not found. Install Windows SDK." }

foreach ($t in $Targets) {
    if (-not (Test-Path $t)) { Write-Warning "skip missing: $t"; continue }
    & $signtool sign /fd SHA256 /f $PfxPath /p $Password `
        /tr http://timestamp.digicert.com /td SHA256 $t
    if ($LASTEXITCODE -ne 0) { throw "sign failed: $t" }
    Write-Host "[OK] signed: $t"
}
=======
# ============================================================================
# sign.ps1 - code signing using self-signed certificate
# ============================================================================
param(
    [Parameter(Mandatory=$true)]
    [string[]]$Targets,
    [string]$PfxPath = "D:\BH_Project\quark-vscode\scripts\certs\quark-codesign.pfx",
    [string]$Password = "quark"
)

$ErrorActionPreference = "Stop"

# locate signtool (Windows SDK version varies)
$signtool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" `
    -Filter "signtool.exe" -Recurse -ErrorAction SilentlyContinue `
    | Where-Object { $_.FullName -match "x64" } `
    | Sort-Object FullName -Descending `
    | Select-Object -First 1 -ExpandProperty FullName

if (-not $signtool) { throw "signtool.exe not found. Install Windows SDK." }

foreach ($t in $Targets) {
    if (-not (Test-Path $t)) { Write-Warning "skip missing: $t"; continue }
    & $signtool sign /fd SHA256 /f $PfxPath /p $Password `
        /tr http://timestamp.digicert.com /td SHA256 $t
    if ($LASTEXITCODE -ne 0) { throw "sign failed: $t" }
    Write-Host "[OK] signed: $t"
}
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
