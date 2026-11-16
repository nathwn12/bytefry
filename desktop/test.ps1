#Requires -Version 7.0
<#
.SYNOPSIS
    Every window-free check for the desktop host, in one command.

.DESCRIPTION
    Runs, and fails on any red result:
      1. the C# suite (desktop/tests): app-folder resolution, the bridge host, the report writer,
         the injected script in Node against a fake chrome.webview, packaging invariants, and the
         host's command line (argument and app-bundle failures happen before any window exists);
      2. the self-check report gate (desktop/selfcheck-report.ps1) against fabricated reports, so a
         weakened gate turns this red.

    Nothing here creates a window. The off-screen `--selfcheck` route is NOT run by this script: it
    needs a real window for WebView2 to compose, so it is opt-in through build.ps1 -Verify.

.EXAMPLE
    pwsh -File desktop/test.ps1
#>
[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Debug'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$desktopDir = $PSScriptRoot
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("meme-fryer-gate-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

$failed = 0
function Write-Ok([string]$text) { Write-Host "  ok    $text" -ForegroundColor Green }
function Write-Fail([string]$text) { Write-Host "  FAIL  $text" -ForegroundColor Red; $script:failed++ }

try {
    # 1. C# suite -------------------------------------------------------------
    Write-Host "C# suite" -ForegroundColor Cyan
    $tests = Join-Path $desktopDir 'tests\MemeFryer.Desktop.Tests'
    & dotnet run --project $tests -c $Configuration --nologo
    if ($LASTEXITCODE -ne 0) { Write-Fail "dotnet run $tests exited $LASTEXITCODE" }
    else { Write-Ok "C# suite" }

    # 2. report gate ----------------------------------------------------------
    Write-Host "self-check report gate" -ForegroundColor Cyan
    . (Join-Path $desktopDir 'selfcheck-report.ps1')

    function New-Report([hashtable]$body) {
        $path = Join-Path $tempRoot ("report-" + [Guid]::NewGuid().ToString('N') + ".json")
        Set-Content -LiteralPath $path -Value ($body | ConvertTo-Json -Depth 6) -Encoding utf8NoBOM
        return $path
    }

    function Expect-Reject([string]$name, [scriptblock]$act, [string]$expected) {
        try { & $act | Out-Null; Write-Fail "$name (was accepted)" }
        catch {
            if ($_.Exception.Message -like "*$expected*") { Write-Ok $name }
            else { Write-Fail "$name (wrong reason: $($_.Exception.Message))" }
        }
    }

    $good = New-Report @{ passed = $true; checks = @(@{ name = 'a'; ok = $true; detail = '' }) }

    try { Read-SelfCheckReport -Path $good -ExitCode 0 | Out-Null; Write-Ok 'a passing report with exit 0 is accepted' }
    catch { Write-Fail "a passing report was rejected: $($_.Exception.Message)" }

    Expect-Reject 'a missing report is rejected' {
        Read-SelfCheckReport -Path (Join-Path $tempRoot 'nope.json') -ExitCode 0
    } 'produced no report'

    $broken = Join-Path $tempRoot 'broken.json'
    Set-Content -LiteralPath $broken -Value '{not json' -Encoding utf8NoBOM
    Expect-Reject 'an unparsable report is rejected' { Read-SelfCheckReport -Path $broken -ExitCode 0 } 'not valid JSON'

    $noPassed = New-Report @{ checks = @(@{ name = 'a'; ok = $true }) }
    Expect-Reject 'a report without passed is rejected' { Read-SelfCheckReport -Path $noPassed -ExitCode 0 } "no 'passed' field"

    $falsePass = New-Report @{ passed = $false; checks = @(@{ name = 'a'; ok = $true }) }
    Expect-Reject 'passed=false is rejected even with a green exit code' { Read-SelfCheckReport -Path $falsePass -ExitCode 0 } 'passed=true'

    $oneRed = New-Report @{ passed = $true; checks = @(@{ name = 'a'; ok = $true }, @{ name = 'b'; ok = $false; detail = 'x' }) }
    Expect-Reject 'one red check is rejected even when passed=true' { Read-SelfCheckReport -Path $oneRed -ExitCode 0 } 'failing check'

    $empty = New-Report @{ passed = $true; checks = @() }
    Expect-Reject 'a report with no checks is rejected' { Read-SelfCheckReport -Path $empty -ExitCode 0 } 'no checks'

    Expect-Reject 'a passing report with a non-zero exit code is rejected' {
        Read-SelfCheckReport -Path $good -ExitCode 1
    } 'refusing to trust'
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
if ($failed -gt 0) {
    Write-Host "$failed check(s) failed" -ForegroundColor Red
    exit 1
}

Write-Host "all window-free checks passed" -ForegroundColor Green
exit 0
