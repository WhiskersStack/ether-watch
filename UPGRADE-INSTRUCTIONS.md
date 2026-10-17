# Ether Watch upgrade instructions

## Current roadmap · 2026-10-17

The user authorized all six follow-up upgrades in four stages: status/news clarity; expanded chart/fit/indicator/touch controls; news markers/official calendar; selected-level/proximity/daily-volume alerts and evidence history. Use the existing dependency-free Worker/D1 architecture and free public sources. The README documents current behavior and test commands; earlier sections below record the original October 14 architecture brief.

Stages 2-4 were published separately on 2026-10-17 as saved versions 5, 6, and 7; production is version 7. The user accepted publication with physical touch unverified. Desktop/mobile viewport checks do not establish physical touch behavior. Sole-owner access, the Codex automation PAUSED, and disabled Site background checking were verified after every release. Do not add another automation or enable schedule controls. Test notification behavior with in-memory fixtures, not live settings changes.

### Verification update · 2026-10-17

- The latest local candidate has desktop 1280x900 and mobile viewport 390x844 checks covering chart/modal/focus behavior, indicator panes and option persistence, literal/topic/source filtering and pagination, the news daily-chart fallback, calendar UTC/Asia-Jerusalem display, selected-level/proximity/volume option persistence, and local-only breach-history evidence. These checks do not establish physical touch behavior; the user accepted that limitation for publication on 2026-10-17.
- Saved Stage 2 was also opened separately: its expanded chart rendered both indicator panes, closed with Escape and restored focus, and fit the 390px viewport. Saved Stage 3 rendered grouped publication markers; selecting a grouped headline closed the expanded chart and focused its accessible news card. Its calendar displayed official date-only and exact-time entries, plus undated roadmap cards, at desktop and mobile widths.
- An archived Stage 3 check found key-level prices clipped on narrow screens. Current `dist/style.css` uses a single-column `#level-list` below 480px. After rebuilding, the 390px visual check confirmed all six prices and distances remain inside the panel. This fix remains local and is absent from deployed saved versions 5-7.
- Refreshed source snapshots passed 65/65 Stage 2 tests, 103/103 Stage 3 tests, and 138/138 Stage 4 tests. Each stage passed `check.cjs`, application syntax checks, and the Worker rebuild. Their JavaScript matches the saved versions; their extra phone CSS fix remains local. Physical touch remains unverified under the accepted release exception.
- Fresh authenticated live Site review showed Scheduled checks paused; the application maps this label to `!background.enabled`. The Codex automation file remains `PAUSED`. Sites metadata confirmed sole-owner access with no editors/groups/external visitors and zero cloud schedules. No live settings or schedules were changed.
- Even after explicit approval for the official helper's hidden credential input, automatic approval review rejected the token in the internal `write_stdin` payload. Do not retry through disguised or indirect credential transport. No source push completed. The safe supported alternative was direct private deployment of the existing matching saved versions and archives. The additional phone CSS fix and current documentation remain local pending a permitted source-authentication path.
- Final live checks confirmed chart expansion, news-to-chart selection, new alert controls/history, preserved revision 1 S1/R1 immediate settings, proximity/volume off, and no browser console warnings/errors. Calendar health showed BLS unavailable and BEA/Federal Reserve/Ethereum verified. No live alert settings or schedules were changed.

### Deployment record · 2026-10-17

| Stage | Saved version | Deployment | Result |
| --- | --- | --- | --- |
| 2 | 5 · `appgprj_6acfc8555d7c81918cdf33a9acf1fa6f~appgver_678d8804218c81918f76892a416c0d96` | `appgdep_6ad351b7f514819193790c7ba7e8a93f` | Succeeded |
| 3 | 6 · `appgprj_6acfc8555d7c81918cdf33a9acf1fa6f~appgver_7a57b2e6e2048191b5c367e77493f51c` | `appgdep_6ad351ee992c81918a143ab09d5edc31` | Succeeded |
| 4 | 7 · `appgprj_6acfc8555d7c81918cdf33a9acf1fa6f~appgver_d1241a52cde881919e0e73b7ee368981` | `appgdep_6ad3522abe94819190be1e714eb194a2` | Succeeded |

