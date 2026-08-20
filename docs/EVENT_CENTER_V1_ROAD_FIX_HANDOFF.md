# EVENT_CENTER_V1 — ROAD REPORT FIX HANDOFF

Date: 2026-08-20 Europe/Warsaw
Task: `EVENT-CENTER-20260820-002`
Status: **READY_FOR_CODEX_REVIEW — NOT DEPLOYED BY CHATGPT**

## Exact candidate

- Branch: `chatgpt/event-center-v1-road-fix-01`
- Base: `codex/local-workspace-snapshot @ 776b35b7d2ad7ec4ab385d8541bd2a65c93e5437`
- Self-contained assembly commit: `c02357184d291cc70d44e97498e6c5a93b91eaa3`
- Road helper production fix: `f257b3744b29d23d5ea925fec659f186be181838`
- **Code + tests commit to review: `56c9484b54018712e060d30f44d2c2e639fa179f`**
- Original Event Center reviewed by Codex: `chatgpt/event-center-v1 @ ef697536f02d6e8d6a65ef88e4b18728be2fd397`
- Prior syntax repair included: corrected `server/events/repository.js` from `0432fb74fc4717d805c97c99c19163a29e51a829`.

This branch is deliberately self-contained. Codex must not manually combine the old Event Center branch and the syntax-fix branch again.

## Exact functional correction

Codex confirmed the first syntax repair and then found:

`TypeError: haversineKm is not a function`

at `server/events/service.js`, causing Road Report creation to return HTTP 500 instead of 201.

Root cause:

```js
const { haversineKm } = require("../driver/location");
```

`server/driver/location.js` does not export `haversineKm`.

The already deployed Road Reports module owns and exports the compatible helper in `server/road-reports/repository.js`.

The Event Center candidate now uses:

```js
const { haversineKm } = require("../road-reports/repository");
```

No Road Report behavior, validation, distance threshold, guest visibility, confirmation policy or API response contract was changed.

## Regression coverage

The existing auth tests remain unchanged and must still prove:

1. Road Report create returns HTTP 201.
2. A nearby eligible driver receives the Event Center Road event.
3. The nearby accident/obstacle case is `URGENT` under the existing Event Center policy.
4. The pre-existing Road Reports regression remains PASS.

A focused static regression was added to `tests/driver/event-center.test.mjs`:

- Event Center service must import the distance helper from `../road-reports/repository`;
- it must not import it from `../driver/location`.

No failing assertion was weakened or removed.

## Required Codex sequence

1. Compare `codex/local-workspace-snapshot @ 776b35b7d2ad7ec4ab385d8541bd2a65c93e5437` against `chatgpt/event-center-v1-road-fix-01 @ 56c9484b54018712e060d30f44d2c2e639fa179f`.
2. Confirm the branch contains the complete Event Center candidate and both known repairs: repository syntax + Road distance import.
3. Run `node --check` over every changed JS/MJS file, especially `server/events/repository.js` and `server/events/service.js`.
4. Run `npm ci`.
5. Run `npm run test:auth` first. The two previously failing assertions must both pass; expected Road create remains HTTP 201.
6. Only if auth passes, run the complete required suite from `docs/EVENT_CENTER_V1_HANDOFF.md`: `npm run test:radio-live`, `npm run test:driver-modules`, `npm run test:client`, `npm run test:config`, `npm run build`, `npm run verify`, `npm run test:browser`.
7. Do not weaken existing Road Report or Event Center tests to obtain PASS.
8. Before the first candidate backend start/apply on the real workspace, create the required real SQLite backup.
9. Apply/deploy only after all mandatory code/regression checks pass.
10. After deployment verify local/public health, perform Event Center multi-account smoke and a real-device Web Push smoke according to the full Event Center handoff.
11. Sync only the actually tested/applied source back into `codex/local-workspace-snapshot` and record exact test counts/results.
12. Do not start Navigation, Voice Assistant or any other new functional block automatically.

## Truth statement

ChatGPT has changed the candidate source and test coverage in GitHub. ChatGPT has **not** run the authoritative Windows test suite, has not modified `D:\WWW.PATAP.EU`, has not backed up or modified production SQLite, and does not claim PASS or deployment.

