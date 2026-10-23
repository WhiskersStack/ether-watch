# Ether Watch cloud-alert runbook

This runbook covers migration to hosted checks and remote Web Push, followed by recovery after cutover. Routine cloud monitoring must not depend on Codex, a local helper, or the owner's PC. Routine runs must not change rules, credentials, source, deployment, or schedules.

## Current evidence and release gate

The cloud path is deployed and the owner has confirmed a real closed-page phone notification. **The first scheduled execution succeeded at 16:26:00 Jerusalem time on 23 October 2026.** Update this status only from observed results.

Cutover evidence on 23 October 2026 (Asia/Jerusalem):

- Production Sites version 23 contains the Cloudflare-compatible push sender (`redirect: manual`, rejecting redirects). Its 334-test regression suite passed before publication.
- The Galaxy S24+ test confirmation is saved against the displayed test ending `80c199bec734`.
- A regular `cloud_monitor_check` succeeded at 16:16:33 with no error. This was an explicit check, not a scheduled occurrence.
- Runtime revision 11 enables cloud processing and records the linked task reference; existing owner pause, armed state, rules and history remain intact.
- Exactly one linked hourly task, **Ether Watch cloud price alerts**, is enabled: `Automation_aef9be59bd088191af11f3059b536788`. Its requested first occurrence is 23 October at 16:21, recurring hourly in Asia/Jerusalem. The first scheduled invocation reached the Worker and recorded lastAttempt/lastSuccess at 16:26:00.946 with no error. No author-triggered regular check was made between 16:16:33 and that occurrence.
- The owner reports that local Codex automation `ether-watch-price-alerts` is already deleted. Do not recreate it.
- The identified local helper files, page-only notification module and dedicated DPAPI ciphertext were removed after the first scheduled success. The ciphertext was deleted without reading or decrypting it.

The app displays the schedule reference and the time it was last independently verified enabled. This is an explicit snapshot: the Worker cannot query the current ChatGPT task state. Inspect the linked task for its live enabled/paused state, and use persisted lastAttempt, lastSuccess and lastError to assess execution. After changing task state, refresh the recorded verification timestamp through Sites runtime settings and deploy. A saved reference or snapshot alone does not prove continuing execution.

The following inspection is the preserved pre-migration baseline:

Inspection on 22 October 2026 established:

- Sites version **21** was deployed successfully with public access and runtime environment revision **3**.
- Existing D1 tables `monitor` and `market_data_cache` contain the saved state. Preserve their contents and any later owner changes.
- `MONITOR_OWNER_ID`, the legacy `MONITOR_SERVICE_TOKEN`, and `CMC_USE_PUBLIC_API` were configured. No VAPID keys were configured.
- Sites reported **no linked cloud schedules**.
- The existing local automation is **Ether Watch price alerts**, ID `ether-watch-price-alerts`. Recent runs failed at a Codex usage limit. Its historical successful check and old event acknowledgements do not verify cloud or phone delivery.
- The owner accepted **hourly Sites cloud checks**. Current published paid-plan limits allow recurring tasks at most once per hour; a five-minute schedule is not supported by that documented route. [Official task limits](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt).
- A real closed-page push to the owner's **Samsung Galaxy S24+** remains unconfirmed.

Do not activate recurring cloud checks or remove the legacy path before hosted execution and the physical-device test are confirmed. Preserve current live monitoring controls during preparation; historical documentation is not authority to pause or resume them.

## Identity and architecture

Site ID: `appgprj_6acfc8555d7c81918cdf33a9acf1fa6f`

Canonical phone origin: **https://etherwatch.app**

Generated origin: https://ether-watch-jen.aquarose3.chatgpt.site

Keep the existing public audience, Site identity, and custom domain. Browser permissions, service workers, and subscriptions are origin-specific; use the canonical origin consistently on the phone.

Sites authenticates visitors and MCP callers. The Worker separately compares the Site-scoped `oai-authenticated-user-id` with the existing `MONITOR_OWNER_ID`. It is not a GitHub or global account ID. Missing owner configuration fails closed; never claim the first public visitor as owner. Public page access does not grant subscription, test-send, or monitor-write permission.

The cloud path is:

