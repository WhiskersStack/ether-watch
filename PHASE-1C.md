# Ether Watch Phase 1C — fixture-only local preview

Baseline: Sites version 29, commit `573756b0c45d6c0ed1e73cdbdee08ba9a79a6a09`.
This independent repository has no remote or production hosting manifest. Do not use
`local-worker-preview.mjs` for isolated design work; it loads the production Worker.

Run `node fixture-preview.mjs` and open `http://127.0.0.1:4175/` only in a new,
disposable browser profile with external network traffic denied. Stop the server
when finished. The fixture server binds loopback, keeps settings only in memory,
never imports the production Worker, has no D1 binding, and denies outbound
network APIs in its process. Only explicit, allowlisted fixture routes exist.
The browser guard blocks unrecognized fetches, external link clicks, recurring
polling, and visibility-triggered refreshes. CSP blocks external resources and
service workers. The push module served in this mode is a stub, and the
notification worker is unavailable.

Use `?scenario=success`, `loading`, `stale`, `empty`, or `failure` to inspect
deterministic synthetic states. Fixture values and headlines are invented for
local rendering and must never be represented as live market information.

## Approved design requirements for the next phase

All five themes will share the new glass dashboard layout: `classic` is Blue
Glass and remains the default, `daylight` is Frosted Glass, `midnight` is Violet
Glass, `dusk` is Sunset Glass, and the new `emerald` is Green Glass. Preserve
existing saved theme identifiers and preferences. Do not return to the previous
dashboard design. Preserve chart, indicator, alert, monitoring, notification,
news, calendar, and saved-state functionality. The fifth theme and visual
redesign are deferred until separately approved.
