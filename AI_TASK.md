# AI_TASK — AUD-019 MACHINE_DISASTER_RECOVERY_V1

Status: `DEPLOYED` after exact Windows verification and a full isolated recovery drill.

Production source of truth before this block:
`codex/local-workspace-snapshot @ faf56337ad060dec22649d81ce069218cff672f5`.

Working branch:
`chatgpt/aud-019-machine-disaster-recovery-v1`.

Use only the exact final head SHA recorded in the AUD-019 draft PR. Do not deploy an older intermediate commit.

## Factual Codex result

- Exact deployed SHA: `e01dd3c4ea9f29b9d54f138a8564c16330201243`.
- Syntax/PowerShell parsing and isolated Windows `verify:release` — PASS: audit 0, auth 57/57 including machine recovery tests, Radio 1/1, Driver 74/74, client 2/2, config 40/40, two-user Driver E2E and browser scenarios.
- Production preflight — READY. Normal encrypted DB DR export and restore drill — PASS.
- One real off-host full recovery set was exported to F:; its encrypted full-object verification and SQLite integrity/foreign-key checks — PASS.
- The set was restored into a clean isolated source checkout with a temporary tunnel-token path. 29/29 private files and the temporary token matched by hash; SQLite was restored; a second restore correctly refused overwrite.
- The temporary recovery target and temporary token were removed after the drill. The live token, media and production data were not moved or deleted.
- Guarded source apply, root build, backend resume, stack health and public smoke — PASS.
- No new coding block is active. Do not run recovery again unless a new verified recovery set or a recovery test is explicitly needed.

## Goal

Close `AUD-019`: make the platform recoverable after total loss of the primary Windows laptop, not only after SQLite corruption.

## Engineering contract

Implemented:

- keeps source code in the safe GitHub snapshot and private/runtime continuity in a separate encrypted off-host recovery set;
- reuses the existing authenticated `PATAP-DR1` encryption envelope rather than creating a second crypto system;
- exports an integrity-checked SQLite backup;
- exports regular private files below `data/` while excluding live SQLite/WAL/SHM and redundant local DB backup copies;
- therefore carries current Chat/Radio/Parking media, auth secret, VAPID/private Event material and other module-local private files when present;
- exports the exact Cloudflare tunnel token from the current Windows `%LOCALAPPDATA%` location;
- encrypts the logical-path index so the public manifest does not expose private file paths;
- requires backend maintenance and an offline backend for normal production export;
- automatically performs a complete encrypted-object restore drill and SQLite integrity/foreign-key verification before declaring a recovery set PASS;
- restore requires literal `PATAP_MACHINE_RECOVERY_CONFIRM=RESTORE` and an explicit checked-out target root;
- restore refuses to overwrite any existing private target file or tunnel token;
- restore never starts Caddy, backend, tunnel or public traffic automatically;
- Windows backup wrapper enters maintenance only when necessary and resumes only maintenance it entered;
- adds executable export/verify/restore commands, regression tests and `docs/MACHINE_DISASTER_RECOVERY_V1.md`.

## Intentionally unchanged

- existing database-only encrypted DR flow remains available;
- no automatic deletion/rotation of old recovery sets;
- no high-availability clustering or automatic failover;
- no user data or recovery keys are committed to GitHub;
- no password-policy change; minimum remains 6;
- auth schema remains 12;
- `main` unchanged;
- Navigation and `NAV_ROUTER_URL` unchanged and still blocked by the provider gate;
- existing Chat/Radio/Parking behavior unchanged.

## Mandatory Codex Windows gate

Review the exact candidate diff and `docs/MACHINE_DISASTER_RECOVERY_V1.md`.

Before any production apply:

1. exact isolated checkout from base `faf56337ad060dec22649d81ce069218cff672f5`;
2. Node 24.x, `npm ci`, syntax/static review and `npm run verify:release` PASS;
3. production preflight remains `READY`;
4. confirm no `data/`, `var/`, SQLite, media, users, GPS, messages, tokens, keys, logs or temporary recovery content is present in GitHub diff;
5. on the real laptop, use the existing off-host recovery drive and locally held DR key to execute one real `backup-machine-recovery.ps1` export;
6. prove the wrapper safely enters/leaves backend maintenance and stack returns HEALTHY;
7. exported `manifest.json` must report `PATAP-MACHINE-DR1`, `restoreDrill: PASS`, SQLite integrity `ok`, zero foreign-key violations and plausible object/byte counts;
8. perform an isolated replacement-machine drill into a clean temporary checkout/target, with `PATAP_RECOVERY_TUNNEL_TOKEN_TARGET` redirected to a temporary path so the live token is never overwritten;
9. verify restored SQLite/private continuity and representative media by hashes/metadata only; do not print secrets or user content;
10. prove a second restore refuses overwrite;
11. after guarded production source apply, run build/resume/status/public smoke; `patap.eu` and `driver.patap.eu` must remain HTTP 200;
12. synchronize the next safe `codex/local-workspace-snapshot` from actually deployed source, excluding every private/runtime path.

Report `CHANGES_REQUIRED` rather than rewriting the block if any safety, Windows-path, filesystem, encryption, restore or operational issue is found. Include file/location/reproduction/expected behavior.

Do not destroy the real laptop, activate a second public origin, move/delete the live tunnel token, delete media, or expose recovery-key material as a test.
