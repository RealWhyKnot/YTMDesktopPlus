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

  $expected = "# Changelog`n`n## Unreleased`n`n## [v2026.803.1](https://github.com/RealWhyKnot/YTMDesktopPlus/releases/tag/v2026.803.1) - 2026-08-03`n- feat: first thing`n- fix: second thing`n"
  Assert-True ($content -eq $expected) "Promote without a keep list writes the original layout"

  $null = & $script -Mode Promote -Path $scratch -Tag "v2026.803.1" -Date "2026-08-04"
  Assert-True ([System.IO.File]::ReadAllText($scratch) -eq $expected) "Promoting a tag twice leaves the file alone"

  & $script -Mode Append -Path $scratch -Subjects @("fix: typo", "feat: shipped thing")
  & $script -Mode Append -Path $scratch -Subjects @("fix: typo", "fix: landed during the build")
  & $script -Mode Promote -Path $scratch -Tag "v2026.804.0-beta" -Date "2026-08-04" -KeepSubjects @("fix: landed during the build", "fix: typo", "fix: not in the changelog")
  $content = [System.IO.File]::ReadAllText($scratch)
  $unreleased = $content.Substring(0, $content.IndexOf("## [v2026.804.0-beta]"))
  $section = (& $script -Mode Notes -Path $scratch -Tag "v2026.804.0-beta") -join "`n"
  Assert-True ($unreleased -match "- fix: landed during the build") "Entries for kept commits stay unreleased"
  Assert-True (($unreleased -split "- fix: typo").Count -eq 2) "A kept subject holds back one matching entry"
  Assert-True ($section -match "- feat: shipped thing") "Entries for released commits move under the tag"
  Assert-True (($section -split "- fix: typo").Count -eq 2) "The other entry with the same subject is released"
  Assert-True ($section -notmatch "landed during the build") "Kept entries are not filed under the tag"
  Assert-True ($content.Contains("## [v2026.803.1]")) "Older sections are untouched"

  $repo = New-ScratchPath "changelog-repo-" ""
  $null = New-Item -ItemType Directory -Path $repo
  Push-Location $repo
  try {
    $env:GIT_CONFIG_NOSYSTEM = "1"
    $env:GIT_CONFIG_GLOBAL = Join-Path $repo ".gitconfig-empty"
    [System.IO.File]::WriteAllText($env:GIT_CONFIG_GLOBAL, "")
    git init --quiet
    git -c user.name=test -c user.email=test@example.com commit --quiet --allow-empty -m "feat: in the release"
    git tag v2026.805.0
    git -c user.name=test -c user.email=test@example.com commit --quiet --allow-empty -m "fix: after the tag"
    git -c user.name=test -c user.email=test@example.com commit --quiet --allow-empty -m "docs(changelog): append entries [skip changelog]"
    [System.IO.File]::WriteAllText((Join-Path $repo "CHANGELOG.md"), "# Changelog`n`n## Unreleased`n- fix: after the tag`n- feat: in the release`n", (New-Object System.Text.UTF8Encoding($false)))
    & $script -Mode Promote -Path (Join-Path $repo "CHANGELOG.md") -Tag "v2026.805.0" -Date "2026-08-05" -KeepRange "v2026.805.0..HEAD"
    $content = [System.IO.File]::ReadAllText((Join-Path $repo "CHANGELOG.md"))
    Assert-True ($content -eq "# Changelog`n`n## Unreleased`n- fix: after the tag`n`n## [v2026.805.0] - 2026-08-05`n- feat: in the release`n") "KeepRange holds back commits after the tag"
  } finally {
    Pop-Location
    Remove-Item Env:\GIT_CONFIG_NOSYSTEM -ErrorAction SilentlyContinue
    Remove-Item Env:\GIT_CONFIG_GLOBAL -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $repo -Recurse -Force -ErrorAction SilentlyContinue
  }

  Write-Output "Update-Changelog self-test passed"
} finally {
  Remove-Item $scratch -ErrorAction SilentlyContinue
}
