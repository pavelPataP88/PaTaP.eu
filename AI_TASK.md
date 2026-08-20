# AI_TASK — EVENT_CENTER_V1: Codex re-review

Status: **READY_FOR_CODEX_REVIEW — NOT DEPLOYED**

Use this single self-contained candidate:
- branch: `chatgpt/event-center-v1-road-fix-01`
- base: `codex/local-workspace-snapshot @ 776b35b7d2ad7ec4ab385d8541bd2a65c93e5437`
- **code + tests commit: `56c9484b54018712e060d30f44d2c2e639fa179f`**
- review instructions: `docs/EVENT_CENTER_V1_ROAD_FIX_HANDOFF.md`
- full product/deployment instructions: `docs/EVENT_CENTER_V1_HANDOFF.md`

This candidate already contains:
1. full `EVENT_CENTER_V1`;
2. the prior `categoryPreferences()` syntax repair;
3. the Road Report regression repair: `server/events/service.js` now imports `haversineKm` from `../road-reports/repository`, the existing deployed Road Reports helper;
4. a focused regression assertion preventing a return to the invalid `../driver/location` import.

Do not manually compose the old Event Center branch and old syntax-fix branch again.

Codex must:
1. diff the exact base against the code + tests commit;
2. run `node --check` across changed JS/MJS;
3. run `npm ci` and `npm run test:auth` first; both previously failing Road create assertions must pass without weakening tests;
4. only then run the complete suite listed in `docs/EVENT_CENTER_V1_ROAD_FIX_HANDOFF.md` / `docs/EVENT_CENTER_V1_HANDOFF.md`;
5. back up the real SQLite before the first real candidate backend start/apply;
6. deploy only after full PASS, then perform public health, multi-account Event Center and real-device Web Push smoke;
7. sync the actually tested result into `codex/local-workspace-snapshot` and record exact results;
8. do not start the next functional block automatically.

Do not change `main`, Caddy, global auth migration, six-character password rule, runtime/private data, Road Report behavior, or unrelated product behavior.

ChatGPT does not claim PASS or deployment. Production remains unchanged until Codex verifies it.