Current production source: `21e2cbf78aa29b8a27abfbf98638eb5d902d81e3`. Rollback version 4 was freshly confirmed with its archive: `appgprj_6acfc8555d7c81918cdf33a9acf1fa6f~appgver_70c51238885c81919c4a6627b5c36098`. Preserve primary checkout changes; isolated Stage 2 copies were preparation only and must not overwrite the latest source.

Prepared: 2026-10-14 (Asia/Jerusalem)
Status: Feature rollout published as versions 5-7 with verified paused monitoring and sole-owner access. Physical touch remains unverified under the accepted exception; the additional phone CSS fix remains unpublished because source authentication was blocked.

## Objective and scope

Upgrade the existing private Ether Watch site with the three features accepted in chat:

1. Alerts delivered while the website is closed.
2. Editable support/resistance levels and saved settings.
3. Selectable breakout confirmation: immediate breach, completed daily close, or completed daily retest.

Keep the existing daily chart, RSI, MACD, relative volume, estimated volume profile, and Coinbase ETH-USD feed. Do not add unrelated assets, portfolio features, trading actions, or a new design system. Fix labels/layout only where the new controls require it.

Site ID: `appgprj_6acfc8555d7c81918cdf33a9acf1fa6f`

Published URL: https://ether-watch-jen.aquarose3.chatgpt.site/

## Verified starting point

- Current implementation is dependency-free HTML/CSS/JavaScript in `dist/`, declared by `.openai/hosting.json`.
- Price polling runs every 15 seconds in an open browser; daily candles refresh every 5 minutes.
- Six price levels are hard-coded in `dist/app.js`. Several chart, range, structure-note, and alert functions repeat those values directly.
- Current alert history and pause state are browser-local. The alert zone resets on reload, and there is no unattended worker or persistent server-side alert state.
- Existing daily analysis uses completed UTC candles. The volume profile estimates volume-at-price from candle ranges; preserve that label.
- Syntax and offline indicator/alert checks were previously reported as passing during initial deployment; they were not rerun for this instructions review and are not proof of the new features.
- Live Sites metadata was checked for this preparation step: current user is the owner, access mode is `custom`, the sole allowed user's role is `owner`, editors/groups are empty, and `automations` is an empty array. Service access is available. Preserve this exact policy. This confirms capability discovery and duplicate-schedule checking only; it does not verify a future unattended run.

## Implementation order and prerequisites

1. Verify these instructions against the current files, Sites capabilities, and user requirements before changing application code.
2. Background delivery destination is Codex notifications in this chat, selected by the user. Do not add an external recipient or send external messages.
3. Confirm a supported unattended runner, durable storage, and access path for the selected delivery method. The future runner must obtain authorized Site access independently; an authoring-session token is insufficient.
4. Explain the smallest required backend addition. Retain the frontend. Any server migration, dependency installation, or external service setup must satisfy the user's approval rules. Prior permission covers this Site's network verification, private publication, source push, and temporary source credential; it does not authorize unrelated services or recipients.
5. Open the existing Site through the Sites source helper before implementation. Keep the same project ID and access policy. Do not create a second Site.
6. Implement shared level/settings definitions, alert evaluation, editor UI, durable state, and unattended delivery in that order.
7. Validate locally, review the final diff, package the exact pushed source, publish with the unchanged custom access policy, and verify the deployed behavior and background access path. Use the owner-private native operation only while owner-only access is explicitly confirmed; refresh access before publication if uncertain.

If a supported runner or notification destination is unavailable, report the specific limitation and leave background status visibly unconfigured. Do not label background monitoring as active until a verified unattended run and readback succeed.

## Editable levels and settings

