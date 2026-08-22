# AUD-019 — MACHINE_DISASTER_RECOVERY_V1

Base production mirror for this engineering block:
`codex/local-workspace-snapshot @ faf56337ad060dec22649d81ce069218cff672f5`.

Status of this document: engineering candidate until Codex completes the Windows acceptance gate and installs the block.

## Goal

Recover PaTaP.eu on a replacement Windows machine after loss of the primary laptop without relying on private/runtime material in GitHub.

The recovery model deliberately separates two sources:

1. **Code and public configuration** — latest verified `codex/local-workspace-snapshot` in GitHub.
2. **Private/runtime continuity** — encrypted off-host machine recovery set created by this block.

A database-only backup is not enough for a total laptop loss. The machine set also preserves private media and identities that GitHub must never contain.

## What the encrypted machine set contains

- an integrity-checked SQLite backup restored as `data/auth/patap-auth.sqlite`;
- all regular files below repository `data/`, excluding the live SQLite/WAL/SHM files and redundant local `data/auth/backups/` copies;
- therefore current private data such as Chat/Radio/Parking media, `data/config/auth-secret.key`, Event Center VAPID material and other module-local private files are carried when present;
- the Cloudflare tunnel token from `%LOCALAPPDATA%\PatapLab\cloudflared\patap-lab-token.txt`.

The public `manifest.json` contains only recovery metadata, counts, byte totals and cryptographic package hashes. The private logical-path index is itself encrypted. Object filenames are opaque numeric IDs.

The recovery encryption key/passphrase is **never** copied into the recovery set. Keep it on a separate device/password manager from the backup drive.

## What is intentionally not backed up

- source code, because the safe GitHub snapshot is the code source of truth;
- `node_modules`, builds, logs, health-watch state and other reproducible `var/` runtime files;
- redundant historical local SQLite backups under `data/auth/backups/`;
- Windows-installed Node, Caddy, cloudflared or Git binaries;
- the recovery encryption key itself.

## Consistency and safety

Whole-machine export is stricter than the existing live SQLite DR export:

- `backup-machine-recovery.ps1` requires an off-host destination and a DR key/passphrase;
- it enters the existing backend maintenance mode if maintenance is not already active;
- the Node exporter refuses a normal production export unless the maintenance marker exists and the backend health endpoint is offline;
- Caddy/tunnel may remain running, but authenticated/API traffic is unavailable during the short snapshot window;
- if this wrapper entered maintenance, it resumes the backend in `finally`, including after an export failure;
- source media are read only; no user data are deleted, rewritten or pruned;
- the destination must be a different device/network share unless the explicit test-only same-device override is used.

Every completed export automatically performs a cryptographic restore drill of every encrypted object and runs SQLite integrity/foreign-key checks. A set is complete only when `manifest.json` says `restoreDrill: PASS`.

## Recovery package format

A successful export creates one directory such as:

```text
F:\PaTaP-DR\patap-machine-2026-08-22T...
  manifest.json
  index.patapdr
  objects\
    00000001.patapdr
    00000002.patapdr
    ...
```

Each `.patapdr` file uses the existing authenticated `PATAP-DR1` AES-256-GCM envelope with an independent salt/IV and SHA-256 verification.

## Creating a full recovery set on the production laptop

Example only; use the actual off-host drive/path approved on the laptop:

```powershell
cd D:\WWW.PATAP.EU
$env:PATAP_MACHINE_DR_EXPORT_DIR = "F:\PaTaP-DR"
$env:PATAP_DR_KEY_FILE = "<path-on-a-separate-medium>"
# Optional but useful when the exact deployed safe snapshot SHA is known:
$env:PATAP_RECOVERY_SOURCE_SHA = "<40-hex-safe-snapshot-sha>"
.\backup-machine-recovery.ps1
```

A passphrase of at least 16 characters may be used through `PATAP_DR_PASSPHRASE` instead of a key file, but it must not be stored beside the backup.

After the command, retain the printed recovery-set directory and confirm its `manifest.json` reports `PATAP-MACHINE-DR1` and `restoreDrill: PASS`.

### Pilot recovery target

For the user-pilot phase, create a whole-machine set after every deployed release and after meaningful private-media growth. The practical RPO is the age of the newest successful machine set. A later incremental/automated retention system is a separate block; this V1 does not silently delete older recovery sets.

The existing database-only encrypted DR command remains useful between whole-machine snapshots because it is smaller and online-safe.

## Verifying an existing set without restoring it

On a machine with the repository source and the separate recovery key:

```powershell
$env:PATAP_DR_KEY_FILE = "<separate-key-path>"
npm run recovery:verify:machine -- "F:\PaTaP-DR\patap-machine-..."
```

Expected result includes:

- `format: PATAP-MACHINE-DR1`;
- `restoreDrill: PASS`;
- SQLite `integrity: ok`;
- zero foreign-key violations;
- matching object count and byte total.

