# Continuation

## Now (2026-10-02): d21, the release-candidate review

- **What ran.** An evidence-driven review of the whole candidate (46
  agents: functional and compatibility, lifecycle, faces, performance,
  security, release integrity, docs), every finding reproduced or
  refuted, then a skeptic round on the fixes (19 agents), then the freeze
  rule's two independent reviews of the final delta (copy truth; code,
  bytes and records), whose findings are fixed below. Records are
  private: `docs/release/external-review-1.7/rc-review-2026-10-02/`.
  REGISTER, d21 has the table.
- **Fixed over 9da6f1c:** faces and the three manifest icons draw in
  Segoe UI on the device (the app's QtSvg read the font list as one
  unknown name and drew Tahoma); a Dual key shortens a long unit instead
  of cutting the value; dial alert row colors (warn back to 1.6.0's
  amber, crit #FF3B30); the Control panel's remembered folds are
  answered; the dial setting **Title after a turn** is **Title when the
  dial moves on** (PI-01: auto cycle, a Control key and a press set to
  step clear the title too); the Gestures select's description reads the
  gesture map (PI-03); panel build token d21; manifest description
  wording; README merged from main's PR #40 with the 1.7 facts; NOTICE
  and AGENTS take main's wording; docs truth fixes; CHANGELOG gains the
  published pre-releases 1.6.92.0 and 1.5.90.0 verbatim from their tags
  (DOC-04).
- **Images, all real output:** status-screens.png and the themes contact
  sheet by their scripts; pi-dial-rotation.png and pi-dial-picker.png by
  `scripts/capture-pi.mjs` (filter `*GPU*`, the bench no longer has an
  RTX 4090); pi-dial-reading-colors-1.7.png by its own script, provenance
  pinned to panel build d21 and plugin.js 7c802b38; Marketplace shot 4
  (`marketing/shot-4-settings.png`) rebuilt from the 1.7 captures with
  the new `--only-settings` flag.
- **Untracked, add at commit:** `.github/readme/`,
  `scripts/readme-boards.mjs`, `test/pi-markup.test.ts`.
- **Bytes.** plugin.js `7c802b38...` (d20: `0d0b4ef4...`), hwsm.node
  `95ae41e5...` unchanged. Clean-clone qualification on a snapshot clone
  (temporary commit 9176c36, only in `%TEMP%\hw-qualify-final3`): all 15
  stages PASS, archive 370,885 bytes, 47 members, sha256
  `3e92b18f7faad68b800361c56638cdda40c4359a6f8bc203eab38ea51854bb03`.
  Against the installed d20: bin/plugin.js, manifest.json, themes.json,
  NOTICE.md, the three icon SVGs and the five ui/ files differ.
- **Gates on the final tree:** lint and typecheck 0; unit 1,559 of
  1,559; native 169 of 169; copy validator 0 warnings; panel suite 453 of 453 and persistence
  646 of 646 on the final d21 panels (17:06 to 17:12Z); the
  nine runtime e2e suites on bundle 7c802b38 under the app's Node 20.20.0
  (08:31 to 08:45Z), and the harness again (105 of 105) after the icon
  change. ui/ changed after those runtime suites (label, description,
  token); the panel and persistence suites cover it.
- **Not installed.** The deck runs d20 until the soak closes.
- **Soak:** app restart 05:00Z and HWiNFO restart 08:54:48Z on 10-02 are
  in the CSV (the plugin held, warned once at 11 s and reopened at
  08:55:08Z). Sleep/wake: 19:39:10 to 19:39:18Z by the system log (8 s,
  so the 60 s CSV shows no gap); both decks reconnected at 19:39:45Z and
  19:39:48Z, the source reopened at 19:39:47Z, no warning, plugin pid
  49804 unchanged, and the owner saw the deck come back. Every soak event
  is in; the window closes 22:27 local. Exclusions
  to add (local runs inside the soak, 10-02): 08:31 to 08:47Z, 09:00 to
  09:20Z, 16:41 to 16:53Z and 17:03 to 17:14Z.
- **Owed before the tag (owner):** the soak summary after 22:27;
  a decision that the d19 soak covers the shipping bytes (the soak ran
  plugin.js `0d0b4ef4`; the delta is faces, theme colors, Control panel
  routing, two panel labels, icons and text, with native and poller
  unchanged, so the runbook's soak trigger is not met by the delta, but
  it is your call); OWNER-CHECK steps 1 to 7 and step 9 on the final
  archive; the upgrade install over 1.6.0; CI green on the pushed
  commit; the CHANGELOG date; merging PR #39 and PR #33; the tag; then
  runbook section 4 to the letter: download the CI draft pack and compare
  its bin/plugin.js, ui/, profiles/ and manifest bytes with this
  archive's, and read the native-drift annotation (the release workflow
  path changed since v1.6.0 and has never run); VirusTotal on the CI
  pack; the hardware.md 1.7 row and the PERF entry after the soak.
