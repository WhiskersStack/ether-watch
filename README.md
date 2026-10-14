# Ether Watch

Ethereum dashboard with a dependency-free Sites Worker and a managed D1 monitor table. Editable frontend sources remain in `dist/`; `node build-worker.cjs` embeds them in `dist/server/index.js` for deployment.

- Coinbase Exchange ETH-USD ticker and 24-hour stats poll every 15 seconds. Daily candles refresh every 5 minutes.
- Initial levels: S1 2416, S2 2373, S3 2320; R1 2554, R2 2683, R3 2813 USD. Edit levels, rule mode and cooldown with the settings dialog. Valid saved settings persist in D1 and update all chart/metric consumers. 2510 is a reference, never a fabricated live quote.
- Alerts use strict S1/R1 boundaries with initial notices, persistent deduplication, reentry, and cooldown. Select immediate breach, completed UTC daily close, or a daily retest within +/-0.25% during the next five completed daily candles. Saving a real settings change cancels obsolete pending reports while preserving history. Missing/stale/invalid intervals cannot qualify signals.
- Browser notifications require permission and an open, connected page. Background Codex notifications use a separate heartbeat in this chat; Codex and the local machine must be available. The dashboard shows actual configured cadence, last background check and failures. Brief breaches between checks can be missed.
- RSI uses Wilder smoothing, MACD uses seeded EMA 12/26 and signal 9. Both use completed daily candles. Relative volume compares the most recent completed daily candle against the preceding 20 candles.
- Volume profile estimates volume-at-price by distributing each daily candle's ETH volume uniformly through its high-low range. Profile window follows the chart selection. Flip dots mark completed daily closes crossing reference levels, without retest confirmation.
- Network failures display unavailable/stale state; no mock or generated market prices are used.

## Manual verification

1. Serve the `dist` directory over HTTPS; verify price, daily candles, and timestamps load from Coinbase. Exchange access and browser CORS policy must permit requests.
2. Select 1M/3M/6M, hover candles, and toggle volume profile. Confirm responsive display at desktop and mobile sizes.
3. Edit levels and modes, verify validation, Save/Cancel/Reset, reload persistence, and pause/resume. Initial activation outside the range creates one notice; continuous breaches do not repeat.
4. Disable network access and wait for a refresh. Verify stale/unavailable labeling and retention of prior values. Reconnect and verify recovery.

Run `node check.cjs`, `node --test rules.test.mjs`, and `node --test worker.test.mjs` for indicator, engine and in-memory SQLite API checks. `local-worker-preview.mjs` is a loopback-only development preview with temporary in-memory storage and a test identity; it is never part of the deployed Worker.

See `MONITOR-RUNBOOK.md` for unattended operation. Source publication uses the Sites helper, preserving the same owner-only custom policy. D1 schema is declared in `drizzle/`; handlers never create or alter tables.
