# Brief: set the shared theme from the theme gallery

## The owner's request (2026-09-26, paraphrased)

The theme gallery at the top of a key's or dial's settings panel sets the
theme for THIS key or dial. To change the SHARED theme (what every key and
dial set to Default draws), the only route is the **Change** link on the
theme line, which opens Advanced > Shared defaults and focuses a plain
**Theme** select: names only, no colors. The owner asks whether there
should be a way to use the gallery itself to set the shared theme, "maybe
with a right click or something similar"; Change is good and could stay,
but the select is less intuitive because it has no visuals. He wants a
simple, elite, patterned solution, evaluated by five reviewers, then built.

## The product today (build 1.7.0.0-d06, worktree C:\Users\stephen\git\hwinfo-pi-density)

- Panels: `com.lawrensen.hwinfo.sdPlugin/ui/sensor-reading.html` and
  `sensor-dial.html` (markup), `pi-common.js` (renderGallery, themeChip,
  renderThemeLine, renderThemeHelp, renderThemeFold, pickTheme; search
  "theme"), `pi-shell.js` (reveal(), announce(), folds), `pi-model.js`,
  `pi.css` (the band at "the look band", the fold row at the end).
- The band is a folding section (`details#sec-theme.hw-sec.hw-look.hw-look-fold`,
  open on a first visit). Its summary is the theme line: "Theme Default
  (shared: Void)" with **Change** outside the row (right side at 300 px and
  wider; its own line under the row below 300 px), or "Ember (set on this
  key)" (Change then holds its place, invisible and unfocusable). Folded, the
  row shows the checked chip as a small chip.
- Eight chips in two rows of four: **Default** (dashed frame, link mark,
  drawn in the resolved shared palette; means "follow the shared theme"),
  then the seven presets, each drawn in its own palette with its name.
  A radiogroup; arrow keys move and select; one Tab stop.
- Shared defaults (Advanced > Shared defaults, marked "All keys and dials")
  has the **Theme** select (options Void, Graphite, Ultraviolet, Midnight,
  Forest, Ember, Paper; writes the global setting `theme`), Text color,
  Accent colors, Data units. Changing it redraws every HWiNFO key and dial on
  every Stream Deck that is set to Default. It writes immediately; no confirm.
- The Replace shared settings button uses arm-then-confirm (first press arms,
  "Press again to ..."; a quick double click only arms; leaving disarms).
- Screenshots of the current panel: `docs/assets/img/pi-theme-strip.png`,
  `pi-theme-folded.png`, `settings-panel.png`, `pi-live-key-advanced.png`.

## Owner's standing rules (must hold)

Every theme name visible on its chip; Default keeps its link mark and dashed
frame; the resolved theme is visible on the theme line; 28 px control scale
(24 px minimum targets); the band folds like a section and its folded row
keeps the checked chip; no new setting stored in a key's settings for UI
state; opening a panel writes nothing; an edit changes only what it names.
No em dashes in any user-facing text (docs/release/COPY_RULES.md applies).

## Real-host facts (the Stream Deck app's QtWebEngine, Chromium 130)

- The panel is 373 x 410 CSS px at 1.5x. Escape never reaches a panel. Clicks
  on the app's own chrome send nothing. pagehide saves never land. Panel web
  storage is per panel (fresh on every key selection).
- NEW, observed today: the app re-serializes messages from the plugin to the
  panel and sorts object keys alphabetically (the chips render in the order
  of the themes object's keys, so on hardware they show Default, Ember,
  Forest, Graphite, Midnight, Paper, Ultraviolet, Void, while the Shared
  defaults select and every simulated capture show Void, Graphite,
  Ultraviolet, Midnight, Forest, Ember, Paper). That order bug is being fixed
  separately (an explicit order array); treat the defined order as the one.
- UNVERIFIED: whether a right click (the `contextmenu` event) reaches a panel
  in the app, or whether the app shows its own menu. Nobody may drive the
  real app to find out (the owner keeps control of it). A design that
  depends on right click must say how it works if right click never arrives.

## How to try things (simulated host only)

`scripts/lib/pi-sim.mjs` serves the panel files with a simulated Stream Deck
socket and sample data; `scripts/lib/cdp.mjs` drives headless Chromium. See
`C:\Users\stephen\AppData\Local\Temp\claude\C--Users-stephen-git-hwinfo-streamdeck\91b47c1b-9d80-49d5-bfea-6c93b12f0164\scratchpad\themefold\verify2.mjs`
for a full working example (fixtures key-configured, key-empty,
dial-configured; `sim.writes` / `sim.globalWrites` record settings writes).
Run with `C:\Users\stephen\git\hwinfo-pi-density\node_modules\.bin\tsx`.
Set `PI_SIM_PLUGIN_DIR` to a COPY of the plugin folder if you prototype;
never edit the worktree. Kill every headless Chrome you start (its
`--remote-debugging-port`); the cdp helper's close() leaves them alive.

## Do not

Edit the worktree or anything outside your own temp folder; start, stop or
drive the Stream Deck app, HWiNFO or the installed plugin (a 48-hour soak is
running on the deck); run `scripts/e2e-*.mjs` or `npm run suite:*`; claim
user research or real-app observation you did not do. You are an AI
reviewer doing expert inspection, not a user study.

## Candidate directions (evaluate these; add your own)

A. Right click (and the context-menu key / Shift+F10, long press for touch)
   on a chip opens a small menu: "Use for this key" and "Make the shared
   theme".
B. A promote action on the theme line after an explicit pick: "Ember (set
   on this key)" gains a link such as "Use for all" that makes Ember the
   shared theme (and optionally sets this key back to Default).
C. A scope switch above or beside the chips (This key | All keys and dials)
   so the same gallery edits either the key's theme or the shared theme.
D. Change keeps its job but the Shared defaults Theme select becomes the
   same named chip gallery (visual), so the shared theme is picked with
   visuals wherever it is picked.
E. Change opens the shared theme in the band itself (the gallery switches
   to editing the shared theme, with a clear "shared" state and a way back).
F. Do nothing beyond D-like visuals; argue why.
