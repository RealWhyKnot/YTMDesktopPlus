#!/usr/bin/env pwsh
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('Append', 'Promote', 'Notes')][string]$Mode,
    [string]$Path = 'CHANGELOG.md',
    [string[]]$Subjects,
    [string]$Range,
    [string]$Tag,
    [string]$Date,
    [string]$RepositoryUrl,
    [string[]]$KeepSubjects,
    [string]$KeepRange
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Changelog {
    [CmdletBinding()]
    [OutputType([void])]
    param([string]$text)

    $formatted = $text.TrimEnd("`r", "`n") + "`n"
    [System.IO.File]::WriteAllText($script:Path, $formatted, (New-Object System.Text.UTF8Encoding($false)))
}

function New-ChangelogSection {
    [CmdletBinding()]
    [OutputType([string])]
    param([string]$Heading, [string]$Body)

    $trimmed = $Body.Trim("`r", "`n")
    if ($trimmed.Length -eq 0) { return $Heading }
    "$Heading`n`n$trimmed"
}

if (-not (Test-Path -LiteralPath $Path)) {
    throw "Changelog not found at $Path"
}
$content = [System.IO.File]::ReadAllText($Path)

switch ($Mode) {
    'Append' {
        if ((-not $Subjects -or $Subjects.Count -eq 0) -and $Range) {
            $Subjects = @(git log --no-merges --format="%s" $Range | Where-Object {
                    $_ -notmatch '\[skip changelog\]' -and $_ -notmatch '^chore\(release\)'
                }
                if ($LASTEXITCODE -ne 0) { throw 'git failed' })
        }
        if (-not $Subjects -or $Subjects.Count -eq 0) { throw 'Append requires -Subjects or -Range' }
        $marker = '## Unreleased'
        $index = $content.IndexOf($marker)
        if ($index -lt 0) { throw "No '## Unreleased' section in $Path" }
        $insertAt = $index + $marker.Length
        $next = [regex]::Match($content.Substring($insertAt), '(?m)^## ')
        $bodyEnd = $content.Length
        if ($next.Success) { $bodyEnd = $insertAt + $next.Index }
        $bullets = [Text.StringBuilder]::new()
        foreach ($subject in $Subjects) {
            $clean = $subject.Trim()
            if ($clean.Length -gt 0) { $null = $bullets.Append("- $clean`n") }
        }
        $body = $bullets.ToString() + $content.Substring($insertAt, $bodyEnd - $insertAt).Trim("`r", "`n")
        $replacement = New-ChangelogSection -Heading $marker -Body $body
        $tail = $content.Substring($bodyEnd).TrimStart("`r", "`n")
        if ($tail.Length -gt 0) { $replacement += "`n`n$tail" }
        Write-Changelog ($content.Substring(0, $index) + $replacement)
    }
    'Promote' {
        if (-not $Tag) { throw 'Promote requires -Tag' }
        if (-not $Date) { $Date = (Get-Date).ToString('yyyy-MM-dd') }
        $marker = '## Unreleased'
        $index = $content.IndexOf($marker)
        if ($index -lt 0) { throw "No '## Unreleased' section in $Path" }
        if ($content -match "(?m)^## \[$([regex]::Escape($Tag))\]") {
            Write-Output "$Tag already has a section in $Path"
            break
        }
        if ((-not $KeepSubjects -or $KeepSubjects.Count -eq 0) -and $KeepRange) {
            $KeepSubjects = @(git log --no-merges --format="%s" $KeepRange | Where-Object {
                    $_ -notmatch '\[skip changelog\]' -and $_ -notmatch '^chore\(release\)'
                }
                if ($LASTEXITCODE -ne 0) { throw 'git failed' })
            if ($LASTEXITCODE -ne 0) { throw "git log $KeepRange failed" }
        }
        $pending = New-Object System.Collections.Generic.List[string]
        foreach ($subject in @($KeepSubjects)) {
            if ($subject -and $subject.Trim().Length -gt 0) { $pending.Add($subject.Trim()) }
        }
        $bodyStart = $index + $marker.Length
        $next = [regex]::Match($content.Substring($bodyStart), '(?m)^## ')
        $bodyEnd = $content.Length
        if ($next.Success) { $bodyEnd = $bodyStart + $next.Index }
        $kept = [Collections.Generic.List[string]]::new()
        $released = [Collections.Generic.List[string]]::new()
        foreach ($line in ($content.Substring($bodyStart, $bodyEnd - $bodyStart) -split "`n")) {
            $entry = $line.TrimEnd("`r")
            if ($entry.StartsWith('- ') -and $pending.Remove($entry.Substring(2).Trim())) {
                $kept.Add($entry)
            } else {
                $released.Add($line)
            }
        }
        $heading = "## [$Tag]"
        if ($RepositoryUrl) { $heading = "## [$Tag]($RepositoryUrl/releases/tag/$Tag)" }
        $replacement = New-ChangelogSection -Heading $marker -Body ($kept -join "`n")
        $releaseSection = New-ChangelogSection -Heading "$heading - $Date" -Body ($released -join "`n")
        $replacement += "`n`n$releaseSection"
        $tail = $content.Substring($bodyEnd).TrimStart("`r", "`n")
        if ($tail.Length -gt 0) { $replacement += "`n`n$tail" }
        Write-Changelog ($content.Substring(0, $index) + $replacement)
    }
    'Notes' {
        if (-not $Tag) { throw 'Notes requires -Tag' }
        $lines = $content -split "`r?`n"
        $collecting = $false
        $notes = [Collections.Generic.List[string]]::new()
        foreach ($line in $lines) {
            if ($line -match "^## \[?$([regex]::Escape($Tag))\]?") { $collecting = $true; continue }
            if ($collecting -and $line -match '^## ') { break }
            if ($collecting) { $notes.Add($line) }
        }
        if (-not $collecting) { throw "No section for $Tag in $Path" }
        ($notes -join "`n").Trim()
    }
}

exit 0