1. One hosted hourly Sites task calls the connected Site's owner-authorized `cloud_monitor_check` tool. No service token or local path belongs in the task prompt.
2. The Worker enforces the cloud gate, the saved background control, and armed state. Owner pause must also be respected during in-flight checks and delivery claims.
3. Coinbase data is validated before the existing rules and durable engine cursors are evaluated.
4. D1 retains configuration, history, evaluation decisions, hosted status, private subscriptions, and delivery jobs. Event/device uniqueness and guarded claims protect retries and overlaps.
5. The Worker encrypts Web Push payloads and signs with VAPID credentials from Sites runtime secrets. Sends happen after a durable claim, outside retryable state-update callbacks.
6. The phone's service worker receives remote push, applies persistent event deduplication, displays the notification, and attempts a receipt. The page does not poll to cause delivery.

Keep historical event IDs and delivery meanings. Old `reported` acknowledgements are not Web Push successes. Do not replay cancelled events or pending events from obsolete settings. A provider acceptance and a D1 write cannot be one transaction; stable tags and device deduplication reduce duplicates but cannot establish mathematical exactly-once physical delivery. Device deduplication claims the event before displaying it. A service-worker crash between those actions can suppress that notification on retry; a missing display receipt remains visible and must not be called successful delivery.

## Secure runtime setup

