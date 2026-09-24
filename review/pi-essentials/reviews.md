# F01 independent reviews and dispositions

Two read-only reviews ran on `2ca44e9..de1e441`, each by a separate agent
with no write access, using the simulated host and their own probe
scripts outside the repository. One reviewed settings, protocol and
compatibility; the other reviewed UX, accessibility, preview truth and
performance. Findings are listed as reported, each with what was done.
"Fixed" means changed on this branch and covered by a named check;
"Recorded" means accepted as a residual and listed in the README.

## Review 1: settings, protocol, compatibility

| # | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| 1a | Major (regression) | After Elite to Custom seeding, the gesture selects kept showing the Legacy fallbacks while the stored values were Elite's; picking the shown option wrote nothing | Fixed: seeding resyncs every bound control. Check: e2e-pi-panels "preset: picking Custom from Elite seeds the Elite map and shows it" |
| 1b | Major (in base) | A settings echo carrying `controlPreset: "custom"` (for example a replaced configuration document) seeded six writes with nobody touching the panel | Fixed: seeding runs only on the person's change of the Gestures select (document capture listener, before the save). Check: "preset: an echo switching Elite to Custom: no writes" |
| 2 | Major | A tile entry this build cannot read (`3`, `{ size: 6 }`) was pruned at the end of the plan or rewritten in the middle | Fixed: `patchEntry` returns an unreadable entry untouched unless an edit changes its meaning; pruning skips tiles whose raw entry is not fully readable. Checks: test/pi-model.test.ts "leaves an entry it cannot read exactly as stored", e2e "unreadable tiles are neither pruned nor rewritten" |
| 3 | Minor | Kept list entries (non-strings, blanks, over-cap) and non-object group entries moved to the end on any edit | Fixed: `splitKeyList` records each kept entry's index and `mergeKept` puts it back. Checks: unit "keeps list entries … and where they were", e2e "a kept list entry stays at its stored position", "a non-object group entry keeps its place". Recorded: duplicate `detailKeys` are still dropped (a removed key must not survive as its own duplicate) and a key stored with a pasted friendly name is still written back bare; the runtime reads both the same way |
| 4 | Minor (in base) | With fewer than two non-empty groups the runtime rotates `rotationKeys`, but the panel edits the single group and rewrites the mirror, which can replace a stored set that differs from the group | Recorded (unchanged from main): only reachable from hand-edited or future-version settings |
| 5 | Minor (in base) | `rotationGroups` and `rotationKeys` go out as two writes; a plugin write in between could pair new groups with a stale mirror | Recorded (unchanged from main) |
| 6 | Minor | Summaries: empty groups counted as groups; a one-key set described as "this sensor's readings"; a non-string `alertUnit` reported as applying; a junk `detailMirrorBack` shown unchecked while the runtime treats it as on | Fixed: summaries follow `rotationGroupsOf` and `rotationKeysOf`; the preview passes the raw anchor to `thresholdsApplyTo`; default-on checkboxes show "on unless false". Checks: unit "counts only groups the runtime uses", "a junk unit anchor keeps a dial's thresholds off" |
| 7 | Nit | An oversize face was dropped but recorded as sent, leaving an older frame on screen; the bound was named in bytes but measured in characters | Fixed: an oversize face clears the panel's picture; renamed `MAX_FACE_CHARS`. Check: unit "clears the panel's picture for a face past the size bound" |
| 8 | Nit | For one round trip after an edit a summary can combine the new stored value with the plugin's previous `effective` | Recorded: self-corrects on the next preview (sent right after the settings change) |
| 9 | Nit | Text typed less than 200 ms before switching actions was lost (in base); the kept-value option stayed after picking a known value | Fixed: pending text saves flush on `pagehide`; picking a known option removes the kept one |

Verified by the reviewer: zero writes on observation (except 1b), setting
names, option values and defaults identical to main, the preview's
context guard, the face as the exact last device SVG, no work with no
panel visible, effective values from the runtime's own functions, race
handling, the security posture (one constant `innerHTML`, the face only
as an `<img>` data URL, no eval), and every panel request handled by the
plugin.

## Review 2: UX, accessibility, preview, performance

| # | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | Major | The stale status text counted seconds, so the live status block was rebuilt and re-announced every tick and a focused "Retry now" lost focus | Fixed: static stale text; the region (`role=status`, polite) is always rendered and changes only when the kind of problem changes; a focused action keeps focus across a rebuild. Check: e2e "a ticking stale count leaves the status region and its focus alone" |
| 2 | Major | At about 320 to 395 px the dial header wraps to about 220 px, taller than the fixed 150 px scroll padding, so Shift+Tab left controls fully under the pinned header | Fixed: the shell measures the header into `--hw-head-h` (scroll padding follows it) and does not pin a header taller than a third of the panel. The lab's check now also walks backward (Shift+Tab) and runs at 320 and 400 px |
| 3 | Major | The sticky "Add readings" dock slid under the pinned header while picking | Fixed: the dock sticks below the header (`--hw-sticky-top`) |
| 4 | Major | Checklists put every row (and every "+ all") in the Tab order: 500 Tab presses to leave a 500-reading list | Fixed: a checklist is one Tab stop; Down Arrow enters, arrows, Home, End and Page keys move, Up from the top returns to the search box, Tab leaves; the help text says so. Checks: e2e "Tab leaves the rotation checklist in one step", "arrows move inside the checklist" |
| 5 | Major | The header image's alt text described the reading and value while the face drew a status screen | Fixed: the alt text is built from the words the face itself draws (the SVG parsed as inert data). Check: e2e "the face's alt text reads what the face draws" |
| 6 | Major | Docs screenshots and their alt text still show the 1.6.0 panel; several body labels were stale (Direction, Bar min/max, the dial preset label) | Body labels fixed (thresholds-alerts, sensor-reading, sensor-dial, troubleshooting). Screenshots: Recorded as a gate; `capture-pi.mjs` needs the live pi-harness (the real plugin reading HWiNFO on Windows), so they cannot be produced truthfully here. Their alt texts still describe the images as they are |
| 7a | Minor | The Press summary promised details on a deck without a detail view, and on an empty filter | Fixed: "Press would open details, but this deck has none"; "Press opens nothing until the filter is set" |
| 7b | Minor | The dial summary counted empty groups | Fixed (same as review 1, item 6) |
| 7c | Minor | Three touch zones omitted that the sides switch readings; "push pauses the auto cycle" with Auto cycle off | Fixed: both named |
| 7d | Minor | A stored 15 s auto cycle showed as "not known to this version" while the runtime runs it | Fixed: kept values read "(not in this list, kept)", and an interval reads "Every 15 s (not in this list, kept)" |
| 8 | Minor | "Alerts ignore this field" under Bar from and Bar to; one bad threshold hidden by a good one in the summary | Fixed: "The bar ignores this field"; the summary names the bad field |
| 9 | Minor | Checklist boxes lacked source context for screen readers | Fixed: each box is named "label, source, value, type" and every source is a named group |
| 10 | Minor | 12 px (dial face) and 22 px (group chips) horizontal overflow at 200 CSS px | Fixed: the face shrinks, the chip rows size their padding inside their width, the group name field can shrink. 0 px at 200 px in the affected states |
| 11 | Nit | Row height estimate 24 px, rows measure 28 px | Fixed |
| 12 | Nits | Rotation and detail notes created a new live node per rebuild; detail cell rename lacked "Rename"; Readings 2 to 4 lacked the help reference; a message inside the listbox; placeholder 3.98:1 on a hovered field; a missing dial header said "Saved reading not found" twice; different "every dial" wording on the dial and Control key | Fixed: one persistent announcer carries note changes; names and `aria-describedby` added; the message is a disabled option; hovered placeholders 4.63:1; the header says it once; "Every dial, everywhere" on both |

Verified by the reviewer: the combobox pattern (no writes on arrows,
Enter without navigation, Tab, Escape), the radio-group theme gallery,
kept unknown options, the unavailable-vs-missing distinction, the single
"plugin not responding" timeout, no fake face on the Control key or
detail tiles, list build-once and filter-in-place performance (p95 28.5
ms at 5,000), no listener leaks, guarded header and summary writes, token
contrast, target sizes, 320 px reflow and the absence of em dashes.
