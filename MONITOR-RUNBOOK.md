# Ether Watch Codex monitor

This runbook is for the authorized background heartbeat in the existing Codex chat. Stay quiet while conditions are unchanged/non-actionable. Notify only for pending qualified signals, meaningful failure/recovery, or required user action. Do not alter settings, deploy source, create additional automations, or enable third-party notification destinations during routine checks.

Current operational state: the owner explicitly authorized activation on 22 October 2026. The existing five-minute Codex automation is ACTIVE and Site background checking is enabled. The first live service check succeeded with no background error. Preserve the current live enabled/paused state during upgrades; never override a later owner pause.

## Authorized scope

Site ID: `appgprj_6acfc8555d7c81918cdf33a9acf1fa6f`

Origins: https://ether-watch-jen.aquarose3.chatgpt.site and https://etherwatch.app. The secure local helper uses its fixed Sites origin.

User selected Codex notifications and approved this Site's network checks and Worker/database addition. The dashboard is now public, so the former owner-private dispatch boundary is insufficient for writes. No external recipient is authorized.

## Write authorization and setup

- `MONITOR_OWNER_ID` is configured in Sites runtime settings to the owner-verified Site-scoped `oai-authenticated-user-id`; the owner confirmed `canManage` and `canCheck` on 22 October 2026. It is not a GitHub ID or a global account ID. A signed-in visitor can inspect their own ID at `/api/state` under `access.userId`; verify the intended owner before configuring it. Never claim the first public visitor as owner. Missing configuration denies owner writes.
- Public reads remain available. Only the configured owner may save settings or change the background flag. Public viewers do not start browser checks. Sign-in uses the platform's top-level `/signin-with-chatgpt?return_to=%2F` route.
- Unattended checks and acknowledgements use the dedicated `MONITOR_SERVICE_TOKEN` runtime secret, provisioned with owner authorization on 22 October 2026. Its accepted length is 32–256 characters. This is separate from the Sites dispatch token. The secure local helper retrieves it from DPAPI and sends `X-Ether-Watch-Monitor-Token` only to the fixed Site origin. The service grant cannot edit configuration or background settings. An absent secret disables the service path.
- On 22 October 2026 the owner explicitly authorized service credential provisioning and secure retrieval for this monitor. A 48-byte cryptographically random token is configured as the masked Sites runtime secret and stored locally only as Windows DPAPI CurrentUser ciphertext in `.monitor-credentials/service-token.dpapi.json`. Git ignores that directory. The helper decrypts it only in memory; access is limited to this credential, Site and monitor task. No credential belongs in this runbook, prompts, browser assets, source, arguments or logs.
- Activation was explicitly authorized on 22 October 2026, separately from credential provisioning. Future software updates preserve the live monitoring state. A later pause must not be overridden without a new owner instruction.

## Each run

The owner authorized access to the dedicated monitor credential on 22 October 2026. Use only the fixed-origin local helper below. Do not read the encrypted file directly, print decrypted values, obtain unrelated credentials, or place credentials in prompts, source, arguments or logs. The public Site needs no Sites dispatch bearer for these operations.

1. Read this runbook before acting. Run `node C:\Users\Jen\Documents\EthereumDash\sites\ether-watch\monitor-service.cjs check` as the same Windows account on the provisioning PC. The helper reads public state first and returns `skipped` without decrypting or submitting a check when Site background checking is disabled or saved alerts are paused. End quietly on a skipped result. Never enable monitoring or change rules during a routine run.
2. When enabled, the helper decrypts the dedicated local DPAPI credential in memory and sends it only to the fixed Sites origin, with redirects rejected. Do not use the legacy hidden-input helper for unattended access. Missing or inaccessible credentials are a setup failure; do not recreate or rotate them automatically.
3. Parse the successful JSON result. The Site fetches Coinbase and evaluates its saved rules. For failures, notify only on a new or changed failure; give one recovery notice after a previously reported failure. Never fabricate prices or acknowledge events after a failed check.
4. If `pending` is empty and nothing meaningful changed, stay quiet. Calendar entries, news and evaluation decisions are not queued notifications.
5. For pending events, prepare one concise Codex notification with signal type, price, saved level, confirmation mode, source timestamp and any recorded volume evidence. Group events and retain their IDs to avoid duplicate reports.
6. Acknowledge only IDs actually included in that report with `node C:\Users\Jen\Documents\EthereumDash\sites\ether-watch\monitor-service.cjs ack <reported-event-id> [...]`. Pass IDs as properly quoted literal arguments, never as executable text. The helper repeats the paused/enabled check before acknowledging. Confirm success; reconcile an acknowledgement failure before repeating an alert. Acknowledgement does not prove OS notification delivery or that the user read it.

