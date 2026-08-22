# AI_TASK — AUD-031 EVENT_STREAM_SESSION_GUARD_V1

Status: `VERIFYING` — NOT DEPLOYED.

Authoritative production base:
`codex/local-workspace-snapshot @ 0bf2d26dc97b69ee728ae4e9f3d36da2b574b74d`.

Working branch:
`chatgpt/aud-031-event-stream-session-guard-v1`.

## Why this block exists

The completed 30-point audit remains closed. During the subsequent whole-system residual review, one concrete privacy/session-lifecycle gap was found in Event Center.

`GET /api/driver/events/stream` authenticates when the SSE connection is opened, but the established stream did not revalidate the backing session afterward. Therefore a stream could remain subscribed after that session was revoked, expired or its user was disabled, until the network connection itself ended.

Chat realtime already revalidates live sessions. Radio live is periodically forced to reconnect. Event Center must also fail closed after auth loss.

## Implemented contract

- Event Center SSE keeps the existing authenticated connect requirement and existing event wire format.
- An established Event stream rechecks the exact user/session state periodically against SQLite.
- Production default recheck interval: 15 seconds.
- Test-only override `PATAP_EVENT_STREAM_SESSION_RECHECK_MS` is bounded to 250 ms..60 s; invalid values fall back to 15 s.
- Recheck requires:
  - same user id;
  - same session CSRF token;
  - session not revoked;
  - session not expired;
  - user not disabled.
- Any invalid session or recheck/database error closes the SSE response fail-closed and removes the Event listener.
- Stream cleanup is idempotent and clears heartbeat + session-check timers.
- Existing 20-second SSE heartbeat remains.
- No Event payload, push behavior, inbox semantics, schema or UI changes.

## Verification added

`tests/auth/event-stream-session.test.js` proves:

1. the recheck interval is bounded;
2. a real isolated Driver session can open Event SSE and receive `event.ready`;
3. after that same session is revoked through normal `/api/logout`, the already-open Event SSE closes within the test recheck window.

`scripts/run-auth-tests.js` includes the new test and starts the isolated auth backend with a 250 ms Event-stream recheck only for deterministic tests. Production configuration is unchanged.

## Intentionally unchanged

- password minimum remains 6;
- async scrypt/auth format unchanged;
- session expiry durations unchanged;
- Chat/Radio protocols unchanged;
- Event payloads/push subscriptions/outbox unchanged;
- SQLite schema/data unchanged;
- GPS/Map/Parking/People/Road Reports unchanged;
- Navigation/Valhalla/`NAV_ROUTER_URL` unchanged;
- interface unchanged;
- Caddy/tunnel/service topology unchanged;
- `main` unchanged by this candidate;
- no runtime/private data in GitHub.

## Mandatory Codex Windows/production gate

1. Review exact final PR SHA only and confirm base `0bf2d26dc97b69ee728ae4e9f3d36da2b574b74d`.
2. Confirm the diff is limited to Event SSE session lifecycle, its auth regression test, test runner wiring and documentation; no schema/private data/interface changes.
3. Windows Node 24.x + clean `npm ci`.
4. Run full `npm run verify:release`; require complete PASS.
5. Require the new auth tests to prove established Event SSE closes after normal session revocation.
6. Confirm normal Event SSE still connects for an authenticated Driver and receives `event.ready` / committed events before revocation.
7. Production preflight must be `READY`.
8. Fresh encrypted off-host DR export + restore drill must PASS.
9. Make a recoverable source backup and apply the exact candidate non-destructively, preserving SQLite/users/media/secrets/tokens/logs/runtime data.
10. Root `npm ci` + build; normal backend resume.
11. Require `status-patap-stack.ps1 = HEALTHY`, local `/api/health` healthy and both public domains HTTP 200.
12. Safe authenticated smoke with temporary/test identity only: open Event SSE, logout/revoke that session and prove the established stream closes. Do not revoke or alter a real user's session for this smoke.
13. Confirm Chat realtime, Radio and normal Driver login/session smoke remain healthy.
14. Create a new clean `codex/local-workspace-snapshot` from actually running production and append `STATUS: DEPLOYED` evidence to `AI_HANDOFF.md`.
15. Return the new snapshot SHA. Do not move `main`; ChatGPT will verify the new snapshot and fast-forward `main` afterward.

If Event SSE remains live after session revocation, normal Event delivery regresses, or any mandatory release/DR/health check fails, return `CHANGES_REQUIRED` precisely and do not broaden the fix.