- **Deferred, with reasons in review.json:** RND-05 (auto decimals),
  PERF-1 code (scan timer), the COMPAT-1 runtime part, the status
  headline fit (not a regression), SEC-02 (dev dependency, after the
  tag), DOC-07 (equal-version reinstall, needs the app), DEV-01 to
  DEV-09, and a panel pick clearing the title (today it keeps it, as the
  docs now say).

## Now (2026-10-01): d20, review closed, ship-ready on the software side

- **Review closed (owner's call, 2026-09-30: "no more hunting").** Nine
  external passes (must-fix per pass 3, 2, 5, 6, 2, 5, 1, 0, 0); no tenth
  pass, and the class 11 gate is retired. Code freeze: a later product
  change gets the unit, panel and persistence suites plus two independent
  reviews of its diff, nothing more. REGISTER, d20 has the reasons and
  the test-value audit; its files are private
  (`docs/release/external-review-1.7/test-audit-2026-09-30/`). Pruning
  the tests waits for after 1.7.0. Rule for new tests: add one only when
  it fails for input the real app, HWiNFO or a person's own edits can
  produce and the failure would show or reach their settings; one browser
  check per code path; no fixed sleeps; where a behavior is held twice,
  keep the unit test (only it runs in CI).
- **d20 over d19:** the last product change: an untouched Config well
  holds still while it has focus (an auto-cycling dial's writes threw the
  caret to the end), and Replace refreshes an untouched well first, as
  Copy does. The built-plugin harness's two device checks (stale since
  d14) are fixed; all nine runtime e2e suites pass on the shipping bundle
  under the app's Node 20.20.0.
- **Installed:** panel build `1.7.0.0-d20`, archive sha256
  `c5aed2e5775a568d141b5e3bfe71bd6a6d3d07709370b88a72c579de4e3a9f7c`
  (370,927 bytes, 47 members), plugin.js `0d0b4ef4...` (unchanged since
  d15), by the panel hot copy at 2026-10-01 00:00 local (plugin pid 24328
  untouched, 0 settings changes). Rollback: the same hot copy from the d19
  extract in `%TEMP%\hw-d19-archive`.
- **Soak:** monitor pid 44260, CSV
  `release/soak-1.7.0.0-d19-20260930-2227.csv`, closes 2026-10-02 22:27
  local, on the plugin bytes every build since d15 shares. Owed inside
  it: a HWiNFO restart, an app restart and a sleep/wake. Then
  `node scripts/soak-monitor.mjs --summary <csv>` into PERF.md (exclude
  05:38 to 05:47Z and 07:00:36 to 07:00:52Z on 10-01: local e2e runs and
  the docs capture).
- **Owed before the tag (owner):** the soak events above; OWNER-CHECK
  steps 1 to 7; the release pack installed through the app's installer
  over a restored 1.6.0 install, settings snapshot unchanged; CI green on
  PR #39; the CHANGELOG publication date; the tag.
- **d19 over d18:** the owner's report OW01 (REGISTER, d19): the reading
  picker left one outlined row behind per close after the saved reading
  moved; one outline now, and a dial turn carries it.
- **d18 over d17:** the ninth review pass: AX79 (each pointer keeps its own
  press note, read only by its own click, so a touch, a pen or a second
  mouse button cannot lend a held mouse the armed start); tests for AX78
  and AX80 to AX87, one per change no check noticed; the panel suite fails
  on any page error in its run. Panel files, tests, one test script and
  the docs capture only.
