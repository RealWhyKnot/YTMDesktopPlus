<#
.SYNOPSIS
Builds the working tree and installs it over the local Squirrel installation.

.DESCRIPTION
Packages the current source into a Windows installer and runs it, so a local
change reaches the installed app without going through a tagged release.

The build is stamped with a version one patch above whatever is installed,
because Squirrel serves the highest version folder it finds and would otherwise
keep running the older installation. That also means the installed app sits
ahead of the published feed until a release with a higher version exists: the
updater will report no update available for that version base, which is the
expected cost of running a local build.

The update channel follows the installed build unless -Beta is passed, so a
stable installation stays on stable.

Settings, sign-in and the rest of the profile in %APPDATA%\YTMDesktopPlus are
untouched; only the program files are replaced.

.PARAMETER Version
Exact version to stamp, for example 2026.803.5. Defaults to one patch above the
highest installed version, or today's CalVer when nothing is installed.

.PARAMETER Beta
Stamp the build as a prerelease so the app follows the beta update channel.

.PARAMETER SkipChecks
Skip lint, typecheck, prettier and unit tests before building.

.PARAMETER NoLaunch
Install without starting the app afterwards.

.PARAMETER Arch
Build architecture. Defaults to x64.

.PARAMETER NodeExe
Node executable used for the build. Defaults to the newest install that is at
least 22 and below 26. Node 26 cannot be used: unpacking the Electron download
stops after the first entry and the packaging step then exits successfully
having produced nothing, which silently yields no installer.

.EXAMPLE
.\scripts\Install-Local.ps1

