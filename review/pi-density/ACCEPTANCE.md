# Acceptance (review kit checklist, answered)

Status words: **IMPLEMENTED** (in the working tree), **AUTOMATED-VERIFIED**
(a check in this repository passed on the final tree), **MANUAL/HOST-VERIFIED**
(seen in the real Stream Deck app or on a device), **NOT RUN**, **BLOCKED**.
"Simulated host" means `scripts/lib/pi-sim.mjs` in headless Chrome on
Windows 10 (sample data). Nothing in this pass is MANUAL/HOST-VERIFIED.
Evidence paths are relative to the repository root.

## Evidence and repository

| Item | Status | Evidence |
| --- | --- | --- |
| Instructions, branch, dirty diff, stack, runtime, settings owners identified; report not mistaken for source | IMPLEMENTED | review/pi-density/PLAN.md "Starting state" |
| User changes and newer 1.7 behavior preserved; no reset, kill, hardware action, commit, push, merge, tag or release | IMPLEMENTED | CONTINUATION.md "Exact state"; own worktree from 4bf09c0, nothing committed, installed plugin and app untouched |
| Before/after captures on identical fixtures, folds, data, fonts, viewport, zoom, DPR; opened and inspected | AUTOMATED-VERIFIED | `pi-lab.mjs density` on a frozen copy of the 4bf09c0 panels and on the tree, same sim; first-screen pairs at 378x410 in `first-screen/` (six fixtures), inspected |
| Image heights vs DOM content heights kept apart; capture padding excluded | IMPLEMENTED | PLAN.md, REPORT.md "Method" (body content box) |
| No historical counts or mixed-build evidence presented as current | IMPLEMENTED | every count in REPORT.md was produced on this tree today |

## Layout, density and context

