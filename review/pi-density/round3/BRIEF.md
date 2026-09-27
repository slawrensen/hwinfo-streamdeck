# Round 3 reviewer brief (shared by all five reviewers, 2026-09-26)

Every reviewer reads this same brief. Your role is in your task prompt.

## Rules

- Read-only on every repository. Never create, edit or delete files under
  `C:\Users\stephen\git\`. Scratch files go only under
  `%TEMP%\hw-r3-<your role>` (create it).
- Never start, stop, restart or attach to the Stream Deck app, HWiNFO or
  the installed plugin; never connect to the app's DevTools port 23654
  (real-host checks belong to the integrator). Never touch the clipboard.
  Never run `npm run suite:full`, `npm run e2e`, `scripts/pi-harness.mjs`,
  `scripts/capture-pi*.mjs` or anything else that spawns the real plugin.
  Stop only processes you started (track their PIDs).
- Use only your lab port base (each lab owns base..base+2).
- Label every claim MEASURED (you ran it), READ (code or files) or
  INFERRED (your judgment). Give commands, fixture, viewport, file:line.
- No finding quota. A reproducible "this works" beats an invented issue.
  Separate observed defects from hypotheses and from taste.
- Name the regressions your own recommendations could introduce.
- No em dashes in your report.

## The product and its goal

A Windows Stream Deck plugin that puts live HWiNFO sensor readings on keys
and dials. Its settings panels (property inspectors, "PIs") are narrow HTML
pages the Stream Deck app embeds. The goal of this campaign: exceptionally
polished, calm, cozy, compact, understandable software that serves BOTH a
complete beginner and a demanding power user. "Cozy" means reassuring
clarity, comfortable readability, predictable behavior, thoughtful defaults
and low cognitive friction; not decorative clutter, oversized controls or
infantilizing language. "Compact" means clear grouping, less redundant
explanation, fewer unnecessary gaps, stable layouts and efficient repeated
interactions; never smaller text, microscopic targets, overlapping hit
areas, tooltip-only labels or hidden state.

The interface must make these easy to answer: What reading am I looking at?
Is its data available and live? What appearance is selected? Is it chosen
here or inherited? What does the inherited choice resolve to? Which group
receives newly ticked readings? Which reading is selected for editing?
Which reading is on the dial now? What will my next click, turn or press
change? How do I recover from an unavailable reading or a mistaken edit?

## Non-negotiable contracts (do not recommend breaking these)

1. Theme chips stay named and visible without hovering: Default, Void,
   Graphite, Ultraviolet, Midnight, Forest, Ember, Paper. Default keeps its
   link mark and shared-theme meaning, and the resolved theme stays visible
   somewhere without a tooltip. The theme controls stay directly under the
   pinned header in every fold state (owner's rule).
2. The Open all / Fold all pair is Lucide `chevrons-up-down` /
   `chevrons-down-up` with no center stroke (owner approved 2026-09-26).
3. The 28 px control scale is the working baseline (standard controls 28 px,
   targets at least 24 px).
4. No functionality removed. Rotation groups, the polling setting ("Read
   every"), gesture presets (Legacy, Elite, Custom), plain-rotate versus
   group-switch behavior and every stored field keep their semantics.
5. Settings integrity: opening, browsing, hovering and folding write
   nothing; an edit writes only the field it touched; unknown stored values
   and fields survive; per-action versus shared (global) scope unchanged.
6. No timing, polling, sensor, transport, native-bridge or control-map
   redesign; no new modes, global settings, banners, onboarding overlays,
   animation systems or frameworks unless a demonstrated problem requires it.

## Baseline under review

- Worktree `C:\Users\stephen\git\hwinfo-pi-density`, branch
  `claude/pi-density`, uncommitted on commit `4bf09c0`. Tree fingerprint
  (sha256 over every tracked and untracked file outside review/pi-density)
  `bc836455dfb26ec9`. Panel build token `1.7.0.0-d03`.
- FROZEN COPY of exactly these panels (review this, not the live tree,
  which the integrator may change while you work):
  `C:\Users\stephen\AppData\Local\Temp\claude\C--Users-stephen-git-hwinfo-streamdeck\91b47c1b-9d80-49d5-bfea-6c93b12f0164\scratchpad\r3-baseline\com.lawrensen.hwinfo.sdPlugin`
  Set `PI_SIM_PLUGIN_DIR` to it for every lab run.
- The same bytes are installed in the owner's real Stream Deck app (do not
  touch it).
- Panel sources (read them in the frozen copy or the worktree; identical
  now): `ui/sensor-reading.html` (Sensor Reading key), `ui/sensor-dial.html`
  (Sensor Dial), `ui/control.html` (HWiNFO Control key),
  `ui/detail-slot.html` (detail tile), `ui/pi.css`, `ui/pi-shell.js`
  (header, status, bindings, folds), `ui/pi-common.js` (pickers, rotation
  editor, theme chips, summaries), `ui/pi-model.js` (pure summaries). Plugin
  side of the preview: `src/pi-protocol.ts`, `src/poller.ts`. Rotation and
  gesture semantics: `src/actions/sensor-dial.ts`, `src/controls/`,
  `docs/controls.md`, `docs/sensor-dial.md`.
- History (claims to reproduce, not to trust): `review/pi-density/REPORT.md`,
  `review/pi-density/reviews/README.md`, `reviews/second-pass.md`,
  `review/pi-density/first-screen/*.png`.

## Real host facts (bench 2026-09-23, Stream Deck 7.4.2, QtWebEngine 6.9.3 / Chrome 130)

The panel is 378 x 410 CSS px at DPR 1.5 with a **373 px client width**.
Escape never reaches the page; each key selection loads a fresh page; saves
from `pagehide` never land; web storage is per panel. Fold state lives in
the plugin's memory for the session.

## Tools (from `C:\Users\stephen\git\hwinfo-pi-density`, Chrome at the default path)

```
set PI_SIM_PLUGIN_DIR=<frozen copy above>
set PI_LAB_PORT_BASE=<your port base>
npx tsx scripts/pi-lab.mjs capture <outDir> --widths 373,320 [--only key-configured,dial-groups] [--dpr 2]
npx tsx scripts/pi-lab.mjs density <out.json> --sizes 373x410,320x560 [--shots <dir>]
npx tsx scripts/pi-lab.mjs a11y <out.json> --widths 373,320 --height 410
npx tsx scripts/pi-lab.mjs perf <out.json>
```

`a11y` adds axe-core 4.13.0 when
`AXE_CORE=C:\Users\stephen\git\slawrensen-site\node_modules\axe-core\axe.min.js`.
Fixtures (`scripts/lib/pi-fixtures.mjs`): key-empty, key-configured,
key-dense, key-triple, key-custom-dim, key-inherited, key-alert,
key-unavailable, key-stale, key-missing, key-back, key-details,
key-zero-negative, dial-empty, dial-configured, dial-groups, dial-alert,
dial-custom-gestures, dial-unavailable, dial-missing, control-default,
control-reset, slot-back, slot-reading. The simulator
(`scripts/lib/pi-sim.mjs`) also has data states (for example `holding`).
For your own interaction scripts, copy and adapt these integrator probes
(import `scripts/lib/cdp.mjs` and `scripts/lib/pi-sim.mjs` by file URL):
`%SCRATCH%\named-final.mjs`, `strip-final.mjs`, `target-audit.mjs`,
`icon-check.mjs`, `first-screens.mjs`, where `%SCRATCH%` is
`C:\Users\stephen\AppData\Local\Temp\claude\C--Users-stephen-git-hwinfo-streamdeck\91b47c1b-9d80-49d5-bfea-6c93b12f0164\scratchpad`.
Integrator baseline measurements (may still be writing when you start):
`review/pi-density/round3/density-r3-baseline.json` and full-page shots in
`%SCRATCH%\r3-baseline-shots\<fixture>--<state>--<W>x<H>.png`.
The existing e2e contract suites are `scripts/e2e-pi-panels.mjs` and
`scripts/e2e-pi-persistence.mjs`. Read them to see what is asserted; do not
run them (they use fixed ports, and the integrator runs them).

## Viewports

373x410 (the app's real client width and panel height), 320x560 (narrow
reference), 189x410 and 160x410 (378 and 320 at 200% zoom), 380x720 (tall).

## Evidence categories and severity

Evidence category: `reproduced-defect`, `measured-friction`,
`standards-backed` (cite the standard and check its actual conditions),
`walkthrough-hypothesis` (simulated cognitive walkthrough; never invent user
quotes or completion rates), `aesthetic-preference`.

Severity: S1 data or settings loss, broken behavior; S2 misleading state or
an irreversible mistake; S3 accessibility barrier or blocked core task;
S4 repeated workflow friction; S5 readability, hierarchy, density;
S6 cosmetic.

## Deliverable

Return the structured result your task asks for. Also write the same
content as Markdown to `%TEMP%\hw-r3-<your role>\report.md`. Each finding
needs: the exact state, task and viewport examined; observed behavior and
evidence; severity and affected user (beginner, power user, keyboard, screen
reader, low vision, everyone); confidence (high, medium, low) and evidence
category; a minimal correction; the likely trade-off or regression risk; a
concrete acceptance test; and list separately what already works and should
stay unchanged.
