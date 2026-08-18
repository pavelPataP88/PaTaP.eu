# CODEX HANDOFF — RADIO_CONSOLE_V2

FROM: CHATGPT
BLOCK: RADIO_CONSOLE_V2
TASK_ID: RADIO-CONSOLE-20260818-002
STATUS: READY_FOR_REVIEW
SOURCE_BRANCH: `chatgpt/radio-console-v2`
BASE: `codex/local-workspace-snapshot @ c8b450fff2f09f70bb1109de8e9a98490710c0d7`
SOURCE_CODE_COMMIT: `11f9d769b4c419233dfefd60c02d627b644ea8cc`

## Почему отдельный handoff-файл

Существующий `AI_HANDOFF.md` содержит большую историю Codex/ChatGPT. В этой сессии GitHub connector не даёт безопасной append-операции, а полная выдача файла обрезается по размеру. Поэтому ChatGPT **не переписывал и не обрезал `AI_HANDOFF.md`**. Этот файл является точной передачей текущего большого блока Codex. После локальной проверки Codex может добавить результат в обычный `AI_HANDOFF.md` своим штатным способом.

## Пользовательская задача

После DEPLOYED `RADIO_EXPERIENCE_V1` пользователь явно расширил задачу: сейчас Radio развивается как самостоятельный продукт, отдельно от Map и Chat, с уровнем функциональности сильной современной PTT-рации. Zello исследован как продуктовый ориентир, но код/assets/UI/trade dress не копировались.

Каноническое описание: `docs/RADIO_CONSOLE_V2.md`.

## Scope diff

На code commit относительно BASE: `ahead 40 / behind 0`.

Изменения только в Radio/docs/tests/package runner:

- `driver/radio/console.mjs`
- `driver/radio/experience.mjs`
- `driver/radio/index.js`
- `driver/radio/live-audio.mjs`
- `server/radio/schema.js`
- `server/radio/repository.js`
- `server/radio/routes.js`
- `server/radio/live-http.js`
- `tests/auth/radio-console.test.js`
- `tests/auth/radio-live.test.js`
- `tests/auth/radio-moderation.test.js`
- `tests/driver/radio-console.test.mjs`
- `tests/driver/radio-experience.test.mjs`
- `scripts/run-auth-tests.js`
- `scripts/run-radio-live-test.js`
- `package.json`
- `docs/RADIO_CONSOLE_V2.md`

НЕ изменялись:

- Map/GPS;
- Chat;
- Driver profile/auth policy;
- Caddy/Cloudflare config;
- main;
- существующие пользовательские runtime-данные в GitHub.

## Что реализовано

### 1. Полноценные радио-пространства

- system `GENERAL` — `Общий эфир`;
- `GROUP` — пользовательские каналы;
- существующий `DIRECT` 1:1 между accepted contacts сохранён.

GROUP:

- PUBLIC / PRIVATE;
- create / discover / join / invite / accept / decline / leave / delete;
- OWNER / MODERATOR / TRUSTED / MEMBER / LISTENER;
- EVERYONE / TRUSTED / BROADCAST talk policy;
- bans;
- member count;
- favorite;
- mute;
- unread;
- default channel;
- pins max 3;
- temporary ATTENTION alert.

### 2. Radio Console UI

- `Недавние / Каналы / Прямые`;
- local filter;
- active speaker;
- large PTT;
- channel management dialogs;
- invitations/member roles;
- AVAILABLE / BUSY / SOLO;
- live sound opt-in;
- replay;
- sequential history;
- playback 1x / 1.25x / 1.5x;
- pins;
- Echo test local-only;
- Driving Mode with large PTT + previous/replay/next/exit;
- mobile/tablet responsive UI and aria labels.

### 3. Existing reliable PTT semantics preserved

- hold/release;
- pointer cancel / drag-out / Esc / blur handling;
- short tap `<550ms` is accidental;
- 60 seconds max;
- 3 MiB committed audio max;
- speaker lease;
- upload token;
- committed-history delivery proof;
- ambiguous lost upload response is rechecked before showing success/failure.

### 4. Best-effort live audio while PTT is held

Reliable committed history remains authoritative. Live is parallel and optional.

Sender:

- same microphone MediaStream feeds MediaRecorder history + Web Audio live capture;
- downsample to PCM16 mono 16kHz;
- ~250ms chunks (4000 samples);
- `POST /api/driver/radio/live/:transmissionId`;
- same current upload token required;
- sequence validation;
- normal release flushes tail and sends `end/finalSequence` before final history commit.

Accidental-tap privacy:

- first `550ms` live audio is buffered locally;
- short tap/cancel before gate sends **zero live PCM**;
- real hold releases the buffered start after the gate.

Cancellation after live began:

- stops future live chunks and prevents saved history;
- already heard live audio cannot be retracted; UI documentation states this explicitly.

Listener:

- explicit `Живой звук` opt-in unlocks AudioContext;
- channel mute / BUSY / SOLO filter playback;
- live sequence gaps are detected;
- only complete sequence + verified end marker marks a transmission fully heard live;
- only then duplicate committed autoplay is suppressed;
- incomplete live always leaves full committed history as fallback.

Server live relay:

- session + profile + CSRF + active lease + upload token;
- `radio.uploadTarget()` rechecks current talk permission;
- no live PCM persisted to disk;
- listener channel access rechecked on relay;
- sender excluded from own relay;
- chunk <=12 KiB;
- <=320 chunks / <=2.4MB live bytes per transmission;
- stale counters expire;
- `/live-events` connection is forcibly recycled every 60s so EventSource reconnect revalidates session.

### 5. Realtime state

- `/api/driver/radio/events` generic `radio.refresh` only, no private channel payload;
- 12s HTTP poll fallback;
- `/api/driver/radio/live-events` only for live PCM.

### 6. Moderation race hardening

Server now immediately releases pending speaker lease + UPLOADING transmission when:

- active user is demoted to a role no longer allowed to talk;
- channel talk policy changes and active speaker is no longer allowed;
- active member is removed/banned;
- active member leaves GROUP.

`uploadTarget()` also rechecks `talkPermission` so stale tokens cannot keep speaking/commit after permission revocation.

Unread count excludes the user's own transmissions. GROUP alert query was tightened to avoid duplicate rows from member joins.

## Data model

Legacy transport tables are preserved; no ALTER/DROP of:

- `radio_channels`
- `radio_channel_members`
- `radio_direct_pairs`
- `radio_speaker_leases`
- `radio_transmissions`

New module-local additive tables use `radio_schema_meta = 1`:

- channel profiles;
- member state;
- invites;
- bans;
- settings;
- alerts;
- pins.

Global auth `schema_migrations` intentionally remains `12`.

## Tests prepared by ChatGPT

ChatGPT **did not run local npm tests** in its environment. Do not mark PASS from this handoff.

New/updated automated coverage includes:

- GROUP roles/access/discovery/invite/join/ban/settings/pins/SSE;
- legacy DIRECT accepted-contact rule;
- live PCM before final commit;
- wrong live upload token rejected;
- live end/finalSequence;
- same transmission then saved in normal history;
- role/policy/member changes immediately revoke active PTT;
- PCM downsample 48k -> 16k;
- 550ms live gate;
- live + history lifecycle static regression;
- old RADIO_EXPERIENCE reliability assertions updated without removing token/delivery checks.

## Codex required automated run

Run on isolated/local working copy before applying production:

1. `npm ci`
2. `npm run test:auth`
3. `npm run test:radio-live`
4. `npm run test:driver-modules`
5. `npm run build`
6. `npm run verify`
7. `npm run test:browser` where browser network policy allows

If any test fails: **do not deploy**. Return exact failing test/assertion and revert local candidate to current deployed version.

## Required real-device smoke

Use test Driver accounts, not real user actions:

1. DIRECT accepted contacts still work.
2. GENERAL PTT.
3. PUBLIC/PRIVATE GROUP lifecycle.
4. invitation/contact rules.
5. roles + talk policies.
6. active PTT revoke on demotion/policy/remove.
7. bans/rejoin.
8. Busy/Solo/mute/default/favorite/unread.
9. pins/replay/history/speed.
10. Echo never uploads.
11. phone ~390px and tablet layout.
12. second authorized device hears live **while first still holds PTT**.
13. short tap <550ms: no live sound and no saved history.
14. drag-out/Esc after live begins: future audio stops and no history is saved.
15. break live endpoint: final saved history must still commit.
16. full live + commit: no duplicate autoplay.
17. partial/gapped live + commit: full history still available.
18. Caddy/Cloudflare must not buffer SSE into unusable chunks.
19. 60s PTT latency/continuity/CPU/memory/network.

## Deployment precautions

This candidate changes backend Radio code and creates additive Radio module tables on first backend start.

Before applying to the working server:

1. create normal SQLite backup using existing project procedure;
2. record current stack status;
3. apply only accepted RADIO_CONSOLE_V2 files;
4. build;
5. restart backend using the normal project script/procedure;
6. verify DB: global schema version remains 12, `radio_schema_meta=1` exists;
7. run stack health check and public/local HTTP checks;
8. do not publish SQLite, users, audio, tokens, logs or secrets to GitHub.

## Known engineering risk / next transport stage

Current near-live transport is an intentionally isolated pilot:

- PCM16 16kHz mono ≈256 kbit/s raw plus base64/SSE overhead;
- relay cost grows with listener count;
- browser capture uses deprecated `ScriptProcessor` for compatibility simplicity;
- actual latency through Caddy/Cloudflare/mobile networks is not claimed until measured.

For large channels, a future focused transport block should evaluate AudioWorklet + Opus/WebCodecs or a dedicated realtime/WebRTC media layer. This is **not** a reason to weaken the committed-history fallback in the current candidate.

## Stop condition

Codex reviews/tests/applies only this Radio block. Do not start Map/Chat integration or another feature block until Codex records the result.
