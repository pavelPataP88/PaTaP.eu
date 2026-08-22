# AI_TASK — AUD-024 RADIO_AUDIOWORKLET_V1

Status: `DEPLOYED` — installed and verified by Codex on 2026-08-22.

Production source of truth before this block:
`codex/local-workspace-snapshot @ 6ea22faf1ede12b6342cc02bf55a3508db719d87`.

Exact deployed source: `044e15c178a9c4d7a3d97cd43ce5aa1fa1c57ca3`.

Working branch:
`chatgpt/aud-024-radio-audioworklet-v1`.

Do not deploy an intermediate commit. Use only the exact final PR head recorded in the PR conversation after GitHub Verify is fully green.

## Goal

Close `AUD-024`: make modern Driver Radio microphone capture use `AudioWorklet` instead of deprecated `AudioContext.createScriptProcessor()`, while preserving the current 16 kHz PCM live-radio protocol and all existing PTT/history behavior.

## Engineering contract

Implemented:

- new same-origin static AudioWorklet processor: `driver/radio/live-capture-worklet.mjs`;
- new capture adapter: `driver/radio/capture-graph.mjs`;
- AudioWorklet is always attempted first when the browser exposes `audioWorklet.addModule` and `AudioWorkletNode`;
- the worklet only forwards mono float audio blocks through its message port; no network/storage/domain logic runs on the audio rendering thread;
- `driver/radio/live-audio.mjs` no longer directly calls `.createScriptProcessor()`;
- old ScriptProcessor capture remains only as an explicit compatibility fallback inside the capture adapter if AudioWorklet is unavailable or fails to load/construct;
- capture fails closed if neither engine is available;
- deterministic stop clears worklet/script handlers and disconnects the graph;
- capture mode is locally observable for diagnostics;
- automated tests cover worklet-first selection, fallback, fail-closed cleanup, static worklet behavior and unchanged wire constants;
- documentation: `docs/RADIO_AUDIOWORKLET_V1.md`.

## Transport behavior that MUST remain unchanged

- sample rate: 16,000 Hz PCM;
- chunk size: 4,000 samples;
- accidental PTT gate: 550 ms;
- little-endian PCM16 live body;
- upload token and sequence headers;
- `X-Radio-Live-Sample-Rate` remains 16000;
- final zero-byte completion request with `X-Radio-Live-End: 1`;
- live failure degrades to existing `history_only` state;
- server radio permissions/channel policies/PTT lease rules unchanged;
- committed history and already-heard live dedup unchanged;
- existing MediaRecorder committed-history path unchanged.

## Security boundary

- worklet module is static and same-origin;
- no blob worklet, eval, remote script or third-party audio code;
- do not broaden Driver CSP;
- no server/API/auth schema change;
- no runtime/private data in GitHub.

## Intentionally unchanged

- Radio channel/group/direct data model;
- contact requirements, moderation and roles;
- server live HTTP endpoints;
- 60-second / 3 MiB limits;
- Radio history retention;
- playback engine;
- GPS, Map, Road Reports, Parking, Chat, People, Event Center;
- Navigation / `NAV_ROUTER_URL`;
- password policy;
- `main`;
- SQLite, users, GPS, messages, radio media, tokens, secrets and logs.

## Mandatory Codex Windows gate

Before any production apply:

1. Review the exact final PR SHA and diff; confirm base is `6ea22faf1ede12b6342cc02bf55a3508db719d87`.
2. Confirm the diff contains no runtime/private data and no unrelated server/channel/auth changes.
3. Windows Node 24.x + clean `npm ci`.
4. Run the Driver radio/worklet tests and then full `npm run verify:release`; require full PASS.
5. Confirm `driver/radio/live-audio.mjs` contains no direct `.createScriptProcessor(` call and the only remaining call is the documented fallback in `capture-graph.mjs`.
6. Confirm build output contains `radio/live-capture-worklet.mjs` and `radio/capture-graph.mjs`.
7. Production preflight must be `READY`.
8. Create fresh encrypted off-host recovery/DR evidence using the existing safe release process.
9. Make a recoverable source backup and use normal guarded maintenance; preserve SQLite/media/secrets/runtime data.
10. Apply exact candidate source non-destructively, run root `npm ci`, build, and normal stack resume.
11. Require stack `HEALTHY` and both `https://patap.eu` and `https://driver.patap.eu` HTTP 200.
12. Browser smoke after login: Radio screen loads without module/CSP/404 console errors. Confirm `/radio/live-capture-worklet.mjs` is served from the Driver origin when live capture starts on an AudioWorklet-capable browser.
13. If a real microphone is available on the Windows machine, perform a local PTT smoke longer than 550 ms and confirm committed history remains normal. Do not claim this proves Android/iOS hardware behavior.
14. Physical phone two-user live mic/speaker smoke remains owner/field verification when practical: live hear, release, committed history, no duplicate replay.
15. After successful deployment, create the next safe `codex/local-workspace-snapshot` from actually deployed source and append `STATUS: DEPLOYED` evidence to `AI_HANDOFF.md`.

If any AudioWorklet loading, CSP, microphone, live chunking, PTT, history, Windows browser or release regression appears, report `CHANGES_REQUIRED` with exact file/location/reproduction/expected behavior. Do not remove the explicit compatibility fallback or weaken CSP as a shortcut.
