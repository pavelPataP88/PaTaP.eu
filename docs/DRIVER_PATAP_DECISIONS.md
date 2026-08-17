# Driver Patap decision record

This file records only votes that were actually received. A response shown in one AI tab but signed as another AI is not attributed until corrected.

## User directive — persistent reciprocal GPS (2026-07-14)

The user's direct instruction supersedes the earlier DP-003 E and F implementation policy:

- GPS, publication and nearby visibility are one switch.
- ON is stored server-side and automatically restored after refresh and later login.
- ON users publish their latest coordinates, see other fresh ON users and are visible to them.
- OFF deletes the current server location, cannot query nearby users and is excluded from nearby results. Driver is considered off.
- Logout clears the live coordinate but preserves the ON preference so the next authenticated session can restore GPS.

The DP-003 table below remains as historical voting provenance and is no longer the current GPS policy.

## DP-003 — recovery core and realtime foundation (2026-07-13)

| Item | Codex | GPT | DeepSeek | Kimi | Result |
| --- | --- | --- | --- | --- | --- |
| A. One immutable principal Owner; host-specific CSP; current documentation | APPROVE | APPROVE | APPROVE | APPROVE | ACCEPTED 4/4 |
| B. Native browser ES modules; recursive build; client/server module boundaries | APPROVE | APPROVE | APPROVE | APPROVE | ACCEPTED 4/4 |
| C. REST + SQLite as chat source of truth; authenticated WebSocket events and ephemeral state; idempotency and cursor resync | APPROVE | APPROVE | APPROVE | APPROVE | ACCEPTED 4/4 |
| D. Store-and-forward PTT; WebSocket speaker lease; completed Blob upload over CSRF-protected HTTPS; no persistent replay history in V1 | APPROVE | APPROVE | APPROVE | APPROVE | ACCEPTED 4/4 |
| E. GPS and public visibility OFF after every page load/login; delete server location; explicit opt-in each session | APPROVE | APPROVE | APPROVE | REJECT | ACCEPTED 3/4 |
| F. No visibility reciprocity; CSRF POST nearby with current query coordinates used for distance and not stored; keep legacy GET temporarily | APPROVE | APPROVE | APPROVE | APPROVE | ACCEPTED 4/4 |

Kimi's recorded dissent on E preferred remembering the user's visibility preference and identified added friction after mobile reloads. The accepted 3/4 result prioritizes preventing silent resumed tracking. Mitigation for V1 is explicit status text and a single deliberate re-enable action; automatic permission requests, hidden tracking and restoring public visibility remain prohibited.

### Implementation state

- A: implemented and covered by automated checks. SQLite schema v4 binds the sole principal Owner; database triggers and API policy prevent another Owner and prevent mutation/deletion/disable of the principal. CSP is host-specific.
- B: implemented for the current Map/Profile/Chat/Radio/Contacts slice. Native client modules, recursive build entries, preflight validation and server repository/route boundaries are covered by verification.
- C: implemented for General and direct rooms. SQLite/REST persistence, idempotent sends, cursor resync and authenticated WebSocket committed events are covered by automated tests.
- D: partially implemented. Accepted-contact direct channels, one server speaker lease, completed Blob upload over CSRF-protected HTTPS and private playback with a 30-day access window are implemented. Physical deletion of expired audio files is not yet implemented. The client currently polls channel/speaker state every four seconds; the accepted WebSocket speaker-event transport is not yet implemented. Physical-microphone E2E is not claimed.
- E: superseded by the 2026-07-14 user directive.
- F: legacy GET removal remains implemented; the non-reciprocal query policy is superseded by the 2026-07-14 user directive.

## DP-003 implementation review

- GPT: `APPROVE`; highest priority is completing B before chat, preserving API/database behavior and regression coverage.
- Kimi: `APPROVE`; requested fuller E dissent reasoning/mitigation, a removal target for legacy GET, and identified real general chat as the highest-priority feature slice.
- DeepSeek: `NO_RESPONSE` to the implementation-review request at the time of this record. No response is invented or attributed.

## Provenance

Votes were collected from the authenticated Chrome tabs named for GPT, DeepSeek and Kimi. GPT and Kimi signed their own responses. DeepSeek's initially misattributed responses were excluded; the table uses the later corrected responses explicitly signed `FROM=DEEPSEEK`.
