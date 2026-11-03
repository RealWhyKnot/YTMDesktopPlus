#!/usr/bin/env pwsh
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$CommitsPath,
    [Parameter(Mandatory = $true)][string]$Tag,
    [string]$PreviousTag,
    [Parameter(Mandatory = $true)][string]$Repository
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Format-AuthorCredit {
    [CmdletBinding()]
    [OutputType([string])]

    param([string] $Author)

    if (-not $Author) { return '' }
    if ($Author -match '\[bot]$') { return $Author }
    if ($Author -notmatch '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$') { return $Author }
    return "[$Author](https://github.com/$Author)"
}

if (-not (Test-Path -LiteralPath $CommitsPath)) { throw "Commits file not found at $CommitsPath" }
$commits = @([IO.File]::ReadAllText($CommitsPath) | ConvertFrom-Json)

$sections = New-Object System.Collections.Specialized.OrderedDictionary
$sections.Add('Features', @())
$sections.Add('Bug Fixes', @())
$sections.Add('Performance', @())
$sections.Add('Refactors', @())
$sections.Add('Documentation', @())
$sections.Add('Style', @())
$sections.Add('Tests', @())
$sections.Add('Build', @())
$sections.Add('CI', @())
$sections.Add('Chores', @())
$sections.Add('Reverts', @())
$sections.Add('Other Changes', @())

$typeMap = @{
    feat     = 'Features'
    fix      = 'Bug Fixes'
    perf     = 'Performance'
    refactor = 'Refactors'
    docs     = 'Documentation'
    style    = 'Style'
    test     = 'Tests'
    build    = 'Build'
    ci       = 'CI'
    chore    = 'Chores'
    revert   = 'Reverts'
}

foreach ($commit in $commits) {
    $section = 'Other Changes'
    if ($commit.subject -match '^([a-z]+)(\([^)]*\))?!?:') {
        $type = $Matches[1]
        if ($typeMap.ContainsKey($type)) { $section = $typeMap[$type] }
    }
    $shortSha = $commit.sha.Substring(0, [Math]::Min(7, $commit.sha.Length))
    $author = ''
    $login = $commit.PSObject.Properties['login']
    if ($null -ne $login -and $login.Value) {
        $author = " by $(Format-AuthorCredit -Author $login.Value)"
    }
    $sections[$section] = @($sections[$section]) + "* $($commit.subject)$author in $shortSha"
}

$lines = [Collections.Generic.List[string]]::new()
$lines.Add("## What's Changed")
foreach ($name in $sections.Keys) {
    $bullets = $sections[$name]
    if ($bullets.Count -eq 0) { continue }
    $lines.Add('')
    $lines.Add("### $name")
    $lines.Add('')
    $lines.AddRange([string[]]$bullets)
}

if ($PreviousTag) {
    $lines.Add('')
    $compare = "$Repository@$PreviousTag...$Tag"
    $url = "https://github.com/$Repository/compare/$PreviousTag...$Tag"
    $lines.Add("Full Changelog: [$compare]($url)")
}

$lines -join "`n"

exit 0
