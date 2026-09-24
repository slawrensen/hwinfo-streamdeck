# F01 acceptance ledger

Status words: **MET** (evidence in this folder or the test suites),
**PARTIAL** (met on the simulated host or by construction, with a named
gap), **NOT RUN** (needs a host, device or person this run did not have),
**NOT MET**. Evidence paths are relative to the repository root.

| # | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| 1 | Read-only preflight; base and branch recorded | MET | README "Baseline"; base `main` 2ca44e9 |
| 2 | Control coverage map, one row per setting/control | MET | review/pi-essentials/coverage-map.md |
| 3 | Research evidence table (issues, source, date, severity, confidence, response) | MET | README "Research evidence" |
| 4 | Task set T1–T9 measured before and after, labeled expert walkthrough | MET | README "Task measurements"; tasks/*.json. Human validation NOT RUN (human-test-script.md) |
| 5 | Three coded layout studies A/B/C at 320 and 480 px; decision record | MET | studies/*.png, studies/tasks-*.json, README "Layout studies" |
| 6 | Shared IA (Header, Reading, Display, Alerts, Interaction, Advanced) per action | MET | four panels; coverage-map.md |
| 7 | Token-based restrained visual system | MET | pi.css `:root` tokens; README contrast matrix |
| 8 | Truthful states (unconfigured … validation failure) | PARTIAL | Simulated-host fixtures for each state (e2e-pi-panels "truth"); "ambiguous identity" exists only on the unmerged 1.7 line, not on main, so it is not represented here |
| 9 | APG combobox, checklist, reorder, radio group; keyboard complete | MET (simulated host) | e2e-pi-panels keyboard checks (combobox, one-Tab-stop checklist, reorder, radio group); a11y/candidate.json forward and Shift+Tab traversal |
| 10 | WCAG 2.2 AA target: names, focus, contrast, target size, reflow 320, zoom 200% | PARTIAL | axe-core 4.13.0: 0 violations in 62 runs (31 states at 400 and 320 px); 0 own traversal issues forward and back; 56 "incomplete" glyph buttons checked by hand (README); reflow 0 px overflow at 320 and 240 CSS px. Not a conformance claim; no screen-reader or embedded-webview run |
| 11 | Preview is the production-rendered device face; parity at three boundaries; precedence matrix | MET | e2e-pi-panels parity checks (byte-equal faces); test/pi-preview.test.ts; README precedence matrix |
| 12 | Lossless settings: unknown top-level, nested, array metadata, future enums; zero writes on observation; declared paths only | MET (simulated host) | e2e-pi-panels observe/edits/lossless (kept entries in place, unreadable tiles untouched); e2e-pi-persistence 551/551; test/pi-model.test.ts. Residual normalizations unchanged from main listed in README |
| 13 | Race handling and context validation | PARTIAL | e2e-pi-panels races (late preview, echoes, shared change, panel switch); residual races listed in README |
| 14 | Performance: 0/1/500/5000 fixtures, p95 ≤ 100 ms, no row cap, no work when closed | MET (simulated host) | perf/picker-candidate.json: p95 26.7 ms at 5000, every row rendered; PERF.md entry; plugin sends previews only to the visible panel (`streamDeck.ui.action` guard). Embedded-webview timing NOT RUN |
| 15 | Security: escaping, no eval, no remote dependencies, no telemetry | MET | README "Security"; review findings |
| 16 | Adversarial tests | MET | future-blob fixtures, junk entries, unknown enums, 64 KiB face bound, IME, rapid switching |
| 17 | Two independent read-only reviews | MET | reviews.md: 9 major findings (3 settings, 6 UX) plus the minor and nit findings; each one fixed, or recorded as a residual unchanged from main |
| 18 | Progress record and acceptance ledger | MET | PROGRESS.md, this file |
| 19 | Evidence: captures, device contact sheet | MET | captures/*.png (before/after), captures/device-faces.png |
| 20 | One identified final candidate with hashes | PARTIAL | bin/plugin.js and UI file hashes in README; `.streamDeckPlugin` pack NOT RUN (needs Windows `hwsm.node` and the Elgato CLI) |
| 21 | Public help, labels, screenshots, Unreleased notes | PARTIAL | docs/*.md and CHANGELOG Unreleased updated; the docs' panel screenshots are NOT regenerated (their documented run is the live pi-harness on the Windows bench) |
| 22 | One focused issue; linked draft PR with required sections | MET | see PR |
| 23 | No merge, tag, release, Marketplace, production or soak changes | MET | none performed |
| 24 | Live e2e, native suite, suite:full, physical devices, human study | NOT RUN | Windows + HWiNFO + Stream Deck hardware required |
