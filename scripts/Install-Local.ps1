#!/usr/bin/env pwsh
[CmdletBinding()]
param(
    [string]$Version,
    [switch]$Beta,
    [switch]$SkipChecks,
    [switch]$NoLaunch,
    [string]$Arch = 'x64',
    [string]$NodeExe
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-NodeMajor {
    [CmdletBinding()]
    [OutputType([int])]

    param([string]$Exe)
    if (-not (Test-Path -LiteralPath $Exe)) { return -1 }
    $reported = & { $ErrorActionPreference = 'Continue'; & $Exe -v 2>$null }
    if ($LASTEXITCODE -ne 0) { return -1 }
    $text = ($reported | Select-Object -First 1).ToString().TrimStart('v')
    $parsed = 0
    if ([int]::TryParse($text.Split('.')[0], [ref]$parsed)) { return $parsed }
    return -1
}

function Resolve-BuildNode {
    [CmdletBinding()]
    [OutputType([string])]
    param()

    $candidates = [Collections.Generic.List[string]]::new()
    $onPath = Get-Command node -ErrorAction SilentlyContinue
    if ($null -ne $onPath) { $candidates.Add($onPath.Source) }
    $candidates.Add((Join-Path $env:ProgramFiles 'nodejs\node.exe'))
    $nvmRoot = Join-Path $env:LOCALAPPDATA 'nvm'
    if (Test-Path -LiteralPath $nvmRoot) {
        foreach ($dir in Get-ChildItem -LiteralPath $nvmRoot -Directory -Filter 'v*' -ErrorAction SilentlyContinue) {
            $candidates.Add((Join-Path $dir.FullName 'node.exe'))
        }
    }

    $best = $null
    $bestMajor = -1
    foreach ($candidate in $candidates) {
        $major = Get-NodeMajor -Exe $candidate
        if ($major -ge 22 -and $major -gt $bestMajor) {
            $best = $candidate
            $bestMajor = $major
        }
    }
    if ($null -eq $best) { throw 'no usable Node found: need 22 or newer. Pass -NodeExe to choose one.' }
    return $best
}

function Invoke-Yarn {
    [CmdletBinding()]
    [OutputType([object[]])]

    param([string[]]$YarnArgs)
    & $NodeExe $yarnCjs @YarnArgs
    if ($LASTEXITCODE -ne 0) { throw ('yarn ' + ($YarnArgs -join ' ') + " failed with exit code $LASTEXITCODE") }
}

function Get-InstalledVersion {
    [CmdletBinding()]
    [OutputType([object[]])]
    param()

    if (-not (Test-Path -LiteralPath $installRoot)) { return @() }
    $found = [Collections.Generic.List[object]]::new()
    foreach ($dir in Get-ChildItem -LiteralPath $installRoot -Directory -Filter 'app-*') {
        $raw = $dir.Name.Substring(4)
        $base = $raw
        $prerelease = ''
        $dash = $raw.IndexOf('-')
        if ($dash -ge 0) {
            $base = $raw.Substring(0, $dash)
            $prerelease = $raw.Substring($dash + 1)
        }
        $parsed = $null
        if ([System.Version]::TryParse($base, [ref]$parsed)) {
            $found.Add([pscustomobject]@{ Raw = $raw; Base = $parsed; Prerelease = $prerelease })
        }
    }
    return $found.ToArray()
}

function Get-HighestVersion {
    [CmdletBinding()]
    [OutputType([object])]

    param([object[]]$Versions)
    $highest = $null
    foreach ($candidate in $Versions) {
        if ($null -eq $highest) { $highest = $candidate; continue }
        if ($candidate.Base -gt $highest.Base) { $highest = $candidate; continue }
        if ($candidate.Base -eq $highest.Base) {
            if ($highest.Prerelease -ne '' -and $candidate.Prerelease -eq '') { $highest = $candidate }
        }
    }
    return $highest
}

function Get-FeedVersion {
    [CmdletBinding()]
    [OutputType([object])]

    param([string]$Channel, [string]$Architecture)
    try {
        $url = "https://ytmdesktopplus.com/update/$Channel/win32-$Architecture/0.0.0"
        $response = Invoke-RestMethod -Uri $url -TimeoutSec 10 -ErrorAction Stop
        $latestProperty = $response.PSObject.Properties['latest']
        if ($null -eq $latestProperty) { return $null }
        $raw = ([string]$latestProperty.Value).TrimStart('v')
        if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
        $base = $raw
        $prerelease = ''
        $dash = $raw.IndexOf('-')
        if ($dash -ge 0) {
            $base = $raw.Substring(0, $dash)
            $prerelease = $raw.Substring($dash + 1)
        }
        $parsed = $null
        if (-not [System.Version]::TryParse($base, [ref]$parsed)) { return $null }
        return [pscustomobject]@{ Raw = $raw; Base = $parsed; Prerelease = $prerelease }
    } catch [System.Net.WebException], [System.Net.Http.HttpRequestException] {
        return $null
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $repoRoot 'package.json'
$yarnCjs = Join-Path $repoRoot '.yarn\releases\yarn-4.18.0.cjs'
$installRoot = Join-Path $env:LOCALAPPDATA 'ytmdesktop_plus'

if (-not (Test-Path -LiteralPath $packageJsonPath)) { throw "package.json not found at $packageJsonPath" }
if (-not (Test-Path -LiteralPath $yarnCjs)) { throw "yarn release not found at $yarnCjs" }

if ([string]::IsNullOrWhiteSpace($NodeExe)) { $NodeExe = Resolve-BuildNode }
$nodeMajor = Get-NodeMajor -Exe $NodeExe
if ($nodeMajor -lt 22) { throw "$NodeExe reports major version $nodeMajor; the build needs at least 22" }

$installed = Get-InstalledVersion
$highest = Get-HighestVersion -Versions $installed

$wantsBeta = $false
if ($Beta) { $wantsBeta = $true }
elseif ($null -ne $highest -and $highest.Prerelease -like '*beta*') { $wantsBeta = $true }

if ([string]::IsNullOrWhiteSpace($Version)) {
    $channel = 'stable'
    if ($wantsBeta) { $channel = 'beta' }
    $feed = Get-FeedVersion -Channel $channel -Architecture $Arch
    if ($null -ne $feed) {
        Write-Output ('Feed:      {0} ({1})' -f $feed.Raw, $channel)
        $combined = [Collections.Generic.List[object]]::new()
        if ($null -ne $highest) { $combined.Add($highest) }
        $combined.Add($feed)
        $highest = Get-HighestVersion -Versions $combined.ToArray()
    }

    $now = Get-Date
    $todayBase = [System.Version]('{0}.{1}.0' -f $now.Year, ($now.Month * 100 + $now.Day))
    if ($null -eq $highest) {
        $nextBase = $todayBase
    } elseif (
        $todayBase.Major -gt $highest.Base.Major -or
        ($todayBase.Major -eq $highest.Base.Major -and $todayBase.Minor -gt $highest.Base.Minor)
    ) {
        $nextBase = $todayBase
    } else {
        $nextBase = [System.Version]('{0}.{1}.{2}' -f
            $highest.Base.Major, $highest.Base.Minor, ($highest.Base.Build + 1))
    }
    $Version = '{0}.{1}.{2}' -f $nextBase.Major, $nextBase.Minor, $nextBase.Build
    if ($wantsBeta) { $Version = $Version + '-beta' }
}

if ($null -eq $highest) { Write-Output "No existing installation found under $installRoot" }
else { Write-Output ('Installed: {0}' -f $highest.Raw) }
Write-Output ('Building:  {0} ({1})' -f $Version, $Arch)
Write-Output ('Node:      {0} (major {1})' -f $NodeExe, $nodeMajor)

$originalPackageJson = [System.IO.File]::ReadAllText($packageJsonPath)
$installedNewVersion = $false

try {
    if (-not $SkipChecks) {
        Write-Output 'Running checks...'
        Invoke-Yarn @('lint')
        Invoke-Yarn @('typecheck')
        Invoke-Yarn @('prettier')
        Invoke-Yarn @('test')
    }

    $stamped = [System.Text.RegularExpressions.Regex]::Replace(
        $originalPackageJson,
        '("version"\s*:\s*")[^"]+(")',
        ('${1}' + $Version + '${2}'),
        [System.Text.RegularExpressions.RegexOptions]::None,
        [System.TimeSpan]::FromSeconds(5)
    )
    if ($stamped -eq $originalPackageJson) { throw 'could not stamp the version into package.json' }
    [System.IO.File]::WriteAllText($packageJsonPath, $stamped, (New-Object System.Text.UTF8Encoding($false)))

    Write-Output 'Building the installer...'
    $buildStart = Get-Date

    $env:YTMD_LOCAL_BUILD = '1'
    try {
        Invoke-Yarn @('make', '--platform', 'win32', '--arch', $Arch)
    } finally {
        Remove-Item -LiteralPath Env:\YTMD_LOCAL_BUILD -ErrorAction SilentlyContinue
    }

    $makeDir = Join-Path $repoRoot ('out\make\squirrel.windows\' + $Arch)
    if (-not (Test-Path -LiteralPath $makeDir)) { throw "no installer output at $makeDir" }

    $setup = Get-ChildItem -LiteralPath $makeDir -Filter '*.exe' |
        Where-Object {
            $_.Name -like '*Setup*' -and
            $_.Name -like ('*' + $Version + '*') -and
            $_.LastWriteTime -ge $buildStart
        } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -eq $setup) {
        throw "no installer for $Version was produced in $makeDir; the build reported success but made nothing"
    }
    Write-Output ('Installer: {0}' -f $setup.FullName)

    $running = Get-Process -Name 'ytmdesktop-plus' -ErrorAction SilentlyContinue
    if ($null -ne $running) {
        Write-Output 'Closing the running app...'
        $running | Stop-Process -Force
        Start-Sleep -Seconds 2
    }

    Write-Output 'Installing...'
    $installer = Start-Process -FilePath $setup.FullName -ArgumentList '--silent' -Wait -PassThru
    if ($installer.ExitCode -ne 0) { throw "Installer failed with exit code $($installer.ExitCode)" }

    $expectedDir = Join-Path $installRoot ('app-' + $Version)
    $deadline = (Get-Date).AddSeconds(180)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $expectedDir) { $installedNewVersion = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $installedNewVersion) { throw "install did not produce $expectedDir" }

    Write-Output ('Installed: {0}' -f $expectedDir)

    if (-not $NoLaunch) {
        $launcher = Join-Path $installRoot 'ytmdesktop-plus.exe'
        if (Test-Path -LiteralPath $launcher) {
            Write-Output 'Starting the app...'
            Start-Process -FilePath $launcher
        }
    }
} finally {
    [System.IO.File]::WriteAllText(
        $packageJsonPath, $originalPackageJson, (New-Object System.Text.UTF8Encoding($false))
    )
}

Write-Output ''
Write-Output ('Done. Running version {0}.' -f $Version)
Write-Output (
    'The app will not offer an update until a release with a ' +
    'higher version is published.'
)

exit 0
