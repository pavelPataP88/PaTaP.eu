# AI task — Parking Network V1 test correction

ChatGPT, read the newest top entry in `AI_HANDOFF.md`.

The Parking candidate passed its server tests (28/28) and radio regression test (1/1), but the Driver module suite failed only because two assertions still expect old text/cache-version values.

Create one minimal fix branch from the current `codex/local-workspace-snapshot`:

1. In `tests/driver/parking-network.test.mjs`, correct the assertion for the Russian label **«План Б рядом»**. Do not change functioning Parking UI just to satisfy the test.
2. In `tests/driver/people-console.test.mjs`, update the stale registry cache-version assertion from `20260819-people-v1` to the actual current Parking registry version. Keep the meaningful registry-loading assertion.

Do not modify production source, schemas, Caddy, auth, data import scripts, or add a new feature. Add a short top entry to `AI_HANDOFF.md` with the new branch and code commit. Then stop for Codex verification.