Open [Sites](https://chatgpt.com/sites), select **Ether Watch → More actions → Settings**, and use the runtime-environment controls. [Official secure configuration instructions](https://learn.chatgpt.com/docs/sites/managing-a-site#configure-runtime-environment-values).

| Name | Value/type | Purpose |
| --- | --- | --- |
| `MONITOR_OWNER_ID` | Preserve the verified value | Owner authorization |
| `WEB_PUSH_PRIVATE_JWK` | **Secret**, VAPID P-256 private JWK JSON | Server-only signing |
| `WEB_PUSH_PUBLIC_KEY` | Public base64url uncompressed P-256 point, matching the private key | Browser application-server key |
| `WEB_PUSH_SUBJECT` | `https://etherwatch.app` | VAPID subject |
| `CLOUD_SCHEDULE_ENABLED` | `false` during preparation | Gate regular cloud checking/delivery |
| `CLOUD_SCHEDULE_ID` | Optional exact returned task ID | Configuration reference, not proof of task enablement |
| `CMC_USE_PUBLIC_API` | Preserve `true` | Existing aggregate-volume provider choice |

Use the offline setup file [tools/create-push-keys.html](tools/create-push-keys.html). Its source contains code only, not credentials, and the production builder does not publish it. No production key has been generated or provisioned by this migration. The owner performs these steps manually:

1. Disable clipboard history and cloud synchronization in the operating system and every clipboard manager. If that cannot be done safely, stop and use trusted secure provisioning tooling; do not paste secrets into chat.
2. Open `C:\Users\Jen\Documents\EthereumDash\sites\ether-watch-cloud\tools\create-push-keys.html` as a local file in a trusted browser that supports secure Web Crypto and clipboard writes. Do not upload it to a website or enable an extension to bypass browser restrictions.
3. Acknowledge the clipboard requirement, then select **Generate key pair**. The page generates a P-256 pair in memory, displays only the public key, and neither stores nor sends the key pair. It has no private-key display or download fallback.
4. In the separate Sites settings tab, add `WEB_PUSH_PRIVATE_JWK` and mark it **Secret**. Use **Copy private JWK** in the offline page, then paste directly into that secret field. Do not reveal or screenshot the value.
5. Use **Copy public key** for `WEB_PUSH_PUBLIC_KEY`. Set `WEB_PUSH_SUBJECT=https://etherwatch.app` and keep `CLOUD_SCHEDULE_ENABLED=false`. Save the runtime settings without changing existing unrelated values.
6. Return to the offline file, select **Clear keys and clipboard**, then close it. Confirm that the OS and clipboard managers retained no history. If clipboard clearing fails, use OS controls before continuing.

The page's clear operation drops key references and requests an empty current clipboard; it cannot erase a clipboard manager's history or guarantee immediate erasure from browser memory. Reload/close alone does not reliably clear the system clipboard. Keep private values out of prompts, source, Git, logs, command arguments, browser storage, and screenshots. Only the public application-server key goes to the published application browser.

Publish through the official Sites workflow to apply the runtime environment revision and additive D1 migrations. Preserve unrelated values. Leave the legacy service-token secret unchanged until no supported path needs it. A configured cloud flag or task ID is not evidence that a hosted schedule is enabled or running; inspect Sites task status and actual run history.

Do not rotate VAPID keys automatically. Rotation may require every browser to unsubscribe and subscribe again, followed by another physical-device test.

## Publish, connect, and subscribe

1. Build and run the relevant regression suite against the exact source to publish. Review migrations for preservation of existing data.
2. Publish the tested package through Sites with regular cloud execution gated off. Preserve public access and identity. Do not commit, push, or synchronize the owner's GitHub checkout. A saved version is not a deployment.
3. Confirm the published Site advertises its MCP tools. Owner publication creates a private Site plugin; install/connect through the official flow if required. Use the server-returned plugin ID.
4. On the S24+, open **https://etherwatch.app** in its regular browser and sign in as the configured owner. Select the subscription control and grant notification permission in response to that explicit action.
5. Verify server registration succeeds. Permission denial must show a blocked state without repeated prompts. Resolve browser/site permissions manually before retrying.
6. Verify anonymous users cannot inspect subscription endpoints, encryption keys, receipt tokens, or send controls.

A browser subscription that the server no longer recognizes must be registered again explicitly. Unsubscribing must remove/disable the server subscription and pending delivery; failed removal stays visible and retryable. Subscribing does not change thresholds, activate recurrence, or prove delivery.

## Verification and cutover

Record these evidence separately:

| Gate | Required result |
| --- | --- |
| Authorization/privacy | Owner operations succeed; unauthorized and cross-origin writes fail; public state exposes no subscription/credential material |
| Evaluation and overlap | Existing regressions pass; settings/history survive; retries and overlapping checks create one qualifying event/job per device |
| Hosted connectivity | The intended cloud context invokes `cloud_monitor_probe`, validates real Coinbase data, and persists a fresh probe result without local files, helper, or PC |
| Remote phone push | Close all Ether Watch tabs on the S24+; from a separate authorized context call `cloud_push_test` with its subscription ID; record provider acceptance and any display receipt |
| Physical confirmation | The owner sees the labelled remote test in the S24+ notification shade while Ether Watch is closed, then explicitly confirms that delivery |
| Hosted evaluation | After probe and phone confirmation, enable the runtime processing gate and invoke one controlled `cloud_monitor_check` from the intended cloud context; verify a fresh successful regular check with saved owner controls respected |
| Failure/recovery | Permission denial, expired subscriptions, provider errors, backoff/recovery, concurrent claims, and pause during in-flight work behave safely |
| Recurring execution | One linked hourly task is enabled; its first real scheduled occurrence records a successful regular hosted check |

`cloud_monitor_probe` validates the hosted Coinbase path without evaluating rules, producing alert events, or delivering queued alerts. A successful probe does not prove recurrence. A call from a local authoring context is not a cloud-task run. Verify the intended cloud context before enabling recurrence; if that interaction is unavailable, report it as pending.

Provider acceptance means the push service accepted the request. A service-worker display receipt means the worker reported display, not that a person saw it. Missing receipts may reflect delayed/lost receipt requests. Only the owner's physical confirmation verifies the requested phone test.

After the hosted probe and phone confirmation pass:

1. Re-read linked Sites schedules and local automation state; reuse a matching cloud task if one exists.
2. Deactivate `ether-watch-price-alerts` through Codex automation controls and confirm it is paused before starting cloud recurrence. Reconcile any old invocation already in progress.
3. Enable the regular-cloud runtime gate and deploy its environment revision while preserving the owner's background and armed controls. Invoke one controlled `cloud_monitor_check` from the intended cloud context and confirm a successful regular check before enabling recurrence. Do not enable a paused owner control implicitly.
4. Create/enable exactly one hourly Sites task in `Asia/Jerusalem`, with the verified connected Site tool.
5. Observe the first scheduled occurrence and confirm its persisted result. No extra schedule should be created to compensate for a failure.
6. Retire the exact legacy artifacts below, rerun affected checks, and publish the final tested cleanup release through Sites.

Suggested task prompt, with cadence supplied separately by task settings:

> Run Ether Watch's connected cloud_monitor_check tool. Preserve the owner's pause and saved rules. Let the Site send qualified events through registered Web Push subscriptions. Do not independently resend ordinary price alerts or acknowledge historical events. Stay quiet on skipped, unchanged, or non-actionable results. Notify only for a meaningful monitoring failure, recovery, or required owner action. Do not change settings, schedules, credentials, source, or deployment.

Task failures and account limits may prevent an invocation from reaching the Worker; the app cannot record an attempt it never receives. Inspect the task's run history as well as app status.

## Exact retirement scope

The hosted and physical-device gates passed, followed by a successful scheduled invocation. The retirement scope below records the removed legacy path; preserve rules, history, owner controls and the remote push service worker. Verify paths in both the managed checkout and original `C:\Users\Jen\Documents\EthereumDash\sites\ether-watch` checkout.

| Artifact/behavior | Action after verification |
| --- | --- |
| Codex automation `ether-watch-price-alerts` | Deactivate and verify paused state |
| `monitor-service.cjs`, `monitor-service.test.cjs` | Remove DPAPI check/ack/probe helper and local-only tests |
| `.monitor-credentials/service-token.dpapi.json` | Delete this exact dedicated ciphertext after path verification; do not decrypt it or touch unrelated credentials |
| `background-check.cjs`, `background-helper.test.cjs` | Remove superseded hidden-input local check/ack path and tests |
| `dist/notifications.mjs`, `notifications.test.mjs` | Remove page-triggered notification-only implementation and obsolete tests |
| Local test/notification labels and page-driven check/ack calls | Remove behavior implying an open page, local Codex run, or PC delivers routine alerts |
| `MONITOR_SERVICE_TOKEN` and service-token authorization branch | Remove from runtime settings/code after the grant has no remaining supported use |
| `dist/notification-worker.js` | **Keep** remote push, deduplication, receipts, and notification clicks |
| D1 rules, thresholds, events, decisions, owner controls | **Keep**; they are not local delivery artifacts |

Do not delete entire credential directories, unrelated files, other automations, or Git history. The owner handles GitHub synchronization.

## Recovery and limitations

| Symptom | Recovery |
| --- | --- |
| No fresh hosted run | Inspect the single linked task, run history, plugin connection, account limits, and cloud gate. A saved task/flag is not proof of execution. |
| Owner pause/disarmed alerts | Respect the pause. Resume only through an explicit owner action. |
| Coinbase invalid/stale/unavailable | Retain last success time, record a safe error, and retry later. Do not fabricate prices or report unqualified events as delivered. |
| Permission denied | Direct the owner to browser/site notification settings; do not repeatedly prompt or silently fall back to page-local notifications. |
| Push 404/410 | Retire the expired subscription and show that the device must subscribe again. |
| Push 401/403 | Show configuration failure; verify secret presence, matching public key, subject, and deployed environment revision without exposing values. |
| Push 429/5xx/network failure | Retain retryable durable work with bounded backoff and provider Retry-After handling; avoid immediate retry loops. |
| Accepted but no phone notification | Check connectivity, browser/OS notification and background settings, subscription health, and receipts. Force-stopping the browser may prevent delivery. |
| Unsubscribe failure | Keep a visible error and retry server removal; do not claim success while sending may continue. |
| Duplicate-looking delivery | Compare safe event/job IDs, attempts, and receipt times. Provider acceptance followed by a crash may be ambiguous; do not disclose endpoint/key material. |

Hourly sampling can miss crossings that reverse between checks. This is not continuous monitoring or a trading guarantee. Safe UI/log summaries may include provider status codes, but never provider bodies, subscription URLs, encryption keys, private JWKs, authentication headers, or receipt tokens.

## Market-data operations

The headline volume card uses CoinMarketCap Ethereum ID `1027`, USD `volume_24h`, for rolling aggregate spot volume. Preserve nonsecret **`CMC_USE_PUBLIC_API=true`**, which selects the official keyless `https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/quotes/latest?id=1027&convert=USD` endpoint. Local preview enables public mode explicitly. No key, account, or paid subscription is required.

**`CMC_API_KEY`** remains an optional keyed upgrade. A configured secret selects CoinMarketCap's keyed `/v3/cryptocurrency/quotes/latest` endpoint before public mode. Do not access its value during routine checks. Provision any future key through Sites runtime secrets and deploy to apply the environment revision; this does not authorize alert activation.

Both public domains share the D1 volume-cache table and refresh lock. Attempts are limited to one per five minutes, including manual Refresh; failures impose a 15-minute cooldown or longer Retry-After. This cache interval is independent of hourly alert checking. Successful stale data expires within one hour while preserving source-update/retrieval timestamps. Do not substitute providers or relabel retrieval time as provider-update time. Verify hosted `/api/volume` separately from fixtures.

The CPI calendar retains BLS fallbacks and may use official St. Louis Fed/FRED dates when BLS fails. Preserve provenance and failure labels. Accept only explicit dates/times; inferred dates, calendar entries, and news are not alert triggers. Verify hosted retrieval separately from local tests.
