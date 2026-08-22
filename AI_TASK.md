# AI_TASK — AUD-028 PLATFORMOS_SCOPE_FREEZE_V1

Status: `VERIFYING` — NOT DEPLOYED.

Production source of truth before this block:
`codex/local-workspace-snapshot @ 30a39f16f35b67a92637117d32f288d2e982804e`.

Working branch:
`chatgpt/aud-028-platformos-scope-freeze-v1`.

Use only the exact final PR head recorded in the PR conversation after GitHub Verify is fully green. Do not deploy an intermediate commit.

## Goal

Close `AUD-028`: prevent PlatformOS `modules/transport` from becoming a second parallel implementation of the active Driver product while preserving PlatformOS as future architecture.

This is an architecture-boundary block, not a Driver feature or runtime migration.

## Implemented contract

- `system/registry.json` continues to declare `activeRuntime = legacy-root-site`;
- Transport remains `status = architecture-only` and `enabled = false`;
- registry/manifest descriptions explicitly state that PlatformOS Transport is not the current Driver runtime;
- `modules/transport/README.md` defines the frozen scope and names `driver/` + `server/` as the active Driver engineering runtime;
- current Map/GPS/Parking/Chat/Radio/People/Event Center/Road Reports/auth/Navigation work must not be duplicated into `modules/transport`;
- future migration is allowed only as `EXPLICIT_PER_DOMAIN_STRANGLER_ONLY`, one separately reviewed domain at a time;
- no broad PlatformOS rewrite/cutover is authorized;
- `docs/PLATFORMOS_SCOPE_FREEZE_V1.md` records the project-wide boundary, allowed architecture work, forbidden duplication and migration exit rules;
- `scripts/test-platformos-runtime.js` now verifies the scope contract and fails if Transport is enabled, stops being architecture-only, or the explicit non-runtime/per-domain migration markers disappear;
- the PlatformOS test remains part of `npm run verify` and therefore `npm run verify:release`.

## Intentionally unchanged

- no Driver product code under `driver/` or `server/` is changed;
- no auth/session/GPS/Map/Parking/Chat/Radio/People/Event/Road Report behavior changes;
- no Navigation source or `NAV_ROUTER_URL` changes;
- no Caddy/tunnel/runtime/service changes;
- no SQLite/schema/data/media/users/secrets/logs changes;
- no `main` changes;
- password minimum remains 6;
- PlatformOS is not deleted;
- no PlatformOS module is activated.

## Mandatory Codex Windows/production gate

Before any apply:

1. Review the exact final PR SHA/diff and confirm base `30a39f16f35b67a92637117d32f288d2e982804e`.
2. Confirm the diff contains only scope documentation/config metadata/test assertions and no Driver runtime/private data.
3. Windows Node 24.x + clean `npm ci`.
4. Run `npm run test:platformos`; require PASS.
5. Run full `npm run verify:release`; require full PASS.
6. Confirm the built Driver product is unchanged in behavior and Transport remains disabled/not launchable.
7. Production preflight must be `READY` even though no DB/runtime migration is expected.
8. Use the normal safe release process and preserve all runtime/private data. No schema migration or destructive action is needed.
9. If applying the docs/config/test-only source update, build/resume normally and require `status-patap-stack.ps1 = HEALTHY`.
10. Public smoke: `https://patap.eu` and `https://driver.patap.eu` must both remain HTTP 200.
11. Do not activate Transport, move routes, migrate data, touch Navigation, change `main`, or change password policy.
12. After successful installation, create a new clean `codex/local-workspace-snapshot` from the actually running source and append `STATUS: DEPLOYED` evidence to `AI_HANDOFF.md`.

If any test shows that PlatformOS Transport is active, launchable as production Driver, or a Driver regression appears, report `CHANGES_REQUIRED` precisely. Do not solve it by weakening the scope assertions.
