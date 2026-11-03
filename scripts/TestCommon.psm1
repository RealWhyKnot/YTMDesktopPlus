#!/usr/bin/env pwsh
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-True {
    [CmdletBinding()]
    [OutputType([void])]
    param([bool]$condition, [string]$message)

    if (-not $condition) { throw "FAILED: $message" }
}

function New-ScratchPath {
    [CmdletBinding()]
    [OutputType([string])]
    param([string]$prefix, [string]$extension)

    Join-Path ([System.IO.Path]::GetTempPath()) ($prefix + [guid]::NewGuid() + $extension)
}

Export-ModuleMember -Function Assert-True, New-ScratchPath
