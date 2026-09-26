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
| 8 | Truthful states (unconfigured … validation failure) | PARTIAL | Simulated-host fixtures for each state (e2e-pi-panels "truth"). Bench 2026-09-23: unavailable, missing and hung-plugin states true on the real app; stale NOT RUN on hardware (HWiNFO elevated); open: D9 "Live" during the source-reopen hold, D10 hint wording. "Ambiguous identity" exists only on the unmerged 1.7 line |
| 9 | APG combobox, checklist, reorder, radio group; keyboard complete | PARTIAL | e2e-pi-panels keyboard checks; a11y/candidate.json traversal. The real app never delivers Escape; dismissal by Tab, a second click and focus loss instead (bench D3, D5) |
| 10 | WCAG 2.2 AA target: names, focus, contrast, target size, reflow 320, zoom 200% | PARTIAL | axe-core 4.13.0: 0 violations in 62 runs (31 states at 400 and 320 px); 0 own traversal issues forward and back; 56 "incomplete" glyph buttons checked by hand (README); reflow 0 px overflow at 320 and 240 CSS px. Not a conformance claim; no screen-reader or embedded-webview run |
| 11 | Preview is the production-rendered device face; parity at three boundaries; precedence matrix | MET after bench D2 | Same bytes, but QtSvg drew unit and badge gaps differently until inlineGap and xml:space (bench 2026-09-23, faces/); e2e-pi-panels parity; test/pi-preview.test.ts |
| 12 | Lossless settings: unknown top-level, nested, array metadata, future enums; zero writes on observation; declared paths only | MET (simulated host) | e2e-pi-panels observe/edits/lossless (kept entries in place, unreadable tiles untouched); e2e-pi-persistence 551/551; test/pi-model.test.ts. Residual normalizations unchanged from main listed in README |
| 13 | Race handling and context validation | MET after bench D1 | e2e-pi-panels races; on hardware a pagehide save never landed (0/20); the pointer-leave and blur flush saved 10/10 (bench 2026-09-23) |
| 14 | Performance: 0/1/500/5000 fixtures, p95 ≤ 100 ms, no row cap, no work when closed | MET | Simulated host: p95 26.7 ms at 5000. Real webview, 543 readings: p95 53.4 ms, max 60.3 ms, every row (bench perf/); previews only on change (D7) |
| 15 | Security: escaping, no eval, no remote dependencies, no telemetry | MET | README "Security"; review findings |
| 16 | Adversarial tests | MET | future-blob fixtures, junk entries, unknown enums, 64 KiB face bound, IME, rapid switching |
| 17 | Two independent read-only reviews | MET | reviews.md: 9 major findings (3 settings, 6 UX) plus the minor and nit findings; each one fixed, or recorded as a residual unchanged from main |
| 18 | Progress record and acceptance ledger | MET | PROGRESS.md, this file |
| 19 | Evidence: captures, device contact sheet | MET | captures/*.png (before/after), captures/device-faces.png |
| 20 | One identified final candidate with hashes | PARTIAL | bin/plugin.js and UI file hashes in README; `.streamDeckPlugin` pack NOT RUN (needs Windows `hwsm.node` and the Elgato CLI) |
| 21 | Public help, labels, screenshots, Unreleased notes | PARTIAL | docs/*.md and CHANGELOG Unreleased updated; the docs' panel screenshots are NOT regenerated (their documented run is the live pi-harness on the Windows bench) |
| 22 | One focused issue; linked draft PR with required sections | MET | see PR |
| 23 | No merge, tag, release, Marketplace, production or soak changes | MET | none performed |
| 24 | Live e2e, native suite, suite:full, physical devices, human study | PARTIAL | Bench 2026-09-23: suite:full green on Windows with live HWiNFO, real app, + XL canvas; NVDA, photos and the human study NOT RUN |
