# PLATFORMOS_SCOPE_FREEZE_V1

Status: `ARCHITECTURE_SCOPE_FREEZE`.

Audit block: `AUD-028 PLATFORMOS_SCOPE_FREEZE_V1`.

## Purpose

Prevent two parallel implementations of the same Driver product from being developed at the same time.

PlatformOS remains in the repository. This block does not delete it, migrate Driver into it, or activate any architecture-only module.

## Current source-of-truth boundary

`system/registry.json` defines:

- `activeRuntime = legacy-root-site`;
- `modules/transport.status = architecture-only`;
- `modules/transport.enabled = false`.

For active Driver engineering, the runtime source remains the real Driver codebase, primarily:

- `driver/` for the Driver client/product modules;
- `server/` for backend/domain/auth composition.

`modules/transport` is not an alternate implementation of the active Driver runtime.

## Freeze contract

Until a separately approved migration block exists, all contributors and AI agents must follow these rules:

1. Do not duplicate active Driver fixes or features into `modules/transport`.
2. Do not activate the Transport module in `system/registry.json`.
3. Do not route production Driver traffic through PlatformOS Transport.
4. Do not create a second auth/session/GPS/Map/Parking/Chat/Radio/People/Event/Road-Report/Navigation runtime under PlatformOS.
5. Do not move SQLite schema ownership or runtime/private data into PlatformOS as part of ordinary Driver work.
6. PlatformOS architecture documents may evolve, but architecture-only work must remain non-runtime and must not claim deployment.
7. Current Driver fixes continue in `driver/` and `server/` until an explicit migration says otherwise.

## Allowed PlatformOS work while frozen

Allowed:

- architecture diagrams and boundary descriptions;
- interface sketches that do not become production routes;
- migration research;
- compatibility contracts for one future domain;
- tests that ensure architecture-only modules remain disabled.

Not allowed:

- feature parity work that copies active Driver behavior into `modules/transport`;
- broad rewrite of Driver into PlatformOS;
- enabling Transport just to experiment on production;
- creating parallel state or schema for the same active Driver domain.

## Future migration model

Migration mode: `EXPLICIT_PER_DOMAIN_STRANGLER_ONLY`.

A future migration must be one small domain at a time. Each domain migration requires:

1. fresh `codex/local-workspace-snapshot` base;
2. explicit source and destination boundary;
3. compatibility strategy for existing API/data/users;
4. isolated migration and regression tests;
5. no duplicate write ownership after cutover;
6. rollback path;
7. Codex Windows verification and normal production gate;
8. new safe snapshot only after deployment is healthy.

The old runtime path remains authoritative until that domain's cutover is explicitly deployed and verified. Merely creating files under `modules/transport` never transfers ownership.

## Navigation exception

Navigation must not be used as the first migration shortcut. Its existing provider gate remains independent: no Navigation deployment until a reviewed real truck-capable router is configured and the fresh Navigation candidate passes real-provider verification.

## Verification contract

`scripts/test-platformos-runtime.js` must fail if the repository loses the frozen scope invariants, including:

- active runtime no longer being `legacy-root-site` without an intentional migration;
- Transport no longer being `architecture-only`;
- Transport becoming enabled;
- Transport README/manifest losing the explicit non-runtime/per-domain migration contract.

This test is already part of `npm run verify` and therefore `npm run verify:release`.

## Exit criteria for AUD-028

AUD-028 is complete when:

- the scope boundary is explicit in project documentation;
- the Transport README cannot reasonably be mistaken for the active Driver implementation;
- registry/manifest keep Transport disabled and architecture-only;
- automated PlatformOS verification enforces those invariants;
- no Driver runtime behavior or production data is changed by this block.
