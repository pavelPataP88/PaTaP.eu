# AI task — Parking Network V1: mobile Driver navigation fix

Read the newest top entry in `AI_HANDOFF.md`.

Parking is blocked only by a real phone-layout regression: it adds a sixth visible Driver navigation button, but mobile CSS still reserves five columns. The sixth button wraps and makes the bottom menu too high.

Create one minimal fix branch from the current `codex/local-workspace-snapshot`:

1. In `driver/styles.css`, make the mobile bottom navigation display all **6** buttons in one bar at 390px wide. Preserve readable labels, keyboard accessibility, no horizontal overflow, and the existing maximum menu height of 56px.
2. In `tests/browser/client-storage.test.js`, update the expected visible Driver navigation button count from 5 to 6. Keep, do not weaken, the checks for height, no overflow and fixed positioning.
3. Add only a focused regression assertion if genuinely necessary.

Do not change Parking backend/schema/import, auth, Caddy, runtime data or any other feature. Add a short top handoff record with the branch and code commit, then stop for Codex verification.
