# Ether Watch Codex monitor

This runbook is for the authorized background heartbeat in the existing Codex chat. Stay quiet while conditions are unchanged/non-actionable. Notify only for pending qualified signals, meaningful failure/recovery, or required user action. Do not alter settings, deploy source, create additional automations, or enable third-party notification destinations during routine checks.

## Authorized scope

Site ID: `appgprj_6acfc8555d7c81918cdf33a9acf1fa6f`

Origin: https://ether-watch-jen.aquarose3.chatgpt.site

User selected Codex notifications and approved this Site's network checks, temporary credentials, private publication and Worker/database addition. The unchanged custom policy permits only the owner. No external recipient is authorized.

## Each run

1. Use native Sites `get_site` for this exact ID. Obtain its current supported service-access bearer in session memory. Do not print or save it. Verify the owner-only policy still applies; stop monitoring and notify the user if audience or supported access has materially changed.
2. Run `node C:\Users\Jen\Documents\EthereumDash\sites\ether-watch\background-check.cjs` in a retained PTY. Wait for its hidden-input readiness message. It is a short approved network operation using only this Site origin.
3. Pass one newline-terminated JSON object through hidden stdin: `origin`, `token`, `operation: "check"`, `body: {"source":"codex"}`. Never place the token in the shell command, a file, schedule prompt or output. The helper rejects redirects and other origins.
4. Wait for successful exit and parse the returned JSON. The Site fetches Coinbase itself, reads the user's current saved rules, evaluates with durable state and returns `pending` events. It also persists the last successful background check.
5. If the check failed, notify only on a new/changed failure; avoid repeating the same failure every run. Do not fabricate prices or acknowledge pending events when the check did not succeed. On recovery, give one brief recovery notice if a failure was previously reported.
6. If paused or `pending` is empty and no meaningful status changed, end quietly without a routine status report. The user did not request periodic price summaries.
7. For pending events, prepare one concise Codex notification listing the signal, price, level, confirmation mode and source timestamp. Include the Site link. Group multiple events into one report and include event IDs in task context to avoid duplicate reporting.
8. Before completing the report, acknowledge only the event IDs included in that report with a second helper invocation: `operation: "ack"`, `body: {"ids":[...]}`. Verify successful readback. This marks events as reported by Codex; it is not proof the operating system delivered or the user read a notification. If acknowledgement fails, keep the IDs in task context and reconcile them on the next run rather than repeating the same alert text blindly.

Settings changes intentionally cancel pending signals for older settings. Do not replay cancelled history. Routine runs do not call `/api/config` or `/api/background`.

## Operational limits

The configured interval is recorded in the Site background status after the heartbeat is created. A local Codex heartbeat requires an available Codex app, online awake machine, authorized Site access and a reachable data feed. Sampling may miss a breach that reverses between runs. No continuous monitoring or exactly-once external notification guarantee is made.

## Deployment checks

Before enabling a new heartbeat, exercise this exact hidden-input helper and read back the persisted state using `operation: "state"`. Confirm current levels, owner-only access, successful check and pending-event handling. Set `/api/background` to enabled only after the saved heartbeat's cadence and activation status are confirmed. Scheduling alone does not prove execution worked.
