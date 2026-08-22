# Transport Module

Status: `architecture-only`.

Scope contract: `PLATFORMOS_TRANSPORT_ARCHITECTURE_ONLY`.

## This is not the Driver runtime

`modules/transport` is a future PlatformOS architecture model. It is **not** the runtime implementation of Driver Patap and it must remain disabled while Driver is being stabilized.

The current Driver product is implemented in the real runtime, primarily under:

- `driver/` — Driver client/product modules;
- `server/` — Driver/auth/domain backend runtime.

Current Driver fixes and features must be made in that real runtime. Do **not** copy or reimplement current Map, GPS, Parking, Chat, Radio, People, Event Center, Road Reports, auth or Navigation changes inside `modules/transport`.

## Freeze rule

Until an explicit migration block is approved:

- registry status remains `architecture-only`;
- registry `enabled` remains `false`;
- no production route is switched to this module;
- no Driver database/schema ownership is moved here;
- no parallel transport API, auth, map, chat, radio or navigation implementation is created here;
- architecture documents may describe future boundaries, but they must not become a second runtime source of truth.

## Future migration rule

Migration mode: `EXPLICIT_PER_DOMAIN_STRANGLER_ONLY`.

A future migration must move **one domain at a time** from the current Driver runtime behind a separately reviewed compatibility boundary. Each domain migration needs its own candidate branch, regression tests, production gate and rollback path. A broad PlatformOS rewrite or duplicate Driver implementation is explicitly out of scope.

Examples of valid future domain-sized migrations might be one of:

- Parking;
- Chat;
- Radio;
- People;
- Road Reports;
- Navigation, only after its provider gate is solved.

A migrated domain is not considered switched until the old runtime path is deliberately retired in a separately approved deployment.

## Architectural inventory only

Future internal areas may include:

- `truck/`
- `taxi/`
- `cargo/`
- `parking/`
- `maps/`
- `radio/`
- `chat/`
- `drivers/`

Future routes may include:

- `/transport`
- `/truck`
- `/taxi`

These names are architecture placeholders, not active Driver routes or permission boundaries.

See `docs/PLATFORMOS_SCOPE_FREEZE_V1.md` for the project-wide contract.
