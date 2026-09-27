# Test coverage ledger (4bf09c0 to this pass)

No assertion was deleted or weakened. Where the panel's DOM changed, the
check drives the new route to the same outcome and asserts the same writes;
several ported checks assert more than before. Where a panel string changed
on purpose, the expectation moved with it, listed below with the reason.

## `scripts/e2e-pi-panels.mjs` (simulated host): 191 to 217 checks

| Check (before) | Now | Why it changed |
| --- | --- | --- |
| lossless: a reorder in group 2 wrote, and the four checks after it (group 1 byte-identical, group 2 reordered, flat mirror keeps its non-string entry, names untouched) | same five assertions; the reorder is done by selecting group 2's first member and pressing **Later** (`rotationTool` helper) | the per-chip ↑/↓ buttons are gone; one toolbar acts on the selected member |
| lossless: a rename changed one name and kept the junk entry | same assertion; rename opened with the toolbar's **Rename** on the member | the name span is no longer a button inside the chip |
| lossless: a non-object group entry keeps its place | same assertion; reorder through **Later** | as above |
| T5: Enter on a move button reorders the rotation | T5: Enter on **Later** reorders the rotation (same expected order) | as above |
| T5: focus stays on the moved chip's move control | T5: focus stays on **Later** and the moved reading stays selected at its new place (`aria-posinset` 2) | stronger: also checks the selection and its position |
| T5: the current reading and membership are distinct marks | unchanged, moved before the new removal check (it counts three members) | ordering only |
| truth: stale is never Live (`=== "Not updating"`) | truth: stale is never Live, and says how long no new data arrived (`=== "Not updating for 42 s"`) | the header now carries the evidence clock's age |

Added (26 runtime checks):

- Palette, on the key and on the dial (5 each): with every section folded
  all eight chips stay in view under the header, each named; the band
  names what is drawn and where Default comes from; every chip shows its
  theme's name on its face, whole, with Default's link mark first; focus
  on a chip names it without picking it (no write); one click picks a
  theme with the sections folded, writing only the theme.
- Rotation (13): the add search precedes the list, the list is one Tab
  stop, the toolbar one more; no control inside a listbox option; the
  editor opens on the dial's reading and selecting writes nothing; the move
  is announced once with its new place; a move never changes the reading on
  the dial; arrow keys select without writing; Alt+ArrowUp moves; Remove
  selects the neighbour and keeps focus; with groups the dial's reading
  starts selected in its own group with the toolbar under it; a click in
  the other group selects the member clicked and nothing moves (second-pass
  P1); Down Arrow from a typed search reaches the first visible result
  (first-pass P0); Delete in group 1's list acts on group 1 only
  (first-pass P0).
- Status truth (3): a forced data source is named in the unavailable state
  with a way to the setting, and that way opens Connection and focuses Data
  source without writing; a held source reads "Reopening", never Live;
  "Pick another reading" opens Reading and focuses the picker without
  writing.

## `scripts/e2e-pi-persistence.mjs`: 646 to 646 checks

| Check | Change |
| --- | --- |
| dial: the rotation help states how the order is set | expects "Earlier and Later set their order" (was "the arrows set their order") |
| link: the help line carries the docs link, and the six link checks after it | the step that opens Advanced also opens its Connection group, where the link now lives; every assertion unchanged |

## Unit (`npm test`): 1343 to 1348

- `test/pi-preview.test.ts`: +2 (stale Shared Memory age in whole seconds,
  rounded like the hint, none for Gadget, ok or unavailable; the hold flag,
  never on unavailable).
- `test/poller-provenance.test.ts`: +1 (the hold ends when a read lands);
  the existing cold-Gadget hold case also asserts `isHolding()` both ways.
- `test/pi-model.test.ts`: +2 (the Display summary names °F and the graph a
  one-reading key draws; the two folded Advanced groups' summaries). Moved
  expectations: the Display summary no longer names the theme (it sits in
  the always-open strip); "push pauses or resumes the auto cycle" and "push
  pins or unpins the reading" (the gestures toggle); "read every" replaces
  "poll" (the words of the Read every control).
- `test/pi-alias-contract.test.ts`: the fake DOM gained `remove()`,
  `after()` and `nextElementSibling` (the rotation toolbar moves between
  lists); no assertion changed.
- `test/docs-image-provenance.test.ts`: passes after
  `scripts/capture-pi-reading-colors.mjs` regenerated the dial colors
  capture and its provenance from this tree.

## Capture script (`scripts/capture-pi.mjs`)

Not a test, but it refuses to write images when a step fails. Ported to
the new DOM: the rename flow goes through the toolbar; the quad label
placeholders are "4 chars max" and "Own name"; clipped shots scroll to the
top first (the pinned header otherwise paints over the strip); the
full-panel shot opens every section and Advanced group; the Press crop
starts at its heading; a new header-and-strip crop feeds
`docs/assets/img/pi-theme-strip.png`.
