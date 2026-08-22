# DRIVER.PATAP.EU — COMMERCIAL HARDENING V1

Base production snapshot: `codex/local-workspace-snapshot @ ef0d4da95f6008cc303eba051764f651594049a4`.

This branch is engineering-only until a later Codex Windows gate and explicit deployment step. Production, `main`, Navigation and runtime/private data are not modified by this branch.

## Included audit blocks

### AUD-014 — Dependency security gate
- adds `npm run security:audit` using `npm audit --audit-level=high`;
- `verify:release` must pass the security audit before the rest of the release chain;
- CI executes the same `verify:release` contract.

### AUD-015 — Windows autostart hardening
- replaces Startup-folder copying with a scoped Windows Scheduled Task;
- task points to the exact repository `start-patap-stack.ps1`;
- current interactive user, limited run level, StartWhenAvailable, bounded task restart, IgnoreNew multiple-instance policy;
- installer removes legacy Startup copy; uninstaller removes both task and legacy copy.

### AUD-017 — Continuous health watch
- `watch-patap-health.ps1` polls the existing stack status contract;
- atomic latest JSON state in `var/run/patap-health-watch.json`;
- transition-only bounded logs in `var/logs/patap-health-watch.log`;
- three consecutive unhealthy probes promote state to `ALERT`;
- maintenance flag yields `MAINTENANCE` rather than a false outage;
- watcher observes only and never restarts backend/Caddy/tunnel;
- normal stack startup starts the watcher and reports `HealthWatchRunning`.

## Evidence boundary

GitHub/Linux tests can prove package/release wiring and static Windows script contracts. Actual Task Scheduler registration, hidden watcher process, reboot/logon behavior and live process identity must be checked by Codex on the production-class Windows laptop before these Windows blocks are considered fully deployed.