| Item | Status | Evidence |
| --- | --- | --- |
| Header keeps face, identity, source and truthful state visible while editing, including short hosts | AUTOMATED-VERIFIED (simulated) | pinned at 378x410 (the app's measured size): density JSON `pinned`; key 89 px, dial 105 px |
| Aspect ratio, units, badges, dense faces legible; payload identity vs physical rendering separate | AUTOMATED-VERIFIED (payload) / NOT RUN (device) | e2e-pi-panels "parity" (face byte-identical to the renderer); QtSvg on a device NOT RUN |
| No focused input, popup item or error obscured by the header; no overflow or trap | AUTOMATED-VERIFIED (simulated) | a11y lab: 0 obscured or partly obscured stops forward and Shift+Tab at 378/320 x 410; overflowX 0 in every density state |
| Reachability recorded (header cost, steps, Tab stops, scroll) | AUTOMATED-VERIFIED | REPORT.md "Task reachability" |
| Default one-reading key 720 to 780 px at 380 | AUTOMATED-VERIFIED | 748 px at 378x410 and 380x720 (REPORT.md); every theme named and visible, no control removed |
| All-open key and details at least 15% shorter, nothing hidden by extra folds | AUTOMATED-VERIFIED (evaluated): both missed | key -12.7% (it was -15.2% with the compact strip; the named theme chips and the 28 px control scale, the owner's call on 2026-09-26, cost 65 px), dense key -14.2%, details -10.1% (the detail-list editor was out of scope and did not shrink); dial all-open +2%, reported though not a target. All-open opens every disclosure, including the new ones. REPORT.md "Against the kit's targets" |
| Theme, text color, value/decimals/units, contextual graph as one Display group | IMPLEMENTED | theme moved to the always-open strip of named chips by the owner's rule; Display holds text color, value, decimals, °F, graph |
| Expanded summaries do not duplicate; collapsed keep effective state, scope, errors | AUTOMATED-VERIFIED | summaries hide while open (pi.css); pi-model tests for every summary |
| Advanced separates shared defaults, connection, support, configuration documents | IMPLEMENTED | four `details.hw-sub` groups, remembered like sections |
| Control and detail panels stay simple; no invented SDK navigation | IMPLEMENTED | control.html copy trimmed; detail tile unchanged in function |

## Keyboard and accessibility

| Item | Status | Evidence |
| --- | --- | --- |
| Dial add/search precedes the membership list; cost does not grow per item | AUTOMATED-VERIFIED | e2e "search comes before the rotation list, which is one Tab stop"; rotation search 16 to 7 Tab stops at 378x410 |
| List semantics: no interactive controls inside listbox options | AUTOMATED-VERIFIED | e2e "no control sits inside a listbox option" |
| Current reading and membership distinct; focus, position feedback and fallback after reorder/remove | AUTOMATED-VERIFIED | e2e T5 checks (selected vs "on dial", aria-posinset, announcement, Remove focus) |
| Pickers: open/close/reopen, overshoot, keyboard exit, beyond 150, duplicates, long/non-Latin, empty search, provider change | AUTOMATED-VERIFIED (simulated) | existing e2e-pi-panels scale and keyboard checks plus the new filtered-results check; pointer overshoot unchanged from the bench fix |
| 24x24 target floor for authored controls | AUTOMATED-VERIFIED | size audit of every interactive element (REPORT.md "The size scale"): standard controls 28 px, theme chips 83x32, group radios 18 px in a 24 px label, text actions a 24 px hit area; the only elements under 24 px are prose links inside sentences (inline exception) |
| Automated checks across the state matrix | AUTOMATED-VERIFIED | axe-core 4.13.0: 0 violations; own traversal 0; 62 runs at 410 and 62 at 800 |
| NVDA, Narrator, High Contrast, real host keyboard | NOT RUN | forced colors only emulated (a11y agent); CONTINUATION.md gates 2, 4, 5 |
| Telemetry does not steal focus, shift layout or announce per tick | AUTOMATED-VERIFIED | e2e "a ticking stale count leaves the status region and its focus alone"; header age is not a live region |

## Data integrity, status and lifecycle

| Item | Status | Evidence |
| --- | --- | --- |
| Navigation, hover, telemetry, browsing, folds write nothing | AUTOMATED-VERIFIED | e2e "observe" over every fixture; new checks: swatch focus, list arrows, status actions, fold all write nothing |
| Each edit writes only its field; unknown values and order survive | AUTOMATED-VERIFIED | e2e "edits", "lossless"; e2e:pi 646 of 646 |
| Shared JSON replace needs a second click; drafts and IME survive | AUTOMATED-VERIFIED | e2e:pi legs C and C2; e2e IME check |
| Rapid key switches keep edits without cross-action writes or pagehide-only saves | AUTOMATED-VERIFIED (simulated) / NOT RUN (app) | unchanged mouseleave/blur flush; e2e race checks |
| "Saved" and "edits still save" match evidence | IMPLEMENTED | copy unchanged from the bench-verified state; no new such claim added |
| Folds session-only, per kind, in plugin memory; timeout and late-response races | AUTOMATED-VERIFIED | e2e fold checks; the four Advanced groups use the same memory (ids match the plugin's `sec-*` rule, 9 of 12 slots) |
| No false Live during a source hold; forced Gadget not called "HWiNFO not running" | AUTOMATED-VERIFIED (simulated) | unit `isHolding`, preview `holding`; e2e "held source reads Reopening"; forced-source line checks |
| Missing, unavailable, empty, stale, silent plugin and config errors distinguishable | AUTOMATED-VERIFIED | e2e "truth" checks |
| Reliable stale age; unknown stays unknown; constant values never stale | AUTOMATED-VERIFIED | unit preview tests (Shared Memory only, rounded like the hint); Gadget stays "Age unknown" |
| Schema, defaults, renderer and profile contracts compatible | AUTOMATED-VERIFIED | no stored field added or changed; unit 1348 of 1348, including the docs-capture provenance guard after the capture was regenerated |

## Matrix and safe qualification

| Item | Status | Evidence |
| --- | --- | --- |
| Four panel types and the variant fixtures, all-folded and partial folds | AUTOMATED-VERIFIED | density states and e2e fixtures |
| 320x400, 320x560, 380x560, 380x720, 400x800, 560x800 plus the host size | AUTOMATED-VERIFIED (simulated) | REPORT.md matrix |
| Real OS scaling vs zoom vs DPR emulation | NOT RUN | only DPR 1 emulation and zoom proxies: the strip probe at 189 and 160 px wide (378 and 320 at 200%) shows 0 overflow, every chip reachable and every chip name whole (REPORT.md) |
| Repository gates | AUTOMATED-VERIFIED | lint 0, typecheck 0, unit, e2e-pi-panels, e2e:pi, copy validator (REPORT.md); `npm run e2e`, `test:native`, `suite:full`, `pack`, `release:validate` NOT RUN |
| Coverage ledger, no weakened assertions or golden refresh | IMPLEMENTED | review/pi-density/COVERAGE.md |
| Process-killing harness isolated; profiles, clipboard, hardware untouched | IMPLEMENTED | suite:full not run; own lab ports; installed plugin untouched |
| Picker latency and preview volume compared equivalently | AUTOMATED-VERIFIED | perf-candidate.json vs baseline/perf-4bf09c0.json (same load, 33 samples each); preview-volume.json |
| Two render/inspect/regression passes without new P0/P1 | AUTOMATED-VERIFIED for the fixes; a third independent pass NOT RUN | pass 2 found no P0 and two new P1 (cross-group click, 200% zoom wrap); both fixed and re-measured (e2e "a click in the other group selects the member clicked, and no member moves"; strip probe). reviews/second-pass.md |
| Report, evidence, risk register, continuation delivered | IMPLEMENTED | REPORT.md, CONTINUATION.md, reviews/, report-tables.md |
| Docs text and images match the panels | IMPLEMENTED | 18 images recaptured on the final tree (13 panel shots, full panel, two Advanced shots, new strip shot, dial colors capture), alt text rewritten; the sensor-details page's Press images and prose predate F01's labels and are listed in CONTINUATION.md |

## UXR follow-through

| Item | Status | Evidence |
| --- | --- | --- |
| Frequency, gallery priority, preview use, fold memory marked as hypotheses | IMPLEMENTED | UXR-PLAN.md H1 to H5 |
| Formative study with novice, power and AT users | NOT RUN (planned) | UXR-PLAN.md |
| Walkthroughs not called studies | IMPLEMENTED | reviews/README.md, REPORT.md |
