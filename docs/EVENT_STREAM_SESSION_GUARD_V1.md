# AUD-031 — Event Stream Session Guard V1

## Scope

This block fixes one post-audit residual security/privacy defect in the active Driver runtime: Event Center Server-Sent Events (`/api/driver/events/stream`) previously authenticated only when the connection was established.

The 30-point audit remains historically closed. AUD-031 is a new residual hardening item discovered during the subsequent whole-system production review.

## Confirmed defect

Before this block:

1. a Driver opened `/api/driver/events/stream` with a valid session;
2. Event Center stored the response as a live listener;
3. later logout, password/session revocation, account disable or natural session expiry changed auth state in SQLite;
4. the already-open SSE response did not query auth state again;
5. until the TCP/HTTP connection ended, Event Center could still publish in-app event data to that response.

This is inconsistent with the rest of the realtime surface:

- Chat WebSocket calls its live-session check while processing/publishing realtime traffic;
- Radio live SSE intentionally ends and requires periodic authenticated reconnect;
- Event Center had no equivalent post-connect auth boundary.

## Security contract

An established Event Center SSE connection is valid only while the session that opened it remains valid.

The periodic check requires all of the following in the current SQLite state:

- same `user_id`;
- same session `csrf_token` captured from the authenticated session;
- `revoked_at IS NULL`;
- `expires_at > now`;
- `users.disabled = 0`.

If any condition fails, or if the recheck itself cannot be completed, the stream fails closed: listener/timers are removed and the response is ended.

## Timing

Production default session recheck: **15 seconds**.

`PATAP_EVENT_STREAM_SESSION_RECHECK_MS` exists only as an operational/test tuning point and is hard-bounded:

- minimum 250 ms;
- maximum 60 seconds;
- invalid input -> 15-second default.

The existing Event SSE heartbeat remains 20 seconds. Event payload format, retry value and normal subscription behavior are unchanged.

## Test contract

A new isolated auth integration test opens a real Event SSE stream with a temporary Driver, waits for `event.ready`, then revokes that exact session through normal `/api/logout` and requires the existing stream to terminate.

The auth test harness sets the recheck to 250 ms for deterministic CI speed. This does not change production defaults.

The same test file also locks the recheck clamp behavior.

## Not changed

- no database/schema migration;
- no session duration change;
- no password policy/hash-format change;
- no Event payload, inbox, push, outbox or routing behavior change;
- no Chat or Radio wire-protocol change;
- no Driver UI change;
- no GPS/Map/Parking/People/Road Reports change;
- no Navigation/Valhalla change;
- no Caddy/Cloudflare topology change;
- no private/runtime data.

## Release acceptance

The candidate is acceptable only if the full release gate remains green and Windows/production verification proves both sides of the contract:

1. authenticated Event SSE still works normally;
2. revoking the session closes the already-established Event SSE;
3. the rest of Driver remains healthy;
4. preflight, fresh encrypted DR restore drill, guarded apply and public health all pass.

Do not weaken the session check or convert this into a general Event Center rewrite.