- **d17 over d16:** the eighth review pass: AX72 (a press confirms an armed
  removal only if it began on the button while armed), AX74 (inherited
  quad preset names ignored), AX75 and AX76 (picker option ids numbered,
  not encoded), AX77 (the Config wells fill from the panel's own newest
  documents and follow every change, so no late read rolls the panel back
  and Replace never writes back an older document); tests for the 34
  class 11 gaps. Panel files, tests and docs only.
- **d16 over d15:** the seventh review pass: AX69 (an older support-report
  request's refused clipboard write no longer copies its report over a
  newer one), AX70 (a test that sees the restore timer's cancellation),
  AX71 (the dial capture's caption names its build, and a test holds it
  to the capture record); the Getting started "First run?" paragraph
  shortened. Panel files, tests and docs only; the plugin process runs the
  same bytes as d15.
- **d15 over d14:** the sixth review pass: AX57, AX67 and AX68 (a repeated
  down keeps a held press, consumed or not, on the Control key, the key
  and the dial; a Control key that left mid-press takes its next down as a
  new press), AX58 (a tile's cell field this build cannot read stays as
  stored through edits that do not write it), AX59 and AX60 (malformed
  command, shared theme and themes messages), AX61 (global settings: the
  latest document wins over an older reply), AX62 (a detail hold decided
  by the time held), AX63 (support report answers bound to their
  request), AX64 (an overflowing session sum keeps AVG), AX65 (pi-lab
  failures exit 1), AX66 (device lookups by own whole numbers); MS07 (no
  per-tick name map) and MS08 (a dead helper). Three independent reviews
  of the first d15 found an AX58 variant, a late copy left on "Copy
  failed", a dial that kept a replayed press whose release was lost, a lab
  hang and seven fixes no test could see; all fixed before install.
- **d14 over d13:** the fifth review pass: AX46 (a held Control key is
  consumed by changed settings, a replayed appear or a disappearance),
  AX47 (detail tiles track the entries of cells no reading fills, and each
  stored list's end, through every structural edit; a reading that lands
  in such a cell takes it over), AX48 and AX49 (panel deadlines and the
  detail navigator on monotonic time), AX50 (outside text quoted in log
  lines), AX51 (malformed themes messages ignored), AX52 (simulator
  bootstrap escaping), AX53 (NOTICE read as its sections), AX54 (ZIP64
  expanded sizes), AX55 (no setup-time claim in the image generator; the
  validator checks it), AX56 (one release listener per detail press); MS05
  (no per-dial row set) and MS06 (panel suite waits for readiness, 293 s to
  171 s). Three independent reviews of the first d14 found a duplicate in
  the AX47 fix as proposed, a broken native test, holes in the new
  license and copy checks and the simulator, and a soak counter reading
  the wrong column; all fixed before install.
- **d13 over d12:** the fourth review pass: AX27 (a held key press is
  consumed by changed settings or a replayed appear), AX28 (a deferred
  threshold keeps its reading's unit), AX29 and AX33 (dormant tile cells
  and short stored lists survive edits), AX30 (arms name the whole group or
  document), AX31 (malformed auto cycle is off), AX32 (full license texts
  in NOTICE), AX34 to AX37 (queued seed, `__proto__` keys, exact-key Make
  shared, stored key spellings), AX38 to AX42 (parser, packer and harness
  hardening), AX43 (monotonic dial timers), AX44 and AX45 (overflow and
  comments); MS01 to MS04 (one preset copy, one dial sample per tick,
  condition waits in the persistence suite, released navigation
  listeners). Two independent reviews of the first d13 found an AX29
  duplicate-entry regression and gaps, fixed before install.
- **d12 over d11:** the third review pass: AX17 to AX19 (structural detail
  edits keep entries this build cannot read), AX20 (one press, one removal
  panel-wide), AX21 (Make shared press record survives Tab), AX22 and
  AX23 (own-key lookups, Back to current value), AX24 (quiet density
  deliveries), AX25 (docs), AX26 (a held dial press cannot acquire a new
  command). The 70-check runner now runs from the repo alone.
- **d11 over d10:** the second review pass: AX12 (a cell edit keeps the
  tile's other entries), AX13 (a slow double click never confirms), AX14
  (a theme arriving mid-press makes Make shared stale), AX15 (unknown
  stored themes said as the line shows them), AX16 (a citation).
- **d10 over d09:** Delete advertised in the rotation list (the owner
  checked it on the real app), one removal per press (a held Delete or a
  held Enter on Remove emptied the list), and the empty-set note says what
  an overview shows.
- **d09 over d08:** AX02 (a late Make shared keeps a newer pick), AX03
  (focus counts as acting for late fold answers), AX04 (only the second
  click of a double click is swallowed), AX07 (a known stored shared theme
  is read first; globals redraw), AX05 test holes, AX06 runner exit code,
  AX08 to AX11 copy, the runbook's release:validate stages.
- **Gates:** `round3/REGISTER.md`, the d09 gates and the d10 to d20 sections.
- **Next:** the owner's steps in the Now section above (step 8 of the
  hands-on check, the list keys, passed on d11),
  the soak summary into PERF.md, `npm run release:validate` from a clean
  clone on the final commit, the 70-check runner on the final archive,
  then the owner's merge, tag and publish.
- **Open, unexplained, and probably closed:** across the d05 install three
  dials moved from the second to the first member of their two-reading
  rotations; the d12 and d13 "moves" of the Encoder 5,0 dial turned out to
  be its auto cycle, which the d12 record missed. Whether the d05 dials had
  auto cycle on was not rechecked. The fourth review pass found no plugin
  path that writes a reading on start (48 restart and clock cases).
- **Rollback:** `deploy.ps1 -From %USERPROFILE%\hwinfo-bench-backup\2026-09-26-0857-f01q\com.lawrensen.hwinfo.sdPlugin`
  (the pushed d08 bytes can also be rebuilt from `f98c76f`).

## Round 3 (2026-09-26): execution state

Objective: the owner's round-3 assignment (canonical fold icons, five
independent xhigh reviews, evidence-backed fixes, final candidate installed
in the real Stream Deck app). Brief: `round3/BRIEF.md`.

