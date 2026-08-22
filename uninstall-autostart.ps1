$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$taskName = "PaTaP Stack"
$taskPath = "\PaTaP\"
$legacyStartup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\Patap Lab Stack.cmd"

$task = Get-ScheduledTask -TaskName $taskName -TaskPath $taskPath -ErrorAction SilentlyContinue
if ($task) {
  Unregister-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Confirm:$false
}

if (Test-Path -LiteralPath $legacyStartup -PathType Leaf) {
  Remove-Item -LiteralPath $legacyStartup -Force
}

[PSCustomObject]@{
  Removed = $true
  TaskPath = "$taskPath$taskName"
  LegacyStartupRemoved = -not (Test-Path -LiteralPath $legacyStartup)
}
