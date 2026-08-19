# CODEX HANDOFF — CHAT_CONSOLE_V2

Date: 2026-08-19 Europe/Warsaw
Status: **READY_FOR_REVIEW — NOT DEPLOYED BY CHATGPT**

## Source

- Repository: `pavelPataP88/PaTaP.eu`
- Source branch: `chatgpt/chat-console-v2`
- Base: `codex/local-workspace-snapshot @ 9604c26d49727b57e9c9a78a64526dd16e5ed93d`
- Code + tests HEAD before documentation: `d9c71ce6e7a46546fe9d4460e028a46eef1bb83c`
- Research document: `docs/CHAT_CONSOLE_V2_RESEARCH.md`
- GitHub CI status at handoff preparation: no status checks reported. ChatGPT therefore does **not** claim npm/tests PASS.

## Objective

Upgrade Driver PaTaP Chat into a real messenger-grade subsystem while preserving existing GENERAL / COUNTRY / DIRECT history, Driver identities, contacts/blocks, WebSocket behavior and the already deployed Map/Radio systems.

## Important scope

Expected modified scope is Chat only plus its loader/tests/docs:

- `driver/chat/**`
- `server/chat/**`
- `driver/module-registry.json`
- `scripts/run-auth-tests.js`
- `package.json`
- chat-specific auth/driver tests
- chat docs / task handoff

Do not accept unrelated changes to Map, GPS, Radio backend, Caddy or `main`.

## Implemented product behavior

### Messenger inbox

- Room list with All / Direct / Groups / Country / Archive filters.
- Unread and `@` mention badges.
- Last-message preview, drafts, favorite, archive, mute and pinned-room state.
- Desktop split view and mobile conversation/list navigation.

### Messages

- Existing text/history preserved.
- Text limit expanded to 4000.
- Reply.
- Forward between rooms the sender can access.
- 15-minute own-message edit window.
- Delete for me.
- Delete for everyone; group moderators can delete where permitted.
- New client can render deletion tombstones; legacy GET contract hides deleted messages unless `includeDeleted=1` is supplied.
- Strict idempotent `clientMessageId`: same request returns same message; reused ID with changed content returns 409.
- 12 curated emoji reactions.
- `@nickname` and `@all` mention storage.
- Typing realtime.
- Delivered/read cursor model and UI receipts.
- Search.
- Up to 5 pinned messages.

### Groups

- Real GROUP rooms alongside legacy room model.
- PUBLIC / PRIVATE.
- History policy FULL / JOINED.
- OWNER / ADMIN / MODERATOR / MEMBER / READONLY.
- Public discovery/join.
- Private invitation flow.
- Server-enforced READONLY posting/upload/edit protection.
- Remove / ban / unban backend support.
- Leave/delete group.
- Owner transfer to another member.

### Attachments and voice

- IMAGE / VIDEO / AUDIO / FILE.
- Two-phase authorized upload using an upload token.
- Attachment must reach READY state before message attach.
- Runtime files stored under `data/chat`, outside public static build.
- Authenticated file access.
- Range requests (`206`) for media seeking.
- Maximum 25 MiB overall with tighter per-kind limits.
- Safe file names + MIME allow-list.
- Voice message MediaRecorder with pause / resume / cancel and five-minute cap.
- Audio speed 1x / 1.5x / 2x.
- Reference-counted physical file cleanup so forwarded/shared attachments are not removed while still referenced.

### Polls

- Up to 12 options.
- Single/multiple selection.
- Backend supports anonymous and close-time fields.

### Advanced PaTaP controls

- Notification mode: ALL / MENTIONS / NONE, persisted server-side.
- Disappearing timer for the user's **new** messages on that browser: Off / 1h / 24h / 7d / 30d; the server stores `expires_at` per message.
- DIRECT chat → open existing PaTaP direct Radio.
- GROUP owner transfer.

## Data / migration safety

- Global auth `schema_migrations` remains version **12**.
- Chat V2 uses additive `chat_schema_meta` version **1**.
- Existing `chat_rooms`, `chat_room_members`, `chat_messages`, `chat_direct_pairs` and old reaction history are not dropped or rewritten.
- New chat tables are additive.
- Old reaction data is copied with `INSERT OR IGNORE` into V2 reaction storage.
- No production runtime data is present in the branch.

Before applying to the real working folder, create a SQLite backup using the existing project backup procedure (`npm run auth:backup` or the locally established equivalent) and confirm the backup file exists.

## Mandatory Codex test sequence

Run from actual `D:\WWW.PATAP.EU` after applying candidate to an isolated/backup-safe state:

