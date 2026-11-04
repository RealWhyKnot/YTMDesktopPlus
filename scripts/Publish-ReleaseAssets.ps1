#!/usr/bin/env pwsh
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [Parameter(Mandatory = $true)][string]$Repository,
    [Parameter(Mandatory = $true)][string[]]$Paths
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-UnpublishedArtifact {
    [CmdletBinding()]
    [OutputType([string])]
    param()

    $response = gh release view $Tag --repo $Repository --json assets
    if ($LASTEXITCODE -ne 0) {
        foreach ($artifact in $artifacts) { [string]$artifact }
        return
    }
    $assets = ($response | ConvertFrom-Json).assets
    foreach ($artifact in $artifacts) {
        $asset = $assets | Where-Object { $_.name -eq (Get-AssetName $artifact) } | Select-Object -First 1
        if (-not $asset -or $asset.state -ne 'uploaded') { $artifact; continue }
        $local = Get-Item -LiteralPath $artifact
        $digestProperty = $asset.PSObject.Properties['digest']
        $digest = if ($null -ne $digestProperty) { $digestProperty.Value } else { $null }
        if ($digest) {
            $hash = (Get-FileHash -LiteralPath $local.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($digest -ne "sha256:$hash") { $artifact }
        } elseif ($asset.size -ne $local.Length) {
            $artifact
        }
    }
}

Import-Module -Name (Join-Path $PSScriptRoot 'ReleaseAssets.psm1')

$artifacts = @($Paths | Where-Object { $_ } | ForEach-Object { (Resolve-Path -LiteralPath $_).Path })
if ($artifacts.Count -eq 0) { Write-Output '::error::No assets to publish'; exit 1 }

$pending = @(Get-UnpublishedArtifact | Sort-Object { (Get-Item -LiteralPath $_).Length } -Descending)
if ($pending.Count -eq 0) {
    Write-Output "All $($artifacts.Count) assets on the release already match this build"
    exit 0
}
for ($attempt = 1; $attempt -le 3; $attempt++) {
    foreach ($artifact in $pending) {
        foreach ($name in (@((Split-Path $artifact -Leaf), (Get-AssetName $artifact)) | Select-Object -Unique)) {
            & {
                $ErrorActionPreference = 'Continue'
                gh release delete-asset $Tag $name --repo $Repository --yes 2>$null
            }
            if ($LASTEXITCODE -eq 0) { Write-Output "Deleted stale asset $name" }
        }
        gh release upload $Tag $artifact --repo $Repository --clobber
        if ($LASTEXITCODE -ne 0) {
            $name = Split-Path -Path $artifact -Leaf
            Write-Output "::warning::Upload of $name reported an error; the release decides"
        }
    }
    $pending = @(Get-UnpublishedArtifact)
    if ($pending.Count -eq 0) {
        Write-Output "All $($artifacts.Count) assets on the release match this build"
        exit 0
    }
    $names = @(foreach ($path in $pending) { Split-Path -Path $path -Leaf }) -join ', '
    $message = "::warning::Attempt $attempt of 3 left $($pending.Count) asset(s) missing or different: $names"
    Write-Output $message
    if ($attempt -lt 3) { Start-Sleep -Seconds (15 * $attempt) }
}
exit 1
