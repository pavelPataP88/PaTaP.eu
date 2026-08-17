$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$expectedCaddyConfig = [IO.Path]::GetFullPath((Join-Path $root "Caddyfile.tunnel"))
$expectedTokenFile = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "PatapLab\cloudflared\patap-lab-token.txt"))
$results = [Collections.Generic.List[object]]::new()

function Add-Check {
  param(
    [string]$Name,
    [ValidateSet("PASS", "FAIL", "WARN")][string]$Status,
    [object]$Actual,
    [string]$Reason = ""
  )
  $results.Add([PSCustomObject]@{
    component = $Name
    status = $Status
    actual = $Actual
    reason = $Reason
  })
}

function Invoke-HttpProbe {
  param([string]$Uri)
  try {
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(8)
    $response = $client.GetAsync($Uri).GetAwaiter().GetResult()
    return [PSCustomObject]@{
      ok = $true
      status = [int]$response.StatusCode
      location = if ($response.Headers.Location) { $response.Headers.Location.ToString() } else { $null }
    }
  } catch {
    return [PSCustomObject]@{ ok = $false; error = $_.Exception.Message }
  } finally {
    if ($client) { $client.Dispose() }
    if ($handler) { $handler.Dispose() }
  }
}

function Get-CommandLineProcesses {
  param([string]$Name)
  $items = @(Get-CimInstance Win32_Process -Filter "Name = '$Name'" -ErrorAction SilentlyContinue)
  if ($items.Count -eq 0) {
    $items = @(Get-WmiObject Win32_Process -Filter "Name = '$Name'" -ErrorAction SilentlyContinue)
  }
  return $items
}

$localSite = Invoke-HttpProbe "http://127.0.0.1:8090/"
if ($localSite.ok -and $localSite.status -eq 200) {
  Add-Check "local-site" "PASS" "HTTP 200" ""
} else {
  Add-Check "local-site" "FAIL" ($localSite | ConvertTo-Json -Compress) "127.0.0.1:8090 did not return HTTP 200"
}

$backend = Invoke-HttpProbe "http://127.0.0.1:8091/api/health"
if ($backend.ok -and $backend.status -eq 200) {
  Add-Check "auth-backend" "PASS" "HTTP 200" ""
} else {
  Add-Check "auth-backend" "FAIL" ($backend | ConvertTo-Json -Compress) "The auth health endpoint did not return HTTP 200"
}

$caddyProcesses = @(Get-CommandLineProcesses "caddy.exe")
$patapCaddy = @($caddyProcesses | Where-Object {
  $command = [string]$_.CommandLine
  $command -like "*Caddyfile.tunnel*" -and
  ($command -like "*$expectedCaddyConfig*" -or $command -like "*D:\WWW.PATAP.EU\Caddyfile.tunnel*")
})
if ($patapCaddy.Count -eq 1) {
  Add-Check "caddy-process" "PASS" "PID $($patapCaddy[0].ProcessId)" ""
  Add-Check "caddy-config" "PASS" $expectedCaddyConfig ""
} elseif ($patapCaddy.Count -gt 1) {
  Add-Check "caddy-process" "WARN" (($patapCaddy.ProcessId -join ",")) "More than one PATAP Caddy process is running"
  Add-Check "caddy-config" "PASS" $expectedCaddyConfig ""
} else {
  Add-Check "caddy-process" "FAIL" (($caddyProcesses.ProcessId -join ",")) "No Caddy process uses the PATAP configuration"
  Add-Check "caddy-config" "FAIL" $expectedCaddyConfig "The expected configuration was not found in a running Caddy command line"
}

if ($localSite.ok -and $localSite.status -eq 200 -and $patapCaddy.Count -ge 1) {
  Add-Check "caddy-origin" "PASS" "PATAP Caddy present; port 8090 returned HTTP 200" ""
} else {
  Add-Check "caddy-origin" "FAIL" "processes=$($patapCaddy.Count); http=$($localSite.status)" "Process identity and the actual port response did not both pass"
}