Phase log (newest last):

1. **A, done.** Fold-all center stroke removed; the Open all / Fold all
   pair is now Lucide `chevrons-up-down` / `chevrons-down-up`, path data
   verbatim from lucide-icons/lucide `icons/*.svg` (viewBox 24, stroke 2,
   round caps and joins, drawn at 18 px so the stroke lands at 1.5 px; 16 px
   under 200 px wide) in `sensor-reading.html`, `sensor-dial.html`,
   `control.html`. Parity measured on all three panels: identical ink box
   (7, 4, 10 x 16), centered to 0 px in 28 px buttons, labels unchanged.
   Lucide (ISC) and Feather (MIT, for the existing `link` mark) credited
   with license texts in `NOTICE.md`, which ships in the plugin. Token
   `1.7.0.0-d03`.
2. **A, early candidate installed.** Built, packed and validated
   (`npm run pack`: 47 members match the shipping contract). Archive
   sha256 `3413eee985983584f3f234023395f1e3887a31936bbd98e1ef5fec4ebea30973`,
   `bin/plugin.js` `36626410eee4a0dc...`, `bin/hwsm.node` `95ae41e5...`
   (unchanged). Installed with the bench route
   (`review/pi-essentials/bench/2026-09-23/tools/deploy.ps1 -From <extracted
   archive>`): plugin stopped through the Elgato CLI, 47 files copied and
   hash-verified, restarted (pid 63720 to 18376), log clean (0 WARN/ERROR,
   Shared Memory open, Stream Deck 5x3 and Stream Deck + XL connected).
   Settings snapshot before install: 144 pages, 881 HWiNFO actions, global
   hash `b4abc011b93a` (`%SCRATCH%\bench\snaps\before-d03.json`, outside the
   repo because it holds personal settings).
   **Rollback:** `deploy.ps1 -From %USERPROFILE%\hwinfo-bench-backup\2026-09-26-0857-f01q\com.lawrensen.hwinfo.sdPlugin`
   (the f01q = 4bf09c0 bytes that were installed before; 47 files,
   hash-verified copy).
3. **Real-panel access.** The app's DevTools port 23654 is live (developer
   mode). The owner declined computer-use control of the Stream Deck app
   on 2026-09-26, so key selection in the app is the owner's; real-panel
   checks are read-only observation of a panel the owner opens.
