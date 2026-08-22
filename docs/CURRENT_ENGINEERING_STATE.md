# Current Engineering State — PaTaP.eu

**Purpose:** current safe starting point for AI work. This document describes deployed/tested reality and the current engineering policy, not a wish list.

## Source of truth

- Production machine: Windows laptop, working directory `D:\WWW.PATAP.EU`.
- GitHub is an engineering mirror, not the production server.
- `codex/local-workspace-snapshot` is the clean evidence branch created from actually running production after a successful release.
- `main` is the stable/default GitHub branch and must track the latest verified production snapshot by **non-force fast-forward only**.
- On 2026-08-22 stale `main` was fast-forwarded to `0e73e8a1972bfd573b312eb4c87af9ada6d2db0c`; GitHub compare immediately reported `identical`, ahead 0 / behind 0.
- After a later deployment, the new snapshot is authoritative evidence until `main` is fast-forwarded to it. If the refs diverge, investigate; never use force/rewrite as the normal repair.

## What is currently working

### Driver map and road events

The map/Road Reports line is deployed and locally verified:

- voluntary GPS and privacy-aware clearing;
- nearby drivers, clustering and driver labels;
- structured road-event types: accident, road work, obstacle, road control, transport inspection;
- fresh voluntary GPS required for event creation; no free-text/photo Road Reports;
- guest map read-only; MapLibre lazy loading;
- freshness/peer confirmation and abuse guard;
- map layers, accuracy, follow/free/heading modes, nearby/ahead summaries;
- initial authorized map zoom and explicit `⌖` recenter behavior.

Relevant code: `driver/map/`, `driver/gps/index.js`, `server/road-reports/`, `server/driver/`.

### Chat and radio

- Chat Console V2 supports general/direct/group chat, attachments, voice messages, polls, replies, edits/deletes, pins and fixed reactions.
- Radio Console V2 supports general/direct/group channels, roles, moderation, favorites, mute, PTT, near-live PCM transport and saved history.
- AudioWorklet is the primary modern capture path; narrow ScriptProcessor fallback remains for older browsers.
- Server-side access/membership rules remain authoritative.

Relevant code: `driver/chat/`, `driver/radio/`, `server/chat/`, `server/radio/`.

### People, Parking, Events, account/recovery

- People & Communities is deployed with privacy, trust and Community-managed Chat/Radio membership.
- Parking Network is deployed with structured parking data, live occupancy, fit/security/amenities, reviews/photos and alternatives.
- Event Center is deployed with event projection/dispatch lifecycle.
- Account export/delete, storage quotas, autostart/health-watch and machine disaster recovery are deployed.
- Server boundary cleanup separates Driver runtime lifecycle and Chat realtime composition without changing product APIs.

Exact deployment evidence is in `AI_HANDOFF.md`.

## Navigation product scope

For Driver V1, internal turn-by-turn routing is intentionally deferred.

- `AUD-025 NAV_PROVIDER_LOCAL_V1` and `AUD-026 NAVIGATION_REBASE_V1` are closed/superseded for V1 by owner decision.
- Do not install Valhalla or require `NAV_ROUTER_URL` for V1.
- Do not substitute passenger-car routing for truck routing.
- Preserve historical `chatgpt/navigation-engine-v1`, but do not merge/rebase/deploy it.
- Future V1 direction is a separate external-navigation handoff to a user-selected external navigation app.

See `docs/NAVIGATION_SCOPE_V1.md`.

## Password policy

- Minimum registration password remains **6 characters by explicit owner decision for Driver V1**.
- This is accepted residual product/security risk, not a claim that every six-character password is strong.
- Asynchronous scrypt hashing/verification remains unchanged.
- No automatic minimum increase, forced reset or migration is authorized without a new owner decision.

## Safety rules

Never publish or commit users, SQLite, GPS data, messages, Radio uploads, tokens, passwords, logs, `data/`, `var/`, `node_modules/` or other runtime/private files.

Do not weaken CSRF, rate limits, session cookies, Radio access checks or GPS/privacy controls.

Do not force-push/rewrite `main` as a normal source synchronization mechanism.

## Verification boundary

Automated Windows release/E2E/browser tests provide strong regression evidence, but do not automatically claim every physical-device behavior. Real GPS/MapLibre phone behavior and two-device microphone/speaker PTT remain field validation where not separately recorded as completed.

## Current next block

`AUD-022/AUD-027 FINAL_AUDIT_CLOSE_V1` is the final documentation/policy close for the 30-point technical audit. Read `AI_TASK.md` and the latest `AI_HANDOFF.md` before action.

Closing 30/30 does **not** mean all future product work is complete: external-navigation handoff, remaining field validation and the later whole-system/final UI/UX pass remain separate work.
