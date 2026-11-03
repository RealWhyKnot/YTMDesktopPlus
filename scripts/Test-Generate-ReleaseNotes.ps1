#!/usr/bin/env pwsh
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest


Import-Module -Name (Join-Path $PSScriptRoot 'TestCommon.psm1')

$script = Join-Path $PSScriptRoot 'Generate-ReleaseNotes.ps1'
$scratch = New-ScratchPath 'relnotes-test-' '.json'

try {
    $commits = @(
        @{ sha = 'abc1234def'; subject = 'feat(player): add sleep timer'; login = 'RealWhyKnot' },
        @{ sha = 'bcd2345efa'; subject = 'fix: stop crash on resume'; login = 'RealWhyKnot' },
        @{ sha = 'cde3456fab'; subject = 'docs(readme): document build steps'; login = '' },
        @{ sha = 'def4567abc'; subject = 'something without a type'; login = 'RealWhyKnot' }
    ) | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText($scratch, $commits)

    $arguments = @{
        CommitsPath = $scratch
        Tag         = 'v2026.803.1'
        PreviousTag = 'v2026.803.0-beta'
        Repository  = 'RealWhyKnot/YTMDesktopPlus'
    }
    $output = (& $script @arguments) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Script failed' }

    Assert-True ($output.StartsWith("## What's Changed")) "starts with the What's Changed heading"
    Assert-True ($output -match '### Features') 'has a Features section'
    Assert-True ($output -match '### Bug Fixes') 'has a Bug Fixes section'
    Assert-True ($output -match '### Other Changes') 'untyped subjects land in Other Changes'
    Assert-True ($output -notmatch '### Chores') 'empty sections are omitted'
    $assertion = @{
        Condition = ($output -match [regex]::Escape((
                    '* feat(player): add sleep timer by ' +
                    '[RealWhyKnot](https://github.com/RealWhyKnot) in abc1234'
                )))
        Message   = 'bullet format with author and short sha'
    }
    Assert-True @assertion
    $assertion = @{
        Condition = ($output -match [regex]::Escape('* docs(readme): document build steps in cde3456'))
        Message   = 'missing login omits attribution'
    }
    Assert-True @assertion
    Assert-True ($output.IndexOf('### Features') -lt $output.IndexOf('### Bug Fixes')) 'sections keep fixed order'
    $assertion = @{
        Condition = ($output -match [regex]::Escape((
                    'Full Changelog: [RealWhyKnot/YTMDesktopPlus@v2026.803.0-beta' +
                    '...v2026.803.1](https://github.com/RealWhyKnot/YTMDesktopPlu' +
                    's/compare/v2026.803.0-beta...v2026.803.1)'
                )))
        Message   = 'compare footer present'
    }
    Assert-True @assertion

    $noPrev = (& $script -CommitsPath $scratch -Tag 'v2026.803.1' -Repository 'RealWhyKnot/YTMDesktopPlus') -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Script failed' }
    Assert-True ($noPrev -notmatch 'Full Changelog') 'no footer without a previous tag'

    Write-Output 'Generate-ReleaseNotes self-test passed'
} finally {
    Remove-Item -LiteralPath $scratch -ErrorAction SilentlyContinue
}

exit 0
