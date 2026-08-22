# AUD-020 — MEDIA_STORAGE_QUOTAS_V1

Base production mirror: `codex/local-workspace-snapshot @ f70ee669d774a6810d3cfb69f55a17daa9c2c45c`.

Status of this document: engineering candidate only. Nothing here authorizes production deployment.

## Goal

Prevent authenticated uploads from gradually exhausting the production disk while preserving all existing user media and current per-file limits.

This block is deliberately fail-closed for **new uploads only**. It does not delete, truncate, migrate, or rewrite existing Chat, Radio or Parking files.

## Protected domains

- Chat attachments: existing per-kind limits remain unchanged (image 12 MiB, video/file 25 MiB, audio 8 MiB).
- Radio history: existing 3 MiB per committed transmission limit remains unchanged.
- Parking photos: existing 5 MiB per photo limit remains unchanged.

## Default pilot budgets

All values can be overridden through local runtime environment variables; secrets are not involved.

| Budget | Default |
| --- | ---: |
| per-user uploads during rolling 24h | 256 MiB |
| per-user accounted storage | 1 GiB |
| Chat accounted storage | 4 GiB |
| Radio accounted storage | 2 GiB |
| Parking accounted storage | 2 GiB |
| global accounted media storage | 8 GiB |
| low-disk reserve | max(2 GiB, 5% filesystem) |
| active Radio upload reservation | 3 MiB |

Environment overrides:

- `PATAP_MEDIA_USER_DAILY_BYTES`
- `PATAP_MEDIA_USER_STORED_BYTES`
- `PATAP_MEDIA_CHAT_STORED_BYTES`
- `PATAP_MEDIA_RADIO_STORED_BYTES`
- `PATAP_MEDIA_PARKING_STORED_BYTES`
- `PATAP_MEDIA_GLOBAL_STORED_BYTES`
- `PATAP_MEDIA_MIN_FREE_BYTES`
- `PATAP_MEDIA_MIN_FREE_RATIO`
- `PATAP_MEDIA_RADIO_RESERVATION_BYTES`

Invalid override values fall back to the reviewed defaults.

## Reservation model

The quota checks count storage that is already committed plus uploads that have been authorized but have not finished yet:

- Chat `READY`/`ATTACHED` rows count as stored; non-expired `PENDING` rows reserve their declared byte length.
- Radio `COMMITTED` rows count their stored byte length; each non-expired `UPLOADING` transmission reserves the 3 MiB maximum before the next PTT grant.
- Parking has no separate prepare phase. The request is checked before reading when a valid `Content-Length` is present and checked again against the actual validated bytes immediately before the synchronous file/database commit.

Expired Chat/Radio reservations do not consume future quota.

## Rejections

The API returns stable domain errors for new media when a budget is exhausted:

- `429 media_daily_quota_exceeded`
- `507 media_user_storage_quota_exceeded`
- `507 media_domain_storage_quota_exceeded`
- `507 media_global_storage_quota_exceeded`
- `507 media_low_disk`
- `507 media_storage_unavailable` when free-space inspection cannot be trusted

Quota rejections are written to the existing security/audit stream as `media_quota_rejected` without storing media content.

## Admin diagnostics

`GET /api/driver/admin/storage`

Access: authenticated `Owner` or `Administrator` only.

The response reports:

- configured limits;
- current accounted/actual/reserved bytes by domain;
- disk free-space state;
- top storage users;
- read-only orphan diagnostics for Chat, Radio and Parking;
- missing referenced files.

The scanner does **not** remove orphaned files. `destructiveCleanupEnabled` is explicitly `false` in this block.

## Safety boundaries

- no automatic cleanup of existing user media;
- no retention-policy change;
- no database schema change;
- no Navigation change;
- no `main` change;
- no production SQLite, media, logs, secrets or runtime data in GitHub;
- quota defaults can be tuned later from observed pilot usage without changing business data.

## Required acceptance

Before deployment the exact candidate SHA must pass the repository release gate, including auth, Radio, Driver, client, config, two-user E2E, browser and Windows jobs.

Codex must then verify on the production-class Windows workspace:

1. `npm ci` and `npm run verify:release`;
2. `npm run production:preflight` = `READY`;
3. fresh encrypted off-host DR export + restore drill;
4. production filesystem supports the Node 24 free-space probe and the storage endpoint reports a plausible healthy disk state;
5. guarded apply with source backup/maintenance protocol;
6. post-apply stack health and public smoke.

No real user media should be deleted or deliberately pushed to quota during deployment verification.