- Initial defaults remain S3 2320, S2 2373, S1 2416, R1 2554, R2 2683, R3 2813 USD. The 2510 reference must never replace the live quote.
- Allow the six existing prices to be edited, with Save, Cancel, and Reset defaults controls. Keep their stable S1-S3/R1-R3 identifiers and names; default alert rules remain S1/R1.
- Validate finite positive USD amounts with at most two decimal places. Require `S3 < S2 < S1 < R1 < R2 < R3`; reject duplicate prices and invalid/empty input with an inline explanation.
- Use one canonical configuration for chart lines, flip markers, distances, range meter, structure notes, and alert rules. Remove repeated hard-coded thresholds in those consumers.
- Save durable settings for background monitoring and cross-session use. Migrate existing valid pause settings/history where appropriate without deleting the user's prior history. Clearly identify local-only state if durable persistence is temporarily unavailable.
- Increment a configuration revision on save. Rearm alert evaluation without treating old historical candles as new signals. Show the saved revision/update time and background synchronization status.

## Alert semantics

- Default mode: immediate breach on S1/R1, preserving the current user request. Levels at exact equality are inside the range: support requires price `< level`; resistance requires price `> level`.
- Default proposed cooldown: 30 minutes per rule and direction. A continuous breach must not repeatedly alert after the cooldown expires. Require a valid reentry and a later breach to rearm; record a suppressed crossing during cooldown so it is not delivered later as a new breach.
- Immediate mode uses a fresh validated quote. On first activation outside the range, allow one clearly labeled initial-state alert; the same state must not recur on refresh, reload, or runner restart.
- Daily-close mode requires a new completed UTC daily candle closing strictly beyond the level, after the previous completed candle closed at or on the opposite side. Ignore the current incomplete candle and deduplicate by rule ID, configuration revision, and candle time.
- Chart flip dots must use the same boundary rule: resistance crossing is previous close `<= level` and new close `> level`; support crossing is previous close `>= level` and new close `< level`. A new close exactly at the level is a touch, not a confirmed flip. Require consecutive valid daily candles.
- Retest mode first requires that daily-close crossing. In one of the next five completed daily candles, require a touch of the level's +/-0.25% band and a close strictly on the breakout side. A close at/on the original side cancels the setup; expiry after five candles cancels it. Never confirm a retest on the breakout candle or an incomplete candle.
- Display the exact mode, tolerance, expiry, cooldown, and armed/paused status in the settings. The tolerance/cooldown/expiry above are proposed defaults, not evidence of predictive performance.
- Config changes and mode changes establish a new baseline. Do not emit alerts for historical signals that predate activation. Pause/resume behavior must distinguish a new current-state notice from replaying old events.
- Persist rule evaluation cursor, state, last alert time, and delivery/event IDs. Use durable uniqueness and safe retry behavior so simultaneous browser/runner checks do not create duplicate events. Do not promise exactly-once external delivery unless the provider supports an idempotency key or equivalent.
- Quotes must have a finite positive price and a valid source timestamp no older than 120 seconds, permitting at most 30 seconds of future clock skew. Reject quotes outside those limits.
- Validate candle timestamps as unique UTC day starts aligned to 86400-second boundaries, sort chronologically, and require finite positive OHLC with `low <= open/close <= high` and finite nonnegative volume. Confirm the latest completed interval is current. A missing daily interval must block a crossing/retest evaluation across that gap rather than fabricating a candle or inferring a signal.
- Do not generate price alerts from stale, invalid, or missing data. Show a degraded connection state and recover automatically when valid data returns.

## Background execution and delivery

