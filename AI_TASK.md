# AI_TASK — PARKING_NETWORK_V1: CODEX REVIEW

Status: **READY_FOR_REVIEW — NOT DEPLOYED BY CHATGPT**

Candidate:
- branch: `chatgpt/parking-network-v1`
- base: `codex/local-workspace-snapshot @ 53b973221540b80d782426a58ade532eb89ab92e`
- code + tests HEAD before handoff docs: `6e08442b34b2596da7c87929a771b9cfb8fd9c00`

Read in this order:
1. `docs/PARKING_NETWORK_V1_RESEARCH.md`
2. `docs/PARKING_NETWORK_V1_SOURCES.md`
3. `docs/PARKING_NETWORK_V1_HANDOFF.md`
4. current real-workspace `AI_HANDOFF.md` / engineering state

Task:
- review the candidate against the real `D:\WWW.PATAP.EU` and current snapshot;
- do not redesign or expand Parking;
- do not mix Caddy/Chat/Radio/People/final-shell work;
- backup the real SQLite **before the first candidate backend start** because Parking schema is additive and auto-initialized;
- run the complete existing test/build/verify/browser suite plus Parking integration tests and manual Parking smoke from the handoff;
- do not weaken old tests to force PASS;
- if any required check fails, leave production unchanged and report the exact error/reproduction to ChatGPT;
- only after PASS, apply to the real site, restart using the existing runbook, verify backend/patap.eu/driver.patap.eu;
- after code deploy, perform only a controlled OSM Poland dry-run/bootstrap according to the handoff; an upstream Overpass outage is not a reason to roll back otherwise-correct code;
- note that Polish GDDKiA KPD currently publishes the DATEX Parking contract but currently reports no Parking records in KPD, so zero KPD data is not a PaTaP failure;
- sync the actually tested/applied result back to `codex/local-workspace-snapshot` and record exact tests/import result in `AI_HANDOFF.md`;
- do not start the next functional block automatically.

Security/data rules:
- no SQLite backup/runtime DB/photos/GPS/reviews/import payloads/secrets/client certificates in GitHub;
- driver live occupancy must remain GPS-proximity guarded;
- driver-created parking must remain `COMMUNITY_UNVERIFIED` and cannot self-assert EU certification/booking;
- prediction must remain explicitly distinct from live occupancy;
- public Overpass is bootstrap, not permanent production infrastructure.
