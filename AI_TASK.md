# AI_TASK — EVENT_CENTER_V1: CODEX REVIEW

Status: **READY_FOR_REVIEW — NOT DEPLOYED BY CHATGPT**

Candidate:
- branch: `chatgpt/event-center-v1`
- base: `codex/local-workspace-snapshot @ 60e939aa8c9d72ecf78d39d6c5c371b8c8cd8d96`
- code/tests/research HEAD before handoff docs: `2455b5e95cdef7c5700e7d586780c7ad19998ab7`

Read in this order:
1. `docs/EVENT_CENTER_V1_RESEARCH.md`
2. `docs/EVENT_CENTER_V1_HANDOFF.md`
3. current real-workspace `AI_HANDOFF.md`
4. current engineering state/runbook

Task:
- review the candidate against the real `D:\WWW.PATAP.EU` and current authoritative snapshot;
- do not redesign or expand Event Center;
- do not start Navigation, Voice or another large block;
- backup the real SQLite **before the first candidate backend start** because Event schema/outbox triggers are additive and auto-initialized;
- run the complete existing regression suite plus Event Center tests exactly as specified in the handoff;
- preserve the verified six-button 390px bottom navigation: Event Center is a global no-view bell/drawer, not a seventh nav button;
- do not weaken old tests to obtain PASS;
- if any required automated check fails, production remains unchanged and the exact failure/reproduction returns to ChatGPT;
- only after automated PASS, apply/restart using the existing runbook and verify local/public health;
- perform Event Center two-account smoke;
- perform **real-device Web Push smoke separately** before claiming Web Push verified. Automated VAPID tests are not enough to claim cross-browser delivery;
- sync only the actually tested/applied state back to `codex/local-workspace-snapshot` and record exact test counts/manual results in `AI_HANDOFF.md`;
- do not start the next functional block automatically.

Security/privacy rules:
- no SQLite/backup/WAL/SHM, users, GPS, messages, Event data, PushSubscription endpoints/keys, media, logs, tokens or passwords in GitHub;
- `DATA_DIR/events/vapid.json` is private runtime data and must never be committed;
- do not broaden Web Push to arbitrary HTTPS endpoints. Default allowed push hosts are FCM/Mozilla/Apple; any extra legitimate host must be reviewed and configured locally through `PATAP_WEB_PUSH_HOSTS`;
- Web Push is wake-only: no Chat/Parking/Road event text is sent as the push payload;
- Push permission must remain explicit user opt-in;
- Driving Mode/quiet hours suppress interruption, not durable inbox history;
- global auth migration remains 12;
- minimum password length remains 6;
- do not modify `main`.
