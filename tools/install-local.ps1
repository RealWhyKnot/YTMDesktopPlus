param([switch]$ThemesOnly)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$root = Join-Path $env:LOCALAPPDATA "ytmdesktop_plus"
if (-not (Test-Path $root)) { throw "no installed client at $root" }

$best = $null
$bestVersion = $null
$bestStable = 0
foreach ($dir in Get-ChildItem -Path $root -Directory -Filter "app-*") {
  $name = $dir.Name.Substring(4)
  $numbers = $name.Split("-")[0]
  $version = $null
  if (-not [version]::TryParse($numbers, [ref]$version)) { continue }
  $stable = 1
  if ($name.Contains("-")) { $stable = 0 }
  if ($null -eq $best -or $version -gt $bestVersion -or ($version -eq $bestVersion -and $stable -gt $bestStable)) {
    $best = $dir
    $bestVersion = $version
    $bestStable = $stable
  }
}
if ($null -eq $best) { throw "no app-* directory under $root" }
$resources = Join-Path $best.FullName "resources"

$running = Get-Process -Name "ytmdesktop-plus" -ErrorAction SilentlyContinue
if ($running) {
  $running | Stop-Process -Force
  Start-Sleep -Seconds 2
}

if (-not $ThemesOnly) {
  Push-Location $repo
  try {
    npx --no-install electron-forge package
    if ($LASTEXITCODE -ne 0) { throw "electron-forge package failed" }
  }
  finally { Pop-Location }
  $out = Join-Path $repo "out\YTMDesktopPlus-win32-x64"
  if (-not (Test-Path (Join-Path $out "resources\app.asar"))) { throw "packaged app.asar not found under $out" }
  robocopy $out $best.FullName /E /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
}

$themesDest = Join-Path $resources "themes"
if (Test-Path $themesDest) { Remove-Item $themesDest -Recurse -Force }
Copy-Item (Join-Path $repo "src\themes") $themesDest -Recurse

Write-Host "installed working tree into $($best.Name)"
if ($running) {
  Start-Process (Join-Path $root "ytmdesktop-plus.exe")
  Write-Host "client restarted"
}
