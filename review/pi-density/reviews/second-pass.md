# Second pass (verification only)

Three of the five reviewers (accessibility and keyboard; information
architecture and copy truth; visual and interaction design) re-ran on the
tree as it stood at 22:37 to 22:51 on 2026-09-25, read-only, each on its own
lab port. They are AI reviewers on the simulated host with sample data in
headless Chromium, not people and not the Stream Deck app. None found a P0.
Their scratch files stayed outside the repository
(`%TEMP%\hw-review-a11y\v2`, `%TEMP%\hw-review-ia`, `%TEMP%\hw-review-visual`).

## What they confirmed (MEASURED by them)

- The theme strip is on the first screen of a 378x410 panel in every state
  they loaded: y 97 on keys, 113 on dials, 2 Tab stops, and still in view
  when HWiNFO is unavailable.
- Every first-pass P0 and P1 holds: Down Arrow from a filtered search
  reaches the first visible result in both checklists; Delete and F2 act
  only on the focused list; Split, Merge and removals leave focus in view;
  a field focused as a checklist closes is clear of the header; the detail
  picker's add row no longer pins on short panels; forced colors show the
  rotation selection and disabled toolbar buttons.
- 0 axe violations and 0 own-traversal issues at 378 and 320 wide (410 and
  800 tall), 62 fixture and state runs in the visual reviewer's pass.
- Status copy (hold, forced source, "Pick another reading"), the alert
  help, the dial scope sentence, the summaries' vocabulary and the
  changelog's 1,042 to 689 px claim match the code and the measurements.

## Findings and dispositions

| Sev | Finding (agent) | Disposition | Evidence now |
| --- | --- | --- | --- |
| P1 | A click on a member in the other rotation group selected that list's first member and slid the list under the pointer, so the release landed on Rename or Earlier (visual) | Fixed both ways the reviewer proposed: every grouped list keeps a toolbar-high slot and the toolbar is drawn in the selected list's slot, so selection moves nothing; `pointerdown` selects the pressed member before focus arrives | e2e "T5: a click in the other group selects the member clicked, and no member moves" |
| P1 | At 200% text zoom the strip held its one-row width, so Ember and Paper fell off the right edge and End scrolled the page sideways (a11y; a regression from pass 1) | Fixed: `.hw-look .hw-themes { flex: 0 1 auto; min-width: 0 }`, so the swatches wrap | Strip probe at 189 and 160 px wide: 0 px horizontal overflow, all 8 swatches in view on two rows, key and dial (`strip-probe.json`, scratch) |
| P2 | The strip changed height at 320 wide with the theme picked (help line and name wrapping), moving Reading 16 px on every pick (visual) | Fixed: below 360 px the label and name share one line; help lines shortened ("Kept when the shared theme changes."; the link reads "Change" with the full name as its accessible name) | Strip probe: one band height per width across all 8 picks: 66 px at 378, 80 at 320, 127 at 200% zoom |
| P2 | The dial's help line ("The theme shows on the dial once a reading is picked") is false: an empty dial draws its prompt in the theme (IA) | Fixed: that line is for keys only ("Shows on the key once a reading is picked."), whose empty face is fixed black | Read: `key-renderer.ts:828` (key prompt on fixed black) and the no-reading branch of `composeDialSvg` (drawn in the theme) |
| P2 | The install sentence was wrong for "Tap cycles; hold opens details" and said "once" (IA) | Fixed: "The first time details open on each kind of deck, Stream Deck asks to install the bundled detail view (and again after an update that changes it)." | Panel text. The sensor-details page's images and prose predate F01's Press labels and were left for their own pass (CONTINUATION.md) |
| P2 | Changelog claimed the face, pinned header and strip for Control keys and detail tiles; "each comes with its local fix" was too broad (IA) | Fixed in CHANGELOG.md and the generated docs/changelog.md | `validate-release-copy.mjs`: 0 warnings |
| P2 | docs/sensor-reading.md put the strip "in the header" and claimed every Advanced group names its values (IA) | Fixed ("right under the header (below any status message)"; "Shared defaults and Connection name their current values") | Read against the panels |
| P2 | Doc images and alt text still showed chips with an inline rename box; "in the order of their chips" (IA) | Fixed: 13 panel images, the full-panel image, both Advanced images and a new header-and-strip image recaptured from a live-HWiNFO harness run; alt text rewritten to what each image shows; "in list order" | docs/assets/img diffs; alt text in controls.md, sensor-dial.md, sensor-reading.md, themes.md, thresholds-alerts.md |
| P2 | Truncated slot pickers (Readings 2 to 4) lost the source that tells readings apart, with no tooltip (visual) | Fixed: `title` holds "name · source" | Read; panels e2e green |
| P2 | No rule between the Control panel's lede and Command (visual) | Fixed: the lede is ruled off | Recaptured `pi-control.png` |
| P2 | In forced colors the selected member and the "on dial" member looked the same (a11y) | Fixed: "on dial" draws a 2 px dashed CanvasText frame; Highlight is the selection's alone | Emulated forced colors only; real Windows High Contrast NOT RUN |
| P2 | Swatches still set `title` to the bare theme name (a11y) | Fixed for the seven presets; the Default chip keeps its title ("Default: follows the shared theme (Void)") because the contract tests pin it and it names what Default resolves to | `pi-alias-contract.test.ts` |
| P2 | The dial's rotation list starts at y 427 at 378x410, below the first screen (visual) | Kept. The search it fills is on the first screen (y 334) and ticking happens there; the list is one short scroll. The proposed fix (fold the "Rotation" legend into the search label and cut the help to one line) would cut the line that says ticking never changes what is on the dial now, the one fact that tells this checklist apart from the "On the dial now" picker above it. Candidate for the study in UXR-PLAN.md | Density matrix, `density-candidate-final.json` |
| P2 | Group radios are 16 x 16 px, passing the 24 px target rule only through its spacing exception (a11y) | Kept: they meet WCAG 2.2 2.5.8 through the spacing exception; enlarging them widens every group row | Measured by the reviewer |

The hold-state sentence says "the last new data"; the IA reviewer noted
that on a cold Gadget source the 15 s counts from the last successful
read and judged it not worth rewording. Kept as is.

## Not run by any reviewer

The real Stream Deck app, real Windows High Contrast (only emulated forced
colors), NVDA and Narrator, OS text scaling, touch.
