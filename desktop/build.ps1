#Requires -Version 7.0
<#
.SYNOPSIS
    Builds the Bytefry Windows desktop host and bundles the web app beside it.

.DESCRIPTION
    Publishes desktop/MemeFryer.Desktop and copies app/ (sibling of desktop/) into the output so the
    folder is self-contained: Bytefry.exe + app/. Nothing is published, installed or signed.

    Outputs (under desktop/dist by default):
      portable\Bytefry.exe   + portable\app\   self-contained, needs only the WebView2 Runtime
      installer\Bytefry-<version>-setup.exe    only with -Installer (Inno Setup 6)

.EXAMPLE
    pwsh -File desktop/build.ps1
    pwsh -File desktop/build.ps1 -FrameworkDependent -Configuration Debug
    pwsh -File desktop/build.ps1 -Installer
#>
[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',

    [ValidateSet('win-x64', 'win-arm64')]
    [string]$Runtime = 'win-x64',

    # Needs the .NET 10 Desktop Runtime installed; the exe drops to a few hundred KB.
    [switch]$FrameworkDependent,

    # Emit one exe instead of exe + dlls. Set -SingleFile:$false to publish the plain folder layout.
    [bool]$SingleFile = $true,

    # Compile the Inno Setup installer from the portable folder (requires ISCC on PATH or the default install).
    [switch]$Installer,

    # Build the host even while the app lane has not written app/index.html yet.
    [switch]$AllowMissingApp,

    # Run the headless self-check (off-screen window, no visible UI) against the built exe.
    [switch]$Verify,

    [string]$OutRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$desktopDir = $PSScriptRoot
$repoRoot   = Split-Path -Parent $desktopDir
$projectDir = Join-Path $desktopDir 'MemeFryer.Desktop'
$project    = Join-Path $projectDir 'MemeFryer.Desktop.csproj'
$iconFile   = Join-Path $projectDir 'Assets\MemeFryer.ico'
$noticeFile = Join-Path $desktopDir 'NOTICE.md'
$appSrc     = Join-Path $repoRoot 'app'
$stage      = Join-Path $desktopDir 'obj\stage'

if (-not $OutRoot) { $OutRoot = Join-Path $desktopDir 'dist' }
$portable = Join-Path $OutRoot 'portable'
$installerOut = Join-Path $OutRoot 'installer'

function Write-Step([string]$text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Write-Note([string]$text) { Write-Host "    $text" -ForegroundColor DarkGray }

# --- preconditions -----------------------------------------------------------

if (-not (Test-Path -LiteralPath $project)) { throw "project file missing: $project" }
if (-not (Test-Path -LiteralPath $iconFile)) { throw "icon missing: $iconFile" }
if (-not (Test-Path -LiteralPath $noticeFile)) { throw "licence notice missing: $noticeFile" }

$sdk = (& dotnet --version).Trim()
Write-Step "dotnet SDK $sdk"

$version = ([xml](Get-Content -LiteralPath $project -Raw)).Project.PropertyGroup.Version |
    Where-Object { $_ } | Select-Object -First 1
if (-not $version) { $version = '0.0.0' }
Write-Note "host version $version"

$appEntry = Join-Path $appSrc 'index.html'
$appReady = Test-Path -LiteralPath $appEntry
if (-not $appReady) {
    if (-not $AllowMissingApp) {
        throw ("app/index.html not found at {0}. The desktop build bundles app/ beside desktop/. " +
               "Run with -AllowMissingApp to build the host alone." -f $appEntry)
    }
    Write-Warning "app/index.html missing: publishing the host shell without an app bundle."
}

# --- publish -----------------------------------------------------------------

if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }

$publishArgs = @(
    'publish', $project,
    '-c', $Configuration,
    '-r', $Runtime,
    '--nologo',
    '-o', $stage,
    "--self-contained", $(if ($FrameworkDependent) { 'false' } else { 'true' }),
    "-p:Version=$version",
    '-p:PublishTrimmed=false',
    '-p:DebugType=none'
)
if ($SingleFile) {
    $publishArgs += @(
        '-p:PublishSingleFile=true',
        '-p:IncludeNativeLibrariesForSelfExtract=true'
    )
    # Compression is only valid for self-contained bundles (NETSDK1176).
    if (-not $FrameworkDependent) { $publishArgs += '-p:EnableCompressionInSingleFile=true' }
}

Write-Step "dotnet publish ($Configuration, $Runtime, self-contained=$(-not $FrameworkDependent), single-file=$SingleFile)"
& dotnet @publishArgs
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE" }

# --- bundle app/ -------------------------------------------------------------

if ($appReady) {
    Write-Step "bundling app/ -> app/"
    $appDest = Join-Path $stage 'app'
    New-Item -ItemType Directory -Path $appDest -Force | Out-Null
    $robocopyArgs = @($appSrc, $appDest, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1')
    & robocopy @robocopyArgs | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "copying app/ failed (robocopy exit $LASTEXITCODE)" }
    $GLOBAL:LASTEXITCODE = 0

    if (-not (Test-Path -LiteralPath (Join-Path $appDest 'index.html'))) {
        throw "app/index.html did not survive the copy into $appDest"
    }
}

# --- bundle the host's licence notice ----------------------------------------

# The GPL text and the vendored-library notices arrive with app/. The host's own notice — its licence
# and the components compiled into the exe — has to travel with the bundle too, or a distributable
# ships a binary whose dependencies are never named.
Write-Step "bundling NOTICE.md -> NOTICE.md"
Copy-Item -LiteralPath $noticeFile -Destination (Join-Path $stage 'NOTICE.md') -Force

# --- build info --------------------------------------------------------------

$appFiles = @(Get-ChildItem -LiteralPath (Join-Path $stage 'app') -Recurse -File -ErrorAction SilentlyContinue)
$appBytes = 0
if ($appFiles.Count -gt 0) {
    $measured = $appFiles | Measure-Object -Property Length -Sum
    if ($measured.Count -gt 0) { $appBytes = $measured.Sum }
}

$webView2 = $null
$edgeClients = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients'
foreach ($client in @(Get-ChildItem -LiteralPath $edgeClients -ErrorAction SilentlyContinue)) {
    $entry = Get-ItemProperty -LiteralPath $client.PSPath -ErrorAction SilentlyContinue
    if ($entry -and $entry.PSObject.Properties['name'] -and $entry.name -eq 'Microsoft Edge WebView2 Runtime') {
        $webView2 = $entry.pv
        break
    }
}
if (-not $webView2) {
    $runtimeDir = 'C:\Program Files (x86)\Microsoft\EdgeWebView\Application'
    $webView2 = @(Get-ChildItem -LiteralPath $runtimeDir -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^\d+\.' } |
        Sort-Object { [version]($_.Name) } -Descending |
        Select-Object -First 1 -ExpandProperty Name)
    if ($webView2 -is [array]) { $webView2 = $webView2[0] }
}

$info = @(
    "Bytefry desktop host"
    "licence:         GPL-3.0-only (see NOTICE.md and app\LICENSE)"
    "version:         $version"
    "built (UTC):     $((Get-Date).ToUniversalTime().ToString('u'))"
    "configuration:   $Configuration"
    "runtime:         $Runtime"
    "self-contained:  $(-not $FrameworkDependent)"
    "single-file:     $SingleFile"
    "dotnet SDK:      $sdk"
    "webview2 runtime: $(if ($webView2) { $webView2 } else { 'not detected (required at run time)' })"
    "app files:       $($appFiles.Count) files, $([math]::Round($appBytes / 1KB, 1)) KB"
    ""
    "Portable: keep app\ beside Bytefry.exe. Requires the Microsoft Edge WebView2 Runtime."
    "No network access is used at run time; UI state lives in %LOCALAPPDATA%\MemeFryer."
    "That profile folder keeps the pre-rename name on purpose, so an installed copy upgrades in"
    "place with its WebView2 profile, and the uninstaller leaves it alone."
)
Set-Content -LiteralPath (Join-Path $stage 'BUILD-INFO.txt') -Value $info -Encoding utf8NoBOM

# --- promote to dist ---------------------------------------------------------

Write-Step "publishing to $portable"
if (Test-Path -LiteralPath $portable) { Remove-Item -LiteralPath $portable -Recurse -Force }
New-Item -ItemType Directory -Path $OutRoot -Force | Out-Null
Move-Item -LiteralPath $stage -Destination $portable

$exe = Join-Path $portable 'Bytefry.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "Bytefry.exe was not produced in $portable" }

$totalBytes = (Get-ChildItem -LiteralPath $portable -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Note ("Bytefry.exe: {0:N1} MB" -f ((Get-Item -LiteralPath $exe).Length / 1MB))
Write-Note ("portable total: {0:N1} MB" -f ($totalBytes / 1MB))

# The published PE machine must match the requested runtime: a wrong runtime pack or a stale bin
# directory is otherwise invisible until the exe refuses to start on the target.
function Get-ExeMachine([string]$path) {
    $stream = [IO.File]::OpenRead($path)
    try {
        $buffer = New-Object byte[] 4096
        $read = $stream.Read($buffer, 0, $buffer.Length)
        if ($read -lt 0x40) { throw "file is too small to be a PE image: $path" }
        $peOffset = [BitConverter]::ToInt32($buffer, 0x3C)
        if ($peOffset -lt 0 -or ($peOffset + 6) -gt $read) { throw "no PE header found in $path" }
        if ($buffer[$peOffset] -ne 0x50 -or $buffer[$peOffset + 1] -ne 0x45) { throw "not a PE image: $path" }
        return [BitConverter]::ToUInt16($buffer, $peOffset + 4)
    }
    finally { $stream.Dispose() }
}

$expectedMachine = switch ($Runtime) {
    'win-x64' { 0x8664 }
    'win-arm64' { 0xAA64 }
    default { throw "no PE machine mapping for $Runtime" }
}
$machine = Get-ExeMachine $exe
if ($machine -ne $expectedMachine) {
    throw ("Bytefry.exe is machine 0x{0:X4} but {1} needs 0x{2:X4}" -f $machine, $Runtime, $expectedMachine)
}
Write-Note ("PE machine: 0x{0:X4} ({1})" -f $machine, $Runtime)

# --- installer ---------------------------------------------------------------

if ($Installer) {
    $iscc = (Get-Command iscc -ErrorAction SilentlyContinue).Source
    if (-not $iscc) {
        $iscc = @(
            'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
            'C:\Program Files\Inno Setup 6\ISCC.exe'
        ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    }
    if (-not $iscc) { throw "Inno Setup 6 compiler (ISCC.exe) not found; install Inno Setup 6 or drop -Installer." }

    Write-Step "compiling installer with $iscc"
    New-Item -ItemType Directory -Path $installerOut -Force | Out-Null
    $iss = Join-Path $desktopDir 'installer\MemeFryer.iss'

    # The installer's architecture restriction must follow the payload, never a fixed x64 default.
    $innoArchitecture = switch ($Runtime) {
        'win-x64' { 'x64compatible' }
        'win-arm64' { 'arm64' }
        default { throw "no Inno Setup architecture mapping for $Runtime" }
    }
    Write-Note "installer architecture: $innoArchitecture"

    & $iscc "/DMyAppVersion=$version" "/DMyArch=$innoArchitecture" "/DSourceDir=$portable" "/DOutDir=$installerOut" "/DIconFile=$iconFile" $iss
    if ($LASTEXITCODE -ne 0) { throw "ISCC failed with exit code $LASTEXITCODE" }

    $setup = Get-ChildItem -LiteralPath $installerOut -Filter 'Bytefry-*-setup.exe' |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $setup) { throw "installer output missing in $installerOut" }
    Write-Note ("{0} ({1:N1} MB)" -f $setup.Name, ($setup.Length / 1MB))
}

Write-Host ""
Write-Host "build ok: $portable" -ForegroundColor Green

# --- off-screen self-check ---------------------------------------------------
#
# The host needs a real window for WebView2 to compose, so this check parks one outside every monitor
# and never activates it: nothing is visible and no focus is taken, but it is off-screen, not headless.
# It is opt-in, and a green exit code alone is not proof: the report must exist, parse and pass.

if ($Verify) {
    if (-not $appReady) { throw "-Verify needs app/index.html; there is nothing for the host to load." }

    Write-Step "off-screen self-check (window outside every monitor, nothing visible)"
    $checkDir = Join-Path $desktopDir 'obj\selfcheck'
    New-Item -ItemType Directory -Path $checkDir -Force | Out-Null
    $report = Join-Path $checkDir 'report.json'
    if (Test-Path -LiteralPath $report) { Remove-Item -LiteralPath $report -Force }

    $proc = Start-Process -FilePath $exe -ArgumentList @('--selfcheck', $report) -Wait -PassThru -NoNewWindow
    $code = $proc.ExitCode

    # The gate lives in one place and is exercised by desktop/test.ps1.
    . (Join-Path $desktopDir 'selfcheck-report.ps1')
    $result = Read-SelfCheckReport -Path $report -ExitCode $code

    foreach ($check in $result.checks) {
        Write-Note ("ok   {0} - {1}" -f $check.name, $check.detail)
    }

    Write-Note "report: $report"
    Write-Host "self-check ok" -ForegroundColor Green
}
