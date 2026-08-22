# SERVER_BOUNDARY_CLEANUP_V1

Audit block: `AUD-029 SERVER_BOUNDARY_CLEANUP_V1`.

Status: `CANDIDATE`.

## Goal

Reduce server composition coupling without changing product behavior or introducing a framework rewrite.

The block is intentionally structural. HTTP paths, auth/session rules, SQLite schemas, Driver APIs, Chat WebSocket protocol, Radio behavior and client UI remain compatible.

## Boundaries introduced

### Driver runtime

`server/driver/runtime.js` is the explicit composition/lifecycle boundary for Driver domain services that were previously created inside the HTTP route factory.

Bootstrap order is deterministic:

1. Driver profile/location/directory/Road Report repositories;
2. Parking routes and their additive domain schema;
3. People routes and their additive domain schema;
4. Account routes;
5. Event Center runtime and projection triggers.

Parking and People must be initialized before Event Center because their additive structures include dependencies used by Event Center projection triggers.

The runtime owns Event dispatcher lifecycle through idempotent `start()` / `stop()` methods.

`server/driver/routes.js` remains a compatibility facade. The HTTP implementation lives in `server/driver/http-routes.js` and exposes its runtime lifecycle as `handleDriverRoute.start/stop`.

### Chat realtime

`server/chat/realtime.js` owns the Chat WebSocket boundary:

- `/api/driver/chat/socket` upgrade routing;
- allowed-origin enforcement;
- authenticated live-session revalidation;
- room subscription/access checks;
- typing notifications;
- committed event fan-out;
- WebSocket start/stop lifecycle.

`server/auth/http-server.js` composes HTTP auth/Driver/Chat/Radio routes and starts the realtime boundary. It no longer contains WebSocketServer implementation details.

`server/auth/server.js` is a stable thin process entrypoint so existing launch scripts do not change.

## Shutdown lifecycle

When the HTTP server closes:

- Driver runtime stops Event dispatcher;
- Chat realtime detaches the upgrade listener and closes active sockets;
- security cleanup timer is cleared.

This is explicit application lifecycle ownership; it does not introduce another process or service.

## Intentionally unchanged

- no framework migration;
- no process split or microservices;
- no SQLite schema/data migration;
- no auth/password/session policy change;
- no Driver/Chat/Radio API or wire-format change;
- no GPS/Map/Parking/People/Event/Road Report behavior change;
- no Navigation change;
- no `main` change;
- no runtime/private data in GitHub.

## Verification

Targeted contract test: `tests/driver/server-boundary-cleanup.test.mjs`.

It proves that:

- Driver route construction delegates domain bootstrap/lifecycle to the explicit runtime;
- Event dispatcher start/stop is owned by that runtime;
- auth entrypoint no longer contains Chat WebSocket business logic;
- Chat realtime owns the WebSocket protocol boundary;
- realtime start/stop attaches and detaches the HTTP upgrade listener idempotently.

Full `npm run verify:release` must remain green, including auth, Driver, Radio, two-user E2E and browser scenarios.
