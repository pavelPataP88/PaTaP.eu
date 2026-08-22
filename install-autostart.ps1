$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$stackScript = [IO.Path]::GetFullPath((Join-Path $root "start-patap-stack.ps1"))
$taskName = "PaTaP Stack"
$taskPath = "\PaTaP\"
$legacyStartup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\Patap Lab Stack.cmd"
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

if (-not (Test-Path -LiteralPath $stackScript -PathType Leaf)) {
  throw "PaTaP stack script not found: $stackScript"
}

if (Test-Path -LiteralPath $legacyStartup -PathType Leaf) {
  Remove-Item -LiteralPath $legacyStartup -Force
}

$argument = "-NoProfile -ExecutionPolicy Bypass -File `"$stackScript`""
$action = New-ScheduledTaskAction -Execute $powershell -Argument $argument -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $taskName `
  -TaskPath $taskPath `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Starts the PaTaP backend, Caddy, Cloudflare tunnel and health watch for the current interactive Windows account." `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath
if (-not $task) { throw "PaTaP scheduled task was not registered" }

[PSCustomObject]@{
  Installed = $true
  TaskPath = "$taskPath$taskName"
  User = $currentUser
  StackScript = $stackScript
  StartWhenAvailable = [bool]$task.Settings.StartWhenAvailable
}