$tunnelProcesses = @(Get-CommandLineProcesses "cloudflared.exe")
$patapTunnel = @($tunnelProcesses | Where-Object {
  $command = [string]$_.CommandLine
  $command -like "*tunnel*run*" -and
  $command -like "*--token-file*" -and
  ($command -like "*$expectedTokenFile*" -or $command -like "*patap-lab-token.txt*")
})
if ($patapTunnel.Count -eq 1) {
  Add-Check "patap-tunnel" "PASS" "PID $($patapTunnel[0].ProcessId)" ""
  Add-Check "tunnel-credential" "PASS" $expectedTokenFile ""
} elseif ($patapTunnel.Count -gt 1) {
  Add-Check "patap-tunnel" "WARN" (($patapTunnel.ProcessId -join ",")) "More than one PATAP tunnel process is running"
  Add-Check "tunnel-credential" "PASS" $expectedTokenFile ""
} else {
  Add-Check "patap-tunnel" "FAIL" (($tunnelProcesses.ProcessId -join ",")) "No cloudflared process matches the PATAP tunnel command"
  Add-Check "tunnel-credential" "FAIL" $expectedTokenFile "The expected token file was not found in a running command line"
}

$publicSite = Invoke-HttpProbe "https://patap.eu/"
if ($publicSite.ok -and $publicSite.status -eq 200) {
  Add-Check "public-site" "PASS" "HTTP 200" ""
} else {
  Add-Check "public-site" "FAIL" ($publicSite | ConvertTo-Json -Compress) "https://patap.eu did not return HTTP 200"
}

$publicHealth = Invoke-HttpProbe "https://patap.eu/api/health"
if ($publicHealth.ok -and $publicHealth.status -eq 200) {
  Add-Check "public-api-health" "PASS" "HTTP 200" ""
} else {
  Add-Check "public-api-health" "FAIL" ($publicHealth | ConvertTo-Json -Compress) "The public health endpoint did not return HTTP 200"
}

$httpRedirect = Invoke-HttpProbe "http://patap.eu/"
if ($httpRedirect.ok -and $httpRedirect.status -in @(301, 302, 307, 308) -and $httpRedirect.location -eq "https://patap.eu/") {
  Add-Check "http-to-https" "PASS" "$($httpRedirect.status) -> $($httpRedirect.location)" ""
} else {
  Add-Check "http-to-https" "FAIL" ($httpRedirect | ConvertTo-Json -Compress) "HTTP did not redirect directly to https://patap.eu/"
}

$wwwRedirect = Invoke-HttpProbe "https://www.patap.eu/"
if ($wwwRedirect.ok -and $wwwRedirect.status -in @(301, 302, 307, 308) -and $wwwRedirect.location -eq "https://patap.eu/") {
  Add-Check "canonical-domain" "PASS" "$($wwwRedirect.status) -> $($wwwRedirect.location)" ""
} else {
  Add-Check "canonical-domain" "FAIL" ($wwwRedirect | ConvertTo-Json -Compress) "www.patap.eu did not redirect directly to the canonical domain"
}

$failed = @($results | Where-Object status -eq "FAIL")
$warned = @($results | Where-Object status -eq "WARN")
$coreDown = @("local-site", "auth-backend", "public-site") | Where-Object {
  $name = $_
  ($results | Where-Object component -eq $name).status -eq "FAIL"
}
if ($coreDown.Count -eq 3) {
  $overall = "DOWN"
  $exitCode = 2
} elseif ($failed.Count -gt 0 -or $warned.Count -gt 0) {
  $overall = "DEGRADED"
  $exitCode = 1
} else {
  $overall = "HEALTHY"
  $exitCode = 0
}

[PSCustomObject]@{
  overall = $overall
  checkedAt = [DateTime]::UtcNow.ToString("o")
  checks = $results
} | ConvertTo-Json -Depth 5

exit $exitCode
