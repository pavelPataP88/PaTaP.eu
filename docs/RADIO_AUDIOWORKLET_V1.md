# RADIO_AUDIOWORKLET_V1

Audit item: `AUD-024`

## Goal

Move live microphone capture for Driver Radio away from deprecated `AudioContext.createScriptProcessor()` on modern browsers while preserving the existing radio transport, PTT and history behavior.

This is a capture-engine change only. It does not redesign channels, permissions, server APIs, radio history, upload format or playback.

## Production source used

Base snapshot:

`codex/local-workspace-snapshot @ 6ea22faf1ede12b6342cc02bf55a3508db719d87`

The previous production implementation captures live microphone samples directly in `driver/radio/live-audio.mjs` with `createScriptProcessor(2048, 1, 1)`.

## New capture architecture

### Primary path — AudioWorklet

`driver/radio/live-capture-worklet.mjs`

- registers static same-origin processor `patap-radio-capture-v1`;
- runs on the browser audio rendering thread;
- copies only the current mono `Float32Array` input block;
- transfers that block through the AudioWorklet port;
- performs no HTTP, WebSocket, EventSource, storage or user-data work.

`driver/radio/capture-graph.mjs`

- loads the worklet with `audioWorklet.addModule()`;
- creates `AudioWorkletNode` with one input and one output channel;
- keeps the existing silent destination connection so the capture graph is actively rendered without audible microphone feedback;
- forwards float samples to `live-audio.mjs`;
- exposes the selected capture mode for diagnostics;
- disconnects and clears event handlers deterministically on stop.

### Explicit compatibility fallback

If AudioWorklet is unavailable, blocked, cannot load, or cannot be constructed, `capture-graph.mjs` may use the existing ScriptProcessor capture path as an explicit legacy fallback.

The fallback is deliberately isolated in one adapter. `live-audio.mjs` no longer calls `createScriptProcessor()` directly.

If neither AudioWorklet nor the legacy fallback can be created, live capture fails closed and returns `false`; normal Radio history/recording behavior remains responsible for its existing fallback UX.

## Contracts intentionally preserved

The following values and protocol stay unchanged:

- live PCM sample rate: **16 kHz**;
- live chunk size: **4,000 samples** (~250 ms);
- accidental PTT gate: **550 ms**;
- little-endian signed PCM16 network body;
- `X-Radio-Upload-Token`;
- `X-Radio-Live-Sequence`;
- `X-Radio-Live-Sample-Rate`;
- final zero-byte live completion marker with `X-Radio-Live-End: 1`;
- live transport failure falls back to `history_only` state;
- existing server authorization, channel policy, PTT lease and upload limits;
- committed history playback and live-listener deduplication.

Downsampling remains in `live-audio.mjs`. Moving only capture to AudioWorklet avoids changing the server wire contract.

## Security / CSP

The worklet is a static file served from the same Driver origin. No blob-generated source, remote worklet source, eval, broad CSP rule or third-party script is required.

Current Driver CSP already allows same-origin scripts/workers. Do not broaden `script-src`, `worker-src` or `connect-src` for this block.

## Automated coverage

`tests/driver/radio-audioworklet.test.mjs` verifies:

1. AudioWorklet is preferred and ScriptProcessor is not touched when worklet setup succeeds;
2. worklet module URL and processor name are exact;
3. captured float samples are delivered to the existing main-thread pipeline;
4. explicit ScriptProcessor fallback works if worklet loading fails;
5. capture fails closed if neither engine is available;
6. worklet source performs no network operations;
7. `live-audio.mjs` keeps the existing 16 kHz / 4,000-sample / 550 ms / completion-marker transport contract;
8. `live-audio.mjs` no longer directly calls `.createScriptProcessor()`.

The normal Driver suite, radio live server test, two-user E2E and browser suite remain mandatory.

## Physical-device verification

Automated browsers do not prove real Android/iOS microphone scheduling or speaker behavior. After Codex Windows verification and guarded deployment, perform one real phone smoke when practical:

1. sign in as Driver;
2. open Radio;
3. grant microphone permission;
4. hold PTT longer than 550 ms;
5. confirm another authorized device/user hears live audio;
6. release PTT and confirm the committed transmission appears in history;
7. verify no duplicate replay caused by already-heard live audio;
8. inspect console only if there is a failure; note whether capture mode is AudioWorklet or legacy fallback.

A physical-device smoke is field validation, not a reason to weaken CSP or change the wire protocol.

## Out of scope

- codec redesign / Opus live streaming;
- WebRTC;
- server endpoint changes;
- channel/member policy changes;
- microphone permission UX redesign;
- playback engine rewrite;
- changing 60-second / 3 MiB radio limits;
- Navigation;
- `main`;
- private/runtime data.
