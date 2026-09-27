# Panel density pass: report

Branch `claude/pi-density` (worktree `C:\Users\stephen\git\hwinfo-pi-density`),
from `4bf09c0` (`claude/f01-on-1.7`, PR #39). Everything is in the working
tree; nothing is committed, pushed, installed or released.

Status words: **IMPLEMENTED** (in the tree), **AUTOMATED-VERIFIED** (a check
passed on the final tree), **MANUAL/HOST-VERIFIED** (seen in the real Stream
Deck app or on a device), **NOT RUN**, **BLOCKED**. Nothing in this pass is
MANUAL/HOST-VERIFIED. Every number below was produced on the final tree
(panel token `1.7.0.0-d02`) on 2026-09-26 unless it is labelled "before" or
belongs to a study.

## Summary

- The property inspectors for Sensor Reading keys and Sensor Dials are
  shorter and keep what matters on the first screen of the app's own
  378x410 panel: the default key panel is 748 px (1,042 before, -28%), the
  header with the live face and state pins at that size (it never pinned
  there before), and the theme palette sits right under it at y 116 (key)
  and 132 (dial) in every fold state (662 and 791 before, and hidden
  whenever Display was folded). AUTOMATED-VERIFIED on the simulated host.
- The palette never folds. After the owner's review it shows every theme
  as a named chip: a small face in that theme's own colors with its name
  written on it, two rows of four, Default with its link mark and a dashed
  frame, 83x32 px targets. The line above says what is drawn ("Default ·
  Void"); the line under says where Default comes from.
- Controls share one size scale: 28 px for every standard control
  (fields, selects, buttons, rotation chips and toolbar, color wells,
  group fields, the header's fold buttons), 18 px checkbox and radio marks
  with at least 24 px targets, 24 px hit areas for text actions such as
  "Change", and the theme chips as the one featured size.
- Status truth: a held source reads "Reopening source · key unchanged"
  instead of "Live" (D9); a forced single provider says so in the
  unavailable state with a button to the setting (D10); stale Shared Memory
  shows its age ("Not updating for 42 s") without announcing per tick.
  AUTOMATED-VERIFIED (unit and simulated host).
- The dial's rotation editor is a listbox with one external toolbar
  (Earlier, Later, Rename, Remove); the search comes first. Tab stops to the
  search fell from 16 to 7 (24 to 7 with groups).
- No stored field was added or changed; zero writes on observation, one
  field per edit and lossless unknown values stay green (e2e 217 + 646).
- Misses, explained under "Heights": all-open heights are 12.7% shorter
  for a key and 10.1% for the details fixture against a 15% target (the key
  met it at 15.2% before the named chips); the dial's all-open height is
  about 2% taller. Seven keyboard routes are one to three Tab stops longer,
  and Text color and the dial's rotation list sit below the first screen
  at 378x410.
- NOT RUN: the real Stream Deck app, a device, NVDA and Narrator, real
  Windows High Contrast, OS scaling, touch, `npm run e2e`, `test:native`,
  `suite:full`, `pack`, `release:validate`. The owner-held checklist is in
  CONTINUATION.md.

## Method

- Simulated host: `scripts/lib/pi-sim.mjs` serves the real panel files and
  plays the Stream Deck socket with sample data, in headless Chromium on
  this Windows 10 machine (Segoe UI, DPR 1). "Before" is a frozen copy of
  the `4bf09c0` panels served by the same simulator, so fixtures, data,
  fonts, viewport, fold defaults and DPR are identical.
- Heights are the body's content box (capture padding never counts).
  Keyboard routes start from a page with nothing focused, scrolled to the
  top; each closed section on the way costs one Enter.
- Sizes: the app's measured panel (378x410 CSS px; 373 px client width,
  bench 2026-09-23) plus 320x400, 320x560, 380x560, 380x720, 400x800 and
  560x800; zoom proxies at 189 and 160 px wide.
- `npx tsx scripts/pi-lab.mjs density` (heights, header, palette, tasks),
  `a11y` (axe-core 4.13.0 plus the lab's own name, tabindex, hidden-focus
  and focus-under-header traversal), `perf` (picker query to next frame at
  0, 1, 500 and 5,000 readings, 33 samples each), a strip probe
  (`strip-final.json`: every chip clicked in turn, every name line tried)
  and a target-size audit of every interactive element in all four panels
  with every disclosure open.
- The five reviewers are AI agents doing expert inspection on the same
  simulator, not people and not a user study (reviews/README.md).
- Tables come from `node review/pi-density/tabulate-report.mjs`
  (`report-tables.md`), which reads `density-candidate-final.json` and
  `baseline/density-4bf09c0-final.json`.

## The palette decision

The owner's rule (2026-09-25): the palette is the product's identity and
must never drop so low that reaching it takes an expand, a collapse or a
long scroll. Five placements (A to E) of the unmodified gallery were
injected into the real panels and measured at 378x410, 380x720 and 320x560
(`palette-study/SUMMARY.md`, `table.md`). Five review agents then critiqued
them from pattern precedent, UX research, accessibility, information
architecture and visual design; the design agent proposed a sixth, F.

| Placement (study, 378x410) | Palette y key / dial | Survives folding | Pinned px key / dial | Verdict |
| --- | --- | --- | --- | --- |
| before (in Display, after the stats) | 662 / 791, below the first screen | no | 0 / 0 | fails the rule |
| A first in Display | 299 / 610 | no | 89 / 105 | fails on the dial and when folded |
| B always-open named band under the header | 116 / 132 | yes | 89 / 105 | four of five reviewers |
| C swatches in the pinned header | 80 / 97 | yes | 113 / 0 (dial header too tall to pin) | names hover-only; 19 focus issues |
| D Display above Reading | 146 / 162 | no | 89 / 105 | doubles the route to the reading |
| E band B pinned with the header | 116 / 132 | yes | 204 / 220 | pins half the panel |
| F one-row strip of unnamed swatches | 97 / 113 | yes | 89 / 105 | first build |

F was built first: B's guarantees at about half B's height, with only the
selected (or hovered) theme's name in a line beside the swatches.

### Revised after the owner's review (2026-09-26)

The owner asked for larger swatches in the same place, then pointed out
what F gave up against the earlier gallery: the names of the themes and
Default's "auto" and link mark. Measured on the real panel by injection:

| Variant (373 px client width) | Band px | Target | Names on screen | Name line cut at 373 |
| --- | ---: | --- | --- | --- |
| F as built: 24 px faces beside the name | 66 | 28x28 | selected or hovered only | "Default · Midnight", "Default · Ultraviolet" |
| F with 26 px faces, same layout | 66 | 30x30 | selected or hovered only | 5 of 10 names |
| name line above, 28 px faces in one row | 87 | 32x32 | selected or hovered only | none |
| **named chips, two rows of four (built)** | **125** | **83x32** | **all eight, always** | **none** |

The first finding: F's side-by-side layout already cut two names at the
app's real width, and any larger swatch in that layout cut more. Putting
the name line above the swatches fixed that. The named chips then answer
both points: every theme's name sits on a face drawn in that theme's
colors (so the chip previews the palette and names it at once), and
Default reads link mark + "Default" with its dashed frame, drawn in the
palette it currently follows. "Default" rather than "auto" keeps the
panel's one word for inheritance (the selects say "Default (shared: ...)").
The chips cost 59 px over F as built (38 over the one-row 28 px version)
and stay well inside the first screen: the band ends at y 214 on a key.

Strip probe on the final tree (every chip clicked in turn; key, dial and
empty key):

| Width | Chip | Band height, all 8 picks | Rows | Horizontal overflow | Chip names whole |
| --- | --- | --- | --- | --- | --- |
| 373 (the app) / 378 | 83-84 x 32 | 125 px | 2 | 0 | yes |
| 360 | 80 x 32 | 125 px | 2 | 0 | yes |
| 320 / 315 (with a scrollbar) | 70 / 68 x 32 | 125 px | 2 | 0 | yes |
| 189 (378 at 200% zoom) | 80 x 32 | 217 px | 4 | 0 | yes |
| 160 (320 at 200% zoom) | 65 x 32 | 217 px | 4 | 0 | yes |

One height per width means a pick never moves the sections below it. At
160 px the name line above ellipsizes "Default · Ultraviolet" and
"Default · Midnight"; the chips stay whole.

First screens, before and after, at 378x410 (`first-screen/*.png`):
`key-configured`, `dial-configured`, `dial-groups`, `key-dense`,
`key-missing`, `key-unavailable`.

## The size scale

Every interactive element in the four panels, with every disclosure open,
at the app's 373 px width (heights in px, before this size pass → after):

| Element | Before | After |
| --- | ---: | ---: |
| Theme chips | 28 (24 px faces) | 32 (83 px wide, named) |
| Buttons (status actions, Split, Add group, Merge, Copy and Replace, Copy support report) | 26 | 28 |
| Rotation chips (listbox options) | 26 | 28 |
| Rotation toolbar (Earlier, Later, Rename, Remove) | 24 | 28 |
| Group name field and its remove button | 24 | 28 |
| Header fold buttons (Open all, Fold all) | 24 | 28 (24 below 200 px wide) |
| Color wells | 26 | 28 |
| Checkbox marks | 16 (labels 24) | 18 (labels 24) |
| Group radio | 16, no label | 18 in a 24 x 24 label |
| Text actions such as "Change" | 16 | 24 hit area, no layout change |
| Detail cell name (its rename control) | 17 | 24 |
| Detail editor micro buttons (move, remove, size, add) | 24 | 24 (the floor, kept compact) |
| "on dial" badge text | 10 px | 11 px |

With groups, the list that does not hold the toolbar shows one quiet line
in the toolbar's reserved space ("Select one to move, rename or remove it")
instead of an empty gap; the space keeps the toolbar's height, so selecting
in another group still moves nothing.

## What changed

Panels (`com.lawrensen.hwinfo.sdPlugin/ui/`, build token `1.7.0.0-d02`):

- **Header**: the "On the key now" caption is gone; padding tightened; it
  pins at any panel height where it takes at most a third (89 px key, 105
  px dial at 378x410). The dial face keeps 176 px at the app's width and
  shrinks only on narrower panels.
- **Status** sits directly under the header: repair actions ("Reload sensor
  list", "Pick another reading", "HWiNFO setup steps", the forced-source
  button) are on the first screen. State words: "HWiNFO ready · Shared
  Memory", "Reopening source · key unchanged", "Not updating for 42 s",
  "Age unknown" (Gadget).
- **Theme strip**: the named chips above. A key with no reading says the
  theme "Shows on the key once a reading is picked"; a dial's empty face is
  drawn in its theme, so it gets the normal line.
- **Reading**: label and layout share one row where both fit; slot rows put
  each picker beside its short label ("4 chars max" / "Own name"); the
  picker help moved to the screen-reader description; truncated slot
  pickers keep "name · source" as a tooltip.
- **Dial rotation**: search ("Readings to rotate through", "Readings for
  <group>" with groups) before the list; each list is one `listbox` (one
  Tab stop, arrows select, Alt+Arrow moves, F2 renames, Delete removes) with
  one external toolbar under the selected list; every grouped list reserves
  the toolbar's height; moves and removals are announced with the new
  position; the reading on the dial is marked "on dial" separately from the
  selection.
- **Display**: Text color first with one visible help line (#31's answer);
  Value shown, Decimals and a "Temperature" °F box in one row; the graph's
  range sentence shows only for Bar and Ring; longer explanation in a "How
  Display works" disclosure.
- **Alerts**: one consequence line in the reading's own unit, including
  bytes and rates; the dial's scope sentence names the bar ends.
- **Press**: the install sentence says when it asks and that an update can
  ask again; "How the detail view works" disclosure.
- **Controls** (dial): "what the controls do now" list built from the
  plugin's resolved gestures; "How the presets work" disclosure.
- **Advanced**: four sub-disclosures (Shared defaults and Connection, both
  badged "All keys and dials", Support, Configuration documents), folded
  with title-line summaries, remembered in plugin memory like sections.
- **Summaries** show only on folded sections; the Display summary no longer
  names the theme (the strip shows it) and adds °F and the graph; "read
  every" and "data units" match the controls' words.
- **Control panel**: shorter target help; the lede is ruled off.
- **Size scale**: above. Tokens `--hw-gutter`, `--hw-gap`, `--hw-field-h`
  28 px, `--hw-row-h` 30 px, `--hw-target` 24 px; picker lists bounded by
  the viewport; the detail picker's add row unpins below 600 px height.
- **Forced colors**: selection in Highlight, "on dial" as a dashed
  CanvasText frame, disabled toolbar buttons in GrayText, theme chips and
  faces keep their colors.

Plugin (`src/`): `poller.isHolding()`; the PI preview carries `holding` and
`staleForMs` (rounded like the face's hint). Read-only for the panel; no
setting, profile or renderer change.

Docs: sensor-reading.md, sensor-dial.md, controls.md, themes.md,
thresholds-alerts.md, troubleshooting.md; CHANGELOG.md 1.7.0.0 bullets and
the generated docs/changelog.md. Images recaptured from a live-HWiNFO
harness on the final tree (`scripts/capture-pi.mjs`, its own harness
plugin, installed plugin untouched): 13 panel images, the full panel
(`settings-panel.png`), both Advanced images, a new `pi-theme-strip.png`,
and the dial colors capture with its provenance; every alt text describes
what its image shows.

## Heights

### Content height at the app's panel (378x410), px

| Panel and state | before | after | change |
| --- | ---: | ---: | ---: |
| key-empty default | 1,042 | 748 | -28% |
| key-configured default | 1,042 | 748 | -28% |
| key-configured all-open | 2,583 | 2,256 | -13% |
| key-configured all-folded | 320 | 403 | +26% |
| key-dense default | 1,386 | 988 | -29% |
| key-dense all-open | 2,927 | 2,512 | -14% |
| key-triple default | 1,177 | 850 | -28% |
| key-details all-open | 3,211 | 2,886 | -10% |
| key-back default | 1,114 | 820 | -26% |
| key-missing default | 1,184 | 872 | -26% |
| key-stale default | 1,184 | 892 | -25% |
| key-unavailable default | 1,200 | 908 | -24% |
| dial-configured default | 1,278 | 1,159 | -9% |
| dial-configured all-open | 3,183 | 3,249 | +2% |
| dial-configured all-folded | 352 | 419 | +19% |
| dial-groups default | 1,903 | 1,656 | -13% |
| dial-groups all-open | 3,916 | 3,887 | -1% |
| dial-custom-gestures all-open | 3,403 | 3,365 | -1% |
| dial-missing default | 1,390 | 1,251 | -10% |
| dial-unavailable default | 1,346 | 1,216 | -10% |
| control-default default | 392 | 387 | -1% |
| control-reset all-open | 596 | 576 | -3% |
| slot-reading default | 233 | 229 | -2% |

"All-open" opens every disclosure, including the new "How ... works" notes
and the four Advanced groups, so folding help away never counts as a
saving.

### Across the matrix, px (before → after)

| State | 320x400 | 320x560 | 378x410 | 380x560 | 380x720 | 400x800 | 560x800 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| key-configured default | 1090 → 776 | 1090 → 776 | 1042 → 748 | 1042 → 748 | 1042 → 748 | 1042 → 748 | 931 → 748 |
| key-configured all-open | 2728 → 2365 | 2728 → 2365 | 2583 → 2256 | 2583 → 2256 | 2583 → 2256 | 2567 → 2256 | 2360 → 2114 |
| key-dense all-open | 3073 → 2622 | 3073 → 2622 | 2927 → 2512 | 2927 → 2512 | 2927 → 2512 | 2911 → 2496 | 2703 → 2341 |
| key-details all-open | 3392 → 3066 | 3392 → 3066 | 3211 → 2886 | 3211 → 2886 | 3211 → 2886 | 3195 → 2870 | 2854 → 2607 |
| dial-configured default | 1406 → 1236 | 1406 → 1236 | 1278 → 1159 | 1278 → 1159 | 1278 → 1159 | 1232 → 1159 | 1121 → 1111 |
| dial-configured all-open | 3425 → 3471 | 3425 → 3471 | 3183 → 3249 | 3183 → 3249 | 3183 → 3249 | 3089 → 3233 | 2817 → 2965 |
| dial-groups all-open | 4189 → 4159 | 4189 → 4159 | 3916 → 3887 | 3886 → 3887 | 3886 → 3887 | 3775 → 3871 | 3390 → 3570 |

### Against the kit's targets

- Default one-reading key, target 720 to 780 px at 380: **748 px**, with
  Reading and Display open, every theme named and visible, and no control
  removed.
- All-open key, target at least 15% shorter: **-12.7%, missed.** The
  compact strip reached -15.2% (2,191 px); the named chips (+59 px over it)
  and the 28 px control scale (+6 px) were the owner's call on 2026-09-26
  and cost the last 2.5 points. Getting them back would mean dropping the
  line above the chips (about 21 px, and the only place that names what
  Default resolves to) plus about 40 px elsewhere in the open sections.
- All-open details, target at least 15% shorter: **-10.1%, missed.** The
  saving is in the shared parts; the detail-list editor inside Press was
  out of scope (PLAN.md) and grew slightly (632 → 647 px) with its new "How
  the detail view works" note open and the longer install sentence.
- Dial all-open (no target in the kit, reported for honesty): **+2.1% at
  378 and 380 wide**, +4.7% at 400x800 and +5.3% at 560x800. The header,
  Display and Advanced save about 160 px; the strip adds about 125 px and
  Controls about 97 px (409 → 506) with the new "what the controls do now"
  list and its open note.
- All-folded grew 26% (key) and 19% (dial): the always-open strip is the
  price of the owner's rule.

## Header cost and the palette at 378x410

| Panel | pinned before | pinned after | header px after | palette y before | palette y after |
| --- | --- | --- | ---: | --- | --- |
| key-configured default | no | yes | 89 | 662, below the first screen | 116, in view |
| key-configured all folded | no | yes | 89 | 463, in a folded section | 116, in view |
| key-unavailable default | no | yes | 89 | 820, below the first screen | 277, in view |
| key-missing default | no | yes | 89 | 804, below the first screen | 240, in view |
| dial-configured default | no | yes | 105 | 791, below the first screen | 132, in view |
| dial-configured all folded | no | yes | 105 | 377, in a folded section | 132, in view |
| dial-unavailable default | no | yes | 105 | 859, below the first screen | 293, in view |

The pinned header costs 89 px (key) or 105 px (dial) of the 410 px panel,
22 to 26%. The strip is not pinned; it scrolls away with the page.

## Task reachability at 378x410

Keyboard from the top, nothing focused; "+ n" is Enter presses on closed
sections.

| Task | Fixture | Target | Tab + Enter before | after | target y before | after | first screen before | after |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| T1 | key-empty | Pick a reading | 3 | 4 | 173 | 271 | yes | yes |
| T2 | key-configured | Theme gallery | 12 | **2** | 662 | 116 | no | **yes** |
| T2 | dial-configured | Theme gallery (dial) | 23 | **2** | 791 | 132 | no | **yes** |
| T2 | key-configured | Text color | 14 | 10 | 844 | 424 | no | no |
| T2 | key-configured | Decimals | 9 | 12 | 423 | 514 | no | no |
| T3 | key-configured | Readings on this key | 6 | 8 | 304 | 326 | yes | yes |
| T3 | key-dense | Reading 4 picker | 13 | 13 | 583 | 503 | no | no |
| T4 | key-configured | Warn threshold | 16 + 1 | 17 + 1 | 982 | 695 | no | no |
| T5 | dial-configured | Rotation search | 16 | **7** | 444 | 393 | no | **yes** |
| T5 | dial-groups | Rotation search (groups) | 24 | **7** | 562 | 393 | no | **yes** |
| T5 | dial-groups | Rotation list (reorder) | 9 | 11 | 302 | 490 | yes | no |
| T6 | key-configured | Press behavior | 17 + 1 | 18 + 1 | 1,017 | 726 | no | no |
| T6 | dial-configured | Dial gestures preset | 30 + 1 | **23 + 1** | 1,253 | 1,137 | no | no |
| T7 | key-missing | Recovery action | 5 | **2** | 329 | 177 | yes | yes |
| T7 | key-unavailable | Recovery action | 5 | **2** | 345 | 214 | yes | yes |
| T8 | key-configured | Shared theme | 18 + 1 | 20 + 2 | 1,121 | 840 | no | no |
| T9 | key-configured | This key's config document | 27 + 1 | 23 + 2 | 1,761 | 899 | no | no |

No reached target was covered by the pinned header. Horizontal overflow
was 0 px in every one of 161 states, before and after, and measuring wrote
nothing.

Read both ways: the strip's two stops come first, so routes to targets
below it (the reading picker, layout, Decimals, Warn, Press) are one to
three stops longer. Warn and Press sit about 290 px higher on the page;
the reading picker, layout and Decimals sit 22 to 98 px lower, under the
strip. Text color (y 424) and the rotation list (y 490) are just below the
first screen. The shared theme and the config document each take one more
Enter, for their Advanced group.

## Accessibility (simulated host)

| Run | Before (4bf09c0) | After |
| --- | --- | --- |
| axe-core 4.13.0 violations, 62 fixture and state runs, 378 and 320 wide, 410 tall | 0 (baseline: 62 runs at 380 and 320 wide) | 0 |
| Same at 800 tall (380 and 320 wide) | not run on the baseline | 0 |
| Own checks (names, tabindex, hidden focus, focus under the header, forward and Shift+Tab) | 0 | 0 |

axe reports one "incomplete" item per page (`bypass`, no skip link) on
both builds. The reviewers' measured findings (focus into filtered lists,
group-scoped Delete and F2, focus after Split and Merge, forced colors,
zoom) are in reviews/README.md and second-pass.md with their fixes.
Screen readers, real High Contrast and OS scaling are NOT RUN.

## Performance and message volume

Picker query to the next frame, 33 samples per size (3 runs of 11 after 3
warm-ups), headless Chromium; p50 sits on the 60 Hz frame.

| Readings | p50 before / after (ms) | p95 before / after | first open, max |
| ---: | --- | --- | --- |
| 0 | 16.7 / 16.6 | 17.4 / 17.5 | 2.8 / 2.6 |
| 1 | 16.7 / 16.8 | 17.4 / 17.8 | 4.0 / 3.3 |
| 500 | 16.9 / 16.6 | 18.8 / 18.5 | 7.7 / 7.2 |
| 5,000 | 16.7 / 17.0 | 20.5 / 19.1 | 33.9 / 27.6 |

Preview messages to the panel over 10 s of 250 ms ticks
(`preview-volume.json`, `buildPreview` with `pushPreviewToPi`'s dedupe):
stale Shared Memory 11 before and after (the age changes once a second),
healthy source 1 and 1, held source 1 and 1. Carrying the age adds no
messages because the rounded age moves with the hint that was already
sent.

## Reviews

First pass: five agents (pattern precedent, UX research, accessibility and
keyboard, information architecture and copy truth, visual and interaction
design): 2 P0 and 13 P1 findings, all fixed or answered
(`reviews/README.md`). Second pass on the compact strip (three agents): no
P0, two new P1 (a click in another rotation group selected the wrong
member; the strip did not wrap at 200% zoom), both fixed and re-measured,
plus twelve P2, ten fixed and two kept with reasons
(`reviews/second-pass.md`). Then the owner's review (2026-09-26) led to the
size scale and the named chips above; no agent pass ran on those, and the
evidence for them is the strip probe, the size audit, the e2e checks and
the a11y lab.

## Validation (final tree)

| Command | Result |
| --- | --- |
| `npm run lint` | 0 problems |
| `npm run typecheck` | 0 errors |
| `npm test` | 1,348 of 1,348 (was 1,343 at 4bf09c0), including the docs-capture provenance guard |
| `npm run e2e:pi-panels` | 217 of 217, ALL GREEN (was 191) |
| `npm run e2e:pi` | 646 of 646, ALL CHECKS PASSED |
| `node scripts/validate-release-copy.mjs` | OK, 60 files, 0 warnings |
| `npx tsx scripts/pi-lab.mjs density review/pi-density/density-candidate-final.json --sizes 320x400,320x560,378x410,380x560,380x720,400x800,560x800` | 161 states, 119 routes, 0 writes, 0 overflow |
| `AXE_CORE=… npx tsx scripts/pi-lab.mjs a11y review/pi-density/a11y-candidate-410.json --widths 378,320 --height 410` (and `-800`, 380 and 320 wide) | 0 axe, 0 own, 62 of 62 clean each |
| `npx tsx scripts/pi-lab.mjs perf review/pi-density/perf-candidate.json` | table above |
| `node scripts/capture-pi-reading-colors.mjs` and `node scripts/capture-pi.mjs` against fresh harnesses on live HWiNFO (their own plugin processes) | 26 states plus the dial colors capture, build `1.7.0.0-d02` |

NOT RUN: `npm run e2e` (drives the real Stream Deck app), `test:native`,
`suite:full` (its process sweep can stop a real installed plugin, bench
H3), `pack`, `release:validate`.

## Status

| Area | Status |
| --- | --- |
| Header, status, theme chips, size scale, sections, rotation editor, Advanced groups, copy | IMPLEMENTED, AUTOMATED-VERIFIED (simulated host) |
| Hold and stale age in the preview | IMPLEMENTED, AUTOMATED-VERIFIED (unit and simulated host) |
| Zero writes on observation, one field per edit, lossless values, fold memory | AUTOMATED-VERIFIED |
| Heights, routes, header cost, overflow at seven sizes and two zoom widths | AUTOMATED-VERIFIED (simulated host) |
| axe and own traversal | AUTOMATED-VERIFIED (simulated host) |
| Forced colors | AUTOMATED-VERIFIED in emulation only; real High Contrast NOT RUN |
| Docs, changelog, images | IMPLEMENTED; copy validator OK |
| Real Stream Deck app, device faces, QtSvg | NOT RUN |
| NVDA, Narrator, OS scaling, touch | NOT RUN |
| Formative study (UXR-PLAN.md) | NOT RUN (planned) |
| Commit, push, merge, tag, release | NOT RUN (owner's) |

## Risks and limits

- The real host may differ from the simulator: the bench found that
  Escape never reaches a panel, and keys such as Alt+Arrow, F2 or Delete
  may be kept by the app. Every keyboard action has a button, so nothing
  depends on those keys.
- Header pinning costs 22 to 26% of the app's panel. If owners find it
  heavy, the pin rule is one media query.
- The named chips cost 59 px over the compact strip and the all-open key
  target with it. The compact strip is described above with its numbers;
  going back is the `.hw-look` rules in pi.css plus the chip text in
  `themeChip()` (pi-common.js).
- Text color and the dial's rotation list sit just below the first screen
  at 378x410.
- The details all-open target is missed until the detail-list editor gets
  its own pass.
- The sensor-details page's images and some of its prose still use the
  1.6 Press labels, which F01 had already renamed at `4bf09c0`
  (CONTINUATION.md).

## Files

46 tracked files changed (`git diff --stat 4bf09c0`: 2,469 insertions,
822 deletions) plus new files: `docs/assets/img/pi-theme-strip.png`,
`scripts/pi-studies/palette.css`, `scripts/pi-studies/palette.js`, and this
folder. By area: 8 panel files under `com.lawrensen.hwinfo.sdPlugin/ui`,
`src/poller.ts` and `src/pi-protocol.ts`, 4 test files, 6 scripts
(`pi-lab.mjs`, `e2e-pi-panels.mjs`, `e2e-pi-persistence.mjs`,
`capture-pi.mjs`, `lib/pi-sim.mjs`, `lib/cdp.mjs`), 7 docs pages, 17
changed docs images plus the dial colors provenance record, and
CHANGELOG.md.

The hardware and host checklist is in CONTINUATION.md.
