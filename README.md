# Ether Watch

**Ethereum market intelligence, minus the noise.**

Ether Watch is a responsive ETH/USD dashboard that combines live market data, interactive technical analysis, editable support and resistance levels, relevant news, and an official-events calendar in one focused workspace.

**Status:** Actively in development. Features and data-source availability may change.

[Live application](https://etherwatch.app) · [Source code](https://github.com/WhiskersStack/ether-watch)

> **Current product:** Quantum Terminal Blue Glass, with Classic as the only theme. The dashboard is public; saving shared chart levels requires the configured signed-in owner. Cloud monitoring, alert rules, push subscriptions, and notification delivery are retired. See [release/README.md](release/README.md) for dated deployment and migration evidence.

## What it does

### Live Ethereum overview

- Displays the Coinbase Exchange **ETH-USD** spot ticker and 24-hour change.
- Shows **Ethereum spot trading volume across tracked exchanges, rolling 24 hours, in USD**, using CoinMarketCap as the single provider. The provider-update time and retrieval time are shown separately. The value is not expected to match TradingView exactly and is not calculated from Coinbase's pair volume.
- Refreshes aggregate volume at most once every five minutes across both public domains, using a shared D1 cache and refresh lock. A failed upstream attempt starts a 15-minute cooldown, or longer when required by `Retry-After`; manual Refresh respects this limit. The last successful value is visibly stale during failure and expires within one hour, retaining its original timestamps.
- Refreshes the ticker and overview in the browser, with distinct timestamps for chart and daily-indicator data.
- Marks the 24-hour percentage change stale if either the current ticker or opening-price stats fail or become 45 seconds old. Both inputs must recover before the warning clears.
- Shows the current price relative to editable support and resistance levels.
- Preserves the last successful data during a feed interruption while clearly marking stale or unavailable values. It does **not** substitute simulated prices.

### Interactive technical analysis

- Switch between **15-minute, 1-hour, and 1-day** candles.
- Choose candlesticks or a closing-price line, 30/90/180 visible bars, linear/logarithmic scale, and different chart-fitting modes.
- Zoom, pan, reset, and expand the chart for closer inspection.
- Toggle **EMA 20/50**, **RSI 14**, **MACD 12/26/9**, volume, and price-level overlays.
- Explore completed-daily-candle crossing markers and an **estimated volume profile** with a point of control.
- Overlay eligible news headlines at their publication times on candles when chart history is available.

The volume profile is an estimate derived from candle high/low ranges and volume, **not** exchange trade-by-trade volume-at-price data. The overview's momentum and relative-volume indicators use completed daily candles, independently of the selected chart interval.

### Saved support and resistance levels

The dashboard displays six ordered levels (**S3 < S2 < S1 < R1 < R2 < R3**) from `/api/settings`. The signed-in owner can edit positive USD amounts with up to two decimal places. Saves use the current revision to reject conflicting changes; Reset defaults only fills the editor and requires an explicit Save.

Initial loading shows placeholders. If settings cannot be verified, editing and level-based chart overlays/position calculations are disabled. Previously verified values remain visible with a stale or rechecking label during temporary failures. Refresh or returning to the page retries retrieval; a valid response restores normal display. Fallback defaults are never silently saved.

Shared levels and their revision live in **D1 `dashboard_settings`**. Chart preferences and the calendar timezone remain in browser local storage. Levels are shared dashboard configuration, not per-visitor settings.

### News and market catalysts

- Reads relevant headlines from the **Ethereum Foundation**, **CoinDesk**, **Decrypt**, and the **Federal Reserve**.
- Filters by source, topic, or headline search; links to the original publisher rather than reproducing full articles.
- Presents publication times, source health, and clearly identified cached results during temporary feed failures.
- Displays upcoming macroeconomic and Ethereum events from official **BLS**, **BEA**, **Federal Reserve**, and **Ethereum** sources. When direct BLS retrieval fails, CPI scheduling can use the official **St. Louis Fed/FRED** calendar, with FRED provenance and a BLS failure warning. Only explicitly published release dates and times are used; missing CPI dates are never inferred.
- Calendar display supports device time, UTC, Jerusalem (default), London, New York, Chicago, Los Angeles, Dubai, India (Kolkata), Singapore, Hong Kong, Tokyo and Sydney. The browser remembers the selection, and city timezones follow daylight-saving rules. Date-only meetings and unconfirmed roadmap targets retain their original precision.

News categorization and chart markers provide context; they do **not** establish that a headline caused a price movement.

## Technology

| Layer | Implementation |
| --- | --- |
| Frontend | HTML5, CSS3, vanilla JavaScript (ES modules), Canvas |
| Market data | Coinbase Exchange REST endpoints; CoinMarketCap v3 aggregate ETH spot volume |
| Backend | Dependency-free JavaScript Sites Worker |
| Persistence | Managed D1 shared dashboard settings and volume cache; browser-local chart/timezone preferences |
| Cloud alerts | Retired; no monitoring, push subscriptions, or notification delivery |
| News / calendar | RSS/Atom feeds and official publisher or agency pages |
| Build and tests | Node.js built-ins and Node's test runner |

There is **no npm dependency installation** or frontend framework required.

## Run locally

**Requirements:** A modern Node.js version with built-in `node:sqlite` support for the tests. No application dependency installation is required.

From an existing checkout, start the offline fixture preview:

```bash
node fixture-preview.mjs
```

Open **http://127.0.0.1:4175**. This temporary loopback server uses synthetic market, news, calendar, and settings data; it never imports the production Worker or opens D1. Fixture settings are held in memory and reset when the process exits. `local-worker-preview.mjs` is an alias for the same fixture server. Viewer mode is `?viewer=true`; `?scenario=loading`, `empty`, `stale`, and `failure` exercise feed states. This is not a production authentication system. Stop the server after QA.

### Configure aggregate volume

The Worker supports the official keyless API when the nonsecret runtime setting **`CMC_USE_PUBLIC_API=true`** is configured. Current production runtime values require separate verification. It requires no CoinMarketCap key, account or paid subscription. The Worker requests `https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/quotes/latest?id=1027&convert=USD`, then validates the Ethereum identity, positive USD `volume_24h`, and provider timestamp. CoinMarketCap remains the single provider; no alternate provider is used during failure.

**`CMC_API_KEY`** is an optional future upgrade to CoinMarketCap's keyed `/v3/cryptocurrency/quotes/latest` endpoint with the same Ethereum ID `1027` and USD conversion. A configured key selects keyed mode before public mode. Any future key must be provisioned through Sites runtime settings as a secret. Do not paste it into chat or put it in source, browser assets, terminal arguments, logs, documentation or Git. Keyed mode is optional. Deploy a saved version after changing runtime configuration to apply its environment revision.

If the selected mode cannot supply a verified response, the card retains a visibly stale successful snapshot only while it is valid, then shows unavailable. Verify public-mode retrieval from the hosted Worker before declaring the source operational.

### Build the deployment bundle

```bash
node build-worker.cjs
```

This embeds the editable frontend sources and Worker modules into `dist/server/index.js`, alongside a generated hosting manifest. The generated output is ignored by Git. **Building does not deploy or publish** the application; hosting requires the appropriate managed Sites/D1 configuration and access policy.

### Run checks and tests

```bash
node build-worker.cjs
node --test
node check.cjs
git diff --check
```

Build first so package tests compare the generated Worker with current sources. These checks run locally; they do not deploy or apply production migrations. Tests cover settings failures/recovery, owner authorization, revision conflicts, chart calculations, market freshness, news/calendar parsing, and retired endpoint behavior using controlled fixtures.

With the fixture server running, the existing browser runner checks desktop/mobile layout and interactions:

```bash
node dashboard-browser-qa.mjs <absolute-evidence-directory-outside-repository>
```

The runner uses the existing local Playwright runtime and Chrome paths declared in the script. It blocks external requests and writes screenshots/results only to the supplied directory. Historical counts in [release/QA.md](release/QA.md) are dated evidence, not a claim about a new candidate.

## Repository structure

```text
dist/                  Editable HTML, CSS, vanilla JS, Canvas charts and brand assets
  settings.mjs         Six-level validation and explicit editor reset defaults
  app.js               Dashboard state, views and API calls
  chart.mjs            Canvas rendering and technical indicators
  market-data.mjs      Coinbase candles and caching
  calendar-ui.mjs      Official-events calendar UI
  retire-notifications.mjs  Cleanup of legacy browser notification registrations
  notification-worker.js   Legacy worker cleanup only; no push delivery
worker/
  index.js             Public read routes, owner-only level saves, retired routes
  news.js              News ingestion and caching
  calendar.js          Official-event ingestion
  volume.js            CoinMarketCap aggregate ETH volume and shared D1 cache
drizzle/               Applied/source migration chain through settings migration 0003
release/               Dated release evidence and separately gated purge proposal
.openai/hosting.json    Managed hosting manifest
build-worker.cjs       Dependency-free local bundle builder
fixture-preview.mjs    Offline synthetic preview
*.test.mjs / *.test.cjs Automated tests
MONITOR-RUNBOOK.md      Historical monitoring record; not current operations
UPGRADE-INSTRUCTIONS.md Current stabilization guidance and historical roadmap
```

## Access, storage, and retired functionality

`GET /api/settings` reads shared saved levels without changing storage. Writes require the platform-provided authenticated identity to match the configured owner and use a revision-checked update. The retained `MONITOR_OWNER_ID` configuration name also protects current level editing; it does not enable monitoring. No authentication or owner-policy changes are part of stabilization.

News and calendar requests may refresh provider caches. Aggregate volume uses managed D1 cache/lock writes even on GET, so these endpoints are not suitable for strictly read-only production audits.

Retired alert API routes return 410. With the MCP capability removed, hosting may return 404 for `/mcp` before the Worker fallback returns 410. Existing browser notification registrations are cleaned up on reconnect without requesting permission or sending notifications.

Alert retirement and permanent deletion of old stored data are separate milestones. This checkout journals migrations through `0003_dashboard_settings`; `0004_purge_alerts.sql` remains outside that journal under `release/`. Its presence does not prove execution. The October 31 read-only audit verified deployed Sites version 34 and found both legacy alert tables still present. Permanent purge remains incomplete; execution of 0004 is not verified. See the dated release record before claiming deletion. Historical schedule activation and credential-provisioning instructions are not current operational guidance.

## Release review

Preserve the approved Blue Glass layout, single Classic theme, Canvas charts, saved preferences, public access, and owner-only level editing. Compare deployed asset content and authoritative Sites provenance with the GitHub candidate; separate commit identifiers can represent separate source histories. Publishing, migrations, remote pushes, production changes, and notification delivery require separate explicit authorization.

---

Built by [WhiskersStack](https://github.com/WhiskersStack). Educational market analysis only; **not financial advice or a trading service**.
