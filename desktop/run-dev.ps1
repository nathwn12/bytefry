#Requires -Version 7.0
<#
.SYNOPSIS
    Runs the desktop host against app/ in the source tree (fast inner loop, no publish).

.DESCRIPTION
    Builds desktop/MemeFryer.Desktop in Debug and launches it with MEME_FRYER_DEV=1 (devtools,
    context menus, browser accelerators) and MEME_FRYER_APP_DIR pointing at <repo>\app, so edits to
    app/ are picked up on the next launch. Reload the page with Ctrl+R / F5 (dev only).

.EXAMPLE
    pwsh -File desktop/run-dev.ps1
    pwsh -File desktop/run-dev.ps1 -NoBuild
#>
[CmdletBinding()]
param(
    [switch]$NoBuild,
    [string]$AppDir
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$desktopDir = $PSScriptRoot
$repoRoot   = Split-Path -Parent $desktopDir
$project    = Join-Path $desktopDir 'MemeFryer.Desktop\MemeFryer.Desktop.csproj'

if (-not $AppDir) { $AppDir = Join-Path $repoRoot 'app' }
$AppDir = [IO.Path]::GetFullPath($AppDir)

if (-not (Test-Path -LiteralPath (Join-Path $AppDir 'index.html'))) {
    throw "no index.html in $AppDir — the app lane has not written it yet."
}

if (-not $NoBuild) {
    Write-Host "==> dotnet build (Debug)" -ForegroundColor Cyan
    & dotnet build $project -c Debug --nologo
    if ($LASTEXITCODE -ne 0) { throw "dotnet build failed with exit code $LASTEXITCODE" }
}

$exe = Join-Path $desktopDir 'MemeFryer.Desktop\bin\Debug\net10.0-windows\win-x64\Bytefry.exe'
if (-not (Test-Path -LiteralPath $exe)) {
    # A build without a runtime identifier lands in the plain TFM folder.
    $exe = Join-Path $desktopDir 'MemeFryer.Desktop\bin\Debug\net10.0-windows\Bytefry.exe'
}
if (-not (Test-Path -LiteralPath $exe)) { throw "Bytefry.exe not found under bin\Debug; run without -NoBuild." }

$env:MEME_FRYER_DEV = '1'
$env:MEME_FRYER_APP_DIR = $AppDir

Write-Host "==> Bytefry.exe  (app: $AppDir)" -ForegroundColor Cyan
& $exe
exit $LASTEXITCODE
