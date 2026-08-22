# DRIVER.PATAP.EU — COMMERCIAL HARDENING V1

Base production snapshot: `codex/local-workspace-snapshot @ ef0d4da95f6008cc303eba051764f651594049a4`.

This branch is engineering-only until the Codex Windows gate and explicit guarded deployment step. Production, `main`, Navigation and runtime/private data are not modified by this branch.

## Included audit blocks

### AUD-007 — User data export and account deletion lifecycle
- authenticated JSON export covers account/profile, GPS, relationships, People, Chat contributions, Radio metadata, Road Reports, Parking, Event Center and security history;
- export excludes password hashes, session/CSRF/reset tokens, Push encryption secrets, upload tokens and internal media storage keys;
- deletion requires an authenticated session, CSRF, current password and literal `DELETE` confirmation;
- Principal Owner deletion is blocked;
- deletion is blocked while the user owns Chat groups, Communities or Radio groups, requiring ownership transfer first;
- personal GPS, sessions, contacts, blocks, Push subscriptions, preferences, drafts/reactions/votes and private state are removed;
- Radio audio, Parking photos and user Chat media are removed through a quarantine-first file lifecycle;
- shared Road/Parking contributions are anonymized where deletion would otherwise damage common data;
- shared Chat history is tombstoned rather than cascade-destroyed; historical author rendering uses a hidden technical `Удалённый пользователь <random>` profile with no real name, vehicle, country or GPS;
- account identity is replaced with a disabled random tombstone identity, preventing reuse of the old credentials;
- module-local `account_tombstones` schema preserves global auth schema version 12;
- startup quarantine reconciliation is crash-safe: files still referenced by SQLite after a pre-COMMIT crash are restored, while unreferenced post-COMMIT quarantine files are removed;
- Driver Profile UI contains `Скачать мои данные` and guarded account deletion without adding another navigation view.

### AUD-014 — Dependency security gate
- adds `npm run security:audit` using `npm audit --audit-level=high`;
- `verify:release` must pass the security audit before the rest of the release chain;
- CI executes the same `verify:release` contract.

### AUD-015 — Windows autostart hardening
- replaces Startup-folder copying with a scoped Windows Scheduled Task;
- task points to the exact repository `start-patap-stack.ps1`;
- current interactive user, limited run level, StartWhenAvailable, bounded task restart, IgnoreNew multiple-instance policy;
- installer removes legacy Startup copy; uninstaller removes both task and legacy copy.

### AUD-017 — Continuous health watch
- `watch-patap-health.ps1` polls the existing stack status contract;
- atomic latest JSON state in `var/run/patap-health-watch.json`;
- transition-only bounded logs in `var/logs/patap-health-watch.log`;
- three consecutive unhealthy probes promote state to `ALERT`;
- maintenance flag yields `MAINTENANCE` rather than a false outage;
- watcher observes only and never restarts backend/Caddy/tunnel;
- normal stack startup starts the watcher and reports `HealthWatchRunning`.

## Mandatory engineering evidence

A release candidate is acceptable only when the exact final SHA passes:
- Node 24 runtime gate;
- `npm audit --audit-level=high` with no high-or-greater vulnerability blocker;
- complete auth suite including account export/delete and quarantine recovery;
- live Radio test;
- Driver module tests;
- client tests;
- config/operations contracts;
- deterministic Driver E2E and local browser scenarios;
- Windows Driver E2E;
- Windows PowerShell parse + one-shot health-watch execution;
- public endpoint smoke as an independent availability signal.

## Evidence boundary

GitHub CI can prove package/release wiring, destructive account lifecycle behavior against an isolated database/filesystem, Windows PowerShell parsing/runtime smoke and Windows Driver E2E. It does not alter production.

Codex must still prove on the production-class Windows laptop, before guarded apply:
- actual Scheduled Task registration and logon/reboot behavior;
- exact production Caddy/cloudflared/backend process identity;
- sustained health-watch process and state file;
- `production:preflight` = `READY` while the old backend is still running;
- verified live DB backup and off-host encrypted DR restore drill;
- post-apply local/public health and focused smoke.

Account deletion itself must **not** be exercised against a real production user during deployment verification. Validate the UI/export on production and use an isolated temporary test account only if a live deletion smoke is explicitly required and can be safely cleaned up.
