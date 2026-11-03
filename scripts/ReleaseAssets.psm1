#!/usr/bin/env pwsh
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-AssetName {
    [CmdletBinding()]
    [OutputType([string])]
    param([string]$path)

    (Split-Path $path -Leaf) -replace '[^\w.@+-]+', '.' -replace '\.+', '.' -replace '^\.|\.$', ''
}

function Get-ReleaseAssetProblem {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory = $true)][System.IO.FileInfo]$file,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$assets
    )

    $name = Get-AssetName $file.FullName
    $asset = $assets | Where-Object { $_.name -ceq $name } | Select-Object -First 1
    if (-not $asset) { return "release asset $name is missing" }
    $digestProperty = $asset.PSObject.Properties['digest']
    $digest = if ($null -ne $digestProperty) { [string]$digestProperty.Value } else { '' }
    if ($digest -notmatch '^sha256:[0-9a-fA-F]{64}$') { return "release asset $name has no SHA-256 digest" }
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ("sha256:$hash" -cne $digest.ToLowerInvariant()) { return "SHA-256 differs from release asset $name" }
}

Export-ModuleMember -Function Get-AssetName, Get-ReleaseAssetProblem
