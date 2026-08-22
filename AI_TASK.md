# AI_TASK — AUD-025/AUD-026 NAVIGATION_SCOPE_V1

Status: `DEPLOYED` — documentation/product-scope decision applied from `ddeda3b6789ed3ef599f0a638c37b80d13ce1bfb`.

Authoritative production base:
`codex/local-workspace-snapshot @ edeacb22ec6fbf8765ee816f053de54aa0fbc3ec`.

Working branch:
`chatgpt/aud-025-026-navigation-scope-v1`.

## Owner decision

For Driver V1, PaTaP will **not** build, self-host or deploy its own route-calculation/navigation engine.

The existing historical Navigation Engine work remains preserved for possible future use, but it is intentionally deferred. It must not be rebased, merged, deployed or used as a release blocker unless the owner explicitly reopens that product direction later.

Therefore:

- `AUD-025 NAV_PROVIDER_LOCAL_V1` is superseded for V1 by this owner product decision;
- `AUD-026 NAVIGATION_REBASE_V1` is superseded for V1 by this owner product decision;
- `NAV_ROUTER_URL` is not required for Driver V1;
- do not install or operate Valhalla for Driver V1;
- do not substitute passenger-car routing for truck routing;
- do not delete the historical Navigation branch/code.

## V1 navigation direction

PaTaP's V1 value is the driver network: Map/GPS, People, Chat, Radio, Parking, Road Reports and Events.

When a user wants turn-by-turn navigation, PaTaP will later provide a small external-navigation handoff so the user can choose their preferred navigation app. The external app, not PaTaP, will calculate and own the route.

Planned free/no-backend handoff targets include:

- Google Maps standard Maps URLs;
- Waze standard deep links;
- the device/system map handler where supported.

No paid Maps/Navigation SDK, commercial routing provider, route telemetry integration or PaTaP-owned truck-routing guarantee is authorized in this block.

The actual external-navigation UI/handoff is a separate future functional block. Do not redesign the interface inside this scope-close block.

## Historical Navigation preservation

Historical branch known from prior work:
`chatgpt/navigation-engine-v1`.

It is evidence/prototype code only and is **not production source**. Preserve it as-is. Do not force-merge it into the current snapshot.

A future owner decision may reopen one of these directions:

1. keep external navigation only;
2. integrate commercial navigation/routing services;
3. build/revive PaTaP-owned routing with reviewed data/provider infrastructure.

Until then, no internal route provider is a V1 requirement.

## Mandatory Codex gate

This block changes documentation/product scope only.

1. Confirm exact base `edeacb22ec6fbf8765ee816f053de54aa0fbc3ec`.
2. Confirm the PR changes only Markdown documentation and contains no runtime/private data.
3. Confirm there is no Driver/server/Caddy/package/schema/config/runtime code change.
4. Confirm no Navigation branch is merged/rebased and no `NAV_ROUTER_URL`/Valhalla configuration is introduced.
5. `git diff --check` must pass.
6. No backend restart, SQLite backup, DR cycle or dependency install is required for this docs-only scope decision.
7. Apply only the documentation files to the production working tree using the normal recoverable source workflow.
8. Confirm the running stack remains `HEALTHY` and both public domains remain HTTP 200; do not disturb the running services merely to prove a docs-only change.
9. Create a new clean `codex/local-workspace-snapshot` from the actual production working tree.
10. Append to `AI_HANDOFF.md`:
   - `BLOCK: AUD-025/AUD-026 NAVIGATION_SCOPE_V1`
   - `STATUS: DEPLOYED`
   - both AUD-025 and AUD-026 superseded/closed for V1 by owner decision;
   - internal Navigation preserved but deferred;
   - Valhalla/`NAV_ROUTER_URL` not required for V1;
   - no runtime/interface/password/main change.

If the diff contains any runtime change, return `CHANGES_REQUIRED`; do not expand this block.
