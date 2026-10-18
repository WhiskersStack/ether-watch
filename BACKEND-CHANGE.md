# Proposed backend addition

The prepared upgrade retains the existing frontend and adds one dependency-free Sites Worker plus one platform-managed D1 table.

- The Worker serves the existing dashboard and authenticated APIs for saved settings, shared alert state, checks and pending notifications.
- D1 stores the six price levels, breakout mode, pause state, evaluation cursors, alert history, and background-check status. Optimistic updates prevent overlapping checks from saving duplicate state.
- The Site ID and URLs stay the same. The dashboard is now public; shared writes require the configured Site-scoped owner ID or a separate restricted service credential. The platform dispatch bearer alone does not authorize public Worker writes. No external recipient or third-party notification account is added.
- The existing Codex heartbeat stays paused and Site background checking stays disabled. A future, explicitly approved resume needs manual runtime provisioning and an authorized secure credential channel documented in `MONITOR-RUNBOOK.md`. Service checks and acknowledgements use hidden input and cannot edit configuration or enable monitoring. Codex and the local machine must be available for these checks.
- The server/database migration is prepared locally. Applying it changes hosting from static-only to a Worker and provisions D1; the user's global AGENTS instructions require approval before this architecture change is enabled.
- No dependency installation is needed. Generated server output is ignored in Git and packaged from the exact verified source.

Validation before approval: JavaScript syntax, indicator calculations, alert-engine tests, SQLite-backed API tests, and targeted diff review. After approval: build/package validation, private deployment, authorized Site read/write/check/readback, browser settings checks, and saved heartbeat cadence verification.
