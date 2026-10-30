# Quantum Terminal — Phase 3 design QA
Reviewed 2026-10-27. Scope: approved Classic visual-direction contract and isolated browser implementation.

final result: passed

This is a scoped design-contract pass, not a pixel-identical claim or production release approval. No actionable P0/P1/P2 defect remains from this comparison after the fixes below. Live-service and release acceptance remain pending; see PHASE-3.md.

## Source and rendered evidence
Source truth:
- C:/Users/Jen/.codex/visualizations/2026/10/26/01a1776e-c678-7272-9710-b2d2fcdadf51/quantum-terminal-concept-review.md
- Desktop: C:/Users/Jen/.codex/generated_images/01a1776e-c678-7272-9710-b2d2fcdadf51/exec-98ecdab1-917c-4592-abf9-2aa2d862e75d.png (1447 × 1087 pixels).
- Mobile: C:/Users/Jen/.codex/generated_images/01a1776e-c678-7272-9710-b2d2fcdadf51/exec-136802d9-9e59-4f2a-8bd2-6f35f1646968.png (920 × 1708 pixels, centered phone-content artwork with surrounding canvas; not a measured CSS viewport).

Implementation evidence directory:
C:/Users/Jen/.codex/visualizations/2026/10/27/01a17e98-1a40-7763-a250-3f9d57e163d1/

| Capture | CSS viewport / density | Output pixels |
| --- | --- | --- |
| quantum-desktop.png | 1448 × 1086, DPR 1 | 1448 × 1345 full page |
| quantum-desktop-viewport.png | 1448 × 1086, DPR 1 | 1448 × 1086 |
| quantum-mobile.png | 390 × 844, DPR 1 | 390 × 2494 full page |
| quantum-mobile-viewport.png | 390 × 844, DPR 1 | 390 × 844 |
| quantum-320.png | 320 × 844, DPR 1 | 320 × 2564 full page |
| options-320.png / settings-320.png | 320 × 844, DPR 1 | 320 × 844 |

The source and final desktop/mobile images were opened together in the same comparison input. This was a simultaneous visual comparison, not a physically composited side-by-side image. Focused review used the actual viewport-size captures, settings/options captures and the final 320px image alongside the source mobile reference. The chart header, candle labels, levels, footer controls and dialog buttons were inspected at readable scale.

Normalization: desktop source width approximately matches the captured CSS width. Mobile source includes unmeasured surrounding canvas and has no declared CSS size or DPR; its app content was compared regionally for order, proportions and styling. No pixel-diff score or false 1:1 mobile density claim is made. Actual layout height is intentionally larger, as discussed below.

State: Classic; 1D/30 bars/candles/candle-fit; EMA and volume on; RSI/MACD/news overlays off for final comparison; synthetic paused alert state; empty news/calendar. Populated and error-state captures are separate. The source has schematic numeric values, unavailable metrics and different level values; these differences are expected, not data regressions. The visible preview banner identifies every capture as synthetic. “Live” status within the app is simulated.

## Comparison findings and resolved iterations
1. **P2 — Dense chart header and supporting panels.** Early implementation separated too many toolbar rows and displayed verbose rule/source details. This obscured the approved chart-led rhythm. Fix: compact timeframe/style/actions header; retained advanced inputs in Options; source/monitor/history disclosures. Final desktop shows the chart and right rail aligned and compact supporting sections.
2. **P2 — Uneven desktop chart/rail bottom alignment.** The chart ended above the rail. Fix: desktop chart flex sizing follows the rail while preserving Canvas sizing and expanded-view behavior. Final quantum-desktop.png shows aligned lower boundaries.
3. **P2 — Classic Options Done button contrast.** The generic glass button rule overrode the accent background but left dark foreground text. Fix: specific accent background/text pair for .chart-options-actions button. The browser asserts rgb(75, 220, 255); final options-320.png shows readable text.
4. **P2 — Clipped native Candles label at 320px.** Excess select padding reduced the available label width. Fix: narrow breakpoint padding 8px 4px and 12px type, retaining 44px height. Final quantum-320.png shows the full label.
5. Earlier captures were overwritten by the bounded harness; the final named files are the post-fix evidence. Iteration descriptions are retained here rather than falsely labeling the current images as before/after pairs.

