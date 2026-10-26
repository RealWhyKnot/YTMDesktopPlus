# Changelog maintenance used by the workflows.
#   Append  - add commit subject bullets under "## Unreleased"
#   Promote - rename "## Unreleased" to a tagged, dated section and insert a
#             fresh Unreleased section above it. Entries for -KeepSubjects or
#             the commits in -KeepRange stay unreleased; a tag that already
#             has a section is left alone
#   Notes   - print the body of a tagged section (release notes extraction)
# Targets Windows PowerShell 5.1; avoid newer-only syntax.
param(
  [Parameter(Mandatory = $true)][ValidateSet("Append", "Promote", "Notes")][string]$Mode,
  [string]$Path = "CHANGELOG.md",
  [string[]]$Subjects,
  [string]$Range,
  [string]$Tag,
  [string]$Date,
  [string]$RepositoryUrl,
  [string[]]$KeepSubjects,
  [string]$KeepRange
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
    if ((-not $Subjects -or $Subjects.Count -eq 0) -and $Range) {
      $Subjects = @(git log --no-merges --format="%s" $Range | Where-Object {
        $_ -notmatch "\[skip changelog\]" -and $_ -notmatch "^chore\(release\)"
      })
    }
    if (-not $Subjects -or $Subjects.Count -eq 0) { throw "Append requires -Subjects or -Range" }
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
    if ($content -match "(?m)^## \[$([regex]::Escape($Tag))\]") {
      Write-Output "$Tag already has a section in $Path"
      break
    }
    if ((-not $KeepSubjects -or $KeepSubjects.Count -eq 0) -and $KeepRange) {
      $KeepSubjects = @(git log --no-merges --format="%s" $KeepRange | Where-Object {
        $_ -notmatch "\[skip changelog\]" -and $_ -notmatch "^chore\(release\)"
      })
      if ($LASTEXITCODE -ne 0) { throw "git log $KeepRange failed" }
    }
    $pending = New-Object System.Collections.Generic.List[string]
    foreach ($subject in @($KeepSubjects)) {
      if ($subject -and $subject.Trim().Length -gt 0) { $pending.Add($subject.Trim()) }
    }
    $bodyStart = $index + $marker.Length
    $next = [regex]::Match($content.Substring($bodyStart), "(?m)^## ")
    $bodyEnd = $content.Length
    if ($next.Success) { $bodyEnd = $bodyStart + $next.Index }
    $kept = @()
    $released = @()
    foreach ($line in ($content.Substring($bodyStart, $bodyEnd - $bodyStart) -split "`n")) {
      $entry = $line.TrimEnd("`r")
      if ($entry.StartsWith("- ") -and $pending.Remove($entry.Substring(2).Trim())) { $kept += $entry } else { $released += $line }
    }
    $heading = "## [$Tag]"
    if ($RepositoryUrl) { $heading = "## [$Tag]($RepositoryUrl/releases/tag/$Tag)" }
    $replacement = $marker
    if ($kept.Count -gt 0) { $replacement += "`n" + ($kept -join "`n") }
    $replacement += "`n`n$heading - $Date" + ($released -join "`n")
    Write-Changelog ($content.Substring(0, $index) + $replacement + $content.Substring($bodyEnd))
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
