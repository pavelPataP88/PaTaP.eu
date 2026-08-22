# AI_TASK — AUD-030 ROAD_REPORT_ABUSE_GUARD_V1

Status: `DEPLOYED` — installed and verified by Codex on 2026-08-22.

Production source of truth before this block:
`codex/local-workspace-snapshot @ 7f9df7dabc99d96072c1bf0084d49ad202190864`.

Exact deployed source: `6d0204cde8e274023d9cf77513376299dc062d52`.

Working branch:
`chatgpt/aud-030-road-report-abuse-guard-v1`.

Use only the exact final PR head recorded in the PR conversation after GitHub Verify is fully green. Do not deploy an intermediate commit.

## Goal

Close `AUD-030`: protect Road Reports from repeated false/spam reporting using independent peer evidence, a decaying internal abuse counter and temporary create-only restrictions, without creating a public driver reputation score or location-history diagnostics.

## Implemented contract

- Road Report module schema upgrades additively from v1 to v2; existing reports/votes remain;
- two nullable lifecycle markers are added to existing report rows: historical peer support and whether that report already produced an abuse signal;
- user guard table stores only user id, abuse score, restriction expiry and timestamps — no coordinates or route history;
- public report trust is report-level only: `UNCONFIRMED`, `SUPPORTED`, `CONFIRMED`, `DISPUTED`;
- report author never counts as an independent peer;
- two independent ACTIVE peers mark a report confirmed/historically supported;
- a report that was independently supported can later clear without penalizing its author;
- one abuse point is recorded only for a report closed by two independent GONE peers within 10 minutes, before it ever reached two independent ACTIVE peers;
- each report can contribute at most one point;
- score decays by one each seven days without a new signal;
- score 3-4 -> six-hour creation restriction; score 5+ -> 24-hour restriction; score capped at 10;
- restriction affects only `POST /api/driver/road-reports`; read/confirm/self-close and all other Driver modules remain available;
- restricted creation returns HTTP 429 + stable `road_report_temporarily_restricted` + `Retry-After`;
- `GET /api/driver/admin/road-reports` is read-only Owner/Administrator diagnostics with policy/trust/guard counts and no coordinates/report ids/location history;
- no public people rating is added;
- documentation: `docs/ROAD_REPORT_ABUSE_GUARD_V1.md`.

## Existing boundaries that must remain unchanged

- fixed Road Report types/TTLs and no free text/media;
- create requires profile + enabled fresh GPS and remains within 2 km;
- peer confirm requires fresh nearby GPS and remains within 2 km;
- author can close own report;
- guest Road Report list remains read-only and does not expose author identity;
- seven-day closed/expired report retention;
- auth schema remains 12;
- password minimum remains 6;
- no Navigation / `NAV_ROUTER_URL` changes;
- no `main` changes;
- no SQLite/users/GPS/messages/media/secrets/logs/runtime content committed.

## Mandatory Codex Windows/production gate

Before any production apply:

1. Review exact final PR SHA/diff and confirm base `7f9df7dabc99d96072c1bf0084d49ad202190864`.
2. Confirm no runtime/private data and no public user reputation/location-history feature is present.
3. Windows Node 24.x + clean `npm ci`.
4. Run full `npm run verify:release`; require full PASS including the new Road Report guard tests.
5. Inspect a copy of the current production SQLite through the existing safe preflight/backup workflow and prove the additive Road Report v1 -> v2 migration on an isolated copy; existing report/vote counts must not decrease because of migration.
6. Production preflight must be `READY`.
7. Create fresh encrypted off-host recovery/DR evidence and successful restore drill.
8. Make recoverable source backup and enter normal guarded maintenance only when ready to apply.
9. Apply exact candidate non-destructively, preserving all runtime/private data; `npm ci` + build.
10. Resume backend normally and require `status-patap-stack.ps1 = HEALTHY`.
11. Public smoke: `https://patap.eu` and `https://driver.patap.eu` both HTTP 200.
12. Read-only browser/API smoke after login: current Road Reports still list/create/confirm normally for an unrestricted test user; guest list remains safe.
13. Owner/Administrator read-only `GET /api/driver/admin/road-reports` must return 200 and contain no latitude/longitude/reportId/location history; User must receive 403; non-GET must receive 405.
14. Do not manufacture three abuse strikes against any real production user just to test restriction. Synthetic restriction behavior is already isolated in automated tests.
15. Do not change Navigation, `main`, password policy or unrelated UI.
16. After successful deployment, create a new clean `codex/local-workspace-snapshot` from the actually running source and append `STATUS: DEPLOYED` evidence to `AI_HANDOFF.md`.

If migration, trust counting, restriction, GPS/create/confirm compatibility, admin privacy, release, DR or production smoke fails: report `CHANGES_REQUIRED` with exact file/location/reproduction/expected behavior. Do not weaken the independent-peer threshold or store location history as a shortcut.
