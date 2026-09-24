# F01 review record: essentials-first property inspector and device preview

Branch `claude/sweet-shannon-lss3s9`, based on `main` at
`2ca44e95c2d8b3442c3ed411952621b254d4cbf0` (release 1.6.0.0). No version
bump. Everything measured here ran on Linux in headless Chromium against
a **simulated Stream Deck host** (`scripts/lib/pi-sim.mjs`) that serves
the shipped panel files and answers with the production preview builder
and renderers over sample data. Nothing ran in the Stream Deck app's
embedded webview, against live HWiNFO, on a physical device, or with a
person. Those gates are listed at the end as NOT RUN.

Contents: baseline, research evidence, task measurements, layout studies
and decision, information architecture, visual system, state model,
preview parity and precedence, compatibility, validation, performance,
accessibility, security, independent reviews, integration dependencies,
remaining gates, rollback, candidate identity.

Related files: [coverage-map.md](coverage-map.md) (one row per setting),
[acceptance-ledger.md](acceptance-ledger.md),
[human-test-script.md](human-test-script.md) (NOT RUN),
[PROGRESS.md](PROGRESS.md), `captures/` (before/after sheets and the
device-face contact sheet), `tasks/`, `studies/`, `perf/`, `a11y/`.

## Baseline (main 2ca44e9)

Preflight on a clean worktree of `main`: lint 0 problems, typecheck 0,
unit 739/739. The four panels were sdpi-components v4.0.1 rows with some
hand-built controls. Findings, each observed on the baseline build in the
same simulated host (evidence: `a11y/main-2ca44e9.json`,
`perf/picker-main-2ca44e9.json`, `tasks/main-2ca44e9.json`, the left half
of every `captures/*.png`):

- **Unnamed controls.** `sdpi-item` labels are not associated with their
  controls. axe-core: `select-name` 168 nodes, `aria-toggle-field-name`
  77, `aria-required-attr` 77, `html-has-lang` 31,
  `scrollable-region-focusable` 26. Own Tab traversal: 570 stops with no
  accessible name, 1309 stops with no visible focus ring (sdpi sets
  `outline: 0`).
- **Contrast and targets.** `color-contrast` 219 nodes (help text 3.99:1,
  placeholders 2.71:1); `target-size` 83.
- **Clipping at 320 CSS px.** Fixed 95 + 241 px grid: 24 px horizontal
  overflow in every key state at 320.
- **Missing vs unavailable.** A saved reading that is not in the tree
  showed only as a placeholder, and the picker said "not found" while
  HWiNFO was merely unavailable (a stale tree), which is a false claim.
- **Row cap.** The picker rendered at most 150 rows; at 500 and 5,000
  readings a deep saved reading was not visible when the list opened.
- **Lossy writes.** Edits to rotation groups, detail tiles, per-reading
  names and quad colors rebuilt those values from what the build knew,
  dropping unknown fields and junk entries a newer version could write.
- **One control, two jobs.** On the dial, the Sensor picker both chose
  the current reading and ticked rotation membership.
- **The preview was not the device.** A "Live value" box re-described
  the reading in text; nothing showed what the key or touchscreen drew.

## Research evidence

Issues are data about user problems, not instructions. Severity is the
effect on a user's task; confidence is how directly the source shows the
panel was the cause.