1. `npm ci`
2. `npm run test:auth`
   - must include `tests/auth/chat-console.test.js`
   - must keep old `tests/auth/api.test.js` and old chat/reaction contracts green
3. `npm run test:driver-modules`
   - must include `tests/driver/chat-console.test.mjs`
   - must keep map/radio/road-report module tests green
4. `npm run test:radio-live`
5. `npm run test:client`
6. `npm run test:config`
7. `npm run build`
8. `npm run verify`
9. `npm run test:browser`

If any old test fails because an old expectation conflicts with a deliberate V2 contract, inspect the behavior first. Do not weaken security/access/idempotency tests just to turn the suite green.

## Mandatory manual smoke after automated PASS

Use only temporary/test Driver accounts, never real-user data.

### Existing behavior regression

- Existing GENERAL history opens.
- Existing COUNTRY room still respects country membership.
- Existing DIRECT room/history opens.
- Blocking still removes access to DIRECT chat and realtime typing.
- Old reaction history is visible.

### Direct conversation

- Send text.
- Reply to a message.
- Edit own message within 15 minutes and see edited state.
- Reaction add/remove.
- Delete for me: only one user stops seeing it.
- Delete for everyone: V2 client shows tombstone; legacy query without `includeDeleted=1` hides it.
- Forward a message to another accessible room.
- Verify strict duplicate `clientMessageId` behavior in automated test.
- Typing appears on the second client.
- Delivered/read receipt updates.

### Media / voice

- Upload JPG/PNG.
- Upload MP4/WebM video.
- Upload a PDF/document.
- Record voice, pause, resume, finish, send, play.
- Audio seek works (server Range support).
- Reject over-limit/unsupported MIME safely.
- Delete a message with a unique file and confirm physical file cleanup.
- Forward an attachment, delete one copy, verify the remaining copy still works.

### Groups

- Create PRIVATE group.
- Invite accepted Driver contact.
- Create PUBLIC group, discover and join from second account.
- Change MEMBER → READONLY; verify UI disables composer and direct API cannot post/upload/edit.
- Change roles within permission hierarchy.
- Remove member.
- Owner transfer; verify previous owner becomes ADMIN and new owner can manage.
- Leave group.

### Poll / mentions / state

- Create poll and vote from two accounts.
- `@nickname` mention increments mention state.
- `@all` behavior follows server group rules.
- Favorite / archive / room pin.
- Notification modes ALL / MENTIONS / NONE.
- Draft survives room switch/reload.
- Search returns message/attachment/poll text results.
- Pin/unpin message.
- Disappearing timer applies only to newly sent messages and expires them at the expected time.

### PaTaP integration

- DIRECT-chat Radio button opens the existing direct PaTaP Radio contact/channel without changing Chat history.
- Map and Radio remain functional after Chat backend restart.

### Responsive UI

Check at minimum:

- ~390px phone portrait.
- ~820px tablet.
- desktop split view.

Verify no horizontal page overflow, composer remains reachable with virtual keyboard, message actions are reachable, media does not overflow bubbles, dialogs fit viewport, list ↔ conversation back navigation works.

## Security / privacy assertions

Must remain true:

- Session required for chat and attachment content.
- CSRF required for mutations and upload.
- Room membership checked server-side.
- DIRECT block rules remain server-side.
- READONLY is a server rule.
- Upload token is required and bound to owner/room/state.
- Files are not placed in public static directories.
- Realtime broadcast must not leak a different user's personalized poll/read/reaction state; personalized state is fetched through authorized API.
- UI must **not** claim end-to-end encryption. No client-to-client E2EE/key-management protocol is implemented in this block.

## Known engineering limits — not deployment blockers for the current stage

- Upload body is currently buffered by Node's existing `readBinaryBody`; 25 MiB is intentionally bounded. At larger scale this should become streaming upload/storage.
- Native background push notifications are not part of this web block.
- Telegram-style Topics, sticker/GIF ecosystem, rich server-side link previews and Chat voice/video calls are separate future blocks.

## Apply / deploy rule

Only after all required automated tests and the relevant manual smoke pass:

1. apply accepted Chat V2 files to the real working tree;
2. keep backup SQLite;
3. rebuild static Driver assets;
4. restart only the backend components actually required by Chat schema/routes;
5. run stack health check;
6. verify `https://driver.patap.eu` returns 200 and unauthenticated protected Chat APIs remain 401;
7. sync accepted source/tests/docs back to `codex/local-workspace-snapshot`;
8. record exact PASS/failure and deployment status in Codex handoff.

If anything fails, revert the candidate from the local working tree, leave production unchanged, report the exact failing test/endpoint and do not start another feature block.