.EXAMPLE
.\scripts\Install-Local.ps1 -SkipChecks -Beta
#>
[CmdletBinding()]
param(
    [string]$Version,
    [switch]$Beta,
    [switch]$SkipChecks,
    [switch]$NoLaunch,
    [string]$Arch = "x64",
    [string]$NodeExe
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $repoRoot "package.json"
$yarnCjs = Join-Path $repoRoot ".yarn\releases\yarn-4.18.0.cjs"
$installRoot = Join-Path $env:LOCALAPPDATA "ytmdesktop_plus"

if (-not (Test-Path $packageJsonPath)) { throw "package.json not found at $packageJsonPath" }
if (-not (Test-Path $yarnCjs)) { throw "yarn release not found at $yarnCjs" }

function Get-NodeMajor {
    param([string]$Exe)
    if (-not (Test-Path $Exe)) { return -1 }
    $reported = & $Exe -v 2>$null
    if ($LASTEXITCODE -ne 0) { return -1 }
    $text = ($reported | Select-Object -First 1).ToString().TrimStart("v")
    $parsed = 0
    if ([int]::TryParse($text.Split(".")[0], [ref]$parsed)) { return $parsed }
    return -1
}

# The build needs a Node the toolchain still works on. Under Node 26 the
# Electron archive stops unpacking after one entry and forge reports success
# with no installer produced, so those are excluded rather than trusted.
function Resolve-BuildNode {
    $candidates = @()
    $onPath = Get-Command node -ErrorAction SilentlyContinue
    if ($null -ne $onPath) { $candidates += $onPath.Source }
    $candidates += (Join-Path $env:ProgramFiles "nodejs\node.exe")
    $nvmRoot = Join-Path $env:LOCALAPPDATA "nvm"
    if (Test-Path $nvmRoot) {
        foreach ($dir in Get-ChildItem $nvmRoot -Directory -Filter "v*" -ErrorAction SilentlyContinue) {
            $candidates += (Join-Path $dir.FullName "node.exe")
        }
    }

    $best = $null
    $bestMajor = -1
    foreach ($candidate in $candidates) {
        $major = Get-NodeMajor -Exe $candidate
        if ($major -ge 22 -and $major -lt 26 -and $major -gt $bestMajor) {
            $best = $candidate
            $bestMajor = $major
        }
    }
    if ($null -eq $best) { throw "no usable Node found: need one at least 22 and below 26. Pass -NodeExe to choose one." }
    return $best
}

if ([string]::IsNullOrWhiteSpace($NodeExe)) { $NodeExe = Resolve-BuildNode }
$nodeMajor = Get-NodeMajor -Exe $NodeExe
if ($nodeMajor -lt 22) { throw "$NodeExe reports major version $nodeMajor; the build needs at least 22" }
if ($nodeMajor -ge 26) { Write-Warning "$NodeExe is Node $nodeMajor; packaging is known to produce no installer on 26" }

function Invoke-Yarn {
    param([string[]]$YarnArgs)
    & $NodeExe $yarnCjs @YarnArgs
    if ($LASTEXITCODE -ne 0) { throw ("yarn " + ($YarnArgs -join " ") + " failed with exit code $LASTEXITCODE") }
}

# app-<version> folders are the only record of what is installed that does not
# require the app to be running.
function Get-InstalledVersions {
    if (-not (Test-Path $installRoot)) { return @() }
    $found = @()
    foreach ($dir in Get-ChildItem $installRoot -Directory -Filter "app-*") {
        $raw = $dir.Name.Substring(4)
        $base = $raw
        $prerelease = ""
        $dash = $raw.IndexOf("-")
        if ($dash -ge 0) {
            $base = $raw.Substring(0, $dash)
            $prerelease = $raw.Substring($dash + 1)
        }
        $parsed = $null
        if ([System.Version]::TryParse($base, [ref]$parsed)) {
            $found += [pscustomobject]@{ Raw = $raw; Base = $parsed; Prerelease = $prerelease }
        }
    }
    return $found
}

# Highest base wins; a release outranks a prerelease of the same base, matching
# how semver and the updater order them.
function Get-HighestVersion {
    param($Versions)
    $highest = $null
    foreach ($candidate in $Versions) {
        if ($null -eq $highest) { $highest = $candidate; continue }
        if ($candidate.Base -gt $highest.Base) { $highest = $candidate; continue }
        if ($candidate.Base -eq $highest.Base) {
            if ($highest.Prerelease -ne "" -and $candidate.Prerelease -eq "") { $highest = $candidate }
        }
    }
    return $highest
}

# What the update feed is serving matters as much as what is installed: a local
# build at or below the published version would be replaced by it on the next
# update check, taking the local changes with it.
function Get-FeedVersion {
    param([string]$Channel, [string]$Architecture)
    try {
        $url = "https://ytmdesktopplus.com/update/$Channel/win32-$Architecture/0.0.0"
        $response = Invoke-RestMethod -Uri $url -TimeoutSec 10 -ErrorAction Stop
        $raw = ([string]$response.latest).TrimStart("v")
        if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
        $base = $raw
        $prerelease = ""
        $dash = $raw.IndexOf("-")
        if ($dash -ge 0) {
            $base = $raw.Substring(0, $dash)
            $prerelease = $raw.Substring($dash + 1)
        }
        $parsed = $null
        if (-not [System.Version]::TryParse($base, [ref]$parsed)) { return $null }
        return [pscustomobject]@{ Raw = $raw; Base = $parsed; Prerelease = $prerelease }
    }
    catch {
        return $null
    }
}

$installed = Get-InstalledVersions
$highest = Get-HighestVersion -Versions $installed

$wantsBeta = $false
if ($Beta) { $wantsBeta = $true }
elseif ($null -ne $highest -and $highest.Prerelease -like "*beta*") { $wantsBeta = $true }

if ([string]::IsNullOrWhiteSpace($Version)) {
    $channel = "stable"
    if ($wantsBeta) { $channel = "beta" }
    $feed = Get-FeedVersion -Channel $channel -Architecture $Arch
    if ($null -ne $feed) {
        Write-Output ("Feed:      {0} ({1})" -f $feed.Raw, $channel)
        $combined = @()
        if ($null -ne $highest) { $combined += $highest }
        $combined += $feed
        $highest = Get-HighestVersion -Versions $combined
    }

    $now = Get-Date
    $todayBase = [System.Version]("{0}.{1}.0" -f $now.Year, ($now.Month * 100 + $now.Day))
    if ($null -eq $highest) {
        $nextBase = $todayBase
    }
    elseif ($todayBase.Major -gt $highest.Base.Major -or ($todayBase.Major -eq $highest.Base.Major -and $todayBase.Minor -gt $highest.Base.Minor)) {
        $nextBase = $todayBase
    }
    else {
        $nextBase = [System.Version]("{0}.{1}.{2}" -f $highest.Base.Major, $highest.Base.Minor, ($highest.Base.Build + 1))
    }
    $Version = "{0}.{1}.{2}" -f $nextBase.Major, $nextBase.Minor, $nextBase.Build
    if ($wantsBeta) { $Version = $Version + "-beta" }
}

if ($null -eq $highest) { Write-Output "No existing installation found under $installRoot" }
else { Write-Output ("Installed: {0}" -f $highest.Raw) }
Write-Output ("Building:  {0} ({1})" -f $Version, $Arch)
Write-Output ("Node:      {0} (major {1})" -f $NodeExe, $nodeMajor)

$originalPackageJson = [System.IO.File]::ReadAllText($packageJsonPath)
$installedNewVersion = $false

try {
    if (-not $SkipChecks) {
        Write-Output "Running checks..."
        Invoke-Yarn @("lint")
        Invoke-Yarn @("typecheck")
        Invoke-Yarn @("prettier")
        Invoke-Yarn @("test")
    }

    # Forge reads the version from package.json, so it is stamped for the build
    # and restored afterwards to keep the working tree clean.
    $stamped = [System.Text.RegularExpressions.Regex]::Replace(
        $originalPackageJson,
        '("version"\s*:\s*")[^"]+(")',
        ('${1}' + $Version + '${2}'),
        [System.Text.RegularExpressions.RegexOptions]::None,
        [System.TimeSpan]::FromSeconds(5)
    )
    if ($stamped -eq $originalPackageJson) { throw "could not stamp the version into package.json" }
    [System.IO.File]::WriteAllText($packageJsonPath, $stamped, (New-Object System.Text.UTF8Encoding($false)))

    Write-Output "Building the installer..."
    $buildStart = Get-Date
    Invoke-Yarn @("make", "--platform", "win32", "--arch", $Arch)

    $makeDir = Join-Path $repoRoot ("out\make\squirrel.windows\" + $Arch)
    if (-not (Test-Path $makeDir)) { throw "no installer output at $makeDir" }

    # The installer has to carry this run's version and be newer than the build.
    # Forge can exit successfully having made nothing, and installing whatever
    # exe happened to be left in the output folder would silently deploy a stale
    # build over a newer one.
    $setup = Get-ChildItem $makeDir -Filter "*.exe" |
        Where-Object { $_.Name -like "*Setup*" -and $_.Name -like ("*" + $Version + "*") -and $_.LastWriteTime -ge $buildStart } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -eq $setup) {
        throw "no installer for $Version was produced in $makeDir; the build reported success but made nothing"
    }
    Write-Output ("Installer: {0}" -f $setup.FullName)

    $running = Get-Process -Name "ytmdesktop-plus" -ErrorAction SilentlyContinue
    if ($null -ne $running) {
        Write-Output "Closing the running app..."
        $running | Stop-Process -Force
        Start-Sleep -Seconds 2
    }

    Write-Output "Installing..."
    Start-Process -FilePath $setup.FullName -ArgumentList "--silent" -Wait

    # Squirrel finishes its own work after Setup.exe returns, so the new folder
    # is what confirms the install rather than the exit code.
    $expectedDir = Join-Path $installRoot ("app-" + $Version)
    $deadline = (Get-Date).AddSeconds(180)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path $expectedDir) { $installedNewVersion = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $installedNewVersion) { throw "install did not produce $expectedDir" }

    Write-Output ("Installed: {0}" -f $expectedDir)

    if (-not $NoLaunch) {
        $launcher = Join-Path $installRoot "ytmdesktop-plus.exe"
        if (Test-Path $launcher) {
            Write-Output "Starting the app..."
            Start-Process -FilePath $launcher
        }
    }
}
finally {
    [System.IO.File]::WriteAllText($packageJsonPath, $originalPackageJson, (New-Object System.Text.UTF8Encoding($false)))
}

Write-Output ""
Write-Output ("Done. Running version {0}." -f $Version)
Write-Output "The app will not offer an update until a release with a higher version is published."
