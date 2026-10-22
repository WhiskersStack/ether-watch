# Ether Watch Codex monitor

This runbook is for the authorized background heartbeat in the existing Codex chat. Stay quiet while conditions are unchanged/non-actionable. Notify only for pending qualified signals, meaningful failure/recovery, or required user action. Do not alter settings, deploy source, create additional automations, or enable third-party notification destinations during routine checks.

Current operational state: the scheduled Codex automation is PAUSED and Site background checking is disabled. Upgrades must preserve this state. Resume only after an explicit user request; a software update or saved version is not authorization to resume.

## Authorized scope

Site ID: `appgprj_6acfc8555d7c81918cdf33a9acf1fa6f`

Origins: https://ether-watch-jen.aquarose3.chatgpt.site and https://etherwatch.app. The hidden-input background helper uses its fixed Sites origin.

User selected Codex notifications and approved this Site's network checks and Worker/database addition. The dashboard is now public, so the former owner-private dispatch boundary is insufficient for writes. No external recipient is authorized.

## Write authorization and setup

- The owner must manually configure `MONITOR_OWNER_ID` in Sites runtime settings to their verified Site-scoped `oai-authenticated-user-id`. It is not a GitHub ID or a global account ID. A signed-in visitor can inspect their own ID at `/api/state` under `access.userId`; verify the intended owner before configuring it. Never claim the first public visitor as owner. Missing configuration denies owner writes.
- Public reads remain available. Only the configured owner may save settings or change the background flag. Public viewers do not start browser checks. Sign-in uses the platform's top-level `/signin-with-chatgpt?return_to=%2F` route.
- Unattended checks and acknowledgements additionally require a dedicated `MONITOR_SERVICE_TOKEN` runtime secret, 32–256 characters, chosen by the owner with sufficient random entropy. This is separate from the Sites dispatch token. The helper receives it as `serviceToken` through hidden stdin and sends `X-Ether-Watch-Monitor-Token` only to the fixed Site origin. The service grant cannot edit configuration or background settings. An absent secret disables the service path.
- The owner must handle secret provisioning and authorize a supported secure retrieval channel for future runs. Never put the secret in this runbook, automation prompts, browser assets, source, command arguments, or output. The code update does not establish that retrieval channel or authorize access to stored secrets.
- Software updates do not enable monitoring. Leave the existing automation paused and `background.enabled` false. Owner configuration and service provisioning do not authorize resuming it.

## Each run

1. Confirm the paused/enabled state and supported authorization before running. Obtain credentials only through a separately authorized secure channel; stop and notify the user if it is unavailable. If a Sites dispatch bearer is required, it remains distinct from the application service secret and never grants Worker write permission by itself. Keep all credential values in session memory without printing or saving them.
2. Run `node C:\Users\Jen\Documents\EthereumDash\sites\ether-watch\background-check.cjs` in a retained PTY. Wait for its hidden-input readiness message. It is a short approved network operation using only this Site origin.
3. First read saved state with hidden input `origin`, `token`, `operation: "state"`. If `background.enabled` is false or saved alerts are paused, end quietly without evaluating or acknowledging events. Otherwise start a second helper and pass hidden input `origin`, `token`, `serviceToken`, `operation: "check"`, `body: {"source":"codex"}`. Never place credentials in a shell command, file, schedule prompt or output. The helper rejects redirects and other origins. The Worker determines service activity from authorization, not the body source label.
4. Wait for successful exit and parse the returned JSON. The Site fetches Coinbase itself, reads the user's current saved rules, evaluates with durable state and returns `pending` events. It also persists the last successful background check.
5. If the check failed, notify only on a new/changed failure; avoid repeating the same failure every run. Do not fabricate prices or acknowledge pending events when the check did not succeed. On recovery, give one brief recovery notice if a failure was previously reported.
6. If paused or `pending` is empty and no meaningful status changed, end quietly without a routine status report. The user did not request periodic price summaries.
7. For pending events, prepare one concise Codex notification listing approach/breach type, price, historical saved level, confirmation mode and source timestamp. Include volume evidence when recorded and the Site link. Group multiple events into one report and include event IDs in task context to avoid duplicates. The separate `decisions` history contains explanations, not pending notifications. Calendar entries/news are not notification triggers.
8. Before completing the report, acknowledge only the event IDs included in that report with a second helper invocation including `serviceToken`, `operation: "ack"`, `body: {"ids":[...]}`. Verify successful readback. This marks events as reported by Codex; it is not proof the operating system delivered or the user read a notification. If acknowledgement fails, keep the IDs in task context and reconcile them on the next run rather than repeating the same alert text blindly.