4. **B, running.** Baseline for review frozen at tree fingerprint
   `bc836455dfb26ec9` (sha256 over every tracked and untracked file outside
   review/pi-density), copy at `%SCRATCH%\r3-baseline\`. Baseline density
   reproduced on it (`round3/density-r3-baseline.json`, 378x410): default
   key 748 px, header 89 (key) / 105 (dial) px, theme band at y 116 / 132,
   key all-open 2,256 px, 0 overflow, 0 writes. Five reviewers running as
   one workflow (`pi-ux-round3-review`, five parallel agents, session model
   Opus 5.5 inherited, `effort: 'xhigh'` per agent). A custom agent type
   with `effort: xhigh` frontmatter was written to
   `.claude/agents/pi-ux-reviewer.md` but is not loadable until a session
   restart (new agents folder), so it was not used.

`%SCRATCH%` = `C:\Users\stephen\AppData\Local\Temp\claude\C--Users-stephen-git-hwinfo-streamdeck\91b47c1b-9d80-49d5-bfea-6c93b12f0164\scratchpad`.

5. **B, done.** Five first-pass reviews (71 findings) in
   `round3/agents/r1/`, consolidated to R01..R54 in `round3/REGISTER.md`.
6. **C, done.** Cross-review (`pi-ux-round3-crossreview`, five agents,
   xhigh) in `round3/agents/x1/`; R38 prototypes P0 to P3 compared,
   consensus "P1b".
7. **D, implementation, done to token `1.7.0.0-d04`.** Every Landed,
   DEFERRED, KEEP and OWNER outcome with its proof is in the register's
   "Status after cross-review and implementation" table. Gates on this
   tree: lint 0, typecheck 0, unit 1349 of 1350 (the one failure is the
   docs-image provenance guard, by design until the reading-colors capture
   is regenerated after the last panel change), `e2e:pi-panels` all green
   (about 257 checks), `e2e:pi` 646 of 646, copy validator OK. Band matrix
   (`%SCRATCH%\band-matrix.mjs`): 48 combinations and 384 picks OK. Zoom matrix
   (`%SCRATCH%\zoom-check.mjs`): overflow 0 at 373/320/189/160.
8. **E, running.** Integrated-candidate re-review (`pi-ux-round3-integrated-review`,
   five agents, xhigh) on the frozen copy `%SCRATCH%\r3-cand-d04\`
   (ui fingerprint `28b53648bcb6ff1e`, diffs beside it). Results go to
   `round3/agents/y1/`.

Next: fix confirmed re-review findings, final non-mutating audit,
regenerate the reading-colors capture and docs images, bump the token,
build, pack, snapshot settings, install with deploy.ps1, verify, final
report.

## Exact state (2026-09-25, end of the first pass)

- Worktree `C:\Users\stephen\git\hwinfo-pi-density`, branch
  `claude/pi-density`, created from `claude/f01-on-1.7` at `4bf09c0`
  (PR #39, the combined 1.7.0 candidate). **Nothing is committed or
  pushed**; every change is in the working tree. The branch exists only
  locally. `git diff --stat 4bf09c0` plus `git status --short` list the
  files (REPORT.md "Files").
- No other worktree, branch, PR, profile, installed plugin or global
  setting was touched. The Stream Deck app, HWiNFO and the installed
  plugin were not started, stopped or restarted. `npm run suite:full` was
  not run (its process sweep can stop a real plugin, bench H3). The docs
  captures ran against a fresh `scripts/pi-harness.mjs` (its own plugin
  process, reading live HWiNFO), closed through its stdin "exit".
- The private release docs (`docs/release/`, `MARKETPLACE.md`) were
  copied into this worktree for the copy validator; both are gitignored
  here as in the primary checkout. Do not `git add -f` them.
- Panel build token: `1.7.0.0-d02` (all four panels and `PI_BUILD`).
- `bin/plugin.js` was rebuilt from this tree (the preview gained
  `holding` and `staleForMs`); the vendored `hwsm.node` is unchanged.

## Gates at the end of this pass

lint 0, typecheck 0, unit 1348 of 1348, `e2e:pi-panels` 217 of 217,
`e2e:pi` 646 of 646, copy validator OK (60 files, 0 warnings), axe 0 and
own traversal 0 at 378/320 x 410 and 380/320 x 800 (62 runs each),
density matrix at seven sizes (0 overflow, 0 writes). Commands and
numbers: REPORT.md "Validation".

## Open items, in the order I would take them

1. **Integration.** This work sits on `4bf09c0`. If `claude/f01-on-1.7`
   has moved, rebase or merge it onto the new head; the panel files,
   `src/pi-protocol.ts` and `src/poller.ts` are the likely conflict
   points. Re-run the gates above and `npm run build` before any e2e.
2. **Real app and device checks** (owner-held, below).
3. **All-open targets.** The key's all-open height is -12.7% and the
   details fixture's -10.1% against the kit's 15%. The key met it (-15.2%)
   until the named theme chips and the 28 px scale (owner's call,
   2026-09-26); the details rest has to come from the detail-list editor
   inside Press, which this pass left alone. Decide whether the target
   still matters against the named chips.
4. **sensor-details page.** Its three panel images
   (`detail-press-panel.png`, `detail-filter-panel.png`,
   `detail-custom-tiles-panel.png`) still show the 1.6 Press labels ("Add
   sensor", "the Tile shows setting") that F01 had already renamed at
   `4bf09c0`, and the page still says "Tile shows" at lines 47, 50 and 75
   and in the line-100 alt text ("Detail contains", "Detail title",
   "Second Back"); the rest of the page already uses "Details list",
   "Readings per tile" and "Title tile text". `scripts/capture-pi.mjs`
   already produces current shots (`pi-key-press.png`,
   `pi-key-detail-filter.png`, `pi-key-detail-tiles.png`).
5. **Gesture words in docs.** `docs/controls.md` and the dial's groups help
   still say "rotate" and "press+rotate" where the panel's selects say
   "Turn" and "Pressed turn" (also true at `4bf09c0`).
6. **Dial rotation list at 378x410** starts at y 427, just below the first
   screen (REPORT.md T5). Candidate for the formative study before any
   change.

## Safe commands (any order; none touches the app, the deck or the installed plugin)

```
npm run lint
npm run typecheck
npm test
npm run build
npx tsx scripts/e2e-pi-panels.mjs
node scripts/e2e-pi-persistence.mjs
node scripts/validate-release-copy.mjs
npx tsx scripts/pi-lab.mjs density review/pi-density/density-check.json --sizes 378x410,380x720
AXE_CORE=<path to axe.min.js> npx tsx scripts/pi-lab.mjs a11y review/pi-density/a11y-check.json --widths 378,320 --height 410
node review/pi-density/tabulate-report.mjs
```

`scripts/capture-pi.mjs` needs a fresh `scripts/pi-harness.mjs` on live
HWiNFO (it starts its own plugin process); run it outside a soak window.

## Owner-held gates (not run here)

1. Commit, push, PR, merge, tag, release, Marketplace: yours.
2. Real Stream Deck app (7.4.2, 378x410 panel at DPR 1.5), with the
   build installed by your usual route (deploy script or `streamdeck
   link`), checklist:
   - The header pins while scrolling a key and a dial panel; no focused
     field or open list hides under it (Tab and Shift+Tab through a
     four-reading key and a dial with groups).
   - The theme strip: eight named chips in two rows of four at the
     default window, every name whole; Default shows its link mark and
     the colors it follows; one click themes the key; "Change" opens
     Advanced › Shared defaults. Check the chip text on the app's own
     renderer (QtWebEngine fonts).
   - Fold all, then Open all: the strip never folds; a key switch keeps
     the folds, including the four Advanced groups.
   - Dial rotation: search first; the list is one Tab stop; Earlier,
     Later, Rename, Remove; with groups, a click in the other group
     selects what was clicked and nothing moves; Alt+Arrow, F2 and Delete
     reach the page (the app may keep some keys; the buttons must work
     regardless).
   - Unplug HWiNFO data: "No HWiNFO data" with the repair under the
     header; with Data source on Gadget only, the forced-source line and
     its button.
   - Stale Shared Memory (pause HWiNFO): "Not updating for N s" counting
     up without screen-reader chatter; Gadget: "Age unknown".
   - A layout change in HWiNFO (start a game that adds GPU readings):
     "Reopening source · key unchanged" for a moment, never "Live".
3. Windows scaling 100, 125, 150 and 200 percent and text size, on the
   real app (only DPR and width emulation ran here).
4. NVDA and Narrator on the key and dial panels: the strip's radios, the
   rotation listbox and toolbar, the status region (one announcement per
   state change, none per tick).
5. Windows High Contrast (emulated forced colors only here).
6. The formative study in UXR-PLAN.md.
