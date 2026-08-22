# AI_TASK — COMMERCIAL_HARDENING_V1: READY_FOR_CODEX_WINDOWS_DEPLOY

Status: READY_FOR_CODEX_WINDOWS_DEPLOY — NOT YET DEPLOYED.

Repository: `pavelPataP88/PaTaP.eu`
Candidate branch: `chatgpt/commercial-hardening-v1-work`
Base deployed snapshot: `codex/local-workspace-snapshot @ ef0d4da95f6008cc303eba051764f651594049a4`
PR: #28

Included audit blocks:
- AUD-007 user data export + guarded account deletion lifecycle;
- AUD-014 mandatory dependency security audit;
- AUD-015 Windows autostart via scoped Scheduled Task;
- AUD-017 continuous observable health-watch.

GitHub CI evidence before this handoff update: run `32572874516` passed Ubuntu release-gate, Windows Driver E2E, Windows operations contract and public smoke. Auth 50/50, Radio 1/1, Driver 14 files / 74/74, client 2/2, config 37/37, Driver E2E PASS, local browser PASS, npm audit 0 vulnerabilities.

Codex job after resolving the exact current branch SHA:
1. Preserve current `D:\WWW.PATAP.EU` branch/HEAD/status and all unrelated local/runtime data. Do not touch `main` or Navigation.
2. Verify Node 24.x, run `npm ci`, `npm run runtime:check`, `npm run verify:release`; require the expected counts above and 0 vulnerabilities.
3. Before changing the running stack, run `npm run production:preflight`; require `PRODUCTION_PREFLIGHT READY`.
4. Preserve the verified DB backup and existing VAPID material/fingerprint. Use the already established off-host DR destination/key handling, create a fresh encrypted DR backup and require `restoreDrill: PASS`. Never print or commit secrets.
5. Validate PaTaP process targeting on Windows. Register/validate the new PaTaP Scheduled Task using the repository installer; remove legacy Startup autostart only through the reviewed installer. Confirm the task points to the exact repo start script, current user, limited run level, StartWhenAvailable and no duplicate-instance behavior.
6. Start/validate `watch-patap-health.ps1`; confirm one sustained watcher process, `var/run/patap-health-watch.json`, expected HEALTHY state while stack is healthy, and that the watcher observes only and does not compete with the backend supervisor. Do not intentionally break the live public stack just to force ALERT.
7. Only after every gate is PASS, enter maintenance with the reviewed scripts and apply this exact candidate to `D:\WWW.PATAP.EU` without destructive DB operations or loss of runtime/private files. Resume through the reviewed scripts; failed start must fail closed.
8. Post-apply: verify backend/Caddy/tunnel/health-watch, local health, `patap.eu` and `driver.patap.eu`, and focused Driver smoke: auth/session, profile, account export download, map/GPS/privacy, Road Reports persistence, Event Center, Chat, Radio, Parking. Do NOT delete a real production user. Account-deletion behavior is already covered by isolated CI; use a disposable isolated account only if an additional live deletion test is truly needed and safe.
9. If all green, update `codex/local-workspace-snapshot` from the actually deployed source, excluding SQLite, secrets, media, GPS/messages/logs/runtime data. Record the exact production SHA and new snapshot SHA.

Fail closed on any blocker. Do not improvise around preflight, DR, process identity, Scheduled Task, health-watch, or verification failures.

Return a concise machine-readable report with: STATUS, OLD_PRODUCTION_SHA, CANDIDATE_SHA, WINDOWS_NODE, VERIFY_RELEASE, PREFLIGHT, DR_RESTORE_DRILL, AUTOSTART_TASK, HEALTH_WATCH, PROCESS_HEALTH, APPLY, PUBLIC_SMOKE, DRIVER_LIVE_SMOKE, PRODUCTION_SHA, NEW_SNAPSHOT_SHA, BLOCKERS. No secrets.
