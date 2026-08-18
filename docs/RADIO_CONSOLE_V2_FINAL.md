# Radio Console V2 — final candidate

> This file is the final engineering description of `RADIO_CONSOLE_V2` and supersedes the earlier transport-boundary section in `docs/RADIO_CONSOLE_V2.md`. The original research matrix remains useful; the transport was subsequently extended to live audio while PTT is held.

## Product goal

Radio is a standalone Driver Patap product surface. This block does not merge Radio into Map or Chat. The objective is to build a full professional PTT console using proven ideas from strong radio products while keeping PaTaP's own code, UI, wording, data model and safety rules.

No Zello code, CSS, icons, images, wording, proprietary assets or exact screen layout are copied.

## Official Zello principles researched

Official pages checked for this block include:

- Channel Types — https://support.zello.com/zw/channel-types
- Creating and configuring channels — https://support.zello.com/zw/creating-and-configuring-channels-management-console
- Setting Up User Roles — https://support.zello.com/zw/setting-up-user-roles
- Channel moderation guidelines — https://support.zello.com/zc/channel-moderation-guidelines
- Channel moderators vs administrators — https://support.zello.com/zc/channel-moderators-vs.-channel-administrators
- Default Channel or Contact — https://support.zello.com/zw/default-channel-or-contact-an-overview
- Car Mode — https://support.zello.com/zc/using-car-mode-android
- Android User Guide / Recents / History / playback — https://support.zello.com/zc/android-user-guide
- Pinned Messages — https://support.zello.com/zw/pinned-messages
- Statuses — https://support.zello.com/zc/understanding-statuses
- Testing audio with Echo — https://support.zello.com/zw/testing-audio-with-echo
- Emergency Channel Settings + Roles — https://support.zello.com/zw/emergency-channel-settings-roles

Only general product principles were used.

## Channel model

PaTaP now has three effective radio spaces:

- `GENERAL` — system `Общий эфир`; a Driver is enrolled when Radio is first used.
- `GROUP` — user-created channels.
- `DIRECT` — existing 1:1 radio between accepted Driver contacts.

GROUP channels support:

- `PUBLIC` — discoverable and joinable;
- `PRIVATE` — invitation only;
- description;
- member count;
- favorite;
- per-channel mute;
- default channel;
- unread counter;
- current speaker;
- pins;
- temporary attention alert;
- leave/delete lifecycle.

PRIVATE invitation is additionally restricted to an accepted Driver contact.

## Roles and speaking policies

Roles:

- `OWNER`
- `MODERATOR`
- `TRUSTED`
- `MEMBER`
- `LISTENER`

Talk policies:

- `EVERYONE` — all channel members except LISTENER may request PTT.
- `TRUSTED` — OWNER, MODERATOR and TRUSTED may request PTT.
- `BROADCAST` — only OWNER and MODERATOR may request PTT.

These rules are enforced in `server/radio/repository.js` before a PTT lease is granted. They are not UI-only controls.

OWNER can transfer ownership. MODERATOR cannot remove OWNER or another MODERATOR. GROUP members can leave; OWNER must transfer ownership first. GROUP owner may delete the channel. GENERAL and DIRECT are not deletable through GROUP management UI.

## Standalone Radio Console UI

The original PaTaP console provides:

- tabs: `Недавние`, `Каналы`, `Прямые`;
- local channel filter;
- channel list with live speaker / unread / favorite / mute state;
- active-channel panel;
- large PTT;
- create channel;
- discover public channels;
- invitations;
- member/role management;
- Busy / Solo / Available;
- default channel;
- favorite / mute;
- sequential voice history;
- replay last;
- 1× / 1.25× / 1.5× playback;
- up to three GROUP pins;
- short-lived `ATTENTION` channel alert;
- local microphone Echo test;
- Driving Mode.

### Driving Mode

Driving Mode intentionally removes most controls and history from the working surface. It keeps:

- very large PTT;
- previous channel;
- replay;
- next channel;
- exit.

It is intended for a mounted phone/tablet. It is not a statement that a driver should manipulate the screen while actively driving.

## PTT safety inherited from RADIO_EXPERIENCE_V1

All previously deployed rules remain:

- hold to talk;
- release to finish;
- drag outside button + release cancels;
- pointercancel / lost pointer capture cancel safely;
- Space / Enter hold-to-talk;
- Escape cancels;
- recording shorter than 550 ms is treated as accidental and not committed;
- 60 second recording maximum;
- 3 MiB saved-audio maximum;
- existing pending speaker lease;
- existing upload token;
- cancellation only releases the matching pending transmission;
- success is never shown without server confirmation / verified committed transmission;
- lost upload-response race is double-checked before declaring success or failure.

## Live audio while PTT is held

The final candidate adds a separate best-effort live path **without removing the reliable saved-history path**.

### Sender path

After the existing server grants the PTT lease:

1. The same microphone `MediaStream` continues feeding the normal `MediaRecorder` for the final saved transmission.
2. In parallel, a local Web Audio processor reads mono samples.
3. Audio is downsampled to 16 kHz signed PCM16 little-endian.
4. The sender groups approximately 4,000 samples (~250 ms) per live chunk.
5. Each live chunk is sent by HTTPS POST to:
   `/api/driver/radio/live/<transmissionId>`.
6. Every chunk must carry the **same existing** `X-Radio-Upload-Token`, a strictly increasing sequence and sample-rate header.

A live chunk cannot exist outside a currently valid pending PTT lease because the server validates it through the existing `radio.uploadTarget(...)` logic.

### Server relay

`server/radio/live-http.js`:

- does not persist live PCM;
- does not create a second transmission/history;
- never writes the live PCM to disk;
- validates session + Driver profile + CSRF + lease + upload token;
- caps chunk size to 12 KiB;
- caps one transmission to 320 live chunks and 2.4 MB live bytes;
- keeps counters bounded and expires stale relay state;
- checks channel membership/access again for every listener before relaying;
- excludes the sender from its own live stream;
- sends live PCM only over authenticated `/api/driver/radio/live-events` SSE.

The listener event contains only the data needed for that authorized live stream: channel id, transmission id, sequence, sample rate and PCM payload. No upload token is ever sent to listeners.

### Listener path

When the user explicitly enables `Живой звук`, PaTaP unlocks a playback `AudioContext` from that user gesture. Incoming PCM chunks are scheduled with a small jitter buffer.

Client-side playback still respects:

- channel mute;
- `BUSY` — no automatic live playback;
- `SOLO` — automatic live playback only for the selected Solo channel;
- membership/access on the server.

### Completion and history fallback

The live path is **not** the delivery record. The saved committed transmission remains authoritative.

On normal PTT release:

1. capture of new live PCM stops;
2. already captured live chunks and the final partial chunk are allowed to drain for a bounded time;
3. then the normal MediaRecorder stops;
4. the full saved audio is uploaded using the existing upload token;
5. server commits the normal transmission and releases the lease;
6. a live end marker includes `finalSequence`;
7. if a listener received that final sequence, the client marks the transmission fully heard live and does not auto-play the exact saved message a second time;
8. if live chunks were missed or the live path failed, the committed history remains available and can be played as the complete fallback.

On explicit cancel, queued-but-not-started live chunks are discarded and no normal transmission is committed.

### Race protections

The live client includes explicit protection against:

- release/cancel while AudioContext is still starting;
- a delayed live context becoming active after PTT was already released;
- queued live chunks continuing after explicit cancel;
- dropping the final partial PCM chunk on normal release;
- duplicate playback of a fully received live transmission after history commit;
- suppressing history when the live stream was incomplete.

## Realtime state transport

Radio uses two authenticated SSE streams:

- `/api/driver/radio/events` — generic `radio.refresh` invalidation only. It carries no channel/nickname/transmission payload; client refetches its protected `/overview`.
- `/api/driver/radio/live-events` — authorized live PCM for channels the connected user can access.

Normal state has a 12 second HTTP polling fallback in case the generic SSE path is unavailable. Browser EventSource provides reconnect/backoff.

## Compatibility / performance risk to verify

The sender currently uses `AudioContext.createScriptProcessor(...)` to process the microphone in parallel with MediaRecorder. It is widely supported in Chromium but deprecated in favor of AudioWorklet.

This is intentional for the candidate because it avoids adding a worklet asset and keeps the live fallback isolated, but **Codex must test the actual Android phone/tablet/browser used by the project**. If that target does not reliably fire ScriptProcessor while capturing, live audio should be moved to AudioWorklet in a focused follow-up before deployment. The reliable post-release history path works independently of this live processor.

The ~250 ms chunk size is an engineering target, **not a claimed production latency**. Actual end-to-end latency depends on browser audio scheduling, HTTPS request overhead, Caddy/Cloudflare streaming and mobile network conditions. It must be measured on the real stack before making any latency claim.

## Data model

Legacy radio transport tables remain intact:

- `radio_channels`
- `radio_channel_members`
- `radio_direct_pairs`
- `radio_speaker_leases`
- `radio_transmissions`

No ALTER/DROP is performed on these legacy tables.

Radio Console has module-local additive schema version `radio_schema_meta = 1` for profiles, member state, invites, bans, user settings, alerts and pins. Global auth `schema_migrations` remains 12. This isolates the channel-console schema from auth/chat/map migrations.

## Intentionally not included

This block does **not** add:

- Map integration;
- GPS-based dynamic channels;
- text chat inside Radio;
- images/location messages;
- emergency/SOS semantics;
- background or automatic microphone recording;
- advertising;
- external voice providers;
- WebRTC/TURN infrastructure;
- copied Zello design/assets;
- per-user audio mixing/volume control (would require a separate mixer/Web Audio design).

## Required Codex verification before deployment

Automated:

- `npm ci`
- `npm run test:driver-modules`
- `npm run test:auth`
- `node scripts/run-radio-live-test.js`
- `npm run build`
- `npm run verify`
- browser test where network policy permits

Real isolated Driver smoke:

1. Existing DIRECT PTT between accepted contacts still works.
2. GENERAL PTT works.
3. Create PUBLIC and PRIVATE GROUP.
4. PUBLIC discover/join.
5. PRIVATE contact invitation/accept/decline.
6. TRUSTED/BROADCAST/LISTENER PTT permissions.
7. Owner transfer, moderator restrictions, remove/ban/rejoin protection.
8. Busy/Solo/mute/default/favorite/unread.
9. pins, replay, sequential history, 1.25×/1.5×.
10. Echo test never sends audio to server.
11. Driving Mode at ~390 px phone width and tablet width.
12. Generic `/events` SSE is not buffered by local stack / Caddy / Cloudflare.
13. `/live-events` PCM is heard by a second authorized device **while the first device is still holding PTT**, not only after release.
14. Measure live latency and audio continuity for a 60-second PTT session.
15. Break/block only the live endpoint: saved post-release transmission must still commit and play from history.
16. Cancel/short tap: no committed history; queued live sending stops.
17. Full live reception + commit: no second automatic playback of the same message.
18. Incomplete live reception + commit: complete history remains usable.
19. Verify CPU/memory/network behavior with several live listeners.
20. Back up the working SQLite before applying the new Radio Console tables.

Only after those checks should Codex apply the candidate and update `codex/local-workspace-snapshot`.