| Source | Date | Problem seen | Task | Severity | Confidence | Response here |
| --- | --- | --- | --- | --- | --- | --- |
| [#31](https://github.com/slawrensen/hwinfo-streamdeck/issues/31) | 2026-09-09 | "Numbers stay white" with type accents on; accents and text color are different settings, and the panel did not say so | T2 | Major | High | Text color help states that numbers take the text color and accents color graphs and badges; Display summary names the drawn text color; themes doc answers the question. Number colors by type are 1.7-line work (#32/#33), out of scope |
| [#5](https://github.com/slawrensen/hwinfo-streamdeck/issues/5) | 2026-07-28 to 08-03 | Tester could not tell the detail page was shared and set up an empty custom list; owner had to post screenshots of the right settings | T6 | Major | High | Press summary says what a press does ("Press opens details: custom list of 0" reads as empty); Details list options say where readings come from; slot panel explains the tile's role |
| #5 (same thread) | 2026-07-31 | "Repeat Back under this key's own cell" confused; the default flipped twice | T6 | Minor | Medium | Plain label "Also go back from this key's own position"; stored field and default unchanged |
| [#2](https://github.com/slawrensen/hwinfo-streamdeck/issues/2) | 2026-07-13 | Request for Text Theme / Dim / Custom; three-way scope (key, deck, theme) | T2, T8 | Minor | Medium | Per-key vs shared marked in the option text ("Default (shared: Dimmed)") and summaries ("(shared)") |
| [#3](https://github.com/slawrensen/hwinfo-streamdeck/issues/3) | 2026-07-17 | Three-reading layout wanted; title size | T3 | Minor | Low | Layout moved into Reading as "Readings on this key"; the header shows the drawn face; a chosen layout that cannot draw yet says so |
| [#1](https://github.com/slawrensen/hwinfo-streamdeck/issues/1) | 2026-07-12 | Multiple sensors per key | T3 | Minor | Low | as #3 |
| [#17](https://github.com/slawrensen/hwinfo-streamdeck/issues/17) | 2026-08-02 | "Sensors freeze"; no signal in the app that data stopped | T7 | Major | Medium | Header state "Not updating" (key) / "HWiNFO stalled" (dial) and a status block with Retry now; never "Live" while stale |
| [#21](https://github.com/slawrensen/hwinfo-streamdeck/issues/21) | 2026-09-03 | Picker offered 4 of 25 Gadget readings (reader bug, fixed in #22) | T1 | Major | Low (reader, not panel) | Picker no longer caps rows; "HWiNFO publishes no readings" is told apart from "no matches" |
| [#35](https://github.com/slawrensen/hwinfo-streamdeck/issues/35) | 2026-09-22 | Filter union request | T6 | n/a | n/a | Out of scope (hard exclusion: no filter-union feature) |
| Baseline audit (this record) | 2026-09-23 | Unnamed controls, contrast, 320 clipping, lossy writes, row cap, false "not found" | all | Major | High | See Baseline; fixed and measured below |

## Task measurements (automated expert walkthrough)

Method: `npx tsx scripts/pi-lab.mjs tasks <out.json>` drives each panel in
headless Chromium on the simulated host at 320 and 480 CSS px (800 px
tall) and, for each task's target control, records the Tab stops from the
top of the panel, the collapsed sections that must be opened, and whether
the target is on the first screen without scrolling. This is an expert
walkthrough by script, **not a human study**; it measures reach, not
comprehension or success. Human validation: NOT RUN
([human-test-script.md](human-test-script.md)).

Cells read `Tab stops / folds to open / on first screen` at 320 px
(`tasks/main-2ca44e9.json`, `tasks/candidate.json`):

| Task | Target | main 2ca44e9 | candidate |
| --- | --- | --- | --- |
| T1 | Pick a reading | 2 / 0 / yes | 2 / 0 / yes |
| T2 | Change decimals | 6 / 0 / yes | 8 / 0 / yes |
| T2 | Theme gallery | 8 / 0 / yes | 11 / 0 / yes |
| T2 | Text color (this key) | 16 / 0 / yes | 13 / 0 / no |
| T3 | Layout select | 17 / 0 / yes | 5 / 0 / yes |
| T4 | Warn threshold | 19 / 0 / no | 14 / 1 / no |
| T5 | Rotation membership list | 2 / 0 / yes | 6 / 0 / yes |
| T5 | Rotation order (first move button) | 9 / 0 / yes | 11 / 0 / yes |
| T6 | Press behavior | 7 / 0 / yes | 15 / 1 / no |
| T6 | Dial controls preset | 26 / 1 / no | 28 / 1 / no |
| T7 | Missing-reading status | 2 / 0 / yes | 4 / 0 / yes |
| T8 | Shared theme default | 21 / 1 / no | 16 / 1 / no |
| T9 | Config document | 21 / 1 / no | 16 / 1 / no |

Reading the deltas honestly:

- **Better:** T3 layout (17 to 5 stops, now beside the reading), T8/T9
  (21 to 16), T2 text color and T4 warn (fewer stops). Each target now
  has a programmatic name, so a Tab stop is also a spoken stop; on main
  most stops were unnamed.
- **Worse:** T6 press behavior (7 to 15 stops plus a fold) and T4 warn
  (now behind the folded Alerts section; at 480 px it was on main's first
  screen and is not here). T5 membership moved 4 stops later because the
  current-reading combobox and its refresh button now come first. T2
  text color left the first screen at 320 px. Each section summary is
  itself a Tab stop, which adds one stop per section passed.
- **Offset, not measured by this metric:** every folded section's title
  line states its current behavior ("Warn ≥ 80 °C · critical ≥ 90 °C",
  "Press cycles current, min, max, avg"), so checking a setting no
  longer needs the control. Whether that offsets the extra reach for
  editing is exactly what the NOT RUN human study must answer.
- The theme gallery became one radio group during this run (it was eight
  Tab stops); without that change T2 text color, T4, T6, T8 and T9 were
  7 stops longer.

## Layout studies and decision

Three studies of the same real panel, coded as injected CSS/JS
(`scripts/pi-studies/`, never shipped), captured at 320 and 480 px
(`studies/*.png`) and measured with the same task script
(`studies/tasks-a|b|c.json`, regenerated on the final panel code):

- **A. Essentials-first vertical.** Header, then Reading and Display
  open, Alerts, Press/Controls and Advanced folded with summaries.
- **B. Compact task sections.** Everything but Reading folded;
  label-left rows.
- **C. Preview-led.** A large face pinned at the top; sections below as a
  folded task list.

Cells as above, 320 px:

| Task | Target | A | B | C |
| --- | --- | --- | --- | --- |
| T1 | Pick a reading | 2 / 0 / yes | 2 / 0 / yes | 2 / 0 / yes |
| T2 | Change decimals | 8 / 0 / yes | 6 / 1 / yes | 6 / 1 / yes |
| T2 | Theme gallery | 11 / 0 / yes | 6 / 1 / yes | 6 / 1 / no |
| T2 | Text color (this key) | 13 / 0 / no | 6 / 1 / no | 6 / 1 / no |
| T3 | Layout select | 5 / 0 / yes | 5 / 0 / yes | 5 / 0 / yes |
| T4 | Warn threshold | 14 / 1 / no | 7 / 1 / yes | 7 / 1 / yes |
| T5 | Rotation membership list | 6 / 0 / yes | 6 / 0 / yes | 6 / 0 / yes |
| T5 | Rotation order | 11 / 0 / yes | 11 / 0 / yes | 11 / 0 / yes |
| T6 | Press behavior | 15 / 1 / no | 8 / 1 / yes | 8 / 1 / yes |
| T6 | Dial controls preset | 28 / 1 / no | 20 / 1 / no | 20 / 1 / no |
| T7 | Missing-reading status | 4 / 0 / yes | 4 / 0 / yes | 4 / 0 / yes |
| T8 | Shared theme default | 16 / 1 / no | 9 / 1 / yes | 9 / 1 / no |
| T9 | Config document | 16 / 1 / no | 9 / 1 / no | 9 / 1 / no |

**Decision: A, with C's pinned face and B's spacing.** A is the default
the brief names, and it is the only study where the appearance tasks
(T2: the subject of #2, #3 and #31, the most-asked panel questions) need
no fold. B and C shorten the reach to Alerts, Press and Advanced by
folding Display, which moves a fold onto every appearance edit and hides
the theme gallery, the one control whose effect the header face shows
live. Taken from C: on panels at least 560 px tall the header (with the
exact device face) is sticky; the shell measures its height into
`--hw-head-h`, which sets `scroll-padding-top` and the sticky offset of
the "Add readings" dock, and a header taller than a third of the panel
(the dial header wraps at narrow widths) is not pinned at all. The
traversal check walks forward and back (Shift+Tab) at 320 and 400 px. Taken from B: the tighter
field rhythm (8/12 px) that keeps Reading and Display within the first
screen at 480 px. Rejected from B: label-left rows (they are what
clipped at 320 on main). Rejected from C: a face larger than the device's
own proportion (it invited reading detail the key does not show). Cost
accepted: T4 and T6 reach, above. Revisit if the human study shows
editing alerts or press behavior is harder than on main.

## Information architecture

Every panel uses the same order; sections a given action does not have
are absent, never empty.

| Section | Sensor Reading key | Sensor Dial | HWiNFO Control key | Detail tile |
| --- | --- | --- | --- | --- |
| Header | exact key face, reading, source, state | exact touchscreen face, reading, source, state | command and target in words (no face: the key draws an icon) | tile role; no face |
| Reading | Reading, Label on the key, Readings on this key, Reading/Label 2 to 4, Row 2 shows | On the dial now, Title on the dial, Title after a turn, Readings to rotate through (checklist, chips, groups) | n/a | explanation only |
| Display | Value shown, Decimals, °F, Graph under the value, Theme, Text color, Cell colors | View (+ overview options), Decimals, °F, Theme, Text color, Bar from / to | n/a | n/a |
| Alerts | Warn at, Critical at, drop-below | same + alert-aware auto cycle | n/a | n/a |
| Interaction | Press: A press, Details list, Add readings, Filter, Readings per tile, Title tile text, second Back | Controls: preset, gestures, Touch zones, Ignore turns, Auto cycle, A stats reset clears, Link ID | Command: When pressed, A reset clears, Target | n/a |
| Advanced | Shared defaults and Connection (marked All keys and dials), Support, Configuration documents | same | Support | n/a |

The Back tile of the detail view shows its role in the header and hides
the Press section (its press is fixed); the stored `pressBehavior` is
never rewritten.

## Visual system

All color, spacing and type sizes are tokens on `:root` in `pi.css`
(`--hw-bg`, `--hw-text`, `--hw-muted`, `--hw-placeholder`, `--hw-link`,
`--hw-focus`, `--hw-edge`, state tones, `--hw-s1..s4`). Contrast of the
text tokens on each surface (WCAG ratio, computed from the token values):

| text \ surface | bg | raised | field | field hover | active row | warn | danger | info |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| text | 11.66 | 10.54 | 9.63 | 8.51 | 8.47 | 9.71 | 11.14 | 10.60 |
| muted | 6.94 | 6.28 | 5.73 | 5.07 | 5.04 | 5.78 | 6.63 | 6.31 |
| placeholder | 5.46 | 4.94 | 4.51 | 3.98 | 3.97 | 4.55 | 5.21 | 4.96 |
| link | 7.96 | 7.20 | 6.57 | 5.81 | 5.78 | 6.63 | 7.60 | 7.23 |
| ok / warn / danger text | 8.29 / 9.45 / 8.11 on bg | | | | | | | |

Placeholders appear only in empty fields (field surface, 4.51:1); on a
hovered field they step up to `#b0b0b0` (4.63:1), so the 3.98:1 cell is
never drawn. The focus ring (`#7cc4ff`) is
7.34:1 on the background; control borders are 3.30:1 against it. The
keyboard-highlighted picker row was 4.14:1 for its muted value text and
was darkened during this run to 5.04:1.

## State model

| State | Header | Reading section | Picker |
| --- | --- | --- | --- |
| Connecting | "Connecting to the plugin" | none | n/a |
| Plugin not answering (3 s, no message) | danger tone | "not answering this panel"; edits still save | n/a |
| Unconfigured | "No reading selected" | none | "Search readings" |
| Ready | "Live · Shared Memory" or "Live · Gadget" | none (Gadget note when relevant) | saved reading selected and scrolled into view on open |
| No matches | unchanged | none | `No readings match "…"` |
| HWiNFO unavailable | "No HWiNFO data" | reason, "your reading and every setting stay saved", Retry now, HWiNFO setup steps | "Saved reading kept (no HWiNFO data to show it)"; never "not found" |
| HWiNFO publishes nothing | state | "running but publishes no readings", setup steps | "HWiNFO publishes no readings right now." |
| Saved reading missing | "Saved reading not found" | kept with label and colors; Reload sensor list | "not found" placeholder |
| Stale | "Not updating" (key) / "HWiNFO stalled" (dial); never Live | what the device shows and that settings are unchanged; Retry now | unchanged |
| Unknown stored option | n/a | the select shows `Stored value "…" (not known to this version, kept)` | n/a |
| Unknown stored theme | n/a | no chip checked; help says what is drawn and that the value is kept | n/a |
| Validation failure | n/a | non-numeric threshold: error text tied to the field; nothing written | n/a |
| Pending (debounced text) | n/a | the field keeps focus and value; one write after 200 ms or on commit | n/a |
| Unsupported deck (details) | n/a | Press explains details are unavailable on this deck | n/a |
| Ambiguous identity | not on main | not on main | exists only on the unmerged 1.7 line; see Integration |

## Preview parity and precedence

The header face is the **exact SVG** the action last sent to the device
(`setImage` for keys, the feedback layout for dials), carried verbatim in
the preview payload (bounded at 64 KiB) and shown as an `<img>` data URL.
The panel never renders a face of its own. Parity is checked at three
boundaries:

1. **Semantics** (test/pi-preview.test.ts): thresholds parse like the
   runtime (decimal comma, junk ignored), an unavailable source is never
   missing, Custom text without a valid color draws theme text, an
   unknown theme draws the spec default, dial thresholds apply only in
   their anchored unit.
2. **Transport** (test/pi-preview.test.ts, e2e-pi-panels "parity"):
   `buildPreview` passes the face through unchanged; the header image is
   byte-equal to `compose()` / `composeDialSvg()` for 16 fixtures and 7
   variants (dual, quad labels, ring, bar critical, Paper dimmed, two-row
   dial, three-row dial with the context line below).
3. **Gate** (test/pi-preview.test.ts): the panel's layout summary uses
   `drawnKeyLayout`, the same function `compose()` branches on, so a
   chosen quad with one reading reads "shows one reading until another is
   picked" and draws byte-identical to a single key.

Precedence the summaries report (all resolved by the runtime functions
the renderers use, sent as `effective` in the preview):

| Property | Highest wins | Then | Then | Fallback |
| --- | --- | --- | --- | --- |
| Theme | alert palette while warn/critical (keys: whole face; dials: bar or row value) | this key's theme | shared theme (global) | spec default (also for an unknown stored id) |
| Text color | alert palette | this key's Text color (Theme text, Dimmed, Custom with a valid color) | shared Text color | theme text (also for Custom without a valid color) |
| Accent | alert palette | Paper and themes that disable type accents | shared Accent colors: By sensor type | theme accent |
| Layout | n/a | chosen layout if enough readings are picked | single | single (unknown markers) |
| Press | Back role (detail view) | A press | n/a | cycle stats (unknown values) |
| Dial gestures | Ignore turns (rotation only) | Custom map | Elite / Legacy preset | Legacy; a tap under two touch zones is dead and not listed |
| Thresholds (dial) | unit anchor: only readings in `alertUnit` | n/a | n/a | legacy reach when no anchor |

## Compatibility

- **Stored settings:** no field added, renamed, removed or re-typed; all
  defaults unchanged ([coverage-map.md](coverage-map.md)).
- **Zero writes on observation:** opening, previews, tree arrival,
  opening pickers, browsing with arrows and Escape write nothing
  (e2e-pi-panels "observe" over every fixture, including a document full
  of unknown fields).
- **Declared paths only:** each edit changes only its declared keys
  (e2e-pi-panels "edits", compared as whole documents).
- **Lossless, and a behavior change:** rotation groups, detail tiles,
  per-reading names, quad colors and key lists keep entries and fields
  this build does not know. On main those edits normalized them. Three
  tile expectations in `e2e-pi-persistence.mjs` asserted the defaults the
  old panel filled in (`colors: [null, null]`, `cellLabels: true`); they
  now assert the stored shape without them, which the runtime reads the
  same way (`src/detail/detail-settings.ts`: absent colors are null,
  `cellLabels` is true unless `false`). Other changed checks follow
  renamed copy; one check was added (the shared Replace's first click
  only arms); no assertion was dropped.
- **Unknown enums:** a stored option value this build does not know is
  shown as kept and written back only if the user picks another option.
- **Shared document Replace:** now needs a second click within 5 s.
- **Residual races and normalizations (accepted, all unchanged from
  main):** the SDK has no partial write, so a second app instance could
  overwrite a whole document; a Replace of the shared document can race
  a shared edit made in another panel in the same second; rotation edits
  go out as two writes (groups, then the mirror); with fewer than two
  non-empty groups the panel still edits the group and rewrites the
  mirror; duplicate `detailKeys` are dropped and a key stored with a
  pasted friendly name is written back bare (the runtime reads both the
  same way). Details: [reviews.md](reviews.md).
- **Downgrade:** a 1.6.0 panel opened on settings this build wrote sees
  the same fields it always did.

## Validation run

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` | 0 problems |
| Types | `npm run typecheck` | 0 errors |
| Unit | `npm test` | 789 / 789 (main: 739; +50: pi-model, pi-preview, widened build-token) |
| Panel suite (simulated host) | `npx tsx scripts/e2e-pi-panels.mjs` | 164 / 164 |
| Persistence suite (simulated host) | `npx tsx scripts/e2e-pi-persistence.mjs` | 551 / 551 |
| Copy validator | `node scripts/validate-release-copy.mjs` | only the 5 failures main also has (internal release docs absent from the public repo) |
| Docs anchors | scripted check of every `page.md#anchor` | 0 broken |
| Captures (simulated host) | `pi-lab.mjs capture` | 64 states each for main and candidate; 0 page errors; candidate overflow 0 px at 320 and 480 (and at 200 px in the states the review flagged) |
| Bundle | `npx rollup -c` twice | byte-identical `bin/plugin.js` both times (see candidate.md) |
| Accessibility | `AXE_CORE=… pi-lab.mjs a11y` | see Accessibility |
| Performance | `pi-lab.mjs perf` | see Performance |

NOT RUN here: `npm run test:native`, `npm run e2e` and the other live e2e
suites, `npm run suite:full`, `npm run pack`, `npm run release:validate`
(needs internal release docs), anything on the Stream Deck app, HWiNFO,
or a physical device.

## Performance

Harness: `npx tsx scripts/pi-lab.mjs perf <out.json>` (3 runs, 3 warm-up
then 11 timed queries each; time from input event to the next frame).
Headless Chromium on Linux x64, simulated host; not the embedded webview.

| Readings | main p50 / p95 (ms) | main rows rendered | candidate p50 / p95 (ms) | candidate rows rendered | deep selection visible on open (main / candidate) | open max (candidate) |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 16.8 / 17.3 | 0 | 16.8 / 17.2 | 0 | n/a | 4.4 ms |
| 1 | 16.6 / 18.0 | 1 | 16.8 / 17.7 | 1 | yes / yes | 8.2 ms |
| 500 | 15.3 / 21.2 | 150 | 16.9 / 21.8 | 500 | no / yes | 18.4 ms |
| 5,000 | 20.5 / 28.6 | 150 | 17.1 / 26.7 | 5,000 | no / yes | 62.6 ms |

The ~16.7 ms floor is one frame. The candidate renders every row (no cap)
at the same p95 as main's 150, because the list is built once per tree
and filtered in place; groups off screen skip layout
(`content-visibility: auto` with per-group size estimates) and the saved
row is scrolled into view after the first frame. Target p95 ≤ 100 ms:
met on this host. When no panel is visible the plugin builds nothing:
`pushPreviewToPi` returns before building a preview unless the SDK
reports a visible panel for that action, and the face is sent only when
it changed for that panel's context.

## Accessibility

Target: WCAG 2.2 AA intent and the ARIA APG patterns. **Not a
conformance claim.** Evidence: `a11y/candidate.json` (31 states at 400
and at 320 CSS px, 62 runs) and `a11y/main-2ca44e9.json` (31 states at
400 px) from `pi-lab.mjs a11y`: a real Tab traversal of every stop and
back again with Shift+Tab (name, visible ring, hidden-by-fold, fully or
partly under the pinned header) plus axe-core 4.13.0 (tags wcag2a,
wcag2aa, wcag21a, wcag21aa, wcag22aa).

| | main 2ca44e9 | candidate |
| --- | --- | --- |
| axe violations (nodes) | color-contrast 219, select-name 168, target-size 83, aria-required-attr 77, aria-toggle-field-name 77, html-has-lang 31, scrollable-region-focusable 26 | 0 |
| Own traversal issues | no-accessible-name 570, no-visible-focus 1309 | 0 |
| Horizontal overflow at 320 CSS px | 24 px (every key state) | 0 (also 0 at 240 CSS px, the 320 px width at 133%) |

axe "incomplete" (needs review) on the candidate: 56 nodes, all reorder
arrow buttons (axe skips contrast for glyphs it treats as icons),
checked by hand: `--hw-muted` 5.73:1 on a chip, `#dcebff` 5.21:1 on the
selected chip. No failure found.

Patterns: reading pickers are APG comboboxes (`aria-activedescendant`;
arrows inspect, Enter commits, Escape closes and restores, Tab never
commits); membership lists are native checkbox checklists that are one
Tab stop (Down Arrow enters, arrows move, Tab leaves), each box named
with its reading, source and value inside a named source group; reorder uses
named buttons ("Move GPU Power earlier") and keeps focus on the moved
item, with drag as an extra; the theme gallery is a radio group with a
roving Tab stop; errors are tied with `aria-describedby`; the status
block is a persistent `role=status` region that changes only when the
kind of problem changes (never per tick) and keeps a focused action
focused; list notes speak through one persistent polite region; the
header image's alt text is built from the words the face draws, so a
status screen is never described as a value. Zoom 100,
150 and 200% map to the 480, 320 and 240 CSS px captures. NOT RUN:
screen readers (NVDA, Narrator), Windows high contrast, the embedded
webview.

## Security

- User data, sensor labels, pasted JSON and previews reach the DOM only
  through `textContent`, attributes and `value`. The one `innerHTML` is a
  constant SVG glyph.
- The device face is displayed as an `<img>` data URL (scripts in an SVG
  image never run) and is bounded at 64 KiB.
- No `eval`, `new Function`, remote script, font or stylesheet; no
  network requests; no telemetry. Pasted configuration documents are
  parsed as JSON and treated as data.
- A preview for another action context is ignored.

## Independent reviews

Two read-only reviews ran on the change set: settings, protocol and
compatibility; UX, accessibility, preview and performance. Their
findings and dispositions are recorded in [reviews.md](reviews.md).

## Integration dependencies

This branch is built on `main`. Open work touches the same files:

- [#33](https://github.com/slawrensen/hwinfo-streamdeck/pull/33) (draft,
  release 1.7) and [#32](https://github.com/slawrensen/hwinfo-streamdeck/pull/32)
  change the dial panel (individual number colors), `pi-common.js`
  (identity, ambiguity, row cap) and the docs. Conflicts are expected;
  the "ambiguous reading" state exists only there.
- [#36](https://github.com/slawrensen/hwinfo-streamdeck/pull/36) (draft,
  into release-1.7) retires "Poll every", which this branch renames to
  "Read every".
- [#26](https://github.com/slawrensen/hwinfo-streamdeck/pull/26),
  [#27](https://github.com/slawrensen/hwinfo-streamdeck/pull/27),
  [#28](https://github.com/slawrensen/hwinfo-streamdeck/pull/28) (drafts)
  touch identity, recovery copy and contrast.

Nothing here claims the 1.7 candidate's behavior is preserved; only main
was tested. The PR stays a draft until the combined baseline is rebuilt
and every suite above plus the live gates pass on it.

## Remaining gates (NOT RUN)

1. The Stream Deck app's embedded webview: every capture, keyboard path
   and timing above, at 100/150/200% Windows scaling.
2. Live HWiNFO (Shared Memory and Gadget): `npm run e2e`,
   `e2e:resilience`, `e2e:gadget`, `suite:full`, `test:native`.
3. Physical devices: 15-key, XL, +, + XL (dial faces and touchscreen).
4. Screen readers: NVDA and Narrator on the four panels.
5. The moderated human study ([human-test-script.md](human-test-script.md)).
6. Pack and hash: `npm run build` with `hwsm.node`, `npm run pack`,
   `validate-native`.
7. Docs screenshots of the panel (`settings-panel.png`, `pi-*.png`):
   regenerate with `capture-pi.mjs` against the live pi-harness.
8. Integration with the 1.7 line (above).

## Rollback

The change is confined to the panel files, four plugin files
(`src/pi-protocol.ts`, the two sensor actions and the new
`src/ui/key-layout.ts`) that add fields to the preview message and share
the layout gate, docs, tests and scripts. Reverting the
branch's commits restores 1.6.0.0 panels. Settings need no migration in
either direction: this branch writes the same fields with the same
types, and keeps (instead of dropping) anything it does not know.

## Candidate identity

See [candidate.md](candidate.md) for the commit, bundle and UI file
hashes of the identified candidate.