Settings changes intentionally cancel pending signals for older settings. Do not replay cancelled history. Routine runs do not call `/api/config` or `/api/background`.

## Operational limits

The configured interval is recorded in the Site background status after the heartbeat is created. A local Codex heartbeat requires an available Codex app, online awake machine, authorized Site access and a reachable data feed. Sampling may miss a breach that reverses between runs. No continuous monitoring or exactly-once external notification guarantee is made.

19 October 2026 verification: both public domains passed 20 live denial checks in total. Anonymous writes, invalid service credentials and cross-origin writes were rejected; caller-supplied identity headers were stripped. Saved rules, event/decision history and background status were unchanged. Runtime key-name inspection and the owner confirmed that `MONITOR_OWNER_ID` and `MONITOR_SERVICE_TOKEN` are not configured. Successful authorized production check/acknowledgement flows remain unverified.

The local **Test notification** control is available without monitor ownership because it requests permission and sends a generic test only to that browser. It makes no monitor API calls, evaluates no rules, changes no settings and creates no alert history. Android delivery uses a notification service worker with no fetch, polling, push or caching handlers. This does not activate browser rule checks, the Codex automation or Site background checking.

The intended physical device is a Samsung Galaxy S24+. Its notification shade and touch behavior require owner confirmation in a regular browser; a fixture, embedded browser or successful deployment is not proof of physical delivery. Browser delivery and Codex report/OS delivery are separate checks. Production owner/service provisioning, secure unattended credential retrieval and actual Codex notification delivery remain unverified. GitHub synchronization is handled by the owner. Keep monitoring disabled until the separate authorized activation and verification are complete.

## Market-data operations

The headline volume card uses CoinMarketCap, Ethereum ID `1027`, USD `volume_24h`, as a single provider for rolling aggregate spot volume. This release explicitly sets the nonsecret choice **`CMC_USE_PUBLIC_API=true`** for the official keyless `https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/quotes/latest?id=1027&convert=USD` endpoint. Local preview enables public mode explicitly. No key, account or paid subscription is required.

**`CMC_API_KEY`** remains an optional future keyed upgrade. A securely configured key selects CoinMarketCap's keyed `/v3/cryptocurrency/quotes/latest` endpoint before public mode; do not access its value during routine checks. No manual secret-entry screen has been verified. Deploy a saved version after changing runtime configuration to apply its environment revision. Neither volume-provider mode nor provisioning authorizes monitor writes or monitoring activation.

Both public domains use a separate shared D1 volume-cache table and refresh lock. Upstream attempts are limited to one per five minutes, including manual Refresh; failure imposes a 15-minute cooldown or longer `Retry-After`. A stale successful snapshot expires within one hour and keeps its original source-update and retrieval times. Do not replace a failed response with another provider or relabel retrieval time as provider-update time. Check `/api/volume` from the hosted Worker in public mode before declaring it operational.

The CPI calendar preserves BLS retrieval fallbacks and may use the official St. Louis Fed/FRED calendar if BLS fails. FRED-backed dates are labeled with their provenance and the direct BLS failure. Only explicit dates/times are accepted; no inferred CPI schedule or calendar entry is an alert trigger. Hosted retrieval must be verified separately from local fixture tests.

## Deployment checks

Before an explicitly authorized resume, confirm owner/service provisioning and use this hidden-input helper to read back state. Confirm current levels, denial of unauthorized writes, successful authorized check and pending-event handling in an isolated test. Only the signed-in configured owner may set `/api/background` to enabled, after cadence and activation are approved. The service helper cannot change this flag. Scheduling alone does not prove execution worked.
