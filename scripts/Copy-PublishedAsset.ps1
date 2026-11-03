#!/usr/bin/env pwsh
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [Parameter(Mandatory = $true)][string]$Repository,
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [Parameter(Mandatory = $true)][string]$Destination
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Import-Module -Name (Join-Path $PSScriptRoot 'ReleaseAssets.psm1')

$files = @(Get-ChildItem -LiteralPath $Source -File -Filter $Pattern)
if ($files.Count -eq 0) {
    Write-Output "::error::No build artifact in $Source matches $Pattern"
    exit 1
}
$response = gh api "repos/$Repository/releases/tags/$Tag"
if ($LASTEXITCODE -ne 0) {
    Write-Output "::error::Could not read release $Tag of $Repository"
    exit 1
}
$assets = @(($response | ConvertFrom-Json).assets)
$null = New-Item -ItemType Directory -Force -Path $Destination
foreach ($file in $files) {
    $problem = Get-ReleaseAssetProblem -File $file -Assets $assets
    if ($problem) {
        Write-Output "::error::$($file.Name): $problem"
        exit 1
    }
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $Destination (Get-AssetName $file.FullName))
}
exit 0
