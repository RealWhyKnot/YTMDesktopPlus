# Builds the "What's Changed" release body from conventional commits.
#
# Commits come in as a JSON file (array of objects with sha, subject, login)
# so the grouping logic stays testable without git or network access. Output
# is markdown on stdout: typed sections in a fixed order, one bullet per
# commit with author attribution, and a compare-link footer when a previous
# tag exists.
# Targets Windows PowerShell 5.1; avoid newer-only syntax.
param(
  [Parameter(Mandatory = $true)][string]$CommitsPath,
  [Parameter(Mandatory = $true)][string]$Tag,
  [string]$PreviousTag,
  [Parameter(Mandatory = $true)][string]$Repository
)

$ErrorActionPreference = "Stop"

$commits = Get-Content $CommitsPath -Raw | ConvertFrom-Json

$sections = New-Object System.Collections.Specialized.OrderedDictionary
$sections.Add("Features", @())
$sections.Add("Bug Fixes", @())
$sections.Add("Performance", @())
$sections.Add("Refactors", @())
$sections.Add("Documentation", @())
$sections.Add("Style", @())
$sections.Add("Tests", @())
$sections.Add("Build", @())
$sections.Add("CI", @())
$sections.Add("Chores", @())
$sections.Add("Reverts", @())
$sections.Add("Other Changes", @())

$typeMap = @{
  feat     = "Features"
  fix      = "Bug Fixes"
  perf     = "Performance"
  refactor = "Refactors"
  docs     = "Documentation"
  style    = "Style"
  test     = "Tests"
  build    = "Build"
  ci       = "CI"
  chore    = "Chores"
  revert   = "Reverts"
}

foreach ($commit in $commits) {
  $section = "Other Changes"
  if ($commit.subject -match '^([a-z]+)(\([^)]*\))?!?:') {
    $type = $Matches[1]
    if ($typeMap.ContainsKey($type)) { $section = $typeMap[$type] }
  }
  $shortSha = $commit.sha.Substring(0, [Math]::Min(7, $commit.sha.Length))
  $author = ""
  if ($commit.login) {
    $author = " by [@$($commit.login)](https://github.com/$($commit.login))"
  }
  $sections[$section] = @($sections[$section]) + "* $($commit.subject)$author in $shortSha"
}

$lines = @("## What's Changed")
foreach ($name in $sections.Keys) {
  $bullets = $sections[$name]
  if ($bullets.Count -eq 0) { continue }
  $lines += ""
  $lines += "### $name"
  $lines += ""
  $lines += $bullets
}

if ($PreviousTag) {
  $lines += ""
  $lines += "Full Changelog: [$Repository@$PreviousTag...$Tag](https://github.com/$Repository/compare/$PreviousTag...$Tag)"
}

$lines -join "`n"
