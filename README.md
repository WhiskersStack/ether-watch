# Ether Watch

**Ethereum market intelligence, minus the noise.**

Ether Watch is a responsive ETH/USD dashboard that combines live market data, interactive technical analysis, configurable support and resistance alerts, relevant news, and an official-events calendar in one focused workspace.

**Status:** Actively in development. Features and data-source availability may change.

[Live application](https://etherwatch.app) · [Source code](https://github.com/WhiskersStack/ether-watch)

> The dashboard is public. Monitor writes require the configured signed-in owner or a restricted application service credential. See `MONITOR-RUNBOOK.md` for manual runtime provisioning; writes fail closed without it. The existing scheduled monitor remains paused.

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

### Customizable price-level alerts

Configure six ordered support/resistance levels (**S1–S3** and **R1–R3**) and select which levels to monitor.

| Rule | Trigger |
| --- | --- |
| Immediate breach | A fresh price moves strictly beyond a selected level. |
| Daily close | A completed UTC daily candle closes across a selected level. |
| Daily retest | A qualifying daily breakout is followed by a confirmed retest within the configured candle window. |

Additional controls include:

- Editable cooldowns and reentry-based deduplication.
- Optional proximity warnings before a level is breached.
- Optional relative-volume confirmation for completed-candle rules.
- Pause/resume controls, settings validation, and persisted rule revisions.
- Filterable alert history and a separate log of evaluation decisions, including available evidence and delivery state.

Saved alert rules and monitoring state live in **D1**. Chart appearance preferences remain in the browser's local storage.

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
| Persistence | Managed D1 database, monitor record with optimistic updates and a separate shared volume-cache table |
| News / calendar | RSS/Atom feeds and official publisher or agency pages |
| Build and tests | Node.js built-ins and Node's test runner |

There is **no npm dependency installation** or frontend framework required.

## Run locally

**Requirements:** Git and a modern Node.js version with built-in `node:sqlite` support (Node.js 22.13+ recommended). Network access is needed to retrieve live market feeds and source updates.

1. Clone the repository:

   ```bash
   git clone https://github.com/WhiskersStack/ether-watch.git
   cd ether-watch
   ```

2. Start the full Worker preview:

   ```bash
   node local-worker-preview.mjs
   ```

3. Open **http://127.0.0.1:4174**.

The local preview listens only on loopback, uses a **temporary in-memory SQLite database**, supplies a **development-only test identity**, and explicitly enables the CoinMarketCap public API mode described below. Settings and history reset when the process exits. It is not a production authentication system or a public deployment target.

### Configure aggregate volume

This release explicitly enables the official keyless API with the nonsecret runtime setting **`CMC_USE_PUBLIC_API=true`**. It requires no CoinMarketCap key, account or paid subscription. The Worker requests `https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/quotes/latest?id=1027&convert=USD`, then validates the Ethereum identity, positive USD `volume_24h`, and provider timestamp. CoinMarketCap remains the single provider; no alternate provider is used during failure.

**`CMC_API_KEY`** is an optional future upgrade to CoinMarketCap's keyed `/v3/cryptocurrency/quotes/latest` endpoint with the same Ethereum ID `1027` and USD conversion. A configured key selects keyed mode before public mode. Any future key must be provisioned through a supported secure Sites runtime-configuration path; no manual secret-entry screen has been verified. Do not paste it into chat or put it in source, browser assets, terminal arguments, logs, documentation or Git. No key setup is required now. Deploy a saved version after changing runtime configuration to apply its environment revision.

If the selected mode cannot supply a verified response, the card retains a visibly stale successful snapshot only while it is valid, then shows unavailable. Verify public-mode retrieval from the hosted Worker before declaring the source operational.

### Build the deployment bundle

```bash
node build-worker.cjs
```

This embeds the editable frontend sources and Worker modules into `dist/server/index.js`, alongside a generated hosting manifest. The generated output is ignored by Git. **Building does not deploy or publish** the application; hosting requires the appropriate managed Sites/D1 configuration and access policy.

### Run checks and tests

```bash
node check.cjs
node --test chart.test.mjs news.test.mjs market-data.test.mjs calendar.test.mjs calendar-ui.test.mjs rules.test.mjs worker.test.mjs ui-state.test.cjs data-accuracy.test.cjs background-helper.test.cjs volume.test.mjs notifications.test.mjs
```

Tests cover chart calculations, market-data validation and freshness, volume parsing/cache behavior, news/calendar parsing and provenance, alert evaluation, Worker endpoints, background-helper restrictions, and UI state. They use controlled fixtures rather than modifying production settings. The version 13 baseline passed 207 tests; this is a historical result, not the test count for a later release.

## Repository structure

```text
dist/
  index.html           Dashboard markup
  style.css            Responsive styling
  app.js               Frontend state, views, and API calls
  chart.mjs            Chart drawing and technical indicators
  market-data.mjs      Coinbase candle retrieval and caching
  rules.mjs            Alert configuration and evaluation
  calendar-ui.mjs      Events calendar UI

worker/
  index.js             Authenticated application routes and D1 state
  news.js              News ingestion, validation, and caching
  calendar.js          Official-event ingestion and validation
  volume.js            CoinMarketCap aggregate ETH volume and shared caching

drizzle/0000_monitor.sql  Database schema
drizzle/                 Additive migrations, including separate volume cache
.openai/hosting.json    Managed hosting manifest
build-worker.cjs        Dependency-free production bundle builder
local-worker-preview.mjs Local Worker + in-memory database preview
*.test.mjs / *.test.cjs Automated tests
MONITOR-RUNBOOK.md      Operational monitoring guidance
UPGRADE-INSTRUCTIONS.md Upgrade and release history
```

## Monitoring and notification limitations

**Unattended monitoring is not currently active.** The scheduled Codex checker is **paused**, and Site background checking is **disabled**. These settings should not be enabled as a side effect of deploying code or changing the README.

- Browser notifications require browser permission and an **open, connected page**. Android delivery uses an active notification service worker; desktop browsers without service-worker support retain the page API fallback. The service worker does not poll, cache pages, subscribe to push, or enable monitoring.
- **Test notification** is a local device check available before owner setup. It requests permission only when tapped, sends a clearly labeled test, and makes no monitor API calls or history entries. Browser acceptance must still be confirmed in the physical device notification shade.
- Closed-page notifications require a separate, explicitly authorized and functioning monitor; the Worker/D1 code alone does not schedule one.
- Polling may miss a brief crossing that occurs between samples.
- An event marked as acknowledged/reported is not proof that a device notification was delivered or read.
- Market, news, and calendar sources may fail or temporarily become unavailable; the UI surfaces those conditions.
- Production owner/service provisioning, authorized monitor flows, and actual device-notification delivery remain unverified. Physical-device touch testing is also outstanding; desktop/mobile browser checks do not replace it.

See [MONITOR-RUNBOOK.md](MONITOR-RUNBOOK.md) for operational details.

## Project direction

Ether Watch remains a work in progress. The current accuracy release builds on the public version 13 baseline. Verify CoinMarketCap and CPI retrieval from the hosted Worker before declaring those sources operational. Owner/service provisioning, successful authorized production flows, Codex notification delivery and physical-device confirmation remain open. GitHub synchronization is handled by the owner. Keep monitor writes restricted and monitoring activation explicit.

---

Built by [WhiskersStack](https://github.com/WhiskersStack). Educational market analysis only; **not financial advice or a trading service**.
