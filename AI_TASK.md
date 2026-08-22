# AI_TASK — AUD-020 MEDIA_STORAGE_QUOTAS_V1

Status: `DEPLOYED` after exact Windows verification and guarded production installation.

Production source of truth before this block:
`codex/local-workspace-snapshot @ f70ee669d774a6810d3cfb69f55a17daa9c2c45c`.

Working branch: `chatgpt/aud-020-media-storage-quotas-v1`.
The exact final candidate SHA is the head SHA recorded in the AUD-020 draft PR. Do not deploy an older intermediate commit.

## Factual Codex result

- Exact deployed SHA: `ae3a2497181560e768e7f24d8eece657cf360b88`.
- Isolated Windows `verify:release` — PASS: audit 0, auth 55/55 (including media quota tests), Radio 1/1, Driver 74/74, client 2/2, config 37/37, two-user Driver E2E and browser scenarios.
- Windows disk probe — PASS and healthy: Node 24 can read filesystem capacity and free space.
- Production preflight — READY. Fresh encrypted off-host DR export and restore drill — PASS.
- Guarded apply, root build, backend resume, stack health and public smoke — PASS.
- `/api/driver/admin/storage` is closed to anonymous requests (HTTP 401). No real media was deleted or uploaded during deployment verification.
- No new block is active. Do not treat the remaining pre-deployment text in this file as an instruction to deploy again.

## Goal

Close `AUD-020 — MEDIA_STORAGE_QUOTAS_V1`: prevent authenticated Chat/Radio/Parking media uploads from gradually exhausting the Windows production disk, without deleting or rewriting existing user files.

## Engineering contract

Implemented:

- shared `server/storage/quota.js` quota/accounting service;
- rolling 24h per-user upload budget;
- per-user stored/accounted budget;
- per-domain Chat/Radio/Parking budgets;
- global media budget;
- low-free-disk guard using Node 24 filesystem statistics;
- active Chat `PENDING` and Radio `UPLOADING` reservations count before the file is committed;
- Parking checks declared size when present and actual validated bytes immediately before synchronous file/database commit;
- stable 429/507 media quota errors and audit event `media_quota_rejected`;
- Owner/Administrator read-only diagnostics at `GET /api/driver/admin/storage`;
- orphan/missing-file diagnostics are read-only: no automatic deletion;
- regression tests in `tests/auth/media-storage-quota.test.js` and normal auth runner.

Defaults and local override variables are documented in `docs/MEDIA_STORAGE_QUOTAS_V1.md`.

## Intentionally unchanged

- existing single-file limits for Chat, Radio and Parking;
- existing Radio retention rules and PTT authorization/token semantics;
- Chat room/access rules;
- Parking business rules;
- existing user media;
- auth schema 12;
- password policy (minimum remains 6);
- `main`;
- Navigation and `NAV_ROUTER_URL`;
- runtime/private data and secrets.

## Mandatory Codex Windows gate

Review the draft PR and use **only its exact final head SHA**.

Before any production apply:

1. exact isolated checkout on the owner Windows workspace;
2. Node 24.x and `npm ci`;
3. `npm run verify:release` must PASS;
4. `npm run production:preflight` must be `READY`;
5. fresh encrypted off-host DR export + restore drill must PASS;
6. inspect `GET /api/driver/admin/storage` on the isolated/runtime-equivalent setup and confirm filesystem probing is available and plausible on Windows;
7. confirm no existing media is deleted by quota/orphan diagnostics;
8. use the normal recoverable source-backup + maintenance + guarded apply protocol;
9. post-apply stack health and public smoke for `patap.eu` and `driver.patap.eu`.

Fail closed and report `CHANGES_REQUIRED` if Windows filesystem free-space inspection, release verification, preflight, DR or media regression checks do not pass.

Do not deliberately fill production storage and do not delete real user media as a deployment test.

After successful deployment, synchronize `codex/local-workspace-snapshot` from the actually applied source while excluding SQLite/backups, users, GPS, messages, media, tokens, logs, secrets, `data/`, `var/`, `node_modules/` and temporary verification directories.
