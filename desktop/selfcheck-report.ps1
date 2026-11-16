#Requires -Version 7.0
<#
    One authority for "did the off-screen self-check actually pass?".

    A green process exit code is not evidence on its own: the run must also have written a report that
    parses and says passed=true with every check ok. build.ps1 uses this, and desktop/test.ps1 exercises
    it against fabricated reports so a weakened gate goes red.

    Dot-source this file; it only defines a function.
#>

function Read-SelfCheckReport {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][int]$ExitCode
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "self-check produced no report (exit $ExitCode); report expected at $Path"
    }

    try { $result = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json }
    catch { throw "self-check report is not valid JSON: $Path ($($_.Exception.Message))" }

    if ($null -eq $result) { throw "self-check report is empty: $Path" }
    if (-not $result.PSObject.Properties['passed']) { throw "self-check report has no 'passed' field: $Path" }
    if ($result.passed -ne $true) { throw "self-check report does not say passed=true: $Path" }
    if (-not $result.PSObject.Properties['checks']) { throw "self-check report has no 'checks' list: $Path" }

    $checks = @($result.checks)
    if ($checks.Count -eq 0) { throw "self-check report contains no checks: $Path" }

    $failed = @($checks | Where-Object { -not $_.ok })
    if ($failed.Count -gt 0) {
        $names = ($failed | ForEach-Object { $_.name }) -join '; '
        throw "self-check has $($failed.Count) failing check(s): $names; report: $Path"
    }

    if ($ExitCode -ne 0) {
        throw "self-check exited $ExitCode while its report passed; refusing to trust either. report: $Path"
    }

    return $result
}
