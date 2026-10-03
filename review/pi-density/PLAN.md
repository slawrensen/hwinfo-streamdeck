# Panel density pass: plan, field map, baseline and backlog

Written before any panel change and kept as written. Where REPORT.md
differs, REPORT.md is what shipped in the tree: the theme gallery moved out
of Display into an always-open strip under the header (owner's rule,
palette study), and a held source reads "Reopening source", not
"Reconnecting". Measurements come from
`npx tsx scripts/pi-lab.mjs density` (added in this pass) on the simulated
host (`scripts/lib/pi-sim.mjs`, sample data, headless Chrome on Windows 10,
Segoe UI), unless a line says otherwise. Nothing here ran in the Stream Deck
app or on a device.

## Starting state

| Item | Value |
| --- | --- |
| Base | `claude/f01-on-1.7` at `4bf09c0` (PR #39, the combined 1.7.0 candidate: F01 panels merged onto the 1.7 line, #36 deferred, "Read every" kept) |
| Work branch | `claude/pi-density` in worktree `C:\Users\stephen\git\hwinfo-pi-density`; created clean from `4bf09c0`, nothing else touched |
| Dirty diff at start | none |
| Panel stack | Plain HTML + CSS + four classic scripts (`pi-model.js` pure logic, `pi-shell.js` header/status/bindings/folds, `pi-common.js` pickers/editors/summaries, `pi-control.js` support button), vendored sdpi-components v4 only for its socket client and settings stores. No framework |
| Settings owners | Action settings through `useSettings` (whole document per save); global settings through `useGlobalSettings`; folds in plugin RAM (`src/panel-folds.ts`) per panel kind; face and effective state from `src/pi-protocol.ts` `buildPreview` |
| Host facts (bench 2026-09-23, Stream Deck 7.4.2, QtWebEngine 6.9.3) | Panel 378x410 CSS px at DPR 1.5, 373 px client width; header never pins there (rule needs 560 px height); Escape never arrives; pagehide saves never land; every key selection is a fresh page with fresh web storage |
| Gates at start | lint 0, typecheck 0, unit 1343/1343, `e2e:pi-panels` ALL GREEN, `e2e:pi` (persistence) ALL CHECKS PASSED |

The supplied review kit (`HWiNFO-UIUX-Review-Kit.zip`) measured images of
an older bench build (f01j to f01n on the 1.6 base). Its numbers are clues;
the table below re-measures the current code.

## Baseline at 380x720 (4bf09c0 panels)

Content height is the body's own box, so blank capture padding never
counts. "Tab" is the real keyboard route from a page with nothing focused;
each closed section on the way costs one Enter.

| Fixture | State | Height px | Header px |
| --- | --- | ---: | ---: |
| key-configured | default (Reading, Display open) | 1,042 | 111 |
| key-configured | all open | 2,583 | 111 |
| key-configured | all folded | 320 | 111 |
| key-dense (four readings) | default | 1,386 | 111 |
| key-dense | all open | 2,927 | 111 |
| key-details | all open | 3,211 | 111 |
| key-missing / key-stale / key-unavailable | default | 1,184 / 1,184 / 1,200 | 111 |
| dial-configured | default | 1,278 | 127 |
| dial-configured | all open | 3,183 | 127 |
| dial-groups | default / all open | 1,873 / 3,886 | 127 |
| dial-custom-gestures | all open | 3,403 | 127 |
| control-default / control-reset all open | | 392 / 596 | 71 |

At 378x410 (the real app's size) no header pins. At 320x560 the dial
header wraps to 208 px and is not pinned (taller than a third).

| Task | Target | Tab + Enter | Folds | Top px | First screen at 720 |
| --- | --- | --- | --- | ---: | --- |
| T1 | Pick a reading | 3 | 0 | 173 | yes |
| T2 | Theme gallery | 12 | 0 | 662 | yes |
| T2 | Text color | 14 | 0 | 844 | no |
| T2 | Decimals | 9 | 0 | 423 | yes |
| T3 | Readings on this key | 6 | 0 | 304 | yes |
| T3 | Reading 4 picker (quad) | 13 | 0 | 583 | yes |
| T4 | Warn threshold | 16 + 1 | 1 | 982 | no |
| T5 | Rotation search, 3 readings | 16 | 0 | 444 | yes |
| T5 | Rotation search, 2 groups | 24 | 0 | 532 | yes |
| T6 | Press behavior | 17 + 1 | 1 | 1,017 | no |
| T6 | Dial gestures preset | 30 + 1 | 1 | 1,253 | no |
| T7 | Recovery action (missing, unavailable) | 5 | 0 | 329 / 345 | yes |
| T8 | Shared theme | 18 + 1 | 1 | 1,121 | no |
| T9 | Key config document | 27 + 1 | 1 | 1,761 | no |

Reproduction of the review's "25 Tab stops to the dial's add search": 16 on
the three-reading fixture and 24 on the two-group fixture on this build
(the report's 25 was the f01l bench build). Cause unchanged: every chip
puts its rename, move and remove buttons before the search.

Where the default key's 1,042 px go: header 111 (the "On the key now"
caption alone is 16), Reading 234, Display 575 (three always-on help
paragraphs of 3 to 5 lines, a two-row theme gallery of 34 px swatches, a
two-line summary on an open section), three folded sections at 35 each.
All open adds Advanced at 1,332 px (four groups, two 120 px JSON wells and
five help paragraphs, all in one flat block).

## Field and scope map

Every stored field keeps its path, type, default and scope; the one-row-
per-setting map is `review/pi-essentials/coverage-map.md` and stays true.
This pass moves controls and copy, adds no stored field and writes no new
value. The only new data crossing the socket are two optional preview
fields (below), read-only for the panel.

| Control | Scope | Before (section, order) | After |
| --- | --- | --- | --- |
| Theme gallery (`theme`) | action | Display, after stat/decimals/°F/graph | Display, first |
| Text color (`textMode`, `textColor`, `textDimSecondary`) | action | Display, after gallery + 2 help lines | Display, right under the gallery |
| Value shown, Decimals, °F (`statMode`, `decimals`, `fahrenheit`) | action | Display, top, 3 lines of help | Display, one row after text color; help in "How this works" |
| Graph under the value (`displayMode`) | action | Display, 5-line help always | Display; range sentence only while Bar or Ring is chosen |
| Label on the key + Readings on this key (`label`, `keyLayout`) | action | Reading, stacked | Reading, one row where both fit (stacked under 360 px) |
| Rotation membership (`rotationKeys`, `rotationGroups`, `rotationNames`) | action | chips with 3 to 4 buttons each, BEFORE the search | search first, then one listbox per list with one toolbar (Earlier, Later, Rename, Remove) |
| Dial gestures (`controlPreset`, `gesture*`, `touchZones`, `rotationDisabled`) | action | long preset paragraph | "What the controls do now" list from the plugin's resolved scheme; suppressed gestures not listed |
| Shared defaults, Connection, Support, Configuration documents | global / action | one flat Advanced block | four disclosures inside Advanced, scope badge on each |
| Header | panel | 72 px face + caption, 111 px, pins only on panels 560 px or taller | caption removed, about 88 px (key) and 104 px (dial), pinned at any height where it takes at most a third |

New read-only preview fields (plugin to panel): `holding` (the poller is
riding out a transient source failure on the last values, today shown as
"Live") and `staleForMs` (the evidence clock's age while Shared Memory is
stale, the number the face's own hint already prints).

## Backlog

P0 (trust and integrity)

1. D9: the header says "Live" while the poller holds the last values
   through a source reopen (up to 15 s). Carry the hold in the preview and
   say "Reconnecting".
2. Stale age: show the evidence clock's age for Shared Memory ("no new
   data for 42 s"), "Age unknown" for Gadget; never announce it per tick.
3. D10: with the data source forced to one provider, the unavailable
   state must say so and point at the setting (today's hint is 1.7's
   neutral "could not open a sensor feed").
4. Keep every non-lossy contract (zero writes on observation, one field
   per edit, kept unknown values, draft-safe config wells, pre-teardown
   flush, fold memory race rules) green through the restructure.

P1 (density and reach)

5. Header: drop the caption, tighten padding, pin at any height where it
   fits; dial face beside the text down to 320 px.
6. Display: gallery and text color first, compact one-row gallery chips,
   stat/decimals/°F grouped, conditional graph help, "How this works"
   disclosures for optional explanation.
7. Summaries only on folded sections; section rows 30 px.
8. Dial rotation: search before the list; listbox with an external
   toolbar; stable focus and position announcements.
9. Advanced: four focused disclosures, folds remembered like sections.
10. Controls: effective gesture list; Alerts: short consequence line and
    "reading 1 only" only when several readings show.
11. 24 px floor for the small editor buttons (chip moves, removes, tile
    size, add markers).

P2

12. Control panel copy (command said once), detail tile owner guidance.
13. Picker list height bounded by the viewport on short panels.

Out of scope: poller cadence, renderer geometry, new settings, a wide
standalone editor, the detail-list editor's structure (its search already
precedes its list; only spacing and target sizes change).

## Acceptance matrix (how each claim will be checked)

| Claim | Check |
| --- | --- |
| Heights and routes | `pi-lab.mjs density` at 380x720, 378x410, 320x560 (+ 320x400, 380x560, 400x800, 560x800 on the final build), before and after, same fixtures |
| No writes on observation, one field per edit, lossless | `e2e:pi-panels` observe / edits / lossless; `e2e:pi` legs; new checks for new controls |
| Rotation keyboard model | new `e2e:pi-panels` checks: search before list, list is one Tab stop, toolbar acts on the selection, focus and position kept after move/remove, current reading unchanged |
| Hold and stale age | unit tests on `buildPreview`; `e2e:pi-panels` truth checks with the sim in each state |
| Accessibility | `pi-lab.mjs a11y` with axe-core 4.13.0 at 380 and 320, forward and Shift+Tab traversal, focus-under-header check, before and after |
| Face parity | `e2e:pi-panels` parity (byte-identical face) unchanged |
| Real app, screen readers, OS scaling, device | NOT RUN in this pass unless stated; handoff in CONTINUATION.md |