- Browser polling and browser notifications are foreground capabilities. Background alerts require a separate supported runner.
- Proposed background cadence: every 5 minutes, subject to the selected runner's supported cadence. Display the actual saved cadence and explain that a breach entirely between samples can be missed.
- Use the same canonical settings and evaluation rules in foreground and background. An update must not require republishing the Site. Use authenticated access and bounded persistent state.
- Reuse an existing matching automation instead of creating duplicates; preserve its pause state unless the user asks to resume.
- If using Sites cloud scheduling, first read `get_site` and inspect linked `automations`. Missing/null metadata prevents schedule creation. A fresh task must be able to read the instructions/settings and perform the required operation using supported access.
- For Codex delivery, use a supported linked automation/notification path and remain quiet while conditions are unchanged or non-actionable. Notify only on a newly qualified signal, meaningful failure/recovery, or required user action.
- For Telegram/email, obtain an explicitly chosen recipient and delivery permission. Keep provider keys in platform-managed secrets configured by the user; do not request pasted secrets or put credentials in source, logs, browser storage, schedule prompts, or instructions.
- Verify the intended unattended access, evaluate a bounded authorized run, and read back persisted results. A saved schedule alone is not proof that monitoring works.
- Display last successful background check, latest evaluated candle, delivery status, and a clear unconfigured/active/paused/error state.

## Acceptance checks

1. Edit valid prices; every chart/metric/alert consumer reflects the saved values. Reload and verify persistence. Cancel preserves prior values; Reset restores the six documented defaults.
2. Reject zero, negatives, non-finite inputs, duplicate/reversed levels, and excessive decimal precision. Render labels safely as plain text.
3. Check strict boundaries at S1/R1, breach deduplication, reentry, cooldown suppression, initial activation, pause/resume, and persistence across reload/runner restart.
4. Check completed-vs-incomplete daily candles, equal closes, matching chart flip boundaries, upward/downward crossings, missing candle intervals, duplicate/misaligned timestamps, incoherent OHLC, chronological ordering, and new configuration baselines. Do not infer a confirmed crossing across missing daily intervals.
5. Check retest success in both directions, wick touch, no touch, invalidating close, same-candle exclusion, five-candle expiry, and duplicate evaluation.
6. Check stale/future-dated/malformed quotes and candle failures: no false price alerts, visible degraded state, automatic recovery.
7. Check concurrent evaluation and delivery retry: one durable event per signal; do not silently discard failed delivery. Label unknown delivery outcomes accurately.
8. Close the website and verify the configured runner can still check settings/data. Verify authorized delivery independently from scheduling, then reopen and read the persisted event/status. Send external test messages only to the explicitly authorized recipient.
9. Inspect desktop/mobile settings, keyboard navigation, visible validation errors, chart controls, and existing indicator calculations. Keep the volume profile estimate disclosure.
10. Review `git diff`, rerun relevant checks once inputs are final, push/package through the Sites helper, confirm successful deployment with the original custom owner-only audience, and report actual test results and any limitations.

## Working rules for this step

Follow the user's global AGENTS instructions: inspect before editing, keep changes targeted, announce exact terminal commands/purpose/write/network/runtime implications, avoid secrets and destructive operations, and get required approvals for new dependencies/services. Do not change global machine state. The Windows packaging workaround may select installed Git Bash and `TAR_OPTIONS=--force-local` only for the workflow process.

## Verification record

- Reviewed against `dist/app.js`, `README.md`, `.openai/hosting.json`, the current Sites workflow, and its storage/identity/recurring-update references.
- Independent review completed. Scope and acceptance coverage pass after clarifying strict flip boundaries, quote/candle validation, access preservation, and limiting the editor to the existing six levels.
- Parent verification checked the live Site identity, owner role, allowed-user role, absence of editors/groups, and linked schedule inventory. No credential was printed or written to this file.
- Confirmed `git diff --stat` was empty before this new instructions file was finalized. Application files were not edited for this preparation milestone.
- Historical preparation record: the user chose Codex notifications and approved the dependency-free Sites Worker/D1 addition. Cadence and unattended-access verification were pending at that time. Any later resumption must verify the intended unattended path; the current publication request keeps monitoring paused.
- The original document review did not execute the new features or send notifications. Current implementation verification and the accepted physical-touch limitation are recorded in the 2026-10-17 update above.
