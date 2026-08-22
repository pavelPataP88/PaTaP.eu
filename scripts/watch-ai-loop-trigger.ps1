param(
  [string]$Repository = 'pavelPataP88/PaTaP.eu',
  [string]$Branch = 'codex/local-workspace-snapshot',
  [string]$Workspace = 'D:\WWW.PATAP.EU',
  [ValidateRange(15, 300)]
  [int]$PollSeconds = 30,
  [switch]$Once
)

$ErrorActionPreference = 'Stop'
$stateDirectory = Join-Path $Workspace '.ai-loop'
$statePath = Join-Path $stateDirectory 'chatgpt-task-state.json'
$logPath = Join-Path $stateDirectory 'watcher.log'
$codexPath = if ($env:CODEX_CLI_PATH) { $env:CODEX_CLI_PATH } else { 'C:\Users\Biuro\AppData\Local\OpenAI\Codex\bin\e305f1c75d8da435\codex.exe' }

New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null

$isFirstWatcher = $false
$watcherMutex = New-Object System.Threading.Mutex($true, 'PaTaPAIMapWatcher', [ref]$isFirstWatcher)
if (-not $isFirstWatcher) { exit 0 }

function Write-Log([string]$Message) {
  "$(Get-Date -Format o) $Message" | Add-Content -LiteralPath $logPath -Encoding utf8
}

function Get-State {
  if (Test-Path -LiteralPath $statePath -PathType Leaf) {
    return Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  }
  return [pscustomobject]@{ processedTaskIds = @(); runningTaskId = $null; lastResult = $null }
}

function Save-State($State) {
  $State | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
}

if (-not (Test-Path -LiteralPath $codexPath -PathType Leaf)) {
  throw "Codex CLI not found: $codexPath"
}

Write-Log "WATCHER_STARTED repository=$Repository branch=$Branch"
while ($true) {
  try {
    # Only this exact GitHub issue title is a wake signal. Handoff updates and Codex commits are ignored.
    $cacheBuster = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $issuesUrl = "https://github.com/$Repository/issues?state=open&cache_buster=$cacheBuster"
    $issuesHtml = & curl.exe --silent --show-error --fail --max-time 20 --header 'User-Agent: Mozilla/5.0' $issuesUrl 2>&1
    if ($LASTEXITCODE -ne 0) { throw "GitHub request failed: $($issuesHtml -join ' ')" }

    $state = Get-State
    $matches = [regex]::Matches(($issuesHtml -join "`n"), '\[AI_TASK\]\[MAP\]\s+TASK_ID=([A-Za-z0-9._-]+)')
    $taskId = $null
    foreach ($match in $matches) {
      $candidate = $match.Groups[1].Value
      if ($state.processedTaskIds -notcontains $candidate -and $state.runningTaskId -ne $candidate) {
        $taskId = $candidate
        break
      }
    }

    if ($null -ne $taskId) {
      $state.runningTaskId = $taskId
      Save-State $state
      $runPrefix = Join-Path $stateDirectory "map-$taskId"
      $promptPath = "$runPrefix-prompt.txt"
      $stdoutPath = "$runPrefix-stdout.txt"
      $stderrPath = "$runPrefix-stderr.txt"
      $lastMessagePath = "$runPrefix-last-message.txt"
      $resultPath = "$runPrefix-result.json"
      $handoffInputPath = "$runPrefix-handoff.md"
      $handoffUrl = "https://raw.githubusercontent.com/$Repository/$Branch/AI_HANDOFF.md"
      $handoffContent = & curl.exe --silent --show-error --fail --max-time 20 $handoffUrl 2>&1
      if ($LASTEXITCODE -ne 0) { throw "Unable to download AI_HANDOFF.md: $($handoffContent -join ' ')" }
      $handoffContent | Set-Content -LiteralPath $handoffInputPath -Encoding utf8
      $taskPrompt = @"
You are Codex in the permanent PaTaP MAP review loop. The GitHub task identifier is $taskId.

Read the current handoff first from this local file: $handoffInputPath
Only process this one MAP task. Do not start CHAT, RADIO, UI, AUTH, or other blocks.

Required safety rules:
- never use git reset --hard;
- never delete user data or alter real SQLite users unless the handoff explicitly requires it;
- never publish secrets, GPS, messages, users, tokens, logs, or runtime data;
- never push or merge main;
- minimum password length remains 6;
- if the task, branch, or latest ChatGPT handoff entry is ambiguous, stop and report BLOCKED.

Review the referenced diff and run only relevant checks. If changes are safe and accepted, apply only the approved MAP changes locally and test them. Record a complete result in AI_HANDOFF.md on branch $Branch. Do not create a new GitHub issue. Your own handoff result must not be treated as a new task.

Only after the GitHub handoff result is saved, use the already available current ChatGPT browser chat to send exactly: CODEX_DONE. If GitHub writing or browser access is unavailable, do not simulate success: record BLOCKED with the reason in the local result.

Always write a concise local result file at '$runPrefix-local-report.md' containing task ID, status, checks, changed files, risks, and whether the GitHub handoff and CODEX_DONE were actually completed.
"@
      $taskPrompt | Set-Content -LiteralPath $promptPath -Encoding utf8
      Write-Log "TASK_DETECTED task=$taskId"
      $arguments = @('--ask-for-approval', 'never', 'exec', '--cd', $Workspace, '--sandbox', 'workspace-write', '--output-last-message', $lastMessagePath, '-')
      $process = Start-Process -FilePath $codexPath -ArgumentList $arguments -RedirectStandardInput $promptPath -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -Wait -PassThru -WindowStyle Hidden
      $localReport = "$runPrefix-local-report.md"
      $status = if ($process.ExitCode -eq 0 -and (Test-Path -LiteralPath $localReport -PathType Leaf)) { 'completed' } else { 'failed-or-blocked' }
      [pscustomobject]@{ taskId = $taskId; finishedAt = (Get-Date -Format o); codexExitCode = $process.ExitCode; status = $status; localReport = $localReport } | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding utf8
      $state.processedTaskIds = @($state.processedTaskIds) + $taskId
      $state.runningTaskId = $null
      $state.lastResult = $status
      Save-State $state
      Write-Log "TASK_FINISHED task=$taskId exit=$($process.ExitCode) status=$status"
      if ($Once) { exit $(if ($status -eq 'completed') { 0 } else { 1 }) }
    }
  } catch {
    Write-Log "POLL_ERROR $($_.Exception.Message)"
  }
  Start-Sleep -Seconds $PollSeconds
}
