# Ether Watch backend and accuracy release

The public version 13 baseline already uses the dependency-free Sites Worker and managed D1 database. The original static-to-Worker migration was deployed; it is not awaiting architecture approval. The dashboard remains public at https://etherwatch.app and https://ether-watch-jen.aquarose3.chatgpt.site/.

## Existing behavior

- The Worker serves the dashboard, public market/news/calendar reads, and protected APIs for saved settings, shared alert state, checks and pending notifications.
- D1 stores the six price levels, rule configuration, pause state, evaluation cursors, alert history and background-check status. Optimistic updates prevent overlapping checks from saving duplicate monitor state.
- Shared writes require the configured Site-scoped owner ID or, for checks/acknowledgements only, a restricted service credential. The platform dispatch bearer alone does not authorize public Worker writes. No new recipient or third-party notification account is added.
- The Codex heartbeat remains paused and Site background checking remains disabled. A software release does not authorize activation. See `MONITOR-RUNBOOK.md` for manual owner/service provisioning and the limits of notification verification.

## Accuracy release · 19 October 2026

- `/api/volume` retains its response fields and uses only CoinMarketCap, Ethereum ID `1027`, USD conversion. This release explicitly enables the official keyless `https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/quotes/latest?id=1027&convert=USD` endpoint with nonsecret runtime setting `CMC_USE_PUBLIC_API=true`; local preview enables that mode explicitly too. No key, account or paid subscription is required. It reports rolling aggregate spot volume, with distinct provider-update and retrieval times; matching TradingView is not a requirement.
- An optional future `CMC_API_KEY` selects the keyed `/v3/cryptocurrency/quotes/latest` endpoint before public mode when securely configured. No key setup is required for this release. No manual secret-entry screen has been verified, and no secret belongs in source or browser responses. TradingView, CoinGecko and CoinPaprika are no longer fallback providers. Deploy a saved version after changing runtime configuration to apply its environment revision.
- An additive migration creates a separate volume-cache table in the existing D1 binding. Monitor records are untouched. Both public domains share the cache and refresh lock: one upstream attempt per five minutes, a 15-minute failure cooldown honoring longer `Retry-After` values, and stale data retained for at most one hour with its original timestamps.
- The 24-hour-change card tracks ticker and opening-price stats independently. Either failure or a 45-second age marks the percentage stale; both inputs must recover to clear it.
- CPI keeps the BLS fallbacks and adds the official St. Louis Fed/FRED calendar only when BLS retrieval fails. FRED-backed entries show their provenance and the direct BLS failure. Only explicit release dates/times are accepted, using `America/Chicago` for FRED and `America/New_York` for BLS.
- No new dependencies or framework changes are needed. Build and package the exact verified managed source through Sites, preserving public access and disabled monitoring.

## Release verification

Run the complete eleven-file test command in `README.md`, `node check.cjs`, and the Worker build. Validate desktop/mobile rendering, Refresh, source links, console health, failure/recovery behavior, and shared-domain cache limits. Verify CoinMarketCap and CPI retrieval from the hosted Worker before declaring either operational. The prior version 13 result was 207 tests; record this release's actual results separately.

Production owner/service flows, actual notification delivery and physical-device touch testing remain unverified. GitHub synchronization is deferred. The new release number is assigned only after successful Sites publication.