A missing/tampered object or wrong key must fail verification.

## Replacement-machine procedure after primary laptop loss

Do not activate public traffic until the old production laptop is confirmed offline or intentionally retired. Two uncertain origins using the same tunnel identity can create ambiguous traffic.

### 1. Prepare Windows

Install the operational prerequisites used by the current project:

- Node.js 24.x LTS;
- Git;
- Caddy;
- cloudflared.

Use the same Windows account that will own the PaTaP Scheduled Task and local `%LOCALAPPDATA%` tunnel token.

### 2. Restore the safe source

Clone `pavelPataP88/PaTaP.eu` into the production directory and check out the current safe `codex/local-workspace-snapshot` (or the exact safe SHA recorded in the recovery manifest/AI handoff when present).

The target is normally:

```text
D:\WWW.PATAP.EU
```

Do not restore from `main` unless the owner has separately changed the source-of-truth policy.

### 3. Verify the encrypted set before writing private state

```powershell
cd D:\WWW.PATAP.EU
npm ci
npm run runtime:check
$env:PATAP_DR_KEY_FILE = "<separate-key-path>"
npm run recovery:verify:machine -- "F:\PaTaP-DR\patap-machine-..."
```

### 4. Restore private state

The restore command is intentionally fail-closed:

- requires literal `PATAP_MACHINE_RECOVERY_CONFIRM=RESTORE`;
- requires an explicit checked-out target root;
- verifies the entire set first;
- refuses to overwrite any target private file or existing tunnel token;
- writes to temporary sibling files and renames only after authenticated decryption/hash verification;
- rolls back files it created if the restore fails part-way;
- does **not** start the public stack automatically.

Example:

```powershell
$env:PATAP_MACHINE_DR_SET_DIR = "F:\PaTaP-DR\patap-machine-..."
$env:PATAP_RECOVERY_TARGET_ROOT = "D:\WWW.PATAP.EU"
$env:PATAP_DR_KEY_FILE = "<separate-key-path>"
$env:PATAP_MACHINE_RECOVERY_CONFIRM = "RESTORE"
npm run recovery:restore:machine -- $env:PATAP_MACHINE_DR_SET_DIR
Remove-Item Env:PATAP_MACHINE_RECOVERY_CONFIRM
```

On Windows the Cloudflare token is restored to the standard `%LOCALAPPDATA%\PatapLab\cloudflared\patap-lab-token.txt` path unless `PATAP_RECOVERY_TUNNEL_TOKEN_TARGET` is explicitly supplied for an isolated drill.

### 5. Validate before public activation

```powershell
npm ci
npm run verify:release
npm run production:preflight
```

Inspect the restored SQLite and media diagnostics without deleting data. Confirm Caddy/cloudflared resolution and the restored tunnel token file exists without printing its contents.

### 6. Install operational startup

Current autostart is the scoped Windows Scheduled Task, not the obsolete Startup-folder mechanism:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

### 7. Explicitly activate the recovered production machine

Only after the old origin is confirmed offline:

```powershell
.\start-patap-stack.cmd
.\status-patap-stack.cmd
npm run test:public-smoke
```

Acceptance target:

- `status-patap-stack` reports `HEALTHY`;
- backend, Caddy, exact PaTaP tunnel and health-watch are present;
- `https://patap.eu` returns HTTP 200;
- `https://driver.patap.eu` returns HTTP 200;
- authentication and private-media access are then checked with safe temporary/user-approved smoke scenarios.

## Windows acceptance gate for AUD-019

Before deployment of this block, Codex must use the exact candidate SHA and prove on the real Windows laptop:

1. static diff review: no private/runtime files in GitHub;
2. Node 24 `npm ci` and `npm run verify:release` PASS;
3. PowerShell parse/contract checks PASS;
4. create one whole-machine set on the existing off-host recovery drive with the real DR key available only locally;
5. export must enter/leave maintenance safely and production backend must recover HEALTHY;
6. manifest must report `restoreDrill: PASS` and SQLite integrity PASS;
7. perform an **isolated replacement-machine drill** into a temporary clean checkout/target, including a temporary tunnel-token destination so the live token path is not overwritten;
8. verify restored database, auth secret, VAPID/private data and sample media hashes/availability where present without exposing content in logs;
9. prove a second restore refuses overwrite;
10. production stack/public sites remain HEALTHY/HTTP 200 after the backup exercise;
11. create the next safe GitHub snapshot from the actually deployed source.

Do not deliberately destroy the production laptop, move the real production tunnel token, delete real media, or activate a second public origin as a test.

## Recovery boundary

This block makes the platform recoverable from a total laptop loss **provided a recent successful off-host machine set and its separate decryption key both survive**. It is not high-availability clustering and does not provide zero-downtime automatic failover. Those are different infrastructure decisions.
