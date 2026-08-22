Set-StrictMode -Version Latest

function Normalize-PatapPath([string]$PathValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return $null }
  try { return [System.IO.Path]::GetFullPath($PathValue).TrimEnd('\') } catch { return $PathValue.Trim().Trim('"').TrimEnd('\') }
}

function Test-PatapCommandLineArgumentPath([string]$CommandLine, [string]$SwitchName, [string]$ExpectedPath) {
  if ([string]::IsNullOrWhiteSpace($CommandLine) -or [string]::IsNullOrWhiteSpace($SwitchName) -or [string]::IsNullOrWhiteSpace($ExpectedPath)) { return $false }
  $pattern = '(?i)(?:^|\s)' + [Regex]::Escape($SwitchName) + '(?:=|\s+)(?:"([^"]+)"|''([^'']+)''|([^\s]+))'
  $match = [Regex]::Match($CommandLine, $pattern)
  if (-not $match.Success) { return $false }
  $actual = if ($match.Groups[1].Success) { $match.Groups[1].Value } elseif ($match.Groups[2].Success) { $match.Groups[2].Value } else { $match.Groups[3].Value }
  return [string]::Equals((Normalize-PatapPath $actual), (Normalize-PatapPath $ExpectedPath), [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-PatapTunnelProcess([string]$TokenFile) {
  return Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $command = [string]$_.CommandLine
      $command -match '(?i)(?:^|\s)tunnel\s+run(?:\s|$)' -and
      (Test-PatapCommandLineArgumentPath $command '--token-file' $TokenFile)
    } |
    Select-Object -First 1
}

function Get-PatapCaddyProcess([string]$ConfigFile) {
  return Get-CimInstance Win32_Process -Filter "Name = 'caddy.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $command = [string]$_.CommandLine
      $command -match '(?i)(?:^|\s)run(?:\s|$)' -and
      (Test-PatapCommandLineArgumentPath $command '--config' $ConfigFile)
    } |
    Select-Object -First 1
}

function Resolve-PatapCloudflaredExecutable {
  $override = [Environment]::GetEnvironmentVariable('PATAP_CLOUDFLARED_EXE', 'Process')
  if (-not [string]::IsNullOrWhiteSpace($override)) {
    if (-not (Test-Path -LiteralPath $override -PathType Leaf)) { throw "PATAP_CLOUDFLARED_EXE does not exist: $override" }
    return (Resolve-Path -LiteralPath $override).Path
  }

  $fromPath = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($fromPath) { return $fromPath.Source }

  $known = @()
  $programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)', 'Process')
  $programFiles = [Environment]::GetEnvironmentVariable('ProgramFiles', 'Process')
  if (-not [string]::IsNullOrWhiteSpace($programFilesX86)) { $known += Join-Path $programFilesX86 'cloudflared\cloudflared.exe' }
  if (-not [string]::IsNullOrWhiteSpace($programFiles)) { $known += Join-Path $programFiles 'cloudflared\cloudflared.exe' }
  foreach ($candidate in $known) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }

  throw 'cloudflared.exe not found. Set PATAP_CLOUDFLARED_EXE, install cloudflared, or add it to PATH.'
}

function Resolve-PatapCaddyExecutable {
  $override = [Environment]::GetEnvironmentVariable('PATAP_CADDY_EXE', 'Process')
  if (-not [string]::IsNullOrWhiteSpace($override)) {
    if (-not (Test-Path -LiteralPath $override -PathType Leaf)) { throw "PATAP_CADDY_EXE does not exist: $override" }
    return (Resolve-Path -LiteralPath $override).Path
  }

  $fromPath = Get-Command caddy.exe -ErrorAction SilentlyContinue
  if ($fromPath) { return $fromPath.Source }

  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $wingetRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\CaddyServer.Caddy_Microsoft.Winget.Source_8wekyb3d8bbwe'
    $direct = Join-Path $wingetRoot 'caddy.exe'
    if (Test-Path -LiteralPath $direct -PathType Leaf) { return $direct }
    if (Test-Path -LiteralPath $wingetRoot -PathType Container) {
      $found = Get-ChildItem -LiteralPath $wingetRoot -Filter 'caddy.exe' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($found) { return $found.FullName }
    }
  }

  throw 'caddy.exe not found. Set PATAP_CADDY_EXE, install Caddy, or add it to PATH.'
}
