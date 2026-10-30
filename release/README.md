# Ether Watch alert retirement release

## Current verified state — 2026-10-30

- Site: appgprj_6acfc8555d7c81918cdf33a9acf1fa6f, https://etherwatch.app; public access preserved.
- Version 33 deployed successfully at 17:00:47 UTC from d9648d5d2ad1ca1b30e29c1eabd2345553577648. It contains the alert-free dashboard and retired endpoints.
- Cloud processing flag false applied in environment revision 12; linked schedule remains disabled.
- Settings migration 0003 applied, preserving revision 1 and all six levels (2320, 2373, 2416, 2554, 2683, 2813 in S3…R3 order). Legacy monitor/push_subscriptions and market_data_cache remain.
- Owner confirmed removal of obsolete push credentials and schedule environment references. The next deployment applies that saved environment revision. Preserve MONITOR_OWNER_ID.
- The owner explicitly accepted hosting-level 404 for /mcp when MCP capability is removed. All retired alert API routes return 410; the Worker fallback also returns 410 for /mcp.
- User authorized managed Sites publication, permanent alert data purge, and temporary source credential use only in memory/hidden stdin. GitHub synchronization remains excluded.

## Packaging correction

The first staged build incorrectly assumed generated dist/.openai/drizzle controlled the final migration bundle. The supported Sites packager copies SOURCE drizzle over it. Thus migration 0003 applied with version 33. No purge was packaged or executed. The migration copy/equality guard passed and original levels were independently read from dashboard_settings.

Do not rewrite applied migration 0003. build-worker.cjs now preserves the source migration chain; release/package-stage-check.cjs invokes the actual Sites packager and inspects the resulting tar journal and SQL bytes. Purge SQL remains only in release/ until the timed gate permits promotion into source drizzle.

## Pending final purge

Gate file (outside source): C:/Users/Jen/Documents/EthereumDash/ether-watch-release-gate-20261030.json

Earliest purge: 2026-10-30 18:15 UTC / 20:15 Asia/Jerusalem, more than one hour after the conservative drain verification time. Recheck the gate, current deployment/provenance, disabled/deleted task, safe settings table, and retired endpoints before proceeding. If new possible sends appear, extend the window.

Run from this checkout, one command at a time:

```text
node release/verify-live.mjs settings
node release/prepare-purge.cjs C:/Users/Jen/Documents/EthereumDash/ether-watch-release-gate-20261030.json
node build-worker.cjs final
node release/package-stage-check.cjs
node --test
node check.cjs
git diff --check
```

prepare-purge refuses before the gate, copies the exact reviewed release/0004_purge_alerts.sql to source drizzle, and appends its source journal entry. It does not itself access production. Inspect the actual final archive for 0004 and the matching journal.

## Managed publication

Use the same managed Site and exact source. Obtain its temporary repository credential using the approved Sites credential tool; never display or persist it. On Windows, prepend C:/Program Files/Git/bin to the child process PATH and set process-local TAR_OPTIONS=--force-local.

```text
node C:/Users/Jen/.codex/plugins/cache/openai-curated-remote/sites/1.1.2/scripts/site-workflow.mjs --project-id appgprj_6acfc8555d7c81918cdf33a9acf1fa6f
```

Launch with a PTY and send documented workflow JSON via hidden stdin: returned credential, source context when available, commands [["node","build-worker.cjs","final"]], and a separate absolute archivePath outside the source checkout. The helper commits/pushes managed source and packages it. Sparse-checkout excludes .openai/hosting.json; any approved future manifest edit needs explicit git add --sparse for that file.

Use the returned commit_sha and archive in Sites save_site_version, then deploy_site_version with its returned version id. Preserve public access/tunnels. Poll get_deployment_status until terminal success. Do not infer success from a saved version.

After deployment: run node release/verify-live.mjs final, use read_database_overview to verify monitor/push_subscriptions are absent, read only dashboard_settings to compare retained levels/revision, and verify market_data_cache remains. Never read/export full monitor or subscription rows. Verify the linked task is deleted and no replacement exists.

## Rollback and devices

Rollback only to an alert-free compatible build. Never restore alert-enabled code, deleted alert data, or old credentials. Existing browser workers clean up on reconnect; notification permission may remain granted. Already accepted pushes cannot be recalled. Send no real test notifications.

## Validation

207 Node tests pass. 17 fixture-browser checks passed at 1440/1024/390/320px; Classic is the only baseline theme. 32 public retirement/settings endpoint checks pass. The actual settings archive matches source migration SQL/journal. Temporary fixture server was stopped. Owner write/conflict tests ran against synthetic storage; signed-out live behavior was verified without changing production levels.
