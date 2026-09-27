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
