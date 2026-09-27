# Continuation

## Now (2026-09-26 evening): d06 on the deck, soaking

- **Installed:** panel build `1.7.0.0-d06` (manifest 1.7.0.0), archive
  `release/com.lawrensen.hwinfo.streamDeckPlugin` sha256
  `a02d1836dedc421bdb745bc0982b96075d2893f3ec81cf77bda147fc0343d63d`,
  plugin.js `36626410...`, hwsm.node unchanged. Bench route
  (`%SCRATCH%\bench\tools\deploy.ps1`), 47 files hash-verified. Settings
  snapshots before/after (`%SCRATCH%\bench\snaps\*-d06.json`): only an
  auto-cycling dial's reading changed.
- **Soak:** `node scripts/soak-monitor.mjs --interval 60 --duration 172800`,
  pid 25880, CSV `release/soak-1.7.0.0-d06-20260926-1652.csv`, closes about
  2026-09-28 16:52 local. Needs one HWiNFO restart, one Stream Deck restart
  and one sleep/wake inside the window (runbook). No e2e suites during it.
  Then: `node scripts/soak-monitor.mjs --summary <csv>` into PERF.md.
- **What d06 adds over d04:** re-review fixes (y1), final audit fixes
  (FA01..FA10, CA01..CA14), the Rotation heading spacing, and the foldable
  theme band (design R2, owner-approved; record in `round3/themefold/`).
  See the register's last section.
- **Gates on d06:** panel e2e 289/289, persistence 646/646, unit 1351/1351,
  design acceptance 70/70 on the product, axe 0 + own 0 in 62 runs, lint 0,
  typecheck 0, copy validator OK, pack validation OK, streamdeck validate OK.
  `npm run release:validate` not run (needs committed history).
- **Docs:** three agents swept every page for 1.7.0.0; images recaptured on
  d06 (`%SCRATCH%\docs-cap7`, copy list in `%SCRATCH%\copy_cap5.py` plus the
  detail, picker and pi-theme-folded mappings).
- **Release drafts:** kept with the private release docs, outside this repo.
- **Open, unexplained:** across the d05 install three dials without auto
  cycle moved from the second to the first member of their two-reading
  rotations. Plugin start writes no readingKey (READ: only steps call
  `adoptReading`); not reproduced across the d06 install (they were already
  on the first member). Watch for it at the next restart.
- **Still owed:** the soak summary, the owner's eight-step hands-on check
  (`round3/OWNER-CHECK.md`), commit/tag/publish (owner's).

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
