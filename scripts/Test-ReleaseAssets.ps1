#!/usr/bin/env pwsh
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Import-Module -Name (Join-Path $PSScriptRoot 'TestCommon.psm1')
Import-Module -Name (Join-Path $PSScriptRoot 'ReleaseAssets.psm1')

$scratch = New-ScratchPath 'release-assets-test-' ''
$null = New-Item -ItemType Directory -Path $scratch

try {
    $setupName = Get-AssetName 'out/make/YTMDesktopPlus Setup 1.0.exe'
    Assert-True ($setupName -ceq 'YTMDesktopPlus.Setup.1.0.exe') 'spaces become dots'
    Assert-True ((Get-AssetName 'out/..odd  name..deb') -ceq 'odd.name.deb') 'dot runs collapse and end dots go'
    Assert-True ((Get-AssetName 'out/ytmd_1.0+beta@x.rpm') -ceq 'ytmd_1.0+beta@x.rpm') 'allowed characters stay'

    $path = Join-Path $scratch 'YTMDesktopPlus 1.0.flatpak'
    [IO.File]::WriteAllText($path, 'published bytes')
    $file = Get-Item -LiteralPath $path
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    $name = 'YTMDesktopPlus.1.0.flatpak'
    $other = 'sha256:' + ('0' * 64)

    $matching = @("[{`"name`":`"$name`",`"digest`":`"sha256:$hash`"}]" | ConvertFrom-Json)
    Assert-True ($null -eq (Get-ReleaseAssetProblem -file $file -assets $matching)) 'a matching digest passes'

    $missing = @('[{"name":"YTMDesktopPlus.2.0.flatpak","digest":"' + $other + '"}]' | ConvertFrom-Json)
    $problem = Get-ReleaseAssetProblem -file $file -assets $missing
    Assert-True ($problem -ceq "release asset $name is missing") "a missing asset is reported: $problem"

    $wrongCase = @("[{`"name`":`"$($name.ToLowerInvariant())`",`"digest`":`"sha256:$hash`"}]" | ConvertFrom-Json)
    $problem = Get-ReleaseAssetProblem -file $file -assets $wrongCase
    Assert-True ($problem -ceq "release asset $name is missing") "names match case-sensitively: $problem"

    $noDigest = @("[{`"name`":`"$name`"}]" | ConvertFrom-Json)
    $problem = Get-ReleaseAssetProblem -file $file -assets $noDigest
    Assert-True ($problem -ceq "release asset $name has no SHA-256 digest") "a missing digest is reported: $problem"

    $nullDigest = @("[{`"name`":`"$name`",`"digest`":null}]" | ConvertFrom-Json)
    $problem = Get-ReleaseAssetProblem -file $file -assets $nullDigest
    Assert-True ($problem -ceq "release asset $name has no SHA-256 digest") "a null digest is reported: $problem"

    $different = @("[{`"name`":`"$name`",`"digest`":`"$other`"}]" | ConvertFrom-Json)
    $problem = Get-ReleaseAssetProblem -file $file -assets $different
    Assert-True ($problem -ceq "SHA-256 differs from release asset $name") "a different digest is reported: $problem"

    $problem = Get-ReleaseAssetProblem -file $file -assets @()
    Assert-True ($problem -ceq "release asset $name is missing") "an empty release is reported: $problem"
} finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output 'ReleaseAssets self-test passed'
exit 0