## Required fidelity surfaces
| Surface | Assessment |
| --- | --- |
| Fonts / typography | Price and section hierarchy retained; numeric EMA/current-candle information stays readable. Existing DM Sans/Space Grotesk declarations preserved. Google Fonts is blocked in fixture mode, so system fallbacks alter glyph shape/weight. Source glyphs are explicitly nonfinal in the approved contract. External font rendering remains untested. |
| Spacing / layout rhythm | Desktop chart/right rail and three supporting columns, mobile chart-first stack and two-column levels match the contract. 44px controls, real metric explanations, source distinctions and preserved history/settings make pages taller than the schematic. This is an expected readability adaptation permitted by the contract, not exact frame-height matching. |
| Colors / tokens | Navy interiors, localized cyan/blue rims with violet reflections, mint support/up, rose resistance/down, amber EMA20 and lavender EMA50 are distinct. Glow is softer than the generated artwork to preserve foreground clarity. Reduced-motion/contrast rules remove decorative shadow while retaining borders/content. Done-button contrast fixed. No formal contrast certification claimed. |
| Assets / image quality | Exact existing Watchpoint SVG preserved with vector proportions; real data-bound Canvas retained. No raster concept is shipped and no replacement logo was drawn. Decorative concept glyphs were not final assets; existing text labels and native controls are used. No new emoji/CSS art replacement assets were introduced. |
| Copy / content | Actual units, Coinbase ETH-USD versus aggregate ETH volume, estimated candle-derived volume profile, timestamps, stale/error states, saved rules and source evidence preserved. Schematic prices/headlines are not inserted into production. Fixture banner remains explicit. |

## Intentional adaptations / follow-up polish
- P3: system-font screenshots differ from the concept's generated typography. Verify the existing external font path in the separately authorized final-validation environment.
- P3: text-labeled Menu/Options/Edit levels controls replace decorative conceptual icons. This preserves unambiguous interaction without inventing an icon asset set.
- P3: glow is subtler and the mobile page includes extra market/source and rule details. User visual review should confirm this balance.
- Existing Daylight/Midnight/Dusk colors are preserved; those are continuity checks, not newly approved Quantum themes.
- Disclosure summaries keep feed health visible; detailed disclaimers and diagnostics remain accessible on expansion.
- Dialog interiors, populated feeds, stale/error states and physical touch behavior were not fully specified by the concept. Existing behavior and readable styles govern those states.

## Interaction and accessibility evidence
11 browser groups passed: navigation/Escape; responsive node identity; chart timeframes/style/indicators/zoom/keyboard/expand; level/rule edits and revision; pause/resume/history; news search/filter/source/refresh/chart focus; calendar zone/source/refresh; four themes and preferences; loading/stale/empty/failure; 320px dialogs/focus return/landscape/reduced-motion; isolation.

No page errors, duplicate IDs or horizontal overflow found at tested widths. No external requests observed. Native dialog scrolling remains necessary on narrow screens; screenshots may show the focused control region rather than the dialog's beginning. Physical touch, assistive-technology sessions, browser zoom/text enlargement and complete WCAG auditing were not performed.

## Implementation checklist
- [x] Approved composition and Classic material implemented.
- [x] Existing Canvas, Watchpoint vector, data semantics and theme identities retained.
- [x] Identified P2 layout/contrast/narrow-control issues corrected and recaptured.
- [x] Desktop, 390px, 320px, dialogs, populated and error states captured.
- [x] Functional regression tests and isolated browser checks passed.
- [ ] User review of actual implementation screenshots.
- [ ] Explicit approval before Phase 4.
- [ ] Live-provider, release packaging and physical-device checks in their authorized scope.

---

# Historical report retained below
The following report is from the earlier chart work. Its production and real-snapshot evidence does not describe the Phase 3 run above.

# Price & structure graph QA

Final result: passed (scoped frontend QA)

Reviewed 2026-10-25 against the user's TradingView screenshot and the captured existing Ether Watch chart. This is a targeted update to the existing Canvas renderer, not a recreation of TradingView.

## Implemented

- Stronger, unsmoothed closing-price line with subtle area shading. Line colors encode above/below the first visible close, whose value is explicitly displayed and updates during zoom/pan.
- Separate visible-candle close/date and a live ticker badge with cents. Selected EMA values identify both moving averages.
- Taller price plot, quieter profile and distant levels, stronger nearest levels, and more space between right-axis annotations. Every saved level remains labeled, including offscreen arrows.
- Existing vertical-fit selector moved into the toolbar. Existing preferences, themes, candles, indicators, news, touch gestures, and expanded-view behavior retained.

## Validation

