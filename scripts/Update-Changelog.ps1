# Changelog maintenance used by the workflows.
#   Append  - add commit subject bullets under "## Unreleased"
#   Promote - rename "## Unreleased" to a tagged, dated section and insert a
#             fresh empty Unreleased section above it
#   Notes   - print the body of a tagged section (release notes extraction)
# Targets Windows PowerShell 5.1; avoid newer-only syntax.
param(
  [Parameter(Mandatory = $true)][ValidateSet("Append", "Promote", "Notes")][string]$Mode,
  [string]$Path = "CHANGELOG.md",
  [string[]]$Subjects,
  [string]$Tag,
  [string]$Date,
  [string]$RepositoryUrl
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Path)) {
  throw "Changelog not found at $Path"
}
$content = [System.IO.File]::ReadAllText($Path)

function Write-Changelog([string]$text) {
  [System.IO.File]::WriteAllText($script:Path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

switch ($Mode) {
  "Append" {
    if (-not $Subjects -or $Subjects.Count -eq 0) { throw "Append requires -Subjects" }
    $marker = "## Unreleased"
    $index = $content.IndexOf($marker)
    if ($index -lt 0) { throw "No '## Unreleased' section in $Path" }
    $insertAt = $index + $marker.Length
    $bullets = ""
    foreach ($subject in $Subjects) {
      $clean = $subject.Trim()
      if ($clean.Length -gt 0) { $bullets += "`n- $clean" }
    }
    Write-Changelog ($content.Substring(0, $insertAt) + $bullets + $content.Substring($insertAt))
  }
  "Promote" {
    if (-not $Tag) { throw "Promote requires -Tag" }
    if (-not $Date) { $Date = (Get-Date).ToString("yyyy-MM-dd") }
    $marker = "## Unreleased"
    $index = $content.IndexOf($marker)
    if ($index -lt 0) { throw "No '## Unreleased' section in $Path" }
    $heading = "## [$Tag]"
    if ($RepositoryUrl) { $heading = "## [$Tag]($RepositoryUrl/releases/tag/$Tag)" }
    $replacement = "$marker`n`n$heading - $Date"
    Write-Changelog ($content.Substring(0, $index) + $replacement + $content.Substring($index + $marker.Length))
  }
  "Notes" {
    if (-not $Tag) { throw "Notes requires -Tag" }
    $lines = $content -split "`r?`n"
    $collecting = $false
    $notes = @()
    foreach ($line in $lines) {
      if ($line -match "^## \[?$([regex]::Escape($Tag))\]?") { $collecting = $true; continue }
      if ($collecting -and $line -match "^## ") { break }
      if ($collecting) { $notes += $line }
    }
    if (-not $collecting) { throw "No section for $Tag in $Path" }
    ($notes -join "`n").Trim()
  }
}
