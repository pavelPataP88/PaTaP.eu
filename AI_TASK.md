# AI_TASK — AUD-029 SERVER_BOUNDARY_CLEANUP_V1

Status: `DEPLOYED` — verified and installed from `918afc8bd56ea730dc0972ffbddd6c31580be344`.

Production source of truth before this block:
`codex/local-workspace-snapshot @ a94c9cf6c624e637211f045601b0b4dd12becb8a`.

Working branch:
`chatgpt/aud-029-server-boundary-cleanup-v1`.

Use only the exact final PR head recorded in the PR conversation after GitHub Verify is fully green. Do not deploy an intermediate commit.

## Goal

Close `AUD-029`: reduce server boundary coupling with explicit Driver domain bootstrap/lifecycle and a separate Chat realtime boundary, without a framework rewrite, process split or product behavior change.

## Implemented contract

- `server/driver/runtime.js` owns Driver domain construction and deterministic initialization order;
- Parking and People additive domains initialize before Event Center projection triggers;
- Event dispatcher lifecycle is explicit and idempotent through Driver runtime `start()` / `stop()`;
- `server/driver/routes.js` remains a stable compatibility facade and real HTTP implementation moves to `server/driver/http-routes.js`;
- the returned Driver route handler exposes runtime `start`, `stop` and read-only runtime state hooks;
- `server/chat/realtime.js` owns Chat WebSocket upgrade/origin/session/room/typing/fan-out behavior and explicit start/stop lifecycle;
- auth HTTP composition no longer contains WebSocketServer business logic;
- `server/auth/server.js` remains a stable thin process entrypoint and delegates to `server/auth/http-server.js`;
- HTTP server close stops Driver dispatcher, Chat realtime and the security cleanup timer;
- targeted contract: `tests/driver/server-boundary-cleanup.test.mjs`;
- documentation: `docs/SERVER_BOUNDARY_CLEANUP_V1.md`.

## Existing behavior that must remain unchanged

- auth/session/cookie/CSRF/rate-limit/admin behavior;
- password minimum remains 6;
- Driver registration/profile/GPS/contacts/Road Reports;
- Parking, People, Event Center, account export/delete;
- Chat HTTP API and `/api/driver/chat/socket` wire behavior;
- Radio HTTP/live behavior;
- SQLite schemas/data and additive domain migration semantics;
- Caddy/tunnel/runtime services;
- Navigation / `NAV_ROUTER_URL`;
- `main`;
- all runtime/private data.

## Mandatory Codex Windows/production gate

Before any apply:

1. Review exact final PR SHA/diff and confirm base `a94c9cf6c624e637211f045601b0b4dd12becb8a`.
2. Confirm this is structural extraction only: no API/wire/schema/product-policy change and no runtime/private data.
3. Windows Node 24.x + clean `npm ci`.
4. Run full `npm run verify:release`; require complete PASS including `server-boundary-cleanup.test.mjs`, auth, Radio, all Driver tests, two-user E2E and browser scenarios.
5. Specifically verify Chat WebSocket subscribe/typing/realtime delivery through the existing automated/live tests; do not accept HTTP-only proof.
6. Verify process shutdown/restart does not leave a second backend, leaked listener or duplicate Event dispatcher.
7. Production preflight must be `READY`.
8. Fresh encrypted off-host DR export + restore drill must PASS.
9. Make recoverable source backup; apply exact candidate non-destructively preserving SQLite/users/media/secrets/tokens/logs/runtime data.
10. Root `npm ci` + build; normal backend resume.
11. Require `status-patap-stack.ps1 = HEALTHY` and both public domains HTTP 200.
12. Verify `/api/health`, normal login/session and a safe authenticated Chat/Driver smoke without manufacturing user content that should not exist.
13. Do not touch Navigation, `main`, password policy or interface.
14. After successful installation, create a new clean `codex/local-workspace-snapshot` from actually running source and append `STATUS: DEPLOYED` evidence to `AI_HANDOFF.md`.

If Chat realtime, Driver/Event lifecycle, auth, E2E, restart, DR or production smoke fails: return `CHANGES_REQUIRED` with exact file/location/reproduction/expected behavior. Do not solve it with a broad framework rewrite or process split.
