# Ether Watch

Buildless Ethereum dashboard. Serve `dist/` through HTTPS/static hosting.

- Coinbase Exchange ETH-USD ticker and 24-hour stats poll every 15 seconds. Daily candles refresh every 5 minutes.
- Fixed user levels: S1 2416, S2 2373, S3 2320; R1 2554, R2 2683, R3 2813 USD. 2510 is a user reference, never a fabricated live quote.
- Alerts fire strictly below S1 or above R1 on entering a breach zone, including initial connection. Reentry into the zone rearms the alert. History and pause settings persist locally when browser storage is available.
- Browser notifications require permission and an open, connected page. No background or email notification service is included.
- RSI uses Wilder smoothing, MACD uses seeded EMA 12/26 and signal 9. Both use completed daily candles. Relative volume compares the most recent completed daily candle against the preceding 20 candles.
- Volume profile estimates volume-at-price by distributing each daily candle's ETH volume uniformly through its high-low range. Profile window follows the chart selection. Flip dots mark completed daily closes crossing reference levels, without retest confirmation.
- Network failures display unavailable/stale state; no mock or generated market prices are used.

## Manual verification

1. Serve the `dist` directory over HTTPS; verify price, daily candles, and timestamps load from Coinbase. Exchange access and browser CORS policy must permit requests.
2. Select 1M/3M/6M, hover candles, and toggle volume profile. Confirm responsive display at desktop and mobile sizes.
3. Pause/resume alerts and enable browser notifications. Initial connection outside the immediate range creates one event, repeated quotes in the same breach zone do not.
4. Disable network access and wait for a refresh. Verify stale/unavailable labeling and retention of prior values. Reconnect and verify recovery.

No dependencies or build step. Network integration and rendered browser QA need to be verified before claiming the site is live.
