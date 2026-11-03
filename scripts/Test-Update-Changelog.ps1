#!/usr/bin/env pwsh
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-Changelog {
    [CmdletBinding()]
    [OutputType([void])]
    param([string]$Expected, [string]$Message)

    Assert-True ([IO.File]::ReadAllText($scratch) -ceq $Expected) $Message
    $output = & $prettier --check $scratch --config $prettierConfig
    if ($LASTEXITCODE -ne 0) { throw "Prettier rejected the changelog: $Message" }
    Write-Host ($output -join "`n")
}

Import-Module -Name (Join-Path $PSScriptRoot 'TestCommon.psm1')

$script = Join-Path $PSScriptRoot 'Update-Changelog.ps1'
$scratch = New-ScratchPath 'changelog-test-' '.md'
$repoRoot = Split-Path -Parent $PSScriptRoot
$prettier = Join-Path $repoRoot 'node_modules/.bin/prettier'
if ($env:OS -eq 'Windows_NT') { $prettier += '.cmd' }
$prettierConfig = Join-Path $repoRoot 'prettier.config.mjs'
$older = "## [v2026.802.0] - 2026-08-02`n`n- fix: older thing`n"

try {
    [System.IO.File]::WriteAllText(
        $scratch, "# Changelog`n`n## Unreleased`n`n$older", (New-Object System.Text.UTF8Encoding($false))
    )

    & $script -Mode Append -Path $scratch -Subjects @('feat: first thing', 'fix: second thing')
    if ($LASTEXITCODE -ne 0) { throw 'Script failed' }
    $content = [System.IO.File]::ReadAllText($scratch)
    Assert-True ($content -match '- feat: first thing') 'Append writes first bullet'
    Assert-True ($content -match '- fix: second thing') 'Append writes second bullet'
    $entries = "- feat: first thing`n- fix: second thing"
    Assert-Changelog "# Changelog`n`n## Unreleased`n`n$entries`n`n$older" 'Append to an empty Unreleased'

    & $script -Mode Append -Path $scratch -Subjects @('fix: third thing')
    if ($LASTEXITCODE -ne 0) { throw 'Script failed' }
    $entries = "- fix: third thing`n$entries"
    Assert-Changelog "# Changelog`n`n## Unreleased`n`n$entries`n`n$older" 'Append to a non-empty Unreleased'

    $promote = @{
        Mode          = 'Promote'
        Path          = $scratch
        Tag           = 'v2026.803.1'
        Date          = '2026-08-03'
        RepositoryUrl = 'https://github.com/RealWhyKnot/YTMDesktopPlus'
    }
    & $script @promote
    if ($LASTEXITCODE -ne 0) { throw 'Script failed' }
    $content = [System.IO.File]::ReadAllText($scratch)
    Assert-True ($content -match '\[v2026\.803\.1\]') 'Promote creates tagged heading'
    Assert-True (($content -split '## Unreleased').Count -eq 2) 'Promote leaves exactly one Unreleased section'
    $assertion = @{
        Condition = ($content.IndexOf('## Unreleased') -lt $content.IndexOf('v2026.803.1'))
        Message   = 'Fresh Unreleased sits above the tagged section'
    }
    Assert-True @assertion

    $notes = & $script -Mode Notes -Path $scratch -Tag 'v2026.803.1'
    if ($LASTEXITCODE -ne 0) { throw 'Script failed' }
    Assert-True (($notes -join "`n") -ceq $entries) 'Notes returns the same bullet text without surrounding whitespace'

    $released = (
        '## [v2026.803.1](https://github.com/RealWhyKnot/YTMDesktopPlus/' +
        "releases/tag/v2026.803.1) - 2026-08-03`n`n$entries`n`n$older"
    )
    $expected = "# Changelog`n`n## Unreleased`n`n$released"
    Assert-Changelog $expected 'Promote with no kept subjects leaves one blank line between headings'

    $null = & $script -Mode Promote -Path $scratch -Tag 'v2026.803.1' -Date '2026-08-04'
    if ($LASTEXITCODE -ne 0) { throw 'Script failed' }
    $assertion = @{
        Condition = ([System.IO.File]::ReadAllText($scratch) -eq $expected)
        Message   = 'Promoting a tag twice leaves the file alone'
    }
    Assert-True @assertion

    & $script -Mode Append -Path $scratch -Subjects @('fix: typo', 'feat: shipped thing')
    if ($LASTEXITCODE -ne 0) { throw 'Script failed' }
    $entries = "- fix: typo`n- feat: shipped thing"
    Assert-Changelog "# Changelog`n`n## Unreleased`n`n$entries`n`n$released" 'Append after a promote'
    & $script -Mode Append -Path $scratch -Subjects @('fix: typo', 'fix: landed during the build')
    if ($LASTEXITCODE -ne 0) { throw 'Script failed' }
    $pendingEntries = "- fix: typo`n- fix: landed during the build`n$entries"
    Assert-Changelog "# Changelog`n`n## Unreleased`n`n$pendingEntries`n`n$released" 'Second append after a promote'
    $promote = @{
        Mode         = 'Promote'
        Path         = $scratch
        Tag          = 'v2026.804.0-beta'
        Date         = '2026-08-04'
        KeepSubjects = @('fix: landed during the build', 'fix: typo', 'fix: not in the changelog')
    }
    & $script @promote
    if ($LASTEXITCODE -ne 0) { throw 'Script failed' }
    $content = [System.IO.File]::ReadAllText($scratch)
    $unreleased = $content.Substring(0, $content.IndexOf('## [v2026.804.0-beta]'))
    $section = (& $script -Mode Notes -Path $scratch -Tag 'v2026.804.0-beta') -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Script failed' }
    Assert-True ($unreleased -match '- fix: landed during the build') 'Entries for kept commits stay unreleased'
    Assert-True (($unreleased -split '- fix: typo').Count -eq 2) 'A kept subject holds back one matching entry'
    Assert-True ($section -match '- feat: shipped thing') 'Entries for released commits move under the tag'
    Assert-True (($section -split '- fix: typo').Count -eq 2) 'The other entry with the same subject is released'
    Assert-True ($section -notmatch 'landed during the build') 'Kept entries are not filed under the tag'
    Assert-True ($content.Contains('## [v2026.803.1]')) 'Older sections are untouched'
    Assert-True ($section -ceq $entries) 'Notes excludes kept subjects without changing the released text'
    $expected = (
        "# Changelog`n`n## Unreleased`n`n- fix: typo`n- fix: landed during the build`n`n" +
        "## [v2026.804.0-beta] - 2026-08-04`n`n$entries`n`n$released"
    )
    Assert-Changelog $expected 'Promote with kept subjects separates both section bodies'

    $repo = New-ScratchPath 'changelog-repo-' ''
    $null = New-Item -ItemType Directory -Path $repo
    Push-Location $repo
    try {
        $env:GIT_CONFIG_NOSYSTEM = '1'
        $env:GIT_CONFIG_GLOBAL = Join-Path $repo '.gitconfig-empty'
        [System.IO.File]::WriteAllText($env:GIT_CONFIG_GLOBAL, '')
        git init --quiet
        if ($LASTEXITCODE -ne 0) { throw 'git failed' }
        git -c user.name=test -c user.email=test@example.com commit --quiet --allow-empty -m 'feat: in the release'
        if ($LASTEXITCODE -ne 0) { throw 'git failed' }
        git tag v2026.805.0
        if ($LASTEXITCODE -ne 0) { throw 'git failed' }
        git -c user.name=test -c user.email=test@example.com commit --quiet --allow-empty -m 'fix: after the tag'
        if ($LASTEXITCODE -ne 0) { throw 'git failed' }
        $message = 'docs(changelog): append entries [skip changelog]'
        git -c user.name=test -c user.email=test@example.com commit --quiet --allow-empty -m $message
        if ($LASTEXITCODE -ne 0) { throw 'git failed' }
        [System.IO.File]::WriteAllText((Join-Path $repo 'CHANGELOG.md'), (
                "# Changelog`n`n## Unreleased`n- fix: after the tag`n- feat: " +
                "in the release`n"
            ), (New-Object System.Text.UTF8Encoding($false)))
        $promote = @{
            Mode      = 'Promote'
            Path      = Join-Path $repo 'CHANGELOG.md'
            Tag       = 'v2026.805.0'
            Date      = '2026-08-05'
            KeepRange = 'v2026.805.0..HEAD'
        }
        & $script @promote
        if ($LASTEXITCODE -ne 0) { throw 'Script failed' }
        $content = [System.IO.File]::ReadAllText((Join-Path $repo 'CHANGELOG.md'))
        $assertion = @{
            Condition = ($content -eq (
                    "# Changelog`n`n## Unreleased`n`n- fix: after the tag`n`n## " +
                    "[v2026.805.0] - 2026-08-05`n`n- feat: in the release`n"
                ))
            Message   = 'KeepRange holds back commits after the tag'
        }
        Assert-True @assertion
    } finally {
        Pop-Location
        Remove-Item -LiteralPath Env:\GIT_CONFIG_NOSYSTEM -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath Env:\GIT_CONFIG_GLOBAL -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $repo -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Output 'Update-Changelog self-test passed'
} finally {
    Remove-Item -LiteralPath $scratch -ErrorAction SilentlyContinue
}

exit 0
