# Round 3 issue register

Source: five independent first-pass reviews on the frozen baseline
`bc836455dfb26ec9` (token `1.7.0.0-d03`), saved verbatim in
`agents/r1/<role>.json` (71 findings: visual V, beginner B, power P,
accessibility A, adversarial X). `node tabulate-findings.mjs r1` lists them.
Stable IDs below (R01...) merge duplicates; the reviewer IDs stay the
evidence trail. Category: RD reproduced defect, MF measured friction, SB
standards-backed, WH walkthrough hypothesis, AP aesthetic preference.

Disposition: FIX (batch), OWNER (needs the real app or the owner), DEFER
(reason), KEEP (no change, reason). Status is updated as batches land.

## 1. Broken behavior, data or settings loss

| ID | Sources | Sev | Cat | Issue | Disposition |
| --- | --- | --- | --- | --- | --- |
| R01 | P01, X02 | S1 | RD | Choosing Custom while Elite is shown snaps back to Elite for every trusted input (keyboard, typeahead, mouse) and seeds six gesture fields with `controlPreset: "elite"`. The seed runs in a document capture listener and ends in `resyncBound()`, which resets the select before the shell saves the pick. Present at 4bf09c0 (1.7-line regression from b24ce39). The e2e check passes because it fires a synthetic `change`. | FIX batch 1: seed only after the preset write lands; resync only the six gesture selects; e2e check driven by trusted CDP key input. |
| R02 | V01, P02, B02, P07 | S2 | RD | A group's `×` removes the group and its readings in one press, with no confirmation or undo; focus then lands on the next group's `×` under the pointer, so a double click or double Enter removes two groups. | FIX batch 1: arm-then-confirm (the panel's existing Replace idiom) for a group that holds readings; after any removal focus moves to a non-destructive control. |
| R03 | X07, P08 | S2 | RD (sim) / WH (host) | Uncommitted text in the rotation rename, group name and detail cell rename fields is not saved by the shell's leave flush (mouseleave, window blur), unlike every bound field. | FIX batch 1: register those commits with the shell's leave flush without rebuilding under the caret. |
| R04 | X01, V04, B13, X02 | S2 | RD | The theme line names the hovered or focused chip instead of what is drawn, so the resolved theme vanishes while pointing; with an unknown stored value Tab shows a theme that is not drawn. The e2e suite asserts the preview. | FIX batch 2: the line reports the stored and drawn theme only (chips already carry names); replace the e2e preview check with "line unchanged while pointing at every chip". |
| R05 | B01, A04 | S2 | RD | A rotation or detail member HWiNFO no longer lists shows as a raw key, is called missing only in a tooltip or sr-only text, and is counted in "moves through these 3 readings" although the runtime skips it. | FIX batch 2: visible "not in HWiNFO" pill (the "on dial" pill style), the note counts live members and names the skipped ones. |
| R12 | X02 | S4 | RD | Grouped rotation edits send two identical frames; e2e "one write" checks assert `>= 1`; the palette position check runs only at 400 px. | FIX batch 1: one frame per grouped edit, exact frame counts, palette checks at 373 and 189. |

## 2. Misleading state or irreversible mistakes

| ID | Sources | Sev | Cat | Issue | Disposition |
| --- | --- | --- | --- | --- | --- |
| R07 | P03 | S3 | RD | Readings with the same label (two drives, two GPUs) are indistinguishable in the rotation list, toolbar names, rename label and detail tile editor. | FIX batch 2: when labels collide, the sensor's name is added to the colliding chips' visible text, titles and accessible names. |
| R11 | X05, V08 | S4 | MF | A healthy Gadget source shows a 42-word info box above the palette on every panel (palette 116 to 221 px, picker bottom at 404 of 410). Outage blocks run 80 to 239 px with a generic hint plus a forced-source sentence. | FIX batch 2: info tone becomes one line under the header with its detail behind a disclosure; forced-source text replaces the generic hint instead of adding to it. |
| R18 | B05 | S4 | WH | With a rotation set that does not include the reading on the dial, nothing says the next turn leaves that reading. | FIX batch 2: one note line naming it. |
| R19 | B06 | S4 | WH | On a Legacy dial the visible groups note implies groups work; the correction sits below the fold. | FIX batch 2: preset-aware note, preset warning moved next to it. |
| R20 | B07 | S4 | MF | "Reload sensor list" and "Retry now" give no acknowledgement when the problem persists. | FIX batch 2: one line "Checked again just now: still ..." in the status region. |
| R29 | B08 | S5 | RD | "Turning the dial changes this too" and similar lines show when turns are ignored or the reading is missing. | FIX batch 2: derive the lines from the effective controls. |
| R30 | B09 | S5 | MF | The folded Controls summary omits the pressed turn (Elite's group switch). | FIX batch 2. |
| R34 | B14 | S5 | RD | With no theme in the shared settings, the band says Default draws one theme while Advanced > Shared defaults shows Void. | FIX batch 2: the select and summary show the resolved shared theme (display only). |
| R39 | V06 | S5 | RD | Reading color wells show white for "automatic" in every theme; disabled Auto buttons look enabled. | FIX batch 2 (display only, never written). |
| R51 | X12 | S6 | RD | The graph select shows "None" for an unknown stored value; every other select names it as kept. | FIX batch 2. |

## 3. Accessibility barriers, blocked core tasks

| ID | Sources | Sev | Cat | Issue | Disposition |
| --- | --- | --- | --- | --- | --- |
| R06 | A01, B03, V07, X03, X04, A09 | S3 | RD | At 200% zoom (189, 160 px) the header's text column collapses (one letter per line, header taller than the panel), the dial face is clipped, the reserved toolbar slot and its hint overflow sideways, and chip pills are cut. | FIX batch 3: below about 240 px the header wraps (text under the face), the face never shrinks below its image, the slot and hint may wrap, pills never shrink. |
| R08 | P07 | S3 | RD | Focus falls to the page after committing a group name (Enter or Tab) or a detail cell rename (Enter). | FIX batch 1. |
| R09 | A02 | S3 | SB | Replace shared settings: the 5 s confirm window re-arms instead of applying for anyone slower than 5 s (the announcement alone is about 5 s). | FIX batch 3: armed until blur or edit. |
| R10 | A03 | S3 | SB | Copy support report drops focus to the page (disabled while waiting) and never announces its result. | FIX batch 3: aria-disabled while waiting, outcome announced. |
| R13 | A05 | S4 | RD | The fold pair's bottom quarter is dead where the dial's reading name wraps under it. | FIX batch 3. |
| R14 | A06 | S4 | MF | Keyboard focus on the checked theme chip shows as a 1 px sliver. | FIX batch 3. |
| R16 | A08 | S4 | SB | A threshold typo is marked invalid but never spoken. | FIX batch 3. |
| R26 | A10, V12 | S5 | RD | Forced colors: disclosure triangles become bars. | FIX batch 3. |
| R27 | A11 | S5 | RD | Forced colors: the saved reading in the picker list is unmarked. | FIX batch 3. |
| R28 | A12, V02, V03 | S5 | RD | Default chip on a light (Paper) shared theme: link mark 1.39:1 and dashed frame 1.59:1; on dark themes Default's 2 px frame competes with the selection ring. | FIX batch 3: mark and a 1 px frame drawn in the resolved palette's own colors. |
| R45 | A14 | S6 | RD | Reduced motion leaves three marker transitions running. | FIX batch 3. |
| R46 | A15 | S6 | RD | Default chip's description repeats its name. | FIX batch 3. |
| R47 | V11 | S6 | RD | Section summary focus rings are clipped to two lines. | FIX batch 3. |
| R48 | V13 | S6 | RD | Back-tile role note runs edge to edge in the warning look. | FIX batch 3. |
| R41 | V10 | S5 | MF | Native checkboxes and radios paint in the light scheme (brightest marks on the panel). | FIX batch 3 if the real host renders `color-scheme: dark` correctly; else KEEP. |
| R52 | X09 | S1 (low) | WH | Delete, F2, Alt+Arrow in the rotation list are untested on the real host, where the app may act on Delete. | OWNER: one check on a throwaway profile (owner declined app control). |

## 4. Repeated workflow friction

| ID | Sources | Sev | Cat | Issue | Disposition |
| --- | --- | --- | --- | --- | --- |
| R15 | P09, A07 | S4 | MF | The detail tile editor costs about four Tab stops per reading and pushes "Readings per tile", "Title tile text" and the second Back far below a long list. | FIX batch 4: move those settings above the list (they apply to every Details list mode); roving focus inside tiles DEFER (larger rewrite). |
| R17 | B04, X11 | S4 | MF | Opened reading lists (and "Pick another reading") land mostly below the 410 px fold. | FIX batch 4: on open, scroll so the list fits under the pinned header. |
| R21 | P04 | S4 | MF | Long rotations: the moved chip leaves the view; no jump to first or last. | FIX batch 4: keep the moved chip in view; Alt+Home, Alt+End. |
| R22 | P05 | S4 | MF | The rotation checklist has no "+ all" per sensor (the detail checklist does). | FIX batch 4 if the cross-review agrees. |
| R23 | P06 | S4 | MF | Moving a reading between groups takes five actions and lands last. | FIX batch 4 if the cross-review agrees: Earlier or Later past a group's edge moves it to the neighbor group. |
| R24 | X06 | S4 | WH | "On dial" wears the selection fill while the selection is a thin ring; the toolbar never names its target. | Cross-review. |
| R25 | X10 | S4 | MF | Undoing a member removal takes several steps and lands in the wrong group. | Cross-review (Undo line in the slot). |
| R36 | P10 | S5 | MF | The tick destination returns to group 1 on every fresh page. | FIX batch 4: derive it from the group holding the reading on the dial. |
| R37 | P11 | S5 | MF | Keyboard accelerators are invisible (no aria-keyshortcuts, not in titles). | FIX batch 4. |

## 5. Readability, hierarchy, copy, density

| ID | Sources | Sev | Cat | Issue | Disposition |
| --- | --- | --- | --- | --- | --- |
| R38 | V05 | S5 | WH | The band says "Default" three times and the panel says "inherited" three ways. Proposal: one line in the Text color select's idiom, "Theme Default (shared: Void) Change" / "Theme Ember (this key only)". | PROTOTYPE and compare before deciding (owner: keep the resolved theme visible). |
| R42 | V14, B12 | S5 | WH | About ten lines of help around the grouped rotation editor, two instructions said twice; the group radio's meaning is 280 px away. | FIX batch 5: trim, one "How groups work" disclosure, the radio's meaning next to the lists. |
| R32 | B11 | S5 | WH | "Sensor" and "source" each mean two things in panel copy. | FIX batch 5 (panel copy only; faces unchanged). |
| R43 | V16, B15 | S5 | WH | The header names only reading 1 on multi-reading keys and ignores the dial's rotation name. | Cross-review. |
| R40 | V09 | S5 | WH | The detail editor and the rotation editor use two visual dialects. | FIX batch 5: tokens and wording only; no restructuring. |
| R49 | V15 | S6 | AP | Four icon languages; the Reload button is a font glyph. | FIX batch 5: Reload drawn with Lucide `rotate-cw` at the fold pair's stroke. |
| R50 | V17 | S6 | AP | Reading 1's label is out of column; °F sits differently on key and dial. | Cross-review. |
| R44 | X08 | S5 | RD | Lab definitions flatter results (a target cut by the fold counts as first screen; heights quoted at 378, not 373). | FIX batch 5: stricter definition, 373, 189 and 160 in the matrix. |
| R53 | A13 | S5 | SB (low) | A WCAG 1.4.12 text-spacing override truncates two chip names. | KEEP unless batch 3 padding changes fix it for free (no user stylesheet in the host). |
| R54 | B16 | S5 | WH | With HWiNFO off, an unlabeled key cannot name its reading. | DEFER: needs plugin-side label memory; out of this UI pass's scope. |

## Status after cross-review and implementation (2026-09-26, token 1.7.0.0-d04)

Cross-review verdicts are in `agents/x1/<role>.json`. "Landed" means the
change is in the tree and a named check proves it (panel suite
`scripts/e2e-pi-panels.mjs`, persistence suite `scripts/e2e-pi-persistence.mjs`,
unit tests `test/pi-model.test.ts`, `test/pi-alias-contract.test.ts`).

| ID | Outcome | How the cross-review changed it | Proof |
| --- | --- | --- | --- |
| R01 | Landed | Seed runs after the shell's save (setTimeout 0 from the capture listener); only the six gesture selects resync; #f-preset never resynced. | Panel: 3 preset checks driven by trusted key input (fail on the frozen baseline). |
| R02 | Landed | One arm helper (armPress) for group remove and Merge; 450 ms guard ignores a double press; blur disarms; focus after removal goes to a non-destructive control. Merge arms whenever a group is named. | Panel: groups checks (double press only arms, blur disarms, second press one frame, focus not on a remove). |
| R03 | Landed | Leave flush registered on first keystroke, never mid-composition. | Panel: names leave-flush checks (group, rotation, cell). |
| R04 | Landed | Line reports stored and drawn theme only. | Panel: pointing and focusing at chips leaves the line. |
| R05 | Landed | Visible "missing" pill (the face's own word), sr-only duplicate removed, note counts measurements the dial steps through; pill wraps under the name below 240 px. | Panel: R05 check. |
| R06 | Landed | Header wraps below 240 px, face flex none, slots reserve the measured toolbar height, pills never shrink; band line reserved (see R38). | Zoom matrix 373/320/189/160: overflow 0, slots equal toolbar. |
| R07 | Landed | Tag pill (#N from HWiNFO's instance mark, else the sensor tail) only on colliding names; full sensor in title, toolbar names, announcements, rename label, reading color rows, detail chip buttons. | Panel: R07 check. |
| R08 | Landed | Enter refocuses the committed field. | Panel: Enter focus checks. |
| R09 | Landed | Armed until blur or edit (no timer), 450 ms guard, disarm says "Not replaced. Nothing was changed." | Panel: armed after 5.5 s, double press only arms; persistence Replace leg. |
| R10 | Landed | aria-disabled while waiting, focus restored after the copy fallback, outcome announced. | Persistence leg C. |
| R11 | Landed | Healthy Gadget: one panel line plus the plugin's full account under Advanced > Connection (#source-now); a withheld-reading note keeps the whole hint in the status region. Forced-source sentence kept as an addition (power: never replace a reason-specific hint). | Panel: two R11 checks. |
| R12 | Landed | One frame per grouped edit; exact counts; palette checks at 373 and 189. | Panel. |
| R13, R14, R16, R26, R27, R45, R46, R47, R48 | Landed | As registered (R16 relabelled walkthrough hypothesis). | Panel and forced-colors review. |
| R15 | Landed | Option B: Readings per tile, Title tile text and Also go back sit above Details list; How text says "below". Roving focus inside tiles (A07) stays DEFERRED. | Panel: R15 order check. |
| R17 | Landed | Page scrolls only on a person's open (pointer, first typed character, Down Arrow), once per open, instantly, never past the field under the pinned header, never back; reveal() puts a picker's field under the header. | Panel: R17 check at 373 x 410. |
| R18 | Landed | One line when the dial's reading is outside the set and something moves it; target is the runtime's entry member. | Panel: two R18 checks. |
| R19, R42 | Landed | One derived groups line from the stored map (where ticks go, what stays inside, what jumps; or why nothing jumps, with "Change gestures"); #groups-preset-help merged into it; the order sentence under the search hides with groups. No new disclosure. | Panel: R42 and R19 checks. |
| R20 | Landed | "Retry now" renamed "Check again" (it asks for the plugin's latest answer; the poller re-opens on every tick by itself); a persistent line in the status region says when the same answer came back and the read interval; docs updated. | Panel: R20 check. |
| R21 | Landed | Keyboard moves keep the chip in view; toolbar presses never scroll; Alt+Home and Alt+End added (in the R52 owner check). | Panel: R21 check. |
| R23 | Landed | Earlier and Later past a group's edge move into the neighbor group; visible labels unchanged, aria-label and title name the target; the page follows the relocated toolbar so the button stays under the pointer. | Panel: two R23 checks. |
| R28 | Landed | Mark in the followed palette's value color, dashes in its label color, 2 px kept. | Band matrix screenshots. |
| R29 | Landed | Picker help derived from the effective map ("Turns and pressed turns change this too", "Turns are ignored here"). | Panel: R29 check. |
| R30 | Landed | Pressed turn named when it differs, resolved to "switches group" or "switches sensor"; same resolution in "What the dial does now". | Unit: pi-model tests; panel R30 check. |
| R32 | Landed (panel prose) | "sensor" for HWiNFO's group in the details option, filter help, press summary and picker help; command names and faces unchanged; docs/sensor-details.md follows. | Unit: pi-model test; copy validator. |
| R34 | Landed | Display only via data-default; the a11y refinement (a disabled "not saved" option) is DEFERRED: every other select uses the same display-default pattern. | Unit: sharedDefaultsSummary tests. |
| R36 | Landed | Settled once per page from the group holding the dial's reading. | Panel: R36 check. |
| R37 | Landed | aria-keyshortcuts on each list and shortcut names in tool tooltips; Delete stays unadvertised until R52. | Panel: R37 check. |
| R38 | Landed as P1b | "Theme Default (shared: Void) Change" or "Theme Ember (set on this key)" ("dial" on the dial); Change is a flex:none sibling that holds its place invisibly on an explicit pick; below 300 px the label and Change share a row and the name wraps inside two reserved lines; help only for an empty key or an unknown value, its slot held for the page's life; the radiogroup is described by a spoken scope line. | Band matrix: 48 combinations (8 widths x key and dial x three shared themes), 384 picks, chips move 0 px across the 8 picks at every width, name never cut, Change 96 to 100% hittable; band 125 to 106 px at 373. |
| R39 | Landed (partial) | Automatic wells show the theme's value color; disabled Auto takes the disabled look. With "Color numbers by sensor type" on, a per-row neutral Auto swatch is DEFERRED (a color well cannot show "automatic"). | Unit: alias-contract tests. |
| R40 | Landed (tokens) | Tile editor on the panel tokens; "×N" size text KEPT (aria-label and title already say "N cells"; wider text wraps tiles at 320). | Screens. |
| R41 | Landed | `color-scheme: dark` on :root (Chromium 81+; the app's QtWebEngine is Chromium 130). Real-app rendering not observed by me. | Screens (simulated host). |
| R43 | Landed (dial) | Dial header leads with the name the dial shows (label, then rotation name, then HWiNFO's); quad-key heading DEFERRED. | Zoom matrix: dial header +13 px at 373 with a renamed reading. |
| R44 | Landed | Matrices run at 373 (DPR 1.5), 320, 189 and 160; first screen means not cut by the fold. | band-matrix, zoom-check. |
| R49 | Landed | Reload draws Lucide rotate-cw (checked against lucide-static, ISC; NOTICE updated). | Screens. |
| R22, R25 | DEFERRED | "+ all" for the rotation needs a one-press bulk Undo first; an Undo line is a new state machine two reviewers flagged for stale-state risk. R02's arm-then-confirm covers the costliest mistake. | |
| R24 | KEEP | Beginner reject, adversarial defer: fill means on dial, ring means selection. | |
| R50 | KEEP | Adversarial reject, a11y defer. | |
| R51 | KEEP | Select shows the drawn mode; value lossless. | |
| R52 | OWNER | Delete, F2, Alt+Arrow, Alt+Home, Alt+End on a throwaway profile; if unchecked by release, ship without the Delete binding. | |
| R53 | KEEP | No user stylesheet in the host. | |
| R54 | DEFER | Needs plugin-side label memory. | |

## Integrated re-review of d04 (2026-09-26, `agents/y1/`)

Five reviewers (xhigh, simulated host, frozen d04 copy) verified the Landed
items and hunted for new defects: 85 items checked fixed, 35 partly, 2
regressed, 5 not checked; 62 findings (7 S2, 5 S3, 12 S4, 22 S5, 16 S6),
50 of them new in d04. Fixed in the working tree after the review, each
with a panel check (`scripts/e2e-pi-panels.mjs`, 268 checks, all green):

| Finding | Sev | What was wrong | Fix | Proof |
| --- | --- | --- | --- | --- |
| VY01, PY01, AY01, AY02 | S2 | R17 regressed: a list brought into view under a resting pointer let the second press of a double click pick or tick a reading (also "Pick another reading"). | For 500 ms after a panel scroll, a press within 4 px of the resting pointer is swallowed; moving the pointer ends it; keyboard unaffected. | Four double-click checks at 373 x 410; the same double click writes a reading on frozen d04 and nothing on the tree (`dbl-proof.mjs`). |
| PY02, AY01 (a11y) | S2 | Holding Enter confirmed an armed remove, Merge or Replace (key repeat outlasts the 450 ms guard). | A repeated key never activates an armed button. | Held-Enter check: arms once, 0 writes. |
| PY03 | S2 | The folded Controls summary hid a reset that reaches every dial. | The push that resets names its reach; Elite's long push is listed when it resets past this reading. | Unit test in `test/pi-model.test.ts`. |
| PY04, AY02 (a11y) | S3/S4 | An echo rebuild (a turn, an auto cycle step) silently dropped an armed remove. | The arm lives in module state keyed by what it removes and is re-applied on rebuild; a person leaving drops it. | Check: armed through a rebuild, then one fresh press removes in one frame. |
| PY09 | S4 | Merging unnamed groups discarded the partition in one press. | Merge arms whenever two groups hold readings ("Merge 2 groups into one list?"). | Check. |
| PY05, BY01 | S4 | The groups line promised jumps while groups were not in effect; a tap under two touch zones counted as a jumper. | Future tense until two groups hold readings; taps under two zones excluded; Ignore turns stated. | Check. |
| BY02 | S4 | "Turns change this too" while the runtime holds the dial (reading missing, HWiNFO off; `advance()` returns). | The picker line says nothing moves the dial and why. | Check on dial-missing. |
| AY03 (a11y and adversarial) | S3/S4 | Copy support report's announcement called an undefined `hw`. | Uses the shell global `hwShell`. | Check with a stubbed clipboard. |
| AY04 | S4 | The status region was atomic, so each Check again re-read the whole block. | `aria-atomic="false"`. | Check. |
| AY06 | S4 | A successful Check again dropped focus to the page in silence. | Says "HWiNFO answered: the reading is live again." and keeps focus on the Reading section. | Code path; to cover in the owner check. |
| AY07 | S4 | Armed and edge button names did not start with their visible words. | Names start with the visible words ("Later: move ...", "Remove CPU and its 2 readings? Press again to remove it."). | Checks updated (contract change, WCAG 2.5.3). |
| VY02, BY04, PY07, AY08 | S3/S4 | Twin tags could be identical (same brand, same instance mark). | The first word of the sensor name no twin has, else the place in HWiNFO's list ("no. 1"). | R07 check still "#0"/"#1". |
| VY03 | S3 | At 200% zoom pills squeezed names to one letter. | Below 240 px any chip with a pill wraps its pills under a 6ch name. | Visual. |
| AY09 (a11y) | S3 | At 200% zoom, focusing the detail search scrolled the field itself 468 px above the view (present since 4bf09c0). | After the landing + comes into view, the field is clamped at or below the pinned header (0 when unpinned). | Check at 189 and 160 px; frozen d04 fails the same probe (`ay09-proof.mjs`). |
| VY07/PY12, VY08, VY10, VY13, BY03/AY05, BY09/PY11, BY11, PY08/AY09, AY11, AY12, AY13, AY14, AY15, VY09, AY07 (Gadget), VY11 | S5/S6 | Armed text without the group, hover lost the danger fill, a waiting Copy looked enabled, planned tiles lost their edge, "no change yet" after a change, "below" help text, a dead placeholder, the tick destination moving, notes spoken on every open, the leave flush speaking mid-typing, the scope line read twice, the tag spoken twice, clipped focus rings, the Legacy note, the Gadget pointer sentence, the answer line bouncing. | Each fixed as the reviewer proposed. | Suites green. |

Left open, with reasons: VY04 (a four-row toolbar reserve at 160 px, zoom only),
VY05 (automatic wells under a custom text color, R39 follow-up), VY06 and
BY06 (Change's place below 300 px, superseded by the foldable band design),
BY05 (empty group guidance), BY07 (the outside line's wording), BY08 (Press
summary on Gadget), BY10 (empty dial note), PY06 (a pressed turn over a
one-sensor set), PY10 (summary length), AY11 old (the Custom seed's frames), AY06 adversarial test
items beyond the double-click checks.

## Final audit and the final candidate (d05 to d06, 2026-09-26)

Two non-mutating auditors read everything that changed after d04: one the
ui delta (FA01 to FA10), one the docs and changelog claims (CA01 to CA15).
No blockers. Then the owner approved the foldable theme band (design R2 in
`themefold/`), which shipped in d06.

| Finding | Sev | What was wrong | Fix | Proof |
| --- | --- | --- | --- | --- |
| AY11 follow-up (found by the persistence suite) | S3 | The AY11 fix made list notes silent on open, but also on a person's first edit after opening and on every Details list edit (the channel was never primed). | `announce(..., { quiet })` records a note without speaking; an edit's render speaks, a repaint queued during a mouse press keeps that intent. | Two checks that fail on the pre-fix code (ay11-proof) and pass now. |
| FA01 | S3 | A pick that filled an aimed tile, and "+ all" with an aim, rendered the new count in the disarm, so it was never spoken. | That render runs as the edit's own. | FA01 check. |
| FA02 | S3 | Custom, two touch zones, tap set to switch groups: the line said turns run through all groups while the runtime keeps boundaries. | A branch on the resolved `switchesGroups`: turns stay inside a group and the tap never fires. | FA02 check. |
| FA03, FA04 | S3/S4 | The stale-press guard re-checked the clock per event, so a press straddling 500 ms lost its mousedown but kept its click; a tap never moved the pointer record. | One verdict per press at pointerdown, applied to its mousedown and click; pointerdown records the position. | Code and the existing double-click checks. |
| FA05 | S4 | The region emptying on the plugin's own poll dropped focus in silence; "the reading is live again" was said on a key with no reading. | Whenever the region empties while it held focus, focus moves and the panel says why, in words that fit the panel. | Code path; owner check step 6. |
| FA06 | S4 | Readings per tile regrouped the list silently. | After the first delivery, its render speaks. | FA06 check. |
| FA07, FA08, FA09, FA10 | S5 | Stale note after a preset change; truncated twin tags could match; no finally around the speaking flag; group removal named "group 1" after asking about "CPU". | `renderRotationSet` on preset change; colliding cut tags fall back to "no. N"; `speakingNotes` with finally; the result uses the name. | Code; suites green. |
| CA01 to CA14 | S4/S5 | Docs lines the redesign had made wrong (theme tooltip, five-second arm window, status message in Reading, Delete advertised, rotate vocabulary, 1.6 Press labels and images). | Rewritten against the code; three detail images and the picker image recaptured. | Copy validator; image-by-image read. |
| Owner, 2026-09-26 | feature | The theme band never folded. | It folds like a section; folded, its row keeps the checked chip and the scope; a late fold answer never folds a section once the panel shows (ADR05). | 70 of 70 design acceptance checks on the product panels; 14 new panel-suite checks. |

d06 gates: panel e2e 289 of 289, persistence 646 of 646, unit 1,351 of
1,351, axe 0 and own checks 0 in 62 runs (a11y-d06-410.json), density in
density-d06.json. Installed on the deck by the bench route (archive
a02d1836..., 47 files hash-verified); 48-hour soak monitor started
2026-09-26 16:52 local, CSV `release/soak-1.7.0.0-d06-20260926-1652.csv`.

## External review and d09 (2026-09-26 night)

A different AI model reviewed `f98c76f` / d08 end to end with the prompt
in the private release docs; its report, its findings and the answer to
each finding (the fix and the check that proves it) stay in the private
release docs (`docs/release/external-review-1.7/`). Verdict: do not ship d08. Two must-fix product defects
(AX02, a Make shared that finished late overwrote a newer pick; AX05's
test holes) and a runner that hid a failure (AX06) are fixed in d09, with
the should-fix items (AX03, AX04, AX07) and the copy corrections (AX08 to
AX11). AX01 (soak, owner check, clean-clone qualification) stays open: the
d08 soak ended after 8 samples when the machine bugchecked in the NVIDIA
display driver.

Every new product check was run against the d08 panel files and fails
there (10 checks), and against two deliberately broken copies (confirmed
Merge as a no-op fails 4 checks; a label edit that writes twice fails 1).
One persistence check changed its setup, not its assertions: its "Paper
deck" had a stored Void shared theme under a plugin answer of Paper, a
state the plugin cannot reach once a known stored theme is read first
(AX07); it now stores Paper for that check and Void again after it.

d09 gates (simulated host unless stated): panel suite 335 of 335 (exit 0,
about 235 s, no browser left; the d08 panel files fail the 10 new race checks, a
Merge no-op copy fails 4, a double-write copy fails 1); persistence 646 of
646; the theme-band runner 70 of 70 with exit 0 (`themefold/acceptance/D09/`;
d08 69 of 70, exit 1, `acceptance/D08/`); unit 1,355 of 1,355 (with `c270e63`: a single-source mode never opens the
other provider; a settings echo during a slow Make shared is not a pick,
each failed by a mutant); lint and
typecheck 0; copy validator 0 warnings; pack validation and `streamdeck
validate` pass. Archive `82b2b856...` (362,033 bytes, 47 members),
installed on the deck by the bench route with every file hash-verified,
0 WARN or ERROR, settings unchanged; soak from 2026-09-26 21:15 local.
Teardown: on Windows the spawned chrome.exe can hand off to a browser that
outlives it; `cdp.mjs` now stops the processes launched with its own
throwaway profile and `pi-sim.mjs` drops live connections on stop, so runs
no longer wait on a leftover browser until the watchdog (now 420 s, a hang
guard; a solo run takes about 235 s).

## d10 (2026-09-26 night): Delete checked on the real app

The owner pressed Delete in a dial's rotation list on d09 in the Stream
Deck app: it removed the selected reading and nothing else (R52's Delete
part passes; F2 and the Alt keys are still in OWNER-CHECK step 8). So
Delete is now advertised like the other list shortcuts (R37:
`aria-keyshortcuts`, the Remove tooltip, the list's spoken help, the
controls and dial docs). Found on the way: a held Delete, or Enter held on
Remove, removed the selected reading and then every reading after it
(3 to 0 in a probe); one press now removes one (two panel checks; a copy
without the guard fails both). The owner's surprise at an emptied set (the
overview then showed the reading on the dial and the next one of its
sensor) was the designed fallback; the panel's empty note and the dial
docs now say what an overview shows then.

d10 gates: panel suite 337 of 337 (exit 0, 239 s, no browser left);
persistence 646 of 646; the theme-band runner 70 of 70, exit 0
(`themefold/acceptance/D10/`); unit 1,355 of 1,355; lint and typecheck 0;
copy validator 0 warnings; pack validation and `streamdeck validate` pass.
Archive `9913d94c...` (362,215 bytes, 47 members), installed by the bench
route (every file hash-verified, 0 WARN or ERROR, settings unchanged but
the auto-cycling dial's reading); soak from 2026-09-26 22:09 local.

## d11 (2026-09-26 night): the external review's second pass

The second pass (on d09 and d10; report private, like the first) found
four product defects and one citation. All four reproduce on the d10 panel
files; each has a check the d10 files fail (16 in all) and d11 passes.

| Finding | Sev | What was wrong | Fix | Proof |
| --- | --- | --- | --- | --- |
| AX12 | must | Changing one detail cell's color or label rewrote that whole list normalized: entries this version cannot read became `""` or `null`, entries past the tile's size went, and a sibling `automaticColors` list could vanish (predates 1.7). | A cell edit in a tile that kept its size rewrites only the cells it changed; a resize still writes whole lists. | 2 lossless checks (color with its automatic flag, label). |
| AX13 | must | A double click with clicks 470 or 650 ms apart (a Windows double-click time can be longer than 450 ms) confirmed Merge, a group's Remove, or Replace shared settings. | The second click of one gesture (`detail` 2 or more) never confirms; the 450 ms guard stays. | 6 no-write checks (3 buttons, 2 gaps) and 3 separate-click confirms. |
| AX14 | should | A theme delivered between press and release of Make shared was shared without a fresh press. | A press records the key's theme choice at pointer or key down; a click whose choice moved does nothing. | 4 checks (key and dial, mouse and Space) and a plain Space control. |
| AX15 | should | The late-share announcement named inherited JavaScript members for an unknown stored theme ("keeps function Object()..."). | Theme names come from this build's own list only; an unknown stored theme is said the way the line shows it: stored, unknown, draws Void. | 4 checks (`constructor`, `__proto__`, `toString`, `future-theme`) and a unit test. |
| AX16 | nit | The journey piece cited the d06 density file for a figure computed from d07. | Cites d07. | 3,243 against 3,183 px. |

d11 gates: panel suite 357 of 357 (exit 0, 263 s, no browser left);
unit 1,356 of 1,356; lint, typecheck 0; copy validator 0 warnings; pack
validation and `streamdeck validate` pass. Archive `0a6f13e2...`
(363,041 bytes, 47 members).

R52 closed (2026-09-26): the owner checked F2, Alt+Left, Alt+Right,
Alt+Home and Alt+End in a dial's rotation list on d11 in the Stream Deck
app; each did its job and the app took none. With Delete (checked on d09),
every list shortcut named in `aria-keyshortcuts` is confirmed on the real
host. OWNER-CHECK step 8 passes.

## d12 (2026-09-27): the external review's third pass

The third pass (on d11; report private) hunted each earlier finding's class
across the panel and the plugin and found ten items. Every product item
reproduces on the d11 files; each has a check that the d11 panel files, or
a copy with the fix removed, fail and d12 passes.

| Finding | Sev | What was wrong | Fix | Proof |
| --- | --- | --- | --- | --- |
| AX17 | must | A whole-tile move rebuilt the plan from the active walk and dropped stored tiles no reading reaches (predates 1.7). | The rebuild keeps them after the moved tiles (tile grip and the ghost drop). | 1 panel check (keyboard grip move). |
| AX18 | must | Renaming one tile pruned an untouched trailing tile that parsed as the default but stored entries past its cells or a label with spaces (predates 1.7). | A trailing tile storing data this build would not restate is never pruned. | 2 panel checks. |
| AX19 | must | Removals, resizes and swaps rebuilt cells from the parsed values: entries this build cannot read became `""`/`null`, entries past the cells went, and on a swap they stayed in the old cell (the d11 fix covered same-size cell edits only). | Each reading's stored cell entries are captured from storage; a write gives a cell its reading's entry back while its value is unchanged, entries past a tile's cells keep their stored index, and a reading carrying such entries keeps an explicit tile. | 3 panel checks (remove, 4-to-1 resize, quad swap), exact stored frames. |
| AX20 | must | Enter held on a detail reading's remove removed it and every reading after it. | One panel-wide rule: a key repeat on any control that removes, merges or replaces does nothing (replaces d10's rotation-only guard). | 1 panel check. |
| AX21 | should | Tab (or any focus loss) mid-press cleared d11's Make shared press record, so a stale press shared again. | The record ends only with its own kind of release, after the click that release may fire. | 1 panel check. |
| AX22 | should | Control command, gesture and detail-slot lookups, and the preview's theme metadata, read inherited JavaScript members; the slot panel threw on `constructor`. | Own keys only (`Object.hasOwn`) in the panel and in `buildPreview`. | Unit tests (model, slot panel, preview). |
| AX23 | should | The Control summary called `backToCurrent`, a command the dial runs, unknown. | Named "Back to current value". | Unit test. |
| AX24 | should | A Readings per tile value arriving from elsewhere was announced as the person's edit. | Only a change of the select in this panel is spoken. | 1 panel check (and FA06 still passes). |
| AX25 | nit | The dual-layout docs said badges never cost label space. | A pinned row's badge shares its label line. | Renderer read. |
| AX26 | must | A held dial press released after the panel changed its command or reset reach ran the new command (Pause/resume became "reset all dials"). | A settings change that alters a held press's command, target or reach consumes that press; an unchanged echo does not. Plugin-side (`src/actions/sensor-dial.ts`). | Unit test on the production handlers; fails with the guard removed. |

The 70-check theme-band runner no longer depends on a temporary copy of
d04: its band baseline (identical in the D08 to D11 records) is frozen in
`themefold/baseline-d04.json`, and it runs from the repo alone.

d12 gates: panel suite 366 of 366 (exit 0, 273 s, no browser left; the d11
panel files fail the 9 new panel checks); unit 1,362 of 1,362; lint,
typecheck 0; copy validator 0 warnings; pack validation and `streamdeck
validate` pass. Archive `223a4cef...` (364,894 bytes, 47 members),
plugin.js `dd92f64f93bad053...` (changed: AX22 preview metadata, AX26).

## d13 (2026-09-27): the external review's fourth pass

The fourth pass (on d12; report private) found nineteen items, AX27 to
AX45, and proposed four simplifications, MS01 to MS04. All were checked
against the code first and all are fixed or adopted. Two independent
reviews of the first d13 then tried to break the fixes; they found a
duplicate-entry regression in the AX29 fix, an incomplete AX35 and
AX28, and missing tests, all fixed below before install.

| Finding | Sev | What was wrong | Fix | Proof |
| --- | --- | --- | --- | --- |
| AX27 | must | A held key press resolved under settings delivered mid-press, or after a replayed appear: another reading, behavior or detail target (predates 1.7). | Any change to the key's settings document (compared with sorted keys, so an echo in another key order is no change) and any replayed appear consume the press. | 20 unit cases on the production handlers with the real press engine; the d12 source fails 16. |
| AX28 | must | A threshold typed while HWiNFO was away took the unit of whatever reading was selected when data returned (predates 1.6). | The edit records the reading on screen, if it is on screen, and stamps that reading's unit; carried across hide and replay. | 3 unit tests; each fails with its line reverted. |
| AX29 | must | Moving a partial tile dropped its empty cells' stored entries. | Cells no reading fills when the plan is read are dormant; their entries stay stored past the tile's new size. A removal or drag that shifts dormant cells falls back to the stored size, so nothing is written twice. | 3 panel checks (move, removal without duplicates, prune). |
| AX30 | must | Group Remove and Merge arms were joined strings: a changed group could share the old arm and a second press removed it. | The arm names the whole stored group (sorted-key JSON). The shared Config Apply arm also names its exact document text. | 5 panel checks (3 collisions, a reordered echo that keeps the arm, a refilled well). |
| AX31 | must | A hand-edited `autoCycleMs` of true or a list enabled cycling; an object threw mid-tick (predates 1.6). The panel described a numeric interval as off. | Only a string or number counts, in the plugin and one shared panel function. | 1 unit test (8 inputs); 8 panel checks across three panel surfaces. |
| AX32 | must | The archive carried credits but not the license texts of its bundled code. | NOTICE carries the exact license texts of every package in `bin/plugin.js` (measured from the bundle: the SDK, utils, schemas, ws, tslib), sdpi-components and Lit. | 6 unit tests read the license files from `node_modules`. |
| AX33 | should | An unrelated cell edit grew untouched short stored lists (`colors: []` became `[null, null]`). | Generated blank entries past a stored list's length are not written. | 1 panel check. |
| AX34 | should | A queued Elite-to-Custom seed wrote six gesture fields into a newer document. | The seed runs only if no document arrived from outside since the pick. | 1 panel check. |
| AX35 | should | A stored key spelled `__proto__` lost its name and color on edit, in the panel and in the dial. | Own-property writes in the panel; a prototype-free name map in the plugin. | 1 panel check, 1 unit test. |
| AX36 | should | Releasing Enter elsewhere ended a held Space press on Make shared. | The press record holds the exact key. | 1 panel check. |
| AX37 | should | An unrelated detail edit rewrote every stored key's spelling (pasted names, spacing). | Each key keeps its stored spelling; a key removed and added back is written bare. | 2 panel checks. |
| AX38 | should | The standalone snapshot parser threw RangeError on truncated input. | Typed errors for short buffers, sections past the end and counts past the native bound; the cached fast path needs the validated length. | 5 unit tests. |
| AX39 | should | A packer that wrote its archive and then failed left it in `release/`. | Any failure removes the archive. | 1 unit test. |
| AX40 | should | The lab browser accepted any debugger on its fixed port. | The browser binds a free port and names it in its own profile; a failed launch stops its browser. | Probe: a real launch works; a launcher that starts no browser is refused and leaves nothing. |
| AX41 | should | The panel suite's watchdog exited without closing its browser. | It closes the browser and the simulated host first (10 s at most). | Read and probe. |
| AX42 | should | The 5,000-reading search check passed on one wrong result. | It requires the exact last reading. | Astra's wrong-result mutant (not rerun here). |
| AX43 | should | Auto cycle ran on the wall clock; a clock correction hurried or stalled it. | Monotonic time for auto cycle, the hidden-dial memory and the strip overlays. | 2 unit tests. |
| AX44 | should | A data reading that overflowed once converted to bytes showed "Infinity". | The unavailable mark in the reading's own unit. | 1 unit test (32 cases). |
| AX45 | nit | Comments and a test title claimed a universal 4-glyph cap. | Worded to the range it holds; the renderer's truncation of larger values is tested. | 1 unit test. |
| MS01 | | A reading-color preset copied the whole map once per reading. | One copy, edited in place. | Existing checks and the recaptured image. |
| MS02 | | Each visible dial was sampled twice per tick. | Once, by the render; an auto-cycle move samples the reading it leaves. | Astra's differential over 90 configurations, rerun here d12 against d13: 720 of 720 checkpoints equal; 1 unit test. |
| MS03 | | The persistence suite slept a fixed 3.5 s at 26 panel starts. | It waits for a loaded, connected, settled panel, 3.5 s at most. | 646 of 646 twice; 205 s to 130 s. |
| MS04 | | Each lab navigation left its listener and a 10 s timer behind. | Both released when the navigation settles. | Suites. |

The open item since d05 is explained for this dial: the "SL Film 1.7"
dial at Encoder 5,0 has auto cycle on (`autoCycleMs` "5000"), which the
d12 record missed. Two snapshots taken 7 s apart with no install between
them show it stepping from rotation member 2 to member 3, so a reinstall
proves nothing about it. The d05 observation (three dials) was not
rechecked.

d13 gates: panel suite 388 of 388 (the d12 panel files fail 12; a copy with
the four review-of-d13 fixes reverted fails exactly those 4); persistence
646 of 646 in 130 s; theme-band runner 70 of 70; unit 1,403 of 1,403; lint,
typecheck 0; copy validator 0 warnings; pack validation and `streamdeck
validate` pass. Archive `b74069565b35446c...` (367,303 bytes, 47 members),
plugin.js `b171a4a3a47d2e4f...`. Installed 2026-09-27 13:32 local from the
archive's own bytes (47 files hash-verified, 0 WARN or ERROR); 48-hour soak
restarted on d13, CSV `release/soak-1.7.0.0-d13-20260927-1333.csv`, closing
2026-09-29 13:33 local.

After install, `81d449c`: the persistence suite removes its throwaway
browser profile once its browser is gone (every run had left one in the
temp folder); 646 of 646 again. Test harness only; the installed bytes
are unchanged.

## d14 (2026-09-27): the external review's fifth pass

The fifth pass (on d13; report private) found eleven items, AX46 to AX56,
and proposed two simplifications, MS05 and MS06. All were checked against
the code first and all are fixed or adopted. Three independent reviews of
the first d14 then tried to break the fixes; they found a defect in the
AX47 fix as proposed, a native test the notice change broke, holes in the
new license and copy checks and in the simulator, and a soak counter that
read the wrong column. All are fixed below.

| Finding | Sev | What was wrong | Fix | Proof |
| --- | --- | --- | --- | --- |
| AX46 | must | A HWiNFO Control key held while its settings changed fired the new command on release, such as a reset of every dial; a replayed appear or a disappearance did not end the press either (predates 1.6). | The key records its settings document (sorted keys) at key down; a changed document, a release carrying other settings, a replayed appear or a disappearance consumes the press. A release with no key down seen still fires, as a Multi Action or Key Logic step delivers it. | 4 unit tests on the production handlers; the d13 source fails 3 (the fourth covers the unchanged lone release). |
| AX47 | must | Removing a reading from a partial tile, or dropping a chip into one, misplaced or dropped stored entries of the cells no reading fills. | Each tile tracks the entries of the cells no reading fills, and where each stored list ends, cell by cell through every removal and insertion, and writes them back past its size. A reading that lands in such a cell (a pick, or a resize that flows one in) wears that entry, as the deck draws it, and owns it from then on; one bringing entries it wears there keeps them and the stored entry moves one cell on (see below). | A new unit test runs the production editor in a vm: 16 cases and a seeded walk of 2,500+ edits with reloads; the d13 file fails 10 of 17. The review's harness: 14,483 structural steps and 8,400 raw checks, 0 failures (two of its scenarios assume the other landing rule; see below). |
| AX48 | should | The panel's second-press confirmations and its stale-pointer guard ran on the wall clock: a clock correction could confirm early or swallow presses for an hour. | Every panel deadline uses `performance.now()`. | 8 panel checks jump the clock an hour each way between presses. |
| AX49 | should | The detail view's Back debounce and blackout ran on the wall clock (predates 1.6). | The navigator's default clock is monotonic. | 3 unit tests on the production default; the old default fails 2. |
| AX50 | should | A sensor name holding a line break wrote what read as a separate log entry. | HWiNFO text in Gadget notices, and device names in log lines, are JSON-quoted. | 2 unit tests on the production provider; the d13 source fails both. The native test that expected the unquoted notice was updated. |
| AX51 | should | A malformed themes message threw in the panel and left a stale gallery. | The message is ignored unless it names a default among its themes, no theme uses the Default chip's empty id, and every palette carries hex colors for what a chip paints. | 2 panel checks (8 malformed messages, then a good one). |
| AX52 | should | The test simulator ran script text from fixture settings. | Its inline bootstrap escapes `<` and the two line separators, and the page is spliced with a function so `$` patterns stay text. | 1 panel check. |
| AX53 | should | The license test passed with the Lit disclaimer or the whole sdpi license deleted. | The test reads NOTICE as the sections it renders to: exactly the eight license headings, once each, no HTML comment, each section equal to its full text. | Nine mutants (each license deleted, a commented-out license, a demoted heading, a doubled section, the Lit disclaimer) all fail. |
| AX54 | should | The archive reader refused a valid ZIP64 member larger than the archive. | An expanded size is bounded by what a Buffer holds. | 1 unit test (1,000 and 1,000,000 bytes); the d13 reader fails it. |
| AX55 | should | The Marketplace image generator claimed setup takes seconds. | New headline; the copy validator checks the image generator as copy, whole, and bars "takes seconds" claims. | The validator flags the old headline and a caption, and runs on Node 20. The committed shot 4 image is regenerated before the 1.7 gallery upload (release step). |
| AX56 | nit | Presses whose release never reached the window each left a listener behind. | One named listener, removed at the ceiling. | 1 panel check. |
| Soak | | The soak monitor counted WARN or ERROR anywhere in a log line (found by the review of d14). | It reads the level column. | 1 unit test; the old pattern fails it. |
| MS05 | | Each two-row dial tracked its row subscriptions in a set the poller already keeps. | Removed; the poller's own guard stands. | Unit suite; the review's 300-checkpoint differential. |
| MS06 | | The panel suite slept 600 ms after every open. | It waits for a ready panel, 3.5 s at most. | 400 of 400 in 171 s (the review measured 293.6 s for d13's 388 checks with the sleep). |

Two rules were decided here (AX47). First, a tile's cell lists are one
sequence: a removal moves every later entry up one and an insertion
pushes them on, entries stored past the cells included. d12 kept those at
their stored index while earlier cells shifted, which needed filler
entries and let the d13 duplicate happen; the d12 panel check was
rewritten to the new rule, with the reason beside it. Second, a reading
that lands in a cell no reading filled takes that cell's stored entry over
instead of pushing it on. The review proposed pushing; with readable
labels that wrote the label twice (`["A","B","C","D"]` plus a pick became
`["A","B","B","C","D"]`), and with the panel reopened between size-cycler
presses it grew the stored lists on every round. Taking over matches
what the deck draws and what every earlier build showed, and a full round
of the size cycler comes back to the plan it started from. A tile whose
last reading leaves is still dropped with everything it stored.

d14 gates: panel suite 400 of 400 in 171 s (the d13 panel files fail
exactly the 11 new and changed panel checks); persistence 646 of 646 in
131 s; theme-band runner 70 of 70, run from the repo and again on the
extracted archive; unit 1,432 of 1,432; native 169 of 169; lint and
typecheck 0; copy validator 0 warnings (65 files). Archive
`a83ff60ebfb49634...` (368,597 bytes, 47 members), plugin.js
`d37987a6ab0bf334...`, hwsm.node unchanged. Installed 2026-09-27 19:13
local from the archive's own bytes (47 files hash-verified, 0 WARN or
ERROR); settings across the install: only the auto-cycling dial at Encoder
5,0 changed. The d13 soak (pid 67908) was stopped; the 48-hour soak
restarted on d14, CSV `release/soak-1.7.0.0-d14-20260927-1913.csv`,
closing 2026-09-29 19:13 local.

## d15 (2026-09-27): the external review's sixth pass

The sixth pass (on d14; report private) found twelve items, AX57 to AX68,
and proposed two simplifications, MS07 and MS08. All were checked against
the code first; all are fixed or adopted, one with a deliberate
difference (AX57, below). Three independent reviews of the first d15 then
tried to break the fixes. They found no must-fix; they found a variant of
AX58 (removals, resizes and moves), a copy that finished after its
deadline and stayed on "Copy failed", a dial that kept a replayed press
whose release was lost, a lab run that hung when its browser never
started, and seven fixes no test could see. All are fixed below.

| Finding | Sev | What was wrong | Fix | Proof |
| --- | --- | --- | --- | --- |
| AX57 | must | A repeated key down re-armed a HWiNFO Control press that changed settings or a replayed appear had consumed, so its release ran the new command (an incomplete AX46). | A repeated down keeps the record it finds. A key that disappears mid-press is marked as left: its release cannot reach it while away, so the first down after it returns is a new press, and a release that reaches it with no down since is consumed. | 2 unit tests on the production handlers; the repeated-down matrix fails on d14, and the second guards the new-press rule, including a settings change while the key is away. |
| AX58 | must | An edit that did not write a tile's cell field (the Abc toggle, and, found by the review of d15, a removal, a resize or a move) replaced a field stored in a shape this build cannot read with a list of blanks. | Such a field stays as stored unless an edit writes it, a reading brings its own entries into it, or a cell now reads as something other than blank. | 18 unit tests over the production editor (17 fail on d14; the other checks that an edit of the field still writes it) and a panel check with a real mouse click (fails on the d14 panel files). |
| AX59 | should | A stored command or shared theme that is an object without a string form threw while the panel drew its summary. | Neither is coerced: an unknown command is shown as JSON, and only a string names a shared theme. | Unit assertions for both summaries (fail on d14). |
| AX60 | should | A themes message with an effectiveDeckTheme that is not a string passed the AX51 guard and threw in the gallery. | The guard rejects it; absent is still fine. | 2 panel checks on a key with no shared theme (four malformed values, then a good one that is named); the first fails on the d14 panel files. |
| AX61 | must | Two global-settings documents arriving in one socket read let the theme migration write the older one back over the newer, and startup apply the older one again. | A listener registered on import keeps the latest document delivered; a read returns it when a delivery arrived during the read, the migration writes onto it, and startup no longer applies the reply again (the delivery listener already did). | 5 tests through the real SDK connection and ws frames and a structural check that plugin.ts applies settings only in its listener; 5 of the 6 fail on d14 (one reply still migrates on both). |
| AX62 | should | A detail hold released after its threshold, before its timer ran (a busy or waking PC), became a tap. | The release is classified by the time held as well as by the timer. | 2 unit tests: 0, 499, 500, 501, 600 ms and one hour, with the late timer checked silent (fails on d14), and a late release after a hold or a consume adds nothing. |
| AX63 | should | Copy support report copied unrequested, late and duplicate answers, and an old timer or clipboard write could settle a newer request. | Each request carries an id that the plugin echoes; only the first answer to the pending request copies; a new request cancels the old label restore; a copy that lands after the deadline still corrects the label. | 9 tests on the shipped script in a vm and on both plugin entry points (7 fail on d14), and the panel suite's normal copy. |
| AX64 | should | Finite samples could overflow a dial's session sum, and AVG stayed infinite for the session. | After an overflow the mean is kept by steps that cannot overflow; ordinary sums are unchanged. | 3 unit tests: the overflow streams with 200 seeded runs and the rendered AVG fail on d14; ordinary sums keep their exact state. |
| AX65 | should | pi-lab exited 0 with no report when AXE_CORE named a missing file, and (found by the review of d15) hung when its browser never started. | It imports the scripts' failure monitor, and a failed command exits 1. | 1 subprocess test (fails on d14); the browser case exits 1 after 17 s, where d14 hung (measured once; a permanent test would add 16 s to the unit suite). |
| AX66 | should | Device lookup treated inherited names ("constructor") as known models and threw on some objects; the grid was coerced the same way. | Only an own, whole, non-negative number names a model or a grid size; the log line quotes a type that is not a number. | 3 unit tests (2 fail on d14; the third shows every numeric type derives as before). |
| AX67 | must | A repeated key down after changed settings or a replayed appear acted under the new settings, and a repeated down after a hold could fire a second hold. | The press engine keeps a held press through repeated downs; changed settings or a replayed appear consume it until release instead of ending it. | 15 unit tests on the production key action and 2 on the engine, all failing on d14 (2 echo controls pass on both). |
| AX68 | must | A replayed dial appear during a press reset the gesture, so a repeated down started a new press under the new settings. | A replayed appear keeps the held press, consumed; a turn the app reports as not pressed ends it, since its release may have been lost in the replay (review of d15: otherwise plain turns acted as pressed turns). | 2 unit tests (the first fails on d14; the second fails without the turn rule). |
| MS07 | | Every dial rebuilt its whole name map on every tick. | The raw map is read; only the names drawn are checked. | The review's 288-case differential hash is identical on d14 and d15; 13 to 14 % less time per tick and about 25 % fewer sampled bytes in its bench; a unit test pins the lookup rules it keeps. |
| MS08 | | An uncalled panel helper. | Removed. | Panel suite. |

The press engine's contract changed on purpose (AX67): a repeated key
down with no release between used to replace the session, which reset
its deadline; it is now the same press. The test that pinned the old
contract was rewritten to guard what the generation check is still for, a
cancelled session's timer, now with a clock so it can fail.

AX57 differs from the review's proposal on purpose. Keeping every record
through a disappearance would swallow the first real press after a page
switch or a device disconnect mid-press: the app never delivers the
release of a press whose key went away. The dial already worked this
way.

d15 gates: panel suite 403 of 403 (the d14 panel files fail exactly the
two new checks); persistence 646 of 646 in 130 s; theme-band runner 70 of
70, run from the repo and again on the extracted archive; unit 1,498 of
1,498; native 169 of 169; lint and typecheck 0; copy validator 0
warnings. Archive `e0a16a923d2e4039...` (369,551 bytes, 47 members),
plugin.js `0d0b4ef4cdfa6d46...`, hwsm.node unchanged. Installed
2026-09-27 23:14 local from the archive's own bytes (47 files
hash-verified, 0 WARN or ERROR); settings across the install: only the
auto-cycling dial at Encoder 5,0 changed. The d14 soak (pid 54144) was
stopped; the 48-hour soak restarted on d15, CSV
`release/soak-1.7.0.0-d15-20260927-2315.csv`, closing 2026-09-29 23:15
local.

## d16 (2026-09-28): the external review's seventh pass

The seventh pass (on d15; report private) found three items, AX69 to
AX71, proposed one simplification, MS09, and three improvements, IX01 to
IX03. All were checked against the code first. The three findings are
fixed; MS09 is declined for 1.7.0 and IX03 deferred to after it (reasons
in the private answer); IX01 (the private Marketplace drafts) and IX02
are adopted in my own wording. Two independent reviews of the first d16
found no must-fix; they found a timer cancellation the new test missed,
an ordering and fallback details no test saw, and three unclear sentences
in the copy. All are fixed below. d16 changes panel files, tests and docs
only: `src/**`, `bin/plugin.js`, `hwsm.node` and the manifest are
byte-identical to d15.

| Finding | Sev | What was wrong | Fix | Proof |
| --- | --- | --- | --- | --- |
| AX71 | must | The caption under the dial Reading colors capture named panel build d12; the image had been retaken on d13, d14 and d15. | The caption names the build of the capture, now d16 (the new panel files required a retake). | A provenance test reads the build from the capture record and requires the page to name exactly that build, once (fails on d15's caption). |
| AX69 | should | After an older support-report request's clipboard write outlived its deadline and a newer request started, the older write's refusal ran the copy-command fallback: it moved focus and put the older report on the clipboard. | A refused write does nothing through the fallback once a newer request has started. The completion check is now the one predicate it was equivalent to. | 5 unit tests on the shipped script: the stale fallback with the newer request finished and still waiting (both fail on d15); the current request's fallback, its scratch field and focus; a failed copy command; a late refusal with no newer request, which still falls back. Twelve mutants, all killed. |
| AX70 | should | The support-report tests passed with the restore-timer cancellation removed. | Two lifetime tests: the newer outcome, and an outcome that follows a late copy, each keep their two seconds. The click's own cancel was redundant (the stray restore writes the label the click shows, and the outcome cancels it) and is removed. | Removing the outcome's cancel, alone or with the click's, fails a test. |
| IX02 | | The Getting started "First run?" paragraph repeated the whole Gadget setup inside a parenthesis. | Shortened to what the panel offers and why a free user picks Gadget (728 to 501 characters). | Copy validator. |

d16 gates: panel suite 403 of 403 and persistence 646 of 646 on the final
d16; theme-band runner 70 of 70, run from the repo and again on the
extracted archive, whose own bytes also passed the panel suite 403 of
403; unit 1,506 of 1,506; native 169 of 169; lint and typecheck 0; copy
validator 0 warnings. Archive `86b9f309936529bf...` (369,666 bytes, 47
members): against d15's archive only the six panel files differ;
plugin.js `0d0b4ef4cdfa6d46...`, hwsm.node and the manifest are
unchanged.

Installed 2026-09-28 01:43 local from the archive's own bytes (47 files
hash-verified, 0 WARN or ERROR after restart); settings across the
install: only the auto-cycling dial at Encoder 5,0 changed. The d15 soak
(pid 53772) was stopped after 2 h 28 min with no required event inside it
(one sample, at 08:18Z, counted a second plugin process: the docs
capture's own run of the bundle, about a minute long); the 48-hour soak
restarted on d16, CSV `release/soak-1.7.0.0-d16-20260928-0144.csv`,
closing 2026-09-30 01:44 local.

## d17 (2026-09-28): the external review's eighth pass

The eighth pass (on d16; report private) swept classes 1 to 10 dry twice.
It found five should-fixes, AX72 and AX74 to AX77, and one nit, AX73. It
also listed 69 small code changes that the tests it assigned did not
notice (class 11). All were checked against the code first.

- The five should-fixes are fixed.
- AX73 is deferred to after 1.7.0: no input reaches it, and its fix would
  change the bundle during the soak.
- The class 11 list was triaged against the full suites.

Two independent reviews of the first d17 found no must-fix. They found that
the first cut's note of key presses went stale after a lost keyup, so a
screen reader could no longer confirm; that a key well filled before the
panel connected showed `{}` for Replace to write; that the shared well's
fallback read could still roll the panel back; and, older (since d13),
that Replace on an untouched well wrote back the document it was filled
with. All are fixed below. d17 changes panel files, tests and docs only: `src/**`,
`bin/plugin.js`, `hwsm.node` and the manifest are byte-identical to d15.

| Finding | Sev | What was wrong | Fix | Proof |
| --- | --- | --- | --- | --- |
| AX72 | should | A mouse button held down on an armed removal (remove a group, Merge, Replace shared settings) while Enter or Space armed it confirmed on its old release. | A pointer press confirms only if it began on the button while it was armed, and focus leaving the button mid-press drops the press's arm. Keys need no note. | 18 panel checks, 6 per button: a mouse held while Enter or Space arms it does not confirm on its release, and a fresh click then confirms once; a press begun under an arm that focus then dropped does not confirm the next arm (all of these fail on d16); a screen reader's activation still confirms after a lost Enter keyup (fails on the first d17). |
| AX74 | should | A quad color preset option named after an inherited property (`__proto__`, `constructor`) threw. | Only the preset table's own names apply. | A panel check (fails on d16). |
| AX75, AX76 | should | A reading key holding a lone surrogate emptied the picker, and "Core 0" and "Core_200" shared an option id, so the row named to screen readers was not the highlighted one. | Each picker numbers its option ids as keys appear. | A panel check (fails on d16). |
| AX77 | should | Opening or copying a Config document read it from the app. The app's reply goes to every control, so a reply that arrived after an edit rolled the panel back, and the next edit saved the older document. | Both wells fill from the panel's own newest documents: the key's once the panel is connected, the shared one once its first answer arrives. An untouched well follows every change to its document (review of d17: since d13, Replace on an untouched well wrote back the document it was filled with). | 5 panel checks: no read at open; an untouched well shows an edit made elsewhere; a shared document on its way fills its well with no second read (these three fail on d16); a draft typed meanwhile stays; a well opened before the panel connects stays empty, then shows the document (fails without the wait). 2 unit tests replace the out-of-order read tests. |
| Class 11 | | Of 69 code changes the pass's assigned tests did not notice, 17 fail the panel or persistence suites, 34 changed behavior with no check to see it, and 18 change nothing observable. | A test or check for each of the 34 (17 unit tests, 1 panel check). | Each fails with its change and passes without it. The 18 (10 equivalent, 5 that only touch a debug log line, 3 redundant) are listed with reasons in the private answer, for the ninth pass to check. The 3 redundant pieces stay until after 1.7.0. |

Contracts changed on purpose (AX77). Two persistence checks and two unit
tests asserted that Copy reads its document from the app (and that the
newest of two out-of-order answers wins), and that read is what AX77
removes. They now assert that Copy asks the app for nothing and shows the
newest document the panel holds. The draft checks next to them are
unchanged. The unit harness in `test/pi-alias-contract.test.ts` now saves
every store write through the client, as sdpi does, so the shell sees it.

d17 gates: unit 1,523 of 1,523; panel suite 429 of 429, and the d16 panel
files fail exactly the new AX72 and AX74 to AX77 checks; persistence 646
of 646; theme-band runner 70 of 70, from the repo and again on the
extracted archive, whose own bytes also passed the panel suite (428 of
428, before the class 11 check was added); native 169 of 169; lint and
typecheck 0; copy validator 0 warnings. Archive `903e8f1f693f9409...`
(370,396 bytes, 47 members): against d16's only the six panel files
differ; plugin.js `0d0b4ef4cdfa6d46...`, hwsm.node and the manifest are
unchanged.

Installed 2026-09-28 17:19 local by copying the six changed panel files
into the installed plugin without stopping it (plugin pid 89580 before and
after; all 47 archive members hash-verified in the install); settings
across the install: only the auto-cycling dial at Encoder 5,0 changed. The
soak started on d16 (pid 77008, closing 2026-09-30 01:44 local) keeps
running on the same plugin process bytes, with the owner's HWiNFO restart
(21:51 to 21:55Z) already inside it. One sample, at 23:50Z, counted a
second plugin process: the docs capture's own run of the bundle.

## d18 (2026-09-30): the external review's ninth pass

The ninth pass (on d17; report private) swept classes 2 to 5 twice and
classes 1 and 6 to 10 once more, with no new blocker or must-fix, and ran
class 11 as a finite set: every condition and statement on the lines
changed since `fe115d0`, 345 entries, each against the full unit command
and, for panel changes, both browser suites. Twice. It found ten
should-fixes, AX78 to AX87: one in the panel (AX79) and nine tests that
cannot fail, which between them account for all 22 changes no check
noticed. Each was checked against the code first.

Two independent reviews of the first d18 found that its AX79 fix, as
proposed, let a mouse press held from before the arm confirm when a second
mouse button was pressed (a second button sends no `pointerup` for the
first; d17 refused this), and tightened five of the proposed tests. All
fixed below. d18 changes panel files, tests, one test script and the docs
capture only: `src/**`, `bin/plugin.js`, `hwsm.node` and the manifest are
byte-identical to d15, d16 and d17.

| Finding | Sev | What was wrong | Fix | Proof |
| --- | --- | --- | --- | --- |
| AX79 | should | The AX72 note was one for all pointers: a touch or pen pressed on the armed button while a mouse was held from before the arm replaced the mouse's start, so the mouse's release confirmed. Cancelling the touch did not help. | Each pointer keeps its own note from its press to its click, and a click reads only its own pointer's note (the click's `pointerId`; a keyboard click carries -1 and is never judged). | 18 panel checks, 6 per button: a mouse held from before the arm does not confirm after a touch began on the armed button, after a touch began and was cancelled, or after the right button was pressed too; the touch then confirms once, or a fresh click does. The touch checks fail on d17's panel files; the right-button checks fail on the first d18 cut. 8 unit tests run the block alone. |
| AX78, AX80 to AX87 | should | Tests that could not fail: a stored false automatic flag through two moves; picker ids on a tree delivered twice; an untouched shared Config well following later documents (the old tests read it after Copy, which refills it); the no-answer status; the pointer guards on events the suites never send; a coordinate-less detail slot; Gadget notices outside the native suite; the plugin's device boundary; pi-lab's failure monitor for a callback that throws outside its command. | A test for each, as proposed, tightened by the review of d18 (AX78 holds the whole new tile; AX84 uses `mock.method`; AX87's preload handles the exception itself; AX83 rewritten for the new notes, with a stand-in document that keeps every listener and a `closest` that is the button itself). The panel suite now fails on a page error anywhere in its run, not only in its first stage. | Each of the 22 changes fails its test on a scratch copy and each test passes without it. The 19 one-at-a-time changes to the rewritten pointer block are each noticed except the `pointercancel` listener, which only frees memory. |

Written list for the tenth pass (private answer): the ninth pass's list,
less m146, with m063's reason corrected, the band-height control recorded
as a measurement inside its allowance, and the `pointercancel` listener
added. Left for after 1.7.0 with AX73: exporting the device boundary from
`devices.ts` (the AX86 test reads it out of `plugin.ts` meanwhile), and the
double-click guard's single note, which a mouse and a touch pressed
together within half a second of a panel scroll can get past.

d18 gates: unit 1,543 of 1,543; panel suite 448 of 448, and the d17 panel
files fail exactly the six new touch checks, the first d18 cut exactly the
three new right-button checks; persistence 646 of 646; theme-band runner
70 of 70, from the repo and again on the extracted archive, whose own bytes
also passed the panel suite (448 of 448); native 169 of 169; lint and
typecheck 0; copy validator 0 warnings. The docs capture was retaken on
d18 (19:47:35 to 19:47:52Z, inside the new soak: a second plugin process
for those seconds). Archive `a4f2835d7acca2b7...` (370,559 bytes, 47
members): against d17's only the six panel files differ; plugin.js
`0d0b4ef4cdfa6d46...`, hwsm.node and the manifest are unchanged.

The d16 soak ended at 30.0 h (1,800 samples) when the PC was restarted from
the Start menu at 07:42 local on 2026-09-29. Inside it: the owner's HWiNFO
restart (21:51 to 21:55Z on 09-28) and an app restart (14:16 to 14:17Z on
09-29). Plugin RSS slope -0.29 MB/30 min on the longest same-PID run,
private bytes +0.02 MB/30 min, CPU 0.20%, 3 WARN and 0 ERROR lines (a
detail entry refused mid-switch, one busy mutex, the HWiNFO quit). A new
48 h soak started 2026-09-30 12:12 local on the same plugin bytes (monitor
pid 43776, CSV `release/soak-1.7.0.0-d17-20260930-1212.csv`, closes
2026-10-02 12:12). The PC bugchecked (0xD1) at 08:46 local on 09-30,
between the two soaks.

## d19 (2026-09-30): one outlined row in the reading picker

Owner report on d18 (screenshot, a cycling dial on the Stream Deck + XL):
the reading picker's open list showed five outlined rows where one reading
is chosen. Measured on d18's panel files before the fix: two outlines after
one open, move, close and reopen, and one more after every later pick.

| Finding | Sev | What was wrong | Fix | Proof |
| --- | --- | --- | --- | --- |
| OW01 | must | `setActive` cleared the outline only from the row under the previous key, while a close, a typed filter and a reopen reset that key without touching the row. Every close after the saved reading had moved (a pick, a dial turn, autocycle) left the old row outlined for as long as the panel stayed open. A dial turn with the list open also left the outline behind on the old reading while the fill moved. | The outlined row is tracked by element and cleared whatever key it was set under; a close goes through `setActive`. A settings echo that moves the saved reading carries the outline with it unless the person moved it with the keys or is typing a filter. | 4 panel checks on `dial-configured` (move then close then reopen, a dial turn's echo with the list open, no writes, a pick then reopen): exactly one outlined row and it is the saved one. d18's panel files fail 3 of them (the no-writes check passes on both). |

d19 changes `ui/pi-common.js` and the build token in the four panels,
the panel suite, and the docs capture only: `src/**`, `bin/plugin.js`
(`0d0b4ef4...`), `hwsm.node` and the manifest are byte-identical to d15 to
d18.

d19 gates: unit 1,543 of 1,543; panel suite 452 of 452, from the repo and
again on the extracted archive; persistence 646 of 646; lint and typecheck
0; copy validator 0 warnings. Archive `e53ae5f91a9675ec...` (370,720 bytes,
47 members): against d18's only the five panel files differ. Installed
2026-09-30 20:45 local by the panel hot copy (plugin pid 24328 before and
after, all 47 members hash-verified). The docs capture was retaken on d19
(03:45:59 to 03:46:14Z on 10-01; no soak was running).

The d17 soak (pid 43776) ended at about 7.4 h: the owner shut the PC down
with shutdown.exe at 19:37 local on 09-30 (event 1074, a clean shutdown,
not a bugcheck); the monitor did not survive the restart (boot 20:04). The
plugin now runs as pid 24328 (started 20:05). A new 48 h soak is owed.

Committed 2026-09-30 on the owner's word, with d18 (never committed
before): `e7f4ee2` (d18's panel files, staged from the d18 archive, so
the commit holds the bytes the deck ran), `c3e47b8` (d18's tests),
`a672a3a` (d19 and its checks), `535d312` (the capture) and this record.
`claude/f01-on-1.7` (PR #39) takes the branch by fast-forward; no bump,
tag or release.

## d20 (2026-10-01): the last product change; review closed

On 2026-09-30 the owner asked whether the candidate was locked in and how
much of the added testing earns its keep. Six independent reviewers
looked: unit-test value, browser-check value, whether a tenth external
pass is worth it, a skeptic of the d17 to d19 product changes, and one
refuter for each test audit. Their files are in the private release docs
(`docs/release/external-review-1.7/test-audit-2026-09-30/`).

- **Review closed (owner's call: "no more hunting").** Must-fix findings
  per external pass ran 3, 2, 5, 6, 2, 5, 1, 0, 0; the last two passes
  found tests to add, not product defects. There is no tenth pass, and
  the class 11 gate (every changed line broken one at a time until two
  runs come back dry) is retired: each fix adds lines, so it cannot
  converge. From here a product change gets the unit, panel and
  persistence suites and two independent reviews of its diff.
- **The gap that mattered** was not more review but running what exists:
  the built-plugin protocol harness (`npm run e2e`) had failed since d14,
  when AX50 put quotes around outside text in log lines and its two
  device checks still expected the bare name. The plugin was right; the
  checks are fixed. All nine runtime e2e suites pass on the shipping
  bundle under the app's own Node 20.20.0 (harness 105 checks, drill-down,
  socket close, resilience, Gadget, native edge, dead fallback, reading
  links 96 checks, load), run 05:38 to 05:47Z on 10-01 inside the d19
  soak; the soak recorded no event in those minutes.
- **Test value:** cost is upkeep and review time, not run time (unit
  1,543 tests in 27 s; panel suite 209 s, three quarters of it added in
  this cycle; persistence 132 s). After refutation, about 22 panel checks
  (16 s) are safe to cut, three fixed-sleep sections can wait on
  conditions instead (about 18 s), and some unit groups can merge; the
  pruning waits for after 1.7.0. The two audits each cut checks because
  the other suite held them; applied together they would have left the
  second-mouse-button case (a real d18 regression) and others with no
  check. Only the unit suite runs in CI, so where a behavior is held
  twice, the unit test is the one to keep.

| Finding | Sev | What was wrong | Fix | Proof |
| --- | --- | --- | --- | --- |
| OW02 (skeptic review of d17 to d19) | should | Since d17 an untouched Config well refilled on every change to its document, even while it had focus. An auto-cycling dial writes its settings every few seconds, so a caret placed in "This dial's settings" jumped to the end before the person typed. | An untouched well holds still while it has focus and catches up when focus moves elsewhere in the panel; Copy and Replace both refresh an untouched well first, so neither uses an older document. Replace reads its press's `detail` and time before that refresh, so the double-press guards see the press itself. | 1 panel check (caret at 10 stays at 10 through a plugin write; d19's panel files fail it with the caret at 833, the end) and 1 unit test (holds while focused, catches up on blur, Replace writes the current document; fails on d19). |

The two reviews of the d20 diff found no product defect. They found that
five persistence legs and one panel check set a well's text from script
without the `input` event every real edit fires, so the refill on
Replace (and, before d20, the fold's own refill) had been replacing the
document the check meant to test; one of those checks set a JSON string
rather than an object and so had never tested its own document. All now
fire `input` and test what they say. One gap is accepted and written in
the code: a well focused when the whole window loses focus catches up
only when focus moves inside the panel again (display only).

d20 changes `ui/pi-common.js` and the build token in the four panels,
tests, three test scripts and the docs capture only: `src/**`,
`bin/plugin.js` (`0d0b4ef4...`), `hwsm.node` and the manifest are
byte-identical to d15 to d19.

d20 gates: unit 1,544 of 1,544; panel suite 453 of 453 (d19's panel files
fail exactly the new caret check); persistence 646 of 646; the nine
runtime e2e suites as above; lint and typecheck 0; copy validator 0
warnings. Archive `c5aed2e5775a568d...` (370,927 bytes, 47 members):
against d19's only the five panel files differ, and its panel files are
byte-identical to those the suites ran. Installed 2026-10-01 00:00 local
by the panel hot copy (plugin pid 24328 before and after; all 47 members
hash-verified; 0 settings changes). The docs capture was retaken on d20
(07:00:36 to 07:00:52Z, inside the d19 soak).

## d21 (2026-10-02): the release-candidate review

The owner asked for an end-to-end, evidence-driven review of the 1.7
candidate with the fixes made, the docs and screenshots brought in line,
and an independent challenge of the result. 46 agents reviewed it by
area and each finding was reproduced or refuted by another; 19 more then
challenged the fixes. Records: `review.json` and `skeptic.json` in the
private `docs/release/external-review-1.7/rc-review-2026-10-02/`. Nothing
here is committed.

| Finding | Sev | What was wrong | Fix | Proof |
| --- | --- | --- | --- | --- |
| RND-02, RND-01 | must | The app draws faces with QtSvg 6.9.3, which takes `font-family="Segoe UI, Arial, sans-serif"` as one family name, finds none and falls back to Tahoma, about 10 % wider than the Segoe UI Semibold every width budget is measured on. On the device three-row labels ran into their values. | One family name, `Segoe UI`, in the renderer and in the three manifest icon SVGs (SK-CODE-1 found the icons in the skeptic round). | Rendered through read-only copies of the app's own Qt DLLs: the old faces and icons are byte-identical to a forced-Tahoma copy, the new ones are not. The golden tests authorize exactly this swap before hashing. |
| RND-04 | should | A Dual key centers value and unit as one chunk, so a long custom unit ("requests/sec") pushed the value's first digits off the key: a different number. | The unit is shortened, or left off, so the chunk fits the 120 px band. | 2 unit tests (the first fails on 9da6f1c) and a band-width assertion (SK-CODE-2). |
| RND-03 | must | 1.7's dial alert row colors sat next to Ember's value color and the type accents. | Warn back to 1.6.0's #E8940D, crit #FF3B30, both through the 4.5:1 readable-color floor. | CIE76 distance test (fails 6 on the old hues). Crit reads 4.80 to 5.92:1 on the dark themes against 1.6.0's 3.05 to 3.77:1; on Paper both are darkened to 4.5:1. |
| SEC-01 | should | The Control action never answered its panel's remembered-folds request, so its sections stayed hidden about 600 ms on every open and its folds were not kept. | Route getPanelFolds and setPanelFolds to the shared handler. | 1 unit test (fails on 9da6f1c). |
| DOC-01, 02, 03, 06 | must/should | main's PR #40 README could not merge as it was (1.6 strings, a stale status board); main said Gadget MIN/MAX/AVG show the current value (false in 1.7); status-screens.png showed 1.6 faces; the FAQ still called 1.7 unqualified. | README rebuilt from main's with the 1.7 facts; data-sources, faq and installation corrected; status-screens.png and the themes contact sheet regenerated by their scripts (renderer output, sample values). | Copy validator 0 warnings; docs image provenance test passes. |
| COMPAT-1 (docs), PERF-1 (copy) | should | The upgrade note did not say what to do when two ticked Gadget readings share a name; the CHANGELOG did not say the scan now rereads each row. | One rule everywhere: untick or relabel the reading your key should not show (DOC-F4, CC-06); the reread counted (1,024 plus 7 per reading, against 1,024 plus 3). | Text checked against `gadget-registry.ts` and the panel code. |
| PI-01 | should | The dial setting **Title after a turn: Clears** named only turns, but auto cycle, a Control key and a press or touch set to step clear a typed title too (`adoptReading`); a pick in the panel keeps it. | Renamed **Title when the dial moves on** (1.6.0 said "Clears when rotation moves on"); docs list every path and the panel-pick exception. | Panel and persistence suites on d21; capture `pi-dial-rotation.png` shows the label on one line. |
| PI-03 | should | The Gestures select's `aria-describedby` pointed at a list carrying its own `aria-label`, so a screen reader heard "What the dial does now" instead of the gesture map. | The label is gone from the list. | New `test/pi-markup.test.ts` (every describedby target exists once and has no name of its own) fails on 9da6f1c's dial panel only. |
| DOC-04 | should | The published pre-releases 1.6.92.0 and 1.5.90.0 had no CHANGELOG entry, against "One entry per version". | Both inserted verbatim from their tags. | Byte-identical to `pre-1.7-issue31-3` and `pre-1.6-issue5-5` (delta review). |
| Skeptic round | should | NOTICE and AGENTS lagged main (DOC-F1); the alert bullet compared with the wrong baseline (DOC-F2); the README build skipped `build:native`, which `npm run build` needs (DOC-F3); several labels and claims were loose (DOC-F5 to F9, F12). | Fixed as written in CONTINUATION. | Copy validator 0 warnings; `npm run build` exits without the addon (read in `copy-hwsm.mjs`). |

Refuted in the skeptic round: CC-02, CC-05, CC-09. Deferred, with the
scope judge's reasons in review.json: RND-05, PERF-1 code, the COMPAT-1
runtime part, the status headline fit, SEC-02, DOC-07, DEV-01 to DEV-09.

The freeze rule's two independent reviews of the final delta found no
product defect. They found the first new label still overclaimed (a
panel pick keeps the title: fixed by the second name), these records
predating the panel change, owner-check step 9 asking for things the
product does not do (four readings on a Triple key, a unit setting), the
shot 4 flag's notes overclaiming, and leftover 1.6 labels in the
CHANGELOG, whats-new and marketing notes. All fixed.

d21 changes `src/ui/key-renderer.ts`, `src/actions/hwinfo-control.ts`,
`themes.json`, the manifest description, three icon SVGs, NOTICE, the
four panels' token and two attributes of the dial panel, tests, one
script flag, images and docs. native/ is byte-identical to d20. plugin.js
`7c802b38...`, hwsm.node `95ae41e5...`.

d21 gates: lint and typecheck 0; unit 1,559 of 1,559; native 169 of
169; copy validator 0 warnings; panel suite 453 of 453 and persistence 646 of
646 on the final d21 panels; the nine runtime e2e suites
on plugin.js 7c802b38 under the app's Node 20.20.0 (08:31 to 08:45Z), the
harness again after the icon change (105 of 105); clean-clone
qualification on a snapshot clone, all 15 stages PASS, record
`9176c36-20261002T171200Z`, archive `3e92b18f7faad68b...` (370,885
bytes, 47 members). Not
installed: the deck runs d20 until the soak closes, and the faces above
have been drawn by the renderer and the app's QtSvg only, never on a deck
(OWNER-CHECK step 9).

## d22 (2026-10-02): the Text font

After the d21 install the owner saw thinner text and set the rule: Tahoma
stays the default unless Segoe UI is objectively bigger, more readable and
causes no issues. Every release through 1.6.0 and every candidate to d20
drew Tahoma Bold on the device (QtSvg reads the old family list as one
unknown name); every docs and marketing render showed Segoe UI. Measured in
the app's own Qt 6.9.3, Segoe UI is 24 to 38 % lighter in stroke and 4 to
9 % shorter at equal size; 6 % larger restores only number height, and bold
costs 70 more cut labels. Five design reviewers and a synthesis (private
`face-font-design.json`) then two reviewers of the built diff
(`face-font-d22-review.json`).

| Finding | Sev | What was wrong | Fix | Proof |
| --- | --- | --- | --- | --- |
| FONT-1 (owner) | must | d21 made every upgraded deck draw lighter, narrower Segoe UI. | Tahoma Bold default, named outright, fitted on a per-glyph Tahoma Bold table measured through QtSvg; Segoe UI as Advanced > Shared defaults > Text font (`textFont`, absent = Tahoma, nothing written on upgrade). | QtSvg census of 596 faces: 0 overlaps, 0 touches, 1 edge clip (1.6.0: 30, 14, 58); the Segoe UI option equals d21 plus the digit fix. |
| FONT-2 | should | Segoe UI Bold draws every digit 6.9 px wide; the estimate priced "1" at 5.0, so "111.1" ran a three-row label 6 px in. | A bold digit floor in the Segoe UI profile. | Unit test (1111 and 8888 price alike); 30 Segoe faces change, census unchanged. |
| D22-R1 | should | On Tahoma, two-reading keys cut units to "Mi…", "M…", "R…". | The value gives up to two 2 px steps before the unit shortens. | Test fails with the fix removed. |
| D22-R2 | should | On Tahoma, three-row dial labels 1.6.0 drew whole were cut (COMMITTED). | The value column books the measured bold width; the label prices its letter-spacing. | Test fails with the fix removed. |
| D22-R3 | polish | A two-row second label line could sit under its value mask. | Measured value widths; the second line sized to the real room, else one cut line. | Test. |
| D22-R4 | must | Marketplace shot 8 drew an empty page: its filter named the old RTX 4090. | Filter *5080*; the script refuses an empty page. | Shot 8 shows 1-11 / 82. |
| D22-R5 | should | Captions named the hot spot, "cycle paused" whole, live 4090 counts, and the Themes section sat in the wrong place. | Captions, the capture script and the bench table corrected; section moved. | Copy validator 0 warnings. |

d22 changes the renderers (`src/ui/face-font.ts` new; key, dial, detail
renderers and format.ts read the profile), theme-store and the global
settings type, both panels (Text font select, summary, token d22), the
three action icons, tests (Segoe-calibrated suites pinned, 15 new Tahoma
tests), two scripts (the bench GPU changed to an RTX 5080), every face
image, and docs. native/ is unchanged. plugin.js `5eabbe07...`.
