# Self-test for Update-Changelog.ps1. Runs against a scratch file so a parser
# or logic regression fails fast in CI before any workflow depends on it.
. (Join-Path $PSScriptRoot "TestCommon.ps1")

$script = Join-Path $PSScriptRoot "Update-Changelog.ps1"
$scratch = New-ScratchPath "changelog-test-" ".md"

try {
  [System.IO.File]::WriteAllText($scratch, "# Changelog`n`n## Unreleased`n", (New-Object System.Text.UTF8Encoding($false)))

  & $script -Mode Append -Path $scratch -Subjects @("feat: first thing", "fix: second thing")
  $content = [System.IO.File]::ReadAllText($scratch)
  Assert-True ($content -match "- feat: first thing") "Append writes first bullet"
  Assert-True ($content -match "- fix: second thing") "Append writes second bullet"

  & $script -Mode Promote -Path $scratch -Tag "v2026.803.1" -Date "2026-08-03" -RepositoryUrl "https://github.com/RealWhyKnot/YTMDesktopPlus"
  $content = [System.IO.File]::ReadAllText($scratch)
  Assert-True ($content -match "\[v2026\.803\.1\]") "Promote creates tagged heading"
  Assert-True (($content -split "## Unreleased").Count -eq 2) "Promote leaves exactly one Unreleased section"
  Assert-True ($content.IndexOf("## Unreleased") -lt $content.IndexOf("v2026.803.1")) "Fresh Unreleased sits above the tagged section"

  $notes = & $script -Mode Notes -Path $scratch -Tag "v2026.803.1"
  Assert-True (($notes -join "`n") -match "feat: first thing") "Notes extracts the tagged section"

  Write-Output "Update-Changelog self-test passed"
} finally {
  Remove-Item $scratch -ErrorAction SilentlyContinue
}
