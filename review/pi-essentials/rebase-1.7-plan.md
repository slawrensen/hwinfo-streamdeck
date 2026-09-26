# PR #38 (F01, essentials-first panels) onto the 1.7 line: integration plan

Analysis date: 2026-09-23 (read-only; nothing committed, pushed or tagged).
Repo: slawrensen/hwinfo-streamdeck, primary clone `<primary clone>`.

## 1. Verdict

**Yes, move F01 onto the 1.7 line, but not as a rebase and not into 1.7.0.**

- **Recommended: option (c), started now on a new branch stacked on the 1.7 line
  (1.7 + #36), retargeted to `main` once #33 merges, and shipped as the next
  release (1.8.0.0) after 1.7.0 is tagged.** The panel HTML/CSS and F01's new
  shell files are ported whole ("file level"), and 1.7's panel features are
  re-expressed inside F01's shell feature by feature. `pi-common.js` is merged
  at merge level, because both sides edited a third of it. Everything else is
  a squashed three-way merge.
- **Do not** literally rebase the 14 F01 commits (12 of 14 stop, about 135
  conflict events). **Do not** ship F01 first on 1.6 (option d), because that
  would force a re-qualification of the frozen 1.7 artifact. **Do not** fold F01
  into 1.7.0.
- **Order:** freeze and commit the bench fixes → renderer fix (its own commit,
  so it can also be a 1.7.x hotfix) → plugin source → panel port → test and
  evidence ports → #36 alignment (a separate commit you can revert) → docs →
  regenerated images → gates → review evidence → hardware bench → retarget
  after #33.
- **Conflicts (git 2.54 `merge-tree`, default style):**
  - F01 candidate 34dd1fc against 1.7 acce981: **23 files, 79 hunks**.
  - Against 1.7 + #36 (2d10b19): **24 files, 84 hunks**.
  - With the bench fixes (as measured): **26 files / 85 hunks** against acce981,
    and **27 files / 90 hunks** against 2d10b19.
  - Of the 90: 36 hunks are in panel files (25 in `pi-common.js`), 6 in plugin
    source, 9 in tests, scripts and package, and 39 in docs, README and PERF.
- **The expensive part is not textual.** Seven harnesses and gates break with
  **no textual conflict at all** (section 4.4). Two examples: 1.7's pack
  contract does not list F01's four new panel scripts, and 1.7's vm-based alias
  contract test cannot load F01's `pi-common.js`.
- **Effort: about 11 working days (range 8 to 14)**, which is 2.5 to 3
  calendar weeks with your gates. That includes one owner-attended hardware
  day.

## 2. Inputs verified

| Piece | Ref | Facts |
| --- | --- | --- |
| main | 2ca44e9 | Release 1.6.0.0 |
| 1.7 line (PR #33, draft) | `codex/release-1.7.0` at acce981 | 127 commits over main, 181 files, +17,914/-2,173. acce981 (2026-09-21 21:57) is a **post-freeze payload change**: the row cap is removed, the panel token goes to `1.7.0.0-8`, and the capture was redone. The freeze point was 945d6b8, with docs at 48ce2b2. |
| PR #36 (draft) | `claude/follow-hwinfo-cadence` at 2d10b19 (611608c, 3dbe76a, 2d10b19) | 28 files, +370/-204. It removes the "Poll every" rows (9 lines in each sensor panel) and `setIntervalMs`. `pollIntervalMs` stays stored and ignored (append-only). It does not touch `pi-common.js` or `pi-protocol.ts`. |
| PR #38 (draft) | `claude/sweet-shannon-lss3s9`, candidate 34dd1fc (tree 77825f707ecd..., verified), head eef1e14 | 14 commits, 77 files, +20,588/-1,954 (about 15k lines of that is `review/`). eef1e14 adds only review docs (4 files). |
| Bench fixes | uncommitted in `<bench worktree>` (detached eef1e14) | Snapshot measured: 26 tracked files, +416/-132. **The worktree changed while this analysis ran**: it is now 28 tracked files plus 2 new ones (`src/panel-folds.ts` 93 lines, `test/panel-folds.test.ts` 74 lines, a `state/` gitignore entry, and a package.json test entry). That adds a plugin-side store for panel fold memory under `<plugin>/state/`. The set is still moving (see Step 0). |

### Other open PRs that touch the same surface

| PR | What it is | Overlap with this move |
| --- | --- | --- |
| #32 `fix/31-dial-sensor-colors` -> main | Issue #31 number colors (6 commits) | **Superseded by 1.7.** Its six commits are re-applied in 1.7 as fd1cab6, 01a36c1, 6186ea4, 6bb84e5, ab1915f and 51a1733 (`git range-diff` pairs them 1:1). It touches control, detail-slot, pi-common (+115/-6), pi.css, sensor-dial and sensor-reading. The F01 port must carry its features (via 1.7), not the PR itself. If #32 were merged to main on its own, the conflict profile would change. Recommend closing it as superseded when #33 merges. |
| #34 `codex/perf-scaling-250ms` -> 1.7 | 250 ms perf scaling harness | Touches `scripts/hygiene.mjs`, `package.json` and `PERF.md`, the same three files the port and bench touch. Only small textual overlap. The "250 ms" premise also interacts with #36's per-source cadence. |
| #25 to #29 (audit stack) | Release inputs, identity, recovery copy, contrast, qualification | **Already ancestors of acce981.** They are inside 1.7, so they add nothing new here. |
| #20 spike/workspace-navigation -> main | Workspace pages spike (draft) | Touches all four panel files, `pi-common.js` and `sensor-reading.ts`. Not in scope, but it will conflict with F01 even more than 1.7 does. |
| #7 to #16 dependabot | Actions and dev dependencies | No panel overlap. #15 (TypeScript 7) is the known do-not-merge. |

## 3. What each side changed (user-visible)

**1.7 (+ #36) in the panel and protocol:**

- **Individual dial reading colors (#31):** a preset (Automatic, Signal,
  Pairs, Uniform, Custom) plus a well and an "Auto" button for each reading.
  The map is keyed by reading identity, so it survives rotation, groups and
  reordering. Unknown entries are kept.
- **"Color numbers by sensor type":** multi-row dials only. Only an exact
  `true` enables it, and opening the panel never writes it.
- **Linked readings across providers:** the tree carries `keys` (aliases).
  The picker, chips, rotation membership, names, colors, the custom detail
  list (one chip per measurement, with a "Linked duplicate entries are hidden"
  note), the parked Back-tile primary and the filter count are all alias-aware.
  A saved key is never rewritten.
- **Honest missing cue:** a panel reports "missing" only when a snapshot
  exists (ok or stale). A tree from an unavailable source never accuses a
  saved key, and a source switch or outage re-fetches the tree.
- **`bareKey`:** only leading whitespace is dropped, and a Gadget key is kept
  whole to its last character.
- **Detail tiles gain `automaticColors` provenance:** a chosen hue renders
  exactly, and an automatic hue keeps its contrast lift. There are also
  projection guards, so a stale DOM control cannot edit a different reading.
- **Row cap removed** (acce981): every match renders.
- **Picker closes on Tab-out.**
- **Help links open in the user's browser** (`openUrl`), with a readable link
  color.
- **"Rotation groups need a gesture that can switch groups" note** for Legacy
  or Custom maps that have no stepGroup.
- **Config drafts survive closing and reopening the fold,** the two wells fill
  independently, and a late reply cannot overwrite a draft.
- **Threshold guidance:** "see units below", and bytes and rates use HWiNFO's
  original number and unit, before Data units changes the scale.
- **Graph copy:** Yes/No spans 0 to 1. Shared Memory uses the session
  min/max, Gadget uses the last 36 samples.
- **Gadget statistics:** an "N/A" stat badge, and "Historical statistics
  unavailable in Gadget".
- **Evidence-based status copy:** "No new data" and "Age unknown" on stale,
  plus "Source busy" and "Bridge failed".
- **Unknown theme ids** seed from the spec default.
- **A reading-links help line** under Data source.
- **Preview payload:** overview row colors and a Gadget stats string.
- **#36:** Poll every is gone.

**F01 (+ bench) in the same places:**

- **A new shell:** `pi-shell.js` (506 lines), `pi-model.js` (344),
  `pi-slot.js` (33) and `pi-command.js` (28). There is a header showing the
  exact device face and its state, and sections for Reading, Display, Alerts,
  Press or Controls, and Advanced.
- **Native controls replace sdpi-components,** bound by `data-setting`.
- **Lossless writes:** raw/base for each tile, kept list entries,
  `patchNames` and `patchEntry`.
- **Pickers:** APG comboboxes and checklist membership.
- **A preview payload with `face`, `effective`, `reading` and `context`.**
- **`key-layout.ts`** (`drawnKeyLayout`).
- **Every help and status string rewritten.**
- **"Poll every" renamed to "Read every".**
- **Bench fixes:**
  - D1: flushes typed text on pointer leave or blur.
  - D3 to D5: list dismissal, selecting text on reopen, copy with no Escape
    promise.
  - D6: reveal.
  - D7: sends a preview only on change.
  - D8: names the Copy buttons.
  - D2: inline gaps that QtSvg honors. `tspan dx` becomes a space character
    plus `xml:space="preserve"`.
  - Dual pinned-row badges move to the label line.
  - Fold memory, now also persisted plugin-side.

## 4. Conflict inventory

### 4.1 Pairings

| Pairing | Files | Hunks | Notes |
| --- | --- | --- | --- |
| 34dd1fc vs acce981 | 23 | 79 | Tree 8847e4d |
| 34dd1fc vs 2d10b19 | 24 | 84 | Adds docs/data-sources.md. sensor-dial.md goes from 3 to 5 hunks, sensor-reading.md from 4 to 5, troubleshooting.md from 2 to 3 |
| F01 + bench snapshot vs acce981 | 26 | 85 | Adds key-renderer.ts, dial-renderer.ts and detail-faces.test.ts |
| F01 + bench snapshot vs 2d10b19 | 27 | 90 | Tree 5a11124 |
| Commit-by-commit replay of the 14 F01 commits onto acce981 | 12 of 14 commits stop | about 135, plus modify/delete stops | Worst: b24ce39 (20 files, 41 hunks), 3a32a27 (30 hunks), 85d5143 (21) |
| Bench renderer slice alone onto 2d10b19 (`git apply --3way`) | 9 files: 6 clean, 3 conflicted | 4 | Only imports, adjacent declarations and two golden hashes |

### 4.2 Per file (F01 + bench vs 2d10b19)

**Kind:** M = mechanical/textual; S = semantic (a 1.7 behavior must be
re-expressed in F01's shell, or copy truth must be merged).

| File | Hunks / conflict lines | 1.7 (+#36) changed | F01 (+bench) changed | Kind | Resolution |
| --- | --- | --- | --- | --- | --- |
| ui/pi-common.js | 25 / 466 | 71 diff hunks (+521/-138): alias index, missing-cue honesty, tree refresh on source switch, bareKey, detail projection plus `automaticColors`, row cap removal, Tab-out close, openUrl, groups-switch note, number-colors toggle, reading colors, theme seed, config drafts, token | 57 diff hunks (+882/-390): shell/model split, combobox/checklist, lossless raw/base plus kept entries, focus memo, reorder buttons, "on dial" badge, person-act Elite seeding, header and hint moved to the shell. Bench adds 4 hunks | S | Merge level. 46 of the 71 1.7 hunks auto-merge and must be audited. The 25 conflicts are mapped in 4.3 |
| ui/sensor-dial.html | 3 / 659 | 6 hunks: groups note, the "Color numbers by sensor type" plus Reading colors block, threshold copy, reading-links help, token. #36 drops Poll every | 1 hunk (the whole file rewritten, +398/-335). Bench changes 8 lines | S | File level: take F01 + bench, then add the 1.7 elements (section 5) |
| ui/sensor-reading.html | 3 / 414 | 4 hunks: graph copy (Yes/No, Gadget samples), threshold copy, reading-links help, token. #36 drops Poll every | Whole file rewritten (+370/-323). Bench changes 8 lines | S | File level, as above |
| ui/pi.css | 2 / 198 | +26: `.hw-reading-colors` (220 px scroll, label ellipsis), button style, `.hw-help a { color: #8ecbff }` | 12 hunks (+816/-510) on a new token system | S (light) | Take F01, then add the reading-colors rules and a link color from F01's tokens (its contrast table lists link at 7.96:1 on bg) |
| ui/control.html | 2 / 13 | Token only | Rewrite. Bench changes 5 lines | M | Take F01 + bench, set the new token |
| ui/detail-slot.html | 1 / 5 | Token only | Rewrite | M | As above |
| src/pi-protocol.ts | 2 / 27 | Tree `keys`. `PreviewSettings` gains dialView, readingColors, sensorValueColors, rotationGroups and `stepListOf`. Overview row colors in `display`, plus the Gadget stats string | `effective`, `face`, `reading`, `context`, `kind`, `MAX_FACE_CHARS`, `lastPanelFace`, `faceOf`. Bench adds the D7 dedupe (and now a panel-folds message) | M + small S | Take the union of imports and the 1.7 `PreviewSettings` type. The `buildPreview` body auto-merges correctly (checked: F01 extras, 1.7 display colors and F01 reading/effective all present). Keep the 1.7 display logic, because `e2e-reading-links` asserts it |
| src/actions/sensor-dial.ts | 2 / 15 | `DialRenderState` plus a `historyOf` parameter on the exported `composeDialSvg` | `FaceState` (the same six fields) on the exported `composeDialSvg` | M | Take 1.7's `DialRenderState` and `historyOf`, and delete `FaceState`. F01 call sites still compile, because `historyOf` has a default |
| src/ui/key-renderer.ts | 1 / 27 | `XML_ILLEGAL` escaping, `cappedUnit`, `quadIdentityOf` | `inlineGap` / `PRESERVE` / `INLINE_GAP_PX`, row badges on the label line, `dualValueFontSize` without `badged`, triple unit gap | M | Keep both blocks |
| src/ui/dial-renderer.ts | 1 / 9 | Imports `cappedUnit`, `estimateKeyTextWidth` and `noDimmerThan`; `wideUnitShift`; `unitColor` / `selectedLabelColor` | Imports `inlineGap` and `PRESERVE`; unit tspan gap | M | Union of the imports |
| test/detail-faces.test.ts | 2 / 10 | `asOf160()` normalizer, still holding the 1.6.0 hashes | Raw hash replaced with new bytes | S (method) | Extend `asOf160` with the inline-gap transform and keep the 1.6.0 hashes (section 7, Step 2) |
| scripts/e2e-pi-persistence.mjs | 3 / 92 | 26 hunks (+538/-45): about 68 new check sites; 15 old-DOM references (reading-color-*, preview-value, status-hint, `.hw-help a`, sdpi-*) | 26 hunks (+87/-40) ported to F01's DOM | S | Port the 1.7 legs to F01's DOM (section 7, Step 5) |
| scripts/capture-pi.mjs | 3 / 29 | Owned browser lifecycle, reads `#preview-value` | F01 selectors (fd8834d) | S (light) | F01 selectors plus 1.7 lifecycle, without `preview-value` |
| package.json | 1 / 5 | Test list +22 files (alias contract, provenance, pack, qualify and others) | +pi-model and pi-preview (bench: +panel-folds) | M | Union |
| README.md | 5 / 101 | Heavy rewrite (+136/-275) | Panel label vocabulary (+23/-20) | S (docs) | 1.7 text in F01 vocabulary |
| PERF.md | 1 / 105 | +79 (1.7 entries) | +27 (F01 picker entry) | M | Keep both, in date order |
| docs (13 files: controls, data-sources, faq, getting-started, index, sensor-details, sensor-dial, sensor-reading, themes, thresholds-alerts, troubleshooting, plus #36's data-sources and troubleshooting hunks) | 39 hunks | 1.7 facts (Gadget statistics, freshness, threshold units, reading colors, links); #36 cadence | F01 section/label vocabulary and tables | S (docs) | F01's structure with 1.7's facts, minus Poll every |

### 4.3 pi-common.js: the 25 conflict hunks by feature

| Hunk | Region | Resolution |
| --- | --- | --- |
| 1 | `PI_BUILD` | New dev token (Step 4) |
| 2 | State declarations (`detailsSupported` vs `treeHasSnapshot`) | Keep both |
| 3 to 4 | Rotation chip class and name | F01 markup (buttons, "on dial" badge), with `missing = keyIsMissing(key)`, `current = sameReading(key, selected)` and `shown = readingNameOf(key) ?? label ?? key` |
| 5 | F01 focusMemo/focusRestore vs 1.7 syncGroupsHelp | Keep both. Point the note at F01's element and drive it from `effective.controls.switchesGroups` (plugin authority) |
| 6 to 9 | Detail tile adopt/clone/occupancy | Each tile carries `{size, labels, colors, cellLabels, automaticColors, raw, base}`. `detailSourceTiles` holds the parsed tiles, and projection hides linked duplicates without writing. **The hardest merge:** a tile the projection filtered has no 1:1 raw anymore, so it must be serialized whole, keeping raw's unknown fields, only when an explicit edit commits |
| 10 | `writeDetailState` | F01 `serializeTile` + `detailTilesKept` + `mergeKept`, plus 1.7's source-copy update and its rule: write `automaticColors` only when some entry is true |
| 11 | `isDefault` / `readable` | Add `"automaticColors"` to F01's `KNOWN`, then apply 1.7's "only automatic default hues are redundant" rule behind F01's `readable()` guard |
| 12 | `adoptDetailKeys` | F01 known/kept/keptAt split, then `detailSourceKeys = known; projectDetailState()` |
| 13 to 15 | Picker placeholders | F01 strings with 1.7 conditions (`treeHasSnapshot`, the title attribute, the collector placeholder rule) |
| 16 to 18 | Picker row build | F01 combobox/checklist rows plus 1.7's alias-resolved `selected`. Both removed the cap. Keep F01's hidden "none" option |
| 19 | Detail checklist tick/onPick | F01 wording and structure plus `isDetailPrimary` / `listedAliasOf` |
| 20 | F01 focusin closer vs 1.7 openUrl + setHint/renderPreview | Keep F01's closer and bench D3. Keep 1.7's openUrl handler (one handler only). Drop 1.7's renderPreview/setHint, because the shell owns the header and hint |
| 21 | Elite seeding vs showGroupsHelp | F01's person-act seeding plus the groups note (see 5) |
| 22 | Threshold placeholders | F01's short form; the unit guidance moves into the help (see 5, row 13) |
| 23 | sensorTree handler | `setTree(Array.isArray(p.groups) ? p.groups : [])`, `treeSource = p.source`, `treeHasSnapshot`, `projectDetailState()` |
| 24 | Preview handler | Drop renderPreview/setHint. Keep 1.7's `if (p.state !== "ok" \|\| p.source !== treeSource) treeFetchedOk = false` |
| 25 | Rotation rename commit | For each alias of the key, `patchNames(raw, alias, "")`, then patch the key with the name. That is 1.7's one-name-per-measurement rule kept lossless |

### 4.4 Breaks with no textual conflict

1. **`scripts/lib/pack-contract.mjs` `SHIPPED_MEMBERS`** (1.7) lists only
   `pi-common.js`, `pi-control.js`, `pi.css`, `sdpi-components.js` and the
   four HTML files. F01's `ui/pi-model.js`, `ui/pi-shell.js`, `ui/pi-slot.js`
   and `ui/pi-command.js` must be added. Otherwise `npm run pack`,
   `validate-pack`, `qualify.mjs` and `release:validate` fail, and
   `test/validate-pack.test.mjs` counts `SHIPPED_MEMBERS.length`.
   - The bench's new `<plugin>/state/panel-folds.json` is not in
     `STAGING_ONLY`, so any local run that writes it becomes staging drift.
   - It also changes the installed tree that 1.7's install checks compare
     against the pack ("all 43 installed files match").
   - Recommendation: store the fold memory outside the plugin folder, or
     declare `state/` staging-only and forbidden.
2. **`test/docs-image-provenance.test.ts`** pins the sha256 of `sensor-dial.html`,
   `pi-common.js` and `pi.css` for `pi-dial-reading-colors-1.7.png`, so
   `npm test` fails until that capture is redone. This is the same reason #36's
   CI is red. It is also a docs-truth question: see Step 7.
3. **`test/pi-alias-contract.test.ts`** (1,405 lines) loads `pi-common.js`
   alone in a node vm over a fake DOM. F01's `pi-common.js` needs
   `self.hwShell` (from `pi-shell.js`) and `hw.model` (from `pi-model.js`), so it
   throws at load.
   - The test also asserts 1.7 strings: `"⚠ Sensor not present. Pick again"` and
     `"Search sensors…"`.
   - Most element IDs survive in F01 (config-*, detail-*, picker-*, pickerd-*,
     rotation-set, theme-gallery, text-color). Missing are `preview-value` and
     the reading-color and number-color IDs.
4. **`scripts/capture-pi-reading-colors.mjs`** (+ its test) reads
   `#preview-value`, `#status-hint` and the old "Appearance" section header.
5. **`test/dial-sensor-colors.test.ts` / `golden/dial-color-baseline.json`**
   hash 21 single-view dial faces. D2 changes every single dial face that
   shows a unit, so those checks fail unless the `SINCE_1_6_0` handling
   learns the gap transform.
   - The overview and two-row faces (42 entries) and 1.7's docs board
     (`dial-reading-colors-1.7.png`) contain no tspan and should not move.
   - They are a free proof that D2 touched nothing else.
6. **`test/compat.test.ts`** (1.7) treats `golden/legacy-faces.json` as a
   **historical artifact** with explicitly authorized replacements. The bench
   edits that file in place, and git auto-merges the edit. It passes, but it
   breaks 1.7's method. Revert the edit and authorize the transform instead.
7. **`scripts/e2e-reading-links.mjs`** finds the last preview carrying
   `display` after a marker. With D7's "send only on change", an unchanged
   preview may never arrive after the marker. Verify it, and if needed have
   the harness trigger `getPreview`.

Also semantic but auto-merged:

- **`CHANGELOG.md`:** F01's `## Unreleased` lands above `## 1.7.0.0`. It
  repeats 1.7's row-cap claim, and it must become `## 1.8.0.0 - YYYY-MM-DD`
  at the bump.
- **`docs/changelog.md`** is derived. Regenerate it, never hand-merge it.
- **`src/actions/sensor-reading.ts`:** the bench's pinned-row badges merged
  with 1.7's `readingStatBadge`, which can return `"N/A"`. It needs a unit
  case: "N/A" on the label line, within its width budget.
- **`scripts/hygiene.mjs`:** `e2e:pi-panels` lands after `e2e:pi`, which I
  checked. F01's `lib/cdp.mjs` Chrome must pass 1.7's owned-process
  classification with zero orphans.
- **`pi-model.js` `advancedSummary`** still prints "poll N s". So do
  `test/pi-model.test.ts` lines 149 to 150.

## 5. 1.7 panel features F01 must carry

| # | 1.7 feature (commit) | Where it goes in F01 | Port | Test that must be ported |
| --- | --- | --- | --- | --- |
| 1 | Individual dial reading colors (6bb84e5, ab1915f) | Dial → Display, under View; shown for tworow/overview only. Keep the IDs `reading-color-preset` and `reading-color-list`. Each row has a well, a name label and an Auto button. Alias-aware; unknown map entries kept (lossless like `patchNames`). The Display summary names it | New markup plus 1.7 code | alias-contract color cases; e2e:pi reading-color legs; capture-pi-reading-colors |
| 2 | Color numbers by sensor type, exact true only, never written on load (fd1cab6, 01a36c1) | Dial → Display, multi-row only (`#sensor-value-colors-toggle`). **F01's accents help ("never the numbers") becomes false and must change** | New control; check that the shell's checkbox binding paints only `=== true` and never coerces | e2e:pi "reflect only exact true" leg |
| 3 | Linked readings across providers (a40e00f, 5a4d15c) | pi-common as merged, plus **`pi-shell.js` `labelOf()` must resolve through `reading.keys`**. It matches only `reading.key` today | Code | pi-alias-contract (whole file) |
| 4 | Honest missing cue (bd954c4) | pi-common `showSelection`; the shell already uses the plugin's `p.missing` | Code | alias contract |
| 5 | Tree refresh on source switch or outage (a40e00f) | pi-common message handler (hunk 24) | Code | e2e:pi |
| 6 | `bareKey` whitespace identity (a40e00f) | pi-common (auto-merged; verify) | Code | alias-contract identity table |
| 7 | Detail `automaticColors` provenance (b9a2312) | pi-common lossless tile model (hunks 6 to 11) | S merge | alias contract, e2e:pi |
| 8 | Detail projection guards and linked-duplicate note (5a4d15c) | pi-common; the note renders through F01's announcer | S merge | alias contract |
| 9 | "Rotation groups need a switching gesture" note | Dial → Reading, under the group editor, from `effective.controls.switchesGroups` | Re-express | e2e:pi leg; e2e:pi-panels new check |
| 10 | Help links open in the browser (`openUrl`), readable link color (bd954c4) | One document click handler plus a link token in `pi.css` | Code + CSS | e2e:pi `.hw-help a` legs |
| 11 | Reading-links help line under Data source | Both panels → Advanced → Connection | Markup | e2e:pi |
| 12 | Config drafts survive the fold; independent wells; late-reply guard (bd954c4) | pi-common config section (auto-merged; verify). **This closes bench D11** | Verify | e2e:pi config legs |
| 13 | Threshold guidance for bytes and rates (bf38e8e, c5c23ce) | Alerts help on both panels. **F01 says "use the numbers the key/dial shows", which is wrong for bytes and rates on 1.7** | Copy | persistence placeholder legs |
| 14 | Graph domain copy (Yes/No 0 to 1; Shared Memory session vs Gadget 36 samples) | Key → Display → Graph help | Copy | none (copy review) |
| 15 | Gadget statistics ("N/A" badge; stats unavailable) | Key → Display → Value shown help. **F01 says "HWiNFO's own, since HWiNFO started", which is false on Gadget** | Copy | none |
| 16 | Evidence-based status copy (14a8c9d, 3c14f5f) | **`pi-shell.js` hardcodes** "HWiNFO stopped updating…" and 'dial shows "HWiNFO stalled"' / 'key shows "Not updating"', and the header shows "Not updating" for every stale state. 1.7 draws "No new data" (Shared Memory, dial), "Age unknown" (Gadget) and the new hint sentences. Take the text from the plugin (`p.hint`, plus a face-name field if needed), not from shell literals | Re-express | e2e:pi-panels truth checks; bench B4 |
| 17 | Unknown theme seed and `hasOwn` (576c4e6, 5a59fd3) | pi-common gallery (auto-merged); F01 radio gallery | Verify | e2e:pi theme legs |
| 18 | Row cap removed (acce981) | Convergent with F01 | Keep F01's | alias contract ("nothing held back") |
| 19 | Picker Tab-out close (bd954c4) | Convergent with F01's focusin closer plus bench D3 | Keep one mechanism | e2e:pi-panels |
| 20 | Cache token discipline | All panels | Token | pi-build-token |
| 21 | #36: Poll every retired | Drop F01's "Read every" rows, the poll part of `advancedSummary`, and the coverage row. `pollIntervalMs` stays stored | Separate commit | pi-model test |

**F01 coverage-map rows that 1.7 or #36 change:**

- **Removed:** "Poll interval → Advanced → Connection → Read every" (#36).
- **Changed:**
  - Primary reading and Current reading: alias-aware selection, and the
    missing cue follows `treeHasSnapshot`.
  - Rotation membership and Rotation order: alias-aware; untick removes every
    alias.
  - Per-reading names: a rename clears the aliases' entries.
  - Custom list (`detailKeys`): one chip per measurement, linked duplicates
    projected, and a note.
  - Tile plan (`detailTiles`): `automaticColors` becomes a known field.
  - Quad cell colors: a chosen hue renders exactly; runtime note only.
  - Theme: unknown-id seed.
  - Accent colors: the help text changes.
  - Warn / Critical: the units guidance changes.
  - Graph and Stat shown: the help text changes.
  - Status / missing and Live value line: 1.7 stale and Gadget copy.
  - Config: shared (the shared document now carries `readingLinks`).
  - Data source: gains the links help.
  - "Controls removed: Row cap message": now also true on 1.7.
- **New rows:**
  - `sensorValueColors` (dial, action, exact-true boolean, default absent).
  - `readingColors` (dial, action, a map keyed by reading identity, unknown
    entries kept).
  - `readingLinks` (global, Config document only, never written by a
    control).
  - The groups-switch note (panel-derived, never stored).

## 6. Strategy options

| | (a) Wait for #33 to merge, then rebase onto main | (b) Rebase onto `codex/release-1.7.0` now | (c) File-level port onto 1.7 (+#36), rest merged (**recommended**) | (d) Ship F01 on 1.6 first, then merge 1.7 over it |
| --- | --- | --- | --- | --- |
| Touches the frozen 1.7 artifact | No | No (if it stays on its own branch) | No: a new branch; never commits to or force-pushes 1.7 | **Yes.** 1.7 must absorb 24 files and requalify (qualify.mjs, suite:full, pack, soak, hardware) |
| Conflict work | Same content (84 to 90 hunks), done once on a settled base | As a literal rebase, 12 of 14 commits stop, with about 135 conflict events and the same pi-common hunks resolved repeatedly | 90 hunks once, of which 36 panel hunks become file-level take-F01-then-re-add. Only `pi-common.js` stays hunk-level | The same conflicts, but resolved inside the qualified 1.7 PR |
| Rework risk if 1.7 moves | None (done after the merge) | High. 1.7 already moved once after the freeze (acce981) | Low: a small stack. Re-sync with `range-diff` and port only the delta | High |
| #36 fit | Depends on #36's timing | Must pick a base | Base on 2d10b19, with the Read-every removal in a revertable commit | #36's panel hunks re-conflict inside 1.7 |
| Release flow | 1.8.0.0 after 1.7.0 | 1.8.0.0 after 1.7.0 | 1.8.0.0 after 1.7.0; the renderer commit can go out alone as 1.7.1 | F01 would take 1.6.x or 1.7.0 and collide with the 1.7 line's version |
| Review evidence | Re-run all of it on the combined base | Same | Same, but the per-feature port gives each re-run a clear target | Re-run F01's evidence and 1.7's qualification |
| Time to start | Blocked until #33 merges | Now | Now | Now |
| Verdict | Fine, but idle | No | **Yes** | No |

(a) and (c) are compatible: (c) is the method, and (a) decides when the PR
is retargeted. Start the port now against the 1.7 tip, keep it a draft PR on
top of 1.7 (like #36), and retarget it to `main` once #33 merges.

## 7. Step-by-step plan (option c)

### Step 0. Freeze and preserve the bench fixes (owner-gated; about 0.25 d)

- **Do not touch the bench worktree while its session is live.** It changed
  during this analysis.
- When it stops, create a new worktree from eef1e14 and apply
  `git -C <bench worktree> diff --binary`, plus the
  new untracked source files (`src/panel-folds.ts`, `test/panel-folds.test.ts`).
  Leave out the raw `review/.../bench/` artifacts unless you want them.
- Commit on a local branch `claude/f01-bench-fixes` in slices, so the
  renderer fix can travel alone:
  - B1 `fix(render)`: D2 inline gaps plus dual pinned-row badges on the label
    line. Covers key-renderer, dial-renderer, `composeDual`, renderer tests,
    density, detail-faces, legacy-faces and the e2e-harness badge check.
  - B2 `perf(pi)`: D7 preview only on change.
  - B3 `fix(pi)`: D1 flush, D3/D4/D5 dismissal, D6 reveal, D8 names, fold
    memory including `panel-folds`.
  - B4 `test`: H1 `e2e:pi-panels` in suite:full; H2 focus emulation.
  - B5 docs and CHANGELOG.
- Gate: the bench's recorded numbers (unit 791+, `e2e:pi-panels` 177/177).
- Then re-measure:
  `git merge-tree --write-tree --name-only claude/f01-bench-fixes 2d10b19`.

### Step 1. Choose the base and branch (about 0.1 d)

- Base: **2d10b19** if #36 is going into 1.7. If it is not, use **acce981**
  and skip Step 6. Record `git rev-parse` of the base in the PR body.
- Create `claude/f01-on-1.7` from the base, in a new worktree
  (`<hwinfo-f01-on-1.7 worktree>`).
- **rerere is on and its cache is shared across all worktrees.** Run merges
  with `git -c rerere.enabled=false`, or check every "Resolved using previous
  resolution" line. Memory already records one bad recording.

### Step 2. Renderer commit R: cherry-pick B1 (about 0.75 d)

- Conflicts:
  - `key-renderer.ts`: keep 1.7's `XML_ILLEGAL` block and B1's
    `inlineGap` / `PRESERVE` / `INLINE_GAP_PX` block.
  - `dial-renderer.ts`: union of the imports.
  - `detail-faces.test.ts`: see below.
- **Prove that only the intended bytes changed, using 1.7's own golden
  method rather than re-baselining:**
  - Add one structural transform, `beforeInlineGap(svg)`. It removes
    ` xml:space="preserve"` and turns `<tspan …>\u2002X` / `<tspan …>\u2004X`
    back into `<tspan dx="6" …>X`.
  - The transform counts its sites, the way `asOf160(svg, movedFills)` does,
    so a face with an unexpected change fails.
  - Apply it in `compat.test.ts` next to the authorized color replacements,
    and restore `golden/legacy-faces.json` to 1.7's bytes.
  - Apply it in `dial-sensor-colors.test.ts` for the 21 single-view entries,
    and update its one `tspan dx` regex.
  - Apply it in `detail-faces.test.ts` through `asOf160`.
  - All 1.6.0 and 1.7 hashes stay as they are.
- Take the bench versions of the geometry tests (`key-renderer`,
  `dial-renderer`, `density`). They assert the new structure.
- Add a unit case: a pinned dual row on Gadget shows "N/A" on its label line
  within budget.
- Regenerate the renderer boards whose faces carry a unit tspan: dual, triple
  and single dial boards in `marketplace-shots`, `gen-docs-shots`,
  `contact-sheet` and `back-face-sheet`. List them with
  `git grep -l renderDualKey\|renderTripleKey\|renderDial( -- scripts`.
  `docs-v17-images` (overview and two-row) must stay byte-identical, which
  gives a second proof.
- This commit is also the 1.7.1 hotfix candidate if you want D2 before F01.
- Gate: lint, typecheck, `npm test`.

### Step 3. Source commit S (about 0.5 d)

- `pi-protocol.ts`: union (4.2), then add B2's dedupe on top. Optionally add
  `effective.numberColors` (exact-true flag plus count) for the Display
  summary.
- `sensor-dial.ts`: take `DialRenderState` and `historyOf`, and drop
  `FaceState`.
- `sensor-reading.ts` auto-merges. `src/ui/key-layout.ts` comes over as-is.
- `scripts/lib/pack-contract.mjs`: add `ui/pi-command.js`, `ui/pi-model.js`,
  `ui/pi-shell.js` and `ui/pi-slot.js`. Then either move the fold store out
  of the plugin folder (preferred), or add `/^state\//` to `STAGING_ONLY` and
  a forbidden pattern.
- `native/`: untouched. `git diff <base> -- native/` must be empty, because a
  TypeScript-only release ships byte-identical native bytes.

### Step 4. Panel commit P: file level (about 2.5 d)

- **HTML:** take F01 + bench as-is for all four panels, then add the items in
  section 5, rows 1, 2, 9, 11, 13, 14 and 15.
  - Use 1.7's element IDs (`sensor-value-colors`,
    `sensor-value-colors-toggle`, `reading-color-preset`,
    `reading-color-list`, `groups-preset-help`) so the ported tests change
    less.
- **pi.css:** take F01, then add the reading-colors rules and a link token.
  Re-check the contrast table.
- **pi-shell.js:**
  - An alias-aware `labelOf`.
  - Status and header copy from the plugin (row 16).
  - One `openUrl` handler (or keep it in pi-common, but only one).
  - The groups note fed from `effective.controls.switchesGroups`.
- **pi-model.js:** a dial Display summary that covers number colors, and an
  Advanced summary without poll (in Step 6).
- **pi-common.js:**
  - Start from the three-way merge output and resolve hunks 1 to 25 per 4.3.
  - Then audit the 46 auto-merged 1.7 hunks, above all
    `projectDetailState`, `wornDressing`, the move and park code, and the
    config fills, against F01's lossless model.
- **Cache token:** keep 1.7's rule (one token everywhere; `PI_BUILD` equals
  every `?v=`).
  - During development, continue F01's lettered series on the 1.7 base:
    `1.7.0.0-f01h`, then `-f01i`, and so on, for each panel change that
    reaches a webview. This cannot be mistaken for 1.7's numeric `-N`
    candidates.
  - At the version bump, switch to `1.8.0.0-1`.
  - Never reuse a token that a webview has already loaded with different
    bytes.

### Step 5. Test and evidence ports T (about 2.5 d)

- **`test/pi-alias-contract.test.ts`:**
  - Load `pi-model.js`, `pi-shell.js` and `pi-common.js` in order into the vm.
  - Extend the fake DOM for what the shell touches: details and summary,
    role and aria attributes, label-row checklists, a `localStorage` stub, no
    `ResizeObserver`, and a `DOMParser` stub.
  - Update the 16 old-DOM and string references.
  - **Keep every 1.7 case.** Keep a ledger that maps each old case name to
    its new name.
- **`scripts/e2e-pi-persistence.mjs`:** resolve the 3 hunks, then port about
  68 1.7 check sites to F01 selectors, with native controls in place of
  `sdpi-*`. Nothing is deleted without a written reason.
- **`scripts/e2e-pi-panels.mjs`, `lib/pi-sim.mjs`, `lib/pi-fixtures.mjs`:**
  - Add fixtures: tree rows with `keys`, a Gadget source with its hint,
    stale on Gadget, and settings carrying `readingColors`,
    `sensorValueColors`, `rotationGroups` and a global `readingLinks`.
  - Add checks: zero writes on open with those fields present, unknown
    `readingColors` entries kept, and the groups note.
- **`scripts/capture-pi-reading-colors.mjs` (+ its test):** retarget to F01's
  DOM (the Display section and the header face).
- **`scripts/capture-pi.mjs`:** resolve 3 hunks.
- **`package.json`:** union of the test lists.
- **`test/pi-model.test.ts`:** new summary expectations.

### Step 6. #36 alignment commit (about 0.25 d; revertable)

- Remove "Read every" from both panels, the poll part of `advancedSummary`
  and its tests, the coverage-map row, and the docs mentions.
- `pollIntervalMs` stays untouched in stored settings (append-only).

### Step 7. Docs commit D (about 1 d)

- README (5 hunks) and the 13 docs pages (39 hunks): F01 structure and
  vocabulary, 1.7 facts, #36 cadence.
- **`docs/whats-new-1.7.md` and `pi-dial-reading-colors-1.7.png` (a decision
  for you):**
  - That page and its image describe the 1.7 panel ("Appearance > Reading
    colors").
  - The provenance test currently pins the image to the *current* panel
    sources.
  - Recommend keeping the 1.7 image as history, pinned to the 1.7.0 tag's
    sources, and adding a new capture for `sensor-dial.md#reading-colors`.
  - The alternative is to recapture it and re-caption it as the current
    panel.
- `CHANGELOG.md`: F01's Unreleased entry drops claims 1.7 already ships (the
  row cap). It becomes `## 1.8.0.0 - YYYY-MM-DD` at the bump.
- Run `npm run changelog:page` and `node scripts/validate-release-copy.mjs`.
  Check for no em dashes and no AI-slop phrasing.
- Update `review/pi-essentials/coverage-map.md` (section 5) and the review
  README ("Integration dependencies", "Remaining gates").
- `PERF.md`: keep both entries.

### Step 8. Images (about 0.5 d; needs live HWiNFO, not the Stream Deck app)

- `capture-pi` (`settings-panel.png`, `pi-live-*.png`).
- `capture-pi-reading-colors`, plus provenance.
- `docs-site-shots`.
- The renderer boards from Step 2.
- All from scripts, never by hand (AGENTS.md: real output, not mockups).

### Step 9. Gates, in order (about 0.5 d wall time)

1. `npm run lint` (zero warnings) and `npm run typecheck`.
2. `npm test`. Expect 1.7's count, plus F01's pi-model and pi-preview, plus
   the ports, plus panel-folds. The provenance, compat, dial-sensor-colors and
   alias-contract suites must all be green.
3. `npm run test:native`: the count is unchanged from 1.7.
4. `npm run build`, then check the mtime of `bin/plugin.js`. suite:full now
   refuses a stale bundle, but check anyway.
5. `npm run e2e`, `e2e:pi`, `e2e:pi-panels`, `e2e:reading-links`,
   `e2e:drilldown`, `e2e:gadget`, `e2e:gadget-raw`, `e2e:resilience`,
   `e2e:dead-fallback`, `e2e:native-edge`, `e2e:socket-close` and
   `e2e:load`.
6. `npm run suite:full`: ALL GREEN, zero orphans. This includes `e2e:pi-panels`
   and the PI capture.
7. `npm run pack`, then `pack:validate`: the four new panel scripts are in
   the contract, and there is no `state/` drift.
8. `npm run release:validate` (qualify.mjs) from a clean clone (it needs the
   private docs, MSVC and the Elgato CLI).
9. CI: lint, typecheck, unit, build, native, and the ABI matrix (20/22/24).
   Provenance must be green now, not "red by design".

### Step 10. Review evidence re-run (about 1 d)

- `pi-lab` captures: 64 states for the base and 64 for the candidate, at 320
  and 480 px, with 0 page errors and 0 px overflow.
- axe: 0 violations. Own traversal: 0.
- Picker perf at 5,000 readings, and the task walkthrough. The walkthrough is
  optional, but it should be reported if the numbers move.
- Bundle reproducibility (build twice, same hash).
- Two independent read-only reviews, focused on the 1.7 features inside the
  new shell:
  - settings, protocol and compatibility, plus the lossless-versus-projection
    tile model;
  - UX, accessibility and copy truth, per section 5 rows 13 to 16.

### Step 11. Hardware bench re-run (owner-attended; about 1 d; no e2e during any soak)

- A5: install over 1.7.0.0. No stored setting changes before a panel opens.
- B2.3 faces with D2 on 1.7 renderers: dual, triple and single dial change
  only by the gap; overview and two-row do not change. Use a canvas capture,
  and a photo if you can.
- B2.6: typed text flush, 10 of 10.
- B3.1: zero writes on open across fixtures that carry `readingColors`,
  `sensorValueColors`, groups and a global `readingLinks`.
- B3.2 and B3.3: each control writes only its declared field, including the
  new 1.7 controls.
- B3.4: two-click Replace.
- B4.1 unavailable, B4.3 missing, and stale on Gadget ("Age unknown"), if you
  can produce it.
- Linked-reading leg: switch between Shared Memory and Gadget with an
  explicit link. The panel should name, tick and color the live row.
- Reading-color wells in the real QtWebEngine: an echo must not close the
  native picker, and Auto must work.
- A help link opens the browser.
- B6.1 axe, B6.2 UIA names, B6.3 keyboard (Escape never arrives), B7.1
  picker at 543 readings.
- Re-check D9 (should improve), D10 (should improve with 1.7's copy) and D11
  (should be closed by bd954c4).
- A physical + XL finger pass on the dials.

### Step 12. PR mechanics and release (all yours)

- Push `claude/f01-on-1.7`. Open a draft PR based on `codex/release-1.7.0`,
  or on #36's branch if #36 has not yet merged into 1.7.
- Keep #38's branch intact as the main-based review record, and close #38 as
  superseded when the new PR is ready. Do not force-push over it.
- When #33 merges:
  - Rebase onto main.
  - Prove that only the base moved with
    `git range-diff <oldbase>..claude/f01-on-1.7 <newmain>..<rebased>`.
  - Retarget to main.
- At release:
  - Bump the four files together: `package.json` 1.8.0, manifest
    `1.8.0.0`, the CHANGELOG heading, and the lock via
    `npm install --package-lock-only`.
  - Run `npm run changelog:page`.
  - Set the token to `1.8.0.0-1`.
  - Soak per the runbook. The renderer and protocol bytes differ from 1.7's
    soaked bytes.
  - Tag and publish as usual.

## 8. Effort

| Step | Work | Days |
| --- | --- | --- |
| 0 | Freeze and commit the bench fixes; re-measure | 0.25 |
| 1 | Base and branch | 0.1 |
| 2 | Renderer commit, normalizers, boards | 0.75 |
| 3 | Plugin source and pack contract | 0.5 |
| 4 | Panel port (HTML, CSS, shell, model, pi-common) | 2.5 |
| 5 | Test and evidence ports (alias contract 1.0, persistence 1.0, panels, sim and capture 0.5) | 2.5 |
| 6 | #36 alignment | 0.25 |
| 7 | Docs, README, CHANGELOG, coverage map | 1.0 |
| 8 | Image regeneration | 0.5 |
| 9 | Gates | 0.5 |
| 10 | Review evidence and two reviews | 1.0 |
| 11 | Hardware bench (owner-attended) | 1.0 |
| **Total** | | **about 11 (range 8 to 14)** |

## 9. Risks and mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| **1** | **Auto-merge loses meaning in `pi-common.js`.** 46 of 71 1.7 hunks merge silently into F01's restructured code. Examples: the linked-duplicate projection against F01's raw/base lossless tiles, and a missing `automaticColors` in `KNOWN`, so a 1.7-written tile never prunes or a chosen hue loses its exact-render flag | Port the alias contract first and run it. Add explicit tests for tiles with `automaticColors` plus unknown fields plus a projected duplicate. Audit the auto-merged hunks against the 4.3 list |
| **2** | **Evidence harnesses broken or quietly weakened:** the alias contract cannot load, persistence legs target the old DOM, the capture provenance fails by design | Port 1:1 with a written old-to-new ledger. No deleted legs without a reason. Keep 1.7's element IDs for 1.7 features |
| **3** | **Copy that is no longer true** in F01's hardcoded shell and help strings: stale copy, Gadget statistics, threshold units for bytes and rates, "accents never color numbers", graph domains. The copy validator checks wording, not truth | Section 5 rows 13 to 16 as a checklist. Source status text from the plugin. A copy-truth review in Step 10 |
| **4** | **Renderer bytes drift under D2 on 1.7** (21 single-dial baselines, detail faces, legacy faces, boards), and re-baselining could hide an unintended change | One site-counted gap transform inside 1.7's existing normalizers. Historical hashes untouched. Overview and two-row boards must stay byte-identical |
| **5** | **Moving base and shared state:** 1.7 moved after the freeze (acce981), #36 and #34 are pending, the bench set is still changing, and rerere's cache is shared across worktrees | Never commit to `codex/release-1.7.0`. Freeze the bench set first (Step 0). `range-diff` before retarget. Disable rerere or check each auto-resolution |
| 6 | The pack contract lacks the four new panel scripts, and the fold store writes into the plugin folder (staging drift; installed tree no longer matches the pack) | Step 3. Prefer a store outside the plugin folder |
| 7 | D7 dedupe starves `e2e-reading-links` or persistence waits that expect a preview on every tick | Run both suites. Use a `getPreview` nudge in the harness if needed, not a plugin rollback |
| 8 | 1.7's owned-process hygiene flags F01's Chrome launcher (`lib/cdp.mjs`) | suite:full zero orphans. Adopt `process-ownership` helpers if flagged |
| 9 | The dual pinned-badge move is a visible face change that users did not ask for | Call it out in the CHANGELOG and docs, and show it on the bench |
| 10 | The docs history question (whats-new-1.7 image) | Decide in Step 7 |
| 11 | The soak: F01 changes plugin bytes (renderers, protocol, actions, a fold store), so 1.7's soak does not cover them | A soak per the runbook before the 1.8.0 tag |

## 10. Is it worth it?

**Yes, with this method and this timing.**

What F01 brings that 1.7's panels lack:

- **Data safety:**
  - D1: text typed just before switching keys is lost on main. The same sdpi
    fields are in 1.7. This was not bench-tested on 1.7.
  - Lossless writes of unknown or junk entries.
- **Accessibility:** axe went from 681 violating nodes on main to 0, own
  traversal issues from 1,879 to 0, and 320 px overflow from 24 px to 0.
- **Truthful state and preview:** the header shows the exact device face.
- **A renderer fix** that every 1.x face needs (D2).

What it costs:

- A port of about 11 days, which is well below a redesign or rewrite on 1.7.
  It is also far below disturbing the qualified 1.7 artifact under option
  (d).

Honest caveats:

- F01's gains are truthfulness, accessibility and safety, not fewer steps.
  Its own walkthrough shows some tasks got longer: decimals went from 6 to 8
  steps, rotation membership from 2 to 6, press behavior from 7 to 15.
- The combined result needs its own soak and bench before it can ship.

If you do not want F01 yet:

- The renderer commit (Step 2) is worth shipping on its own as 1.7.1.
- D1 would need a separate flush for the sdpi text fields in 1.7's panels.
  That is a smaller but real job.

## Appendix: how these numbers were produced

- `git merge-tree --write-tree --name-only 34dd1fc acce981` (and against
  2d10b19). Hunk counts are the number of `<<<<<<<` markers per file in the
  written tree. Line counts are the lines inside markers.
- Bench snapshot: `git diff --binary` from the bench worktree, applied in a
  throwaway worktree (`<zz-rebase-trial worktree>`, detached at
  eef1e14). It was stored as an **unreferenced** commit eebf510 (dangling;
  gc will prune it) and merge-treed against acce981 and 2d10b19.
- Commit replay: `git merge-tree --merge-base=C^ acce981 C` for each of the 14
  F01 commits.
- Renderer slice: `git apply --3way` of the bench renderer and test diff onto
  2d10b19 in the throwaway worktree.
  - This recorded three rerere **preimages** (no resolutions) in the shared
    `.git/rr-cache` (8fe9f10…, 37a3272…, c825831…). I deleted them straight
    away.
  - The throwaway worktree was removed with `git worktree remove --force`.
  - No branch was created, nothing was pushed, and origin was not touched.
- The bench worktree was only read. It changed during the analysis because
  another session is working there.

## Addendum: decisions settled after the analysis (2026-09-23, bench session)

- **Fold memory needs no plugin file and no pack-contract change.** The
  bench build briefly kept a durable copy in `<plugin>/state/panel-folds.json`
  (the analysis above counted it). Once the header gained Open all and Fold
  all, the owner and I dropped it: the panel keeps the folds in its own
  webview storage while the app runs, and a restart shows the defaults, one
  press away from everything open. `src/panel-folds.ts`, its test, the
  `getPanelFolds`/`setPanelFolds` messages and the `state/` gitignore entry
  are gone, so section 4.4 item 1's `state/` note and Step 3's fold-store
  bullet no longer apply; the four new panel scripts still need adding to
  `SHIPPED_MEMBERS`. `bin/plugin.js` is back to the bytes suite:full passed
  on (4808487d).
- **D11 is fixed on the bench build too** (`pi-common.js` refills only an
  untouched configuration well), which converges with 1.7's bd954c4; take
  1.7's version in the merge.