- `node --test chart.test.mjs visual-layout.test.mjs ui-state.test.cjs`: 81 passed, 0 failed.
- `node --check dist/app.js`: passed.
- Browser QA used an isolated loopback server serving the edited chart and stylesheet with labeled synthetic fixtures. Production app startup and API connections were excluded; preview CSP prohibited all data connections.
- Desktop: fit, zoom, line/candle switching, color-key visibility, RSI/MACD/news toggles, logarithmic scale, expanded view, and reset passed.
- Mobile: 390px and 320px viewport checks passed with no horizontal document overflow. Existing range/profile controls moved into Chart options. Keyboard ArrowLeft and Home updated/restored the displayed close and baseline.
- Midnight and Daylight visual checks passed. Existing automated palette checks passed for all four themes.
- Browser error/warning log was empty after the interaction checks.

## Evidence

- Desktop: `C:/Users/Jen/.codex/visualizations/2026/10/25/01a171f9-d524-78d1-9484-c93c6b5da7d2/new-chart-desktop.png`
- Mobile: `C:/Users/Jen/.codex/visualizations/2026/10/25/01a171f9-d524-78d1-9484-c93c6b5da7d2/new-chart-mobile.png`
- Baseline capture: `C:/Users/Jen/.codex/visualizations/2026/10/25/01a171f9-d524-78d1-9484-c93c6b5da7d2/ether-watch-current-chart.png`

## Intentional differences and limits

- Kept the product's data intervals and EMA calculations. No one-minute feed, smoothing, dependencies, or new chart preferences were added.
- Browser screenshots show synthetic development fixtures, not actual market quotes. The harness reused the actual readout and responsive-layout functions; production startup, networking, preference persistence, and alert delivery were not exercised in the browser. Relevant existing automated tests passed.
- Worker, alert rules, D1, push transport, hosting, and access configuration were not edited. During implementation and QA, no commit, push, or publication was performed.
- Physical touch input and a screen-reader session were not tested; existing gesture tests and browser keyboard checks passed.

## News-marker verification with real snapshots

Completed 2026-10-25. Captured all 21 headlines rendered in the already-open Ether Watch page, including each DOM `datetime`, title, ID, and original source URL. Read real Coinbase ETH-USD candle responses for all three supported intervals. Production was not reloaded and no alert, hosting, or database settings were changed.

The isolated preview reused the edited renderer plus the actual app's news-rendering, grouping, selection, focus, and responsive-layout functions. It replayed recorded snapshots with external connections prohibited. This validates mapping against the feed's supplied timestamps, not publisher date accuracy, feed completeness, or continuing live-feed health.

| Candle interval | Recorded candles | Mapped headlines | Outside loaded history |
| --- | ---: | ---: | ---: |
| Daily | 350 | 21 | 0 |
| Hourly | 350 | 17 | 4 |
| 15 minutes | 350 | 14 | 7 |

An offline assertion check independently compared publication-time UTC buckets with actual candle starts, checked that all and only eligible stories were mapped, and rejected duplicate assignment. All checks passed. Recorded candle volumes were nonuniform.

Browser results:

- Daily desktop badges represented all 21 headlines. Clicking the 13-story canvas badge opened exactly the corresponding 13 stories across three daily candles.
- Selecting a real story preserved its source URL and exact ISO timestamp. Selection from expanded view closed that dialog and focused the matching article.
- Narrowing the visible range split clustered badges while retaining all in-range stories. Hourly and 15-minute views correctly limited markers to visible candle history.
- An old story on the 15-minute chart produced the explicit outside-history message and exposed the daily-history recovery control. Manually switching to daily and selecting that story successfully focused it. The recovery button itself was not exercised in this replay.
- Hiding/showing News markers removed/restored the marker browser. Clear selection removed the selected stories.
- At 390px, selecting a two-story cluster opened exactly two headlines. At 320px, badge counts still summed to 21, with document width equal to client width. Physical touch was not tested.
- Error/warning logs were empty after these interactions.
- Focused automated command: `node --test --test-name-pattern="news|event|marker|cluster|focus|expanded" chart.test.mjs visual-layout.test.mjs ui-state.test.cjs`: 22 passed, 0 failed.

Additional evidence lives under `C:/Users/Jen/.codex/visualizations/2026/10/25/01a171f9-d524-78d1-9484-c93c6b5da7d2/`:

- `news-verified-desktop.png` and `news-verified-mobile.png`
- `news-snapshot.json` and `candle-snapshots.json`
- `verify-news-snapshots.mjs` and `news-verification-results.json`

No graph-code correction was required during this verification. The temporary preview server was stopped after QA. Publication was not part of this verification run.
