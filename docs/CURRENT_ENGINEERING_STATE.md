# CURRENT ENGINEERING STATE

## Source of truth

Engineering source remains GitHub branch `codex/local-workspace-snapshot`; Windows laptop remains production runtime.

## Audit candidate checkpoint — 2026-08-22

The single conflict-resolved candidate for Codex review is:

- branch: `chatgpt/audit-integration-v1`
- pull request: `#19`
- candidate head: `9cc65f3ff9edeec09f0357183e6c6b9f98939bd2`
- base: `codex/local-workspace-snapshot @ 2ccf14c1ac6f58829d3222988ccd74457f5c8bef`
- GitHub Actions Verify run: `32563551739`
- verified PR merge ref: `fb5f4c06cd0f95278de0d3fc4396db70c6afe9fc`
- status: `READY_FOR_CODEX_WINDOWS_REVIEW — NOT MERGED / NOT DEPLOYED`

Final combined CI evidence on Node 24.19.0:

- `npm ci`: 45 packages installed / 46 audited / 0 vulnerabilities
- auth: 47/47 PASS
- radio-live: 1/1 PASS
- Driver module discovery: 14 files
- Driver modules: 74/74 PASS
- client: 2/2 PASS
- config/release/runtime/Windows guards: 30/30 PASS
- deterministic two-user Driver E2E: PASS
- isolated local browser scenarios: PASS
- public-smoke: SUCCESS

The current checkpoint adds to the prior integrated candidate:

- original AUD-009 Event Outbox dead-letter lifecycle, Owner diagnostics/retry, and SQLite-lock resilience;
- original AUD-010 deterministic two-driver browser E2E gate;
- original AUD-016 Windows stack process detection bound to exact Caddy config / cloudflared token file;
- original AUD-018 encrypted off-host DR package and immediate SQLite restore drill.

## Windows evidence boundary

GitHub CI cannot prove actual Windows process/service control or a real second-device/network-share DR destination. Codex must verify those on the laptop before any production apply.

Before any live backend stop/restart/apply:

1. Run `npm run production:preflight` while the existing backend is still running.
2. Require `PRODUCTION_PREFLIGHT READY`.
3. If active legacy in-memory Road Reports are reported, do not restart until they expire / the preflight clears.
4. Preserve the generated verified DB backup and current VAPID material/fingerprint.
5. Configure a real off-host DR target through `PATAP_DR_EXPORT_DIR` and secret material through `PATAP_DR_KEY_FILE` (preferred) or `PATAP_DR_PASSPHRASE`; never commit or print the secret.
6. Run `npm run auth:backup:dr` and require `restoreDrill: PASS`.
7. Exercise maintenance entry/resume and exact PaTaP process targeting on Windows before production use.

No production action has been performed by ChatGPT. `main` must not be changed without an explicit owner decision.
