# Shared pieces for the script self-tests. Dot-source from a Test-*.ps1.
$ErrorActionPreference = "Stop"

function Assert-True([bool]$condition, [string]$message) {
  if (-not $condition) { throw "FAILED: $message" }
}

function New-ScratchPath([string]$prefix, [string]$extension) {
  Join-Path ([System.IO.Path]::GetTempPath()) ($prefix + [guid]::NewGuid() + $extension)
}
