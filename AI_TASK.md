# AI_TASK — AUDIT_INTEGRATION_V1: awaiting owner DR configuration

Status: BLOCKED_DEPLOYMENT — code and release checks are accepted; production is not updated.

Accepted candidate: `chatgpt/audit-integration-v1 @ 66aee30744711206a5f92e032d8e7308b3fe0233`.

Codex actually passed `npm ci` (0 vulnerabilities), Node 24 check, and `verify:release`: auth 47/47, radio 1/1, Driver 14 files / 74/74, client 2/2, config 30/30, two-user Driver E2E and local browser. `PRODUCTION_PREFLIGHT READY` also passed against the existing site.

The only blocker is operational, not code: no external encrypted disaster-recovery destination or key is configured (`PATAP_DR_EXPORT_DIR`, `PATAP_DR_KEY_FILE` / secure passphrase are unset). Deployment must not continue before the owner configures it and Codex gets a successful encrypted export plus restore drill.

No ChatGPT code task now. Do not alter the accepted candidate, start a new feature, touch `main`, Navigation, secrets or runtime data. Read AI_HANDOFF.md for details.