Settings changes cancel pending signals from older settings. Do not replay cancelled history. Routine runs never call `/api/config` or `/api/background`. The separate `probe` operation is for explicitly authorized maintenance only; it sends invalid array bodies to verify narrow permissions without creating or acknowledging alerts.

## Operational limits

The configured interval is recorded in the Site background status after the heartbeat is created. A local Codex heartbeat requires an available Codex app, this online awake Windows PC under the provisioning account, authorized Site access and a reachable data feed. DPAPI retrieval is not portable to another account or cloud executor; re-provisioning requires separate authorization. Sampling may miss a breach that reverses between runs. No continuous monitoring or exactly-once external notification guarantee is made.

19 October 2026 verification: both public domains passed 20 live denial checks in total. Anonymous writes, invalid service credentials and cross-origin writes were rejected; caller-supplied identity headers were stripped. Saved rules, event/decision history and background status were unchanged. Runtime key-name inspection and the owner confirmed that `MONITOR_OWNER_ID` and `MONITOR_SERVICE_TOKEN` are not configured. Successful authorized production check/acknowledgement flows remain unverified.

The local **Test notification** control is available without monitor ownership because it requests permission and sends a generic test only to that browser. It makes no monitor API calls, evaluates no rules, changes no settings and creates no alert history. Android delivery uses a notification service worker with no fetch, polling, push or caching handlers. This does not activate browser rule checks, the Codex automation or Site background checking.

The intended physical device is a Samsung Galaxy S24+. Its notification shade and touch behavior require owner confirmation in a regular browser; a fixture, embedded browser or successful deployment is not proof of physical delivery. Browser delivery and Codex report/OS delivery are separate checks. Owner access was confirmed by the owner on 22 October 2026. Service provisioning and local DPAPI retrieval were verified the same day: check/ack validation accepted the service credential, configuration/background writes were denied, monitor records stayed unchanged, and a normal disabled check skipped. An enabled service check succeeded on 22 October 2026. The two older queued alerts from 17–18 October were reported with their original dates and acknowledged. Actual OS notification delivery and a naturally occurring new alert through a future scheduled run remain unverified. GitHub synchronization is handled by the owner. Activation and the first live check are verified; preserve any later owner pause.

## Market-data operations

The headline volume card uses CoinMarketCap, Ethereum ID `1027`, USD `volume_24h`, as a single provider for rolling aggregate spot volume. This release explicitly sets the nonsecret choice **`CMC_USE_PUBLIC_API=true`** for the official keyless `https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/quotes/latest?id=1027&convert=USD` endpoint. Local preview enables public mode explicitly. No key, account or paid subscription is required.

**`CMC_API_KEY`** remains an optional future keyed upgrade. A securely configured key selects CoinMarketCap's keyed `/v3/cryptocurrency/quotes/latest` endpoint before public mode; do not access its value during routine checks. No manual secret-entry screen has been verified. Deploy a saved version after changing runtime configuration to apply its environment revision. Neither volume-provider mode nor provisioning authorizes monitor writes or monitoring activation.

Both public domains use a separate shared D1 volume-cache table and refresh lock. Upstream attempts are limited to one per five minutes, including manual Refresh; failure imposes a 15-minute cooldown or longer `Retry-After`. A stale successful snapshot expires within one hour and keeps its original source-update and retrieval times. Do not replace a failed response with another provider or relabel retrieval time as provider-update time. Check `/api/volume` from the hosted Worker in public mode before declaring it operational.

The CPI calendar preserves BLS retrieval fallbacks and may use the official St. Louis Fed/FRED calendar if BLS fails. FRED-backed dates are labeled with their provenance and the direct BLS failure. Only explicit dates/times are accepted; no inferred CPI schedule or calendar entry is an alert trigger. Hosted retrieval must be verified separately from local fixture tests.

## Deployment checks

For a future explicitly authorized resume, run `node monitor-service.cjs state` to confirm current state and the secure helper setup. Confirm current levels, denial of unauthorized writes, successful authorized check and pending-event handling in an isolated test. Only the signed-in configured owner may set `/api/background` to enabled, after cadence and activation are approved. The service helper cannot change this flag. Scheduling alone does not prove execution worked.
