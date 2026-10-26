param(
  [Parameter(Mandatory = $true)][string]$Tag,
  [Parameter(Mandatory = $true)][string]$Repository,
  [Parameter(Mandatory = $true)][string[]]$Paths
)

$ErrorActionPreference = "Stop"

$artifacts = @($Paths | Where-Object { $_ } | ForEach-Object { (Resolve-Path -LiteralPath $_).Path })
if ($artifacts.Count -eq 0) { Write-Output "::error::No assets to publish"; exit 1 }

function Get-AssetName([string]$path) {
  (Split-Path $path -Leaf) -replace '[^\w.@+-]+', '.' -replace '\.+', '.' -replace '^\.|\.$', ''
}

function Get-UnpublishedArtifacts {
  $assets = (gh release view $Tag --repo $Repository --json assets | ConvertFrom-Json).assets
  foreach ($artifact in $artifacts) {
    $asset = $assets | Where-Object { $_.name -eq (Get-AssetName $artifact) } | Select-Object -First 1
    if (-not $asset -or $asset.state -ne 'uploaded') { $artifact; continue }
    $local = Get-Item -LiteralPath $artifact
    if ($asset.digest) {
      $hash = (Get-FileHash -LiteralPath $local.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($asset.digest -ne "sha256:$hash") { $artifact }
    } elseif ($asset.size -ne $local.Length) {
      $artifact
    }
  }
}

$pending = @($artifacts | Sort-Object { (Get-Item -LiteralPath $_).Length } -Descending)
for ($attempt = 1; $attempt -le 3; $attempt++) {
  foreach ($artifact in $pending) {
    foreach ($name in (@((Split-Path $artifact -Leaf), (Get-AssetName $artifact)) | Select-Object -Unique)) {
      gh release delete-asset $Tag $name --repo $Repository --yes 2>$null
      if ($LASTEXITCODE -eq 0) { Write-Output "Deleted stale asset $name" }
    }
    gh release upload $Tag $artifact --repo $Repository --clobber
    if ($LASTEXITCODE -ne 0) { Write-Output "::warning::Upload of $(Split-Path $artifact -Leaf) reported an error; the release decides" }
  }
  $pending = @(Get-UnpublishedArtifacts)
  if ($pending.Count -eq 0) {
    Write-Output "All $($artifacts.Count) assets on the release match this build"
    exit 0
  }
  Write-Output "::warning::Attempt $attempt of 3 left $($pending.Count) asset(s) missing or different: $(($pending | ForEach-Object { Split-Path $_ -Leaf }) -join ', ')"
  if ($attempt -lt 3) { Start-Sleep -Seconds (15 * $attempt) }
}
exit 1
