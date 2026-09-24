# F01 bench validation, 2026-09-23 (Windows, real Stream Deck app, live HWiNFO)

Candidate under test: `claude/sweet-shannon-lss3s9`, commit `34dd1fc`
(tree `77825f707ecdacc3dae580fc9c82895ad6ae13bd`, verified), branch head
`eef1e14` (review docs only on top). The bench found defects, and the owner
asked for them fixed in the same session, so this folder records two builds:

| Build | plugin.js SHA-256 | Where it ran |
| --- | --- | --- |
| Candidate as submitted | `8bc22197a646865ad71c394b6e743a86f84dc2b795762306d9cd4f7294863dc3` | every A and B leg up to the first fix |
| Candidate plus bench fixes (committed on the branch after this run; see `../../candidate.md`) | `4808487da695297e8e02d984b59a7786ad646e0578d172ae24e71a86f006ba95` | installed on the deck at the end |

`hwsm.node` in both: `be3527d829d84efc54473c235c35a0454272b3d32f3d36c825369e1cbd3f2453`
(built here from main's unchanged native source). Panel cache token went
`1.6.0.0-f01` to `1.6.0.0-f01l` as the panel files changed; the owner's
design pass (below) changed panel files only, so `plugin.js` is the same
`4808487d...` that suite:full passed on.

What this folder holds: the report, the bench tools, face and panel
captures, JSON evidence, and `gates.md`, which quotes the result lines of
every gate log. Three raw records stay on the bench machine: the logs
themselves (the repository ignores `*.log`), the WebSocket recording
(`logs/ws-watch.jsonl`, 26 MB) and the settings snapshots of the owner's
live profiles (`snaps/`); the verdicts that cite them quote the numbers.

## Environment

| Item | Value |
| --- | --- |
| Windows | 10 IoT Enterprise LTSC 2021, build 19044 |
| Display | primary 5120x2160 at 150 % (panel DPR 1.5); second 5760x2400 |
| Stream Deck app | 7.4.2.22730 (Qt 6.9.3), developer mode on (CDP port 23654) |
| Panel engine | `QtWebEngine/6.9.3 Chrome/130.0.0.0` (from `navigator.userAgent`, `b1.1-features-K1.json`) |
| Face engine (keys, dials) | QtSvg, SVG Tiny (ignores `dx` on `tspan`, trims chunk-edge whitespace by default; proven below) |
| Devices | Stream Deck + XL (20GBX9901, 9x4 keys, 6 dials); two 5x3 decks (20GBL9901, 20GBA9901); three Virtual Stream Decks. Firmware not recorded |
| HWiNFO | 8.48-5990, Shared Memory on, 25 sensors / 543 readings (`probe-live.json`); Gadget registry key absent; runs elevated |
| Node | build and tests: 24.16.0; plugin runtime: the app's 20.20.0 |
| NVDA, Accessibility Insights | not installed (screen-reader legs NOT RUN) |
| Soak | a 1.7.0.0 soak was running (monitor pid 89584); the owner authorized stopping it; stopped 18:23 local after 44.2 h, summary next to its CSV |

Instruments (all in `tools/`): `rpi.mjs` (CDP attach and a WebSocket frame
recorder, `logs/ws-watch.jsonl`), `probe.mjs` (the `pi-lab.mjs` probes ported
to the real webview), `snap.mjs` (per-action settings from every ProfilesV3
page plus the global value), `observe*.mjs`, `declared.mjs`,
`b26-*.mjs`, `sample-states.mjs`, `grab.ps1` (native-resolution capture of the
app canvas, which QtSvg draws at device resolution), `deploy.ps1`,
`restore-1.7.ps1`.

## Verdict ledger

| ID | Verdict | Evidence | Observed |
| --- | --- | --- | --- |
| A1 | CONFIRMED | git; `candidate.md` | Tree matches. `core.autocrlf=true` is overridden by `.gitattributes` `eol=lf`, so bytes match |
| A2 | CONFIRMED (after harness fixes) | `gates.md` | lint 0, typecheck 0, unit 789/789, native 69/69, validate-native OK, suite:full ALL GREEN zero orphans with live HWiNFO present. `e2e:pi-panels` was not in suite:full (H1) and failed 2/164 here (H2). Final build: unit 791/791, native 69/69, e2e:pi-panels 177/177 inside suite:full, suite:full ALL GREEN zero orphans. After the owner's design pass (panel files only, token f01l): unit 791/791, e2e:pi-panels 184/184, e2e:pi 551/551, e2e all passed (`gates.md`) |
| A3 | CONFIRMED | `logs/build-*.log` | plugin.js built twice: `8bc22197...` both times, identical to the Linux/Node 22 hash. Pack: NOT RUN for the submitted candidate |
| A4 | PARTIAL (deviation) | `fixtures/`, `snaps/` | Baseline was the 1.7.0.0 already on the deck, not a 1.6.0.0 reinstall. Fixtures generated as a profile (`fixtures/FIXTURES.md`, 24 keys, 6 dials) and imported through the app |
| A5 | CONFIRMED | `snaps/01-pre-deploy`, `02-before-observe` | Installing the candidate over 1.7.0.0 changed no stored setting before a panel opened |
| B1.1 | CONFIRMED | `b1.1-features-K1.json` | Every listed feature works in QtWebEngine 6.9.3 |
| B1.2 | PARTIAL | `b1.2-layout-K1-default.json` | 378x410 CSS px at DPR 1.5, no horizontal overflow. At this size the header never pins (410 < 560). Other scalings and High Contrast NOT RUN (system settings) |
| B1.3 | REFUTED (lab assumption) | `logs/ws-watch.jsonl`, focus logs | OS-level Tab and Shift+Tab reach the panel. **Escape never does** (no keydown, no keyup). At renderer level Tab wraps inside the page |
| B1.4 | NOT RUN | none | Would overwrite the owner's clipboard, which this session cannot restore |
| B2.1 | CONFIRMED | `logs/ws-watch.jsonl` | Each selection is a new page and a new registration (116 panel loads). Rapid 10/s switching NOT RUN |
| B2.2 | CONFIRMED | WS analysis | 30 own setSettings, 0 echoed back; 21 plugin-driven didReceiveSettings delivered to open panels |
| B2.3 | REFUTED, then FIXED | `faces/*.png` | Header face is the device SVG byte for byte, but the device engine draws it differently: gaps before units and badges vanish on keys and dials ("59.7°CAVG"). Fixed in the renderer (D2); after the fix both engines draw the same gaps. Physical photos NOT RUN (canvas captures used) |
| B2.4 | NOT RUN | none | CPU sampler ready (`tools/cpu-sample.ps1`). Preview traffic was measured instead: 4/s before D7, 1/s after |
| B2.5 | CONFIRMED (by case) | `logs/b25-*`, screenshots | Plugin **hung** (suspended): "The plugin is not responding" after about 3 s, back to Live by itself when resumed. Plugin **stopped**: the app closes the panel, so the in-panel state never shows, and nothing is written |
| B2.6 | REFUTED, then FIXED | `b26-rounds.json`, `b26-real-rounds.json`, `snaps/16..19` | Text typed within 200 ms of selecting another key: **0 of 20 saved** (pagehide flush never lands). After D1 fix, real mouse and keyboard, click 46 to 63 ms after the last key: **10 of 10 saved to the right key**, nothing on the next |
| B3.1 | CONFIRMED | `observe/*.json`, `snaps/02..03` | 30 fixtures: sections open, picker browsed, hovered, scrolled, 10 to 60 s. 0 panel writes, 0 setSettings or setGlobalSettings frames |
| B3.2 | CONFIRMED | `declared/*.json`, `snaps/06..09` | K1: 10/10 controls changed exactly their own field, confirmed on disk. 6/6 shared controls clean. My restore of the shared values was wrong at first (see Incidents) |
| B3.3 | CONFIRMED | `snaps/12..15` | J1 and D4: unrelated edits changed only their fields. Non-string list entries, non-object tiles and groups, unknown fields, extra colors, `"hex"`, `"neon"`, `"15000"` and `"false"` all survive in place. The panel says "kept" (select) or names the unknown theme in words |
| B3.4 | CONFIRMED | WS log | One click arms and writes nothing; the arm expires within 6 s; two clicks write exactly once |
| B3.5 | NOT RUN | none | Restore to 1.7.0.0 is scripted but not exercised |
| B3.6 | NOT RUN | none | |
| B4.1 | CONFIRMED with findings | `states/B4.1-*.json`, `shots/B4.1-*` | Forced Gadget source (key absent): "No HWiNFO data", face "Start HWiNFO", Retry and setup buttons, one announcement. Findings D9 and D10 |
| B4.2 | NOT RUN on hardware | none | HWiNFO runs elevated; this shell cannot suspend it. Covered by e2e:resilience on the fake source |
| B4.3 | CONFIRMED | `observe/K16.json`, `D5.json` | "Saved reading not found", face "Sensor missing", label kept |
| B4.4 to B4.8 | NOT RUN | none | B4.7 could not be produced: an elevated HWiNFO and an unelevated app read fine here |
| B4.9 | PARTIAL | canvas | Negative (-11.97 V) renders; an exact zero was not produced |
| B4.10 | CONFIRMED | `observe/D5.json` | |
| B5 | PARTIAL | canvas | Alert-below warn is live (pump 1762 < 1800); °F thresholds in °F do not fire at 148 °F. The rest NOT RUN |
| B6.1 | CONFIRMED (one fixture) | `a11y/K1-*.json` | axe-core 4.13.0 in the real panel: 0 violations, 0 own issues, folded and open |
| B6.2 | CONFIRMED (UIA) | `a11y/uia-first.json` | 47 UIA elements, 0 focusable without a name. Two buttons both named "Copy" (fixed, D8) |
| B6.3 | PARTIAL | focus/key logs, WS | Arrows browse without writing; Tab closes and writes nothing; Escape does not reach the panel (D5). NVDA NOT RUN |
| B6.4 to B6.7 | NOT RUN | none | No NVDA |
| B7.1 | CONFIRMED | `perf/picker-real-webview.json` | 543 readings: p50 16.8 ms, p95 53.4 ms, max 60.3 ms, every row rendered, open at most 47 ms. Saved reading in view on every realistic open (`tools/reopen-probe.mjs`); missed twice only after the perf probe's synthetic events (INCONCLUSIVE) |
| B7.2 | NOT RUN on hardware | lab only | Headless Chrome on Windows after H2: 5,000 options 34 ms after focus, deep reading selected and in view |
| B7.3 | NOT RUN | none | |
| B8.1 | REFUTED, then FIXED | docs diff | Stale labels "Direction → Alert when value drops below thresholds" (faq, troubleshooting), the Escape promise, and the dual badge description |
| B8.2 | NOT RUN | none | Needs the owner's OK |
| B9 | NOT RUN | none | Detail views need physical presses. The plugin restarted cleanly on each of 7 deploys |

## Defects, most severe first

Fixed ones are uncommitted in this worktree; every fix has a unit or e2e
check that fails without it.

1. **D1: text typed just before selecting another key is lost** (High,
   data loss). Repro: type a label, click another key within 200 ms.
   Expected: saved to the first key. Actual: 0 of 20 saved. Cause: the app
   tears the page down and the `pagehide` save never lands. Also on main
   (sdpi's 200 ms debounce, no flush). Fix: `pi-shell.js` flushes pending
   text on pointer leave and window blur, never mid-IME. After: 10/10.
   e2e: "text typed just before the pointer leaves is saved at once".
2. **D2: the device engine drops unit and badge gaps** (Medium, every
   dual, triple and dial face; pre-existing since 1.x). QtSvg ignores `dx`
   on `tspan` and trims chunk-edge whitespace. Fix: `inlineGap()` puts an
   en space or three-per-em space inside the tspan, and `xml:space="preserve"`
   goes on the text elements that carry one. Proven on the app canvas
   (`faces/*after-fix2*`). Goldens changed only in those bytes (a diff
   proof is in the session record).
3. **D3: an open reading list could not be dismissed from the app**
   (Medium). The app never delivers Escape or its own clicks, and a click on
   the open box did nothing. Fix: a second click on the box toggles it
   closed and window blur closes it. A first version also closed a
   browsing list 350 ms after the pointer left the panel; the owner
   found that closing on a mere hover-out misfires (overshooting the
   edge while browsing), so only a click or a focus change closes it
   now. Known cost: a click on the app's unfocusable grey areas sends
   the panel nothing, so the list stays open until the next click.
   Seven e2e checks.
4. **D4: reopening the list with a click spliced typing into the old name**
   ("CPU [#0]: driveAMD..."). Fix: a click that opens the list selects the
   whole name on mouseup.
5. **D5: the panels and docs promised Escape**, which never arrives. Copy
   now says "Tab or a click elsewhere closes without changing anything".
   Escape handling is kept for hosts that deliver it.
6. **D6: "HWiNFO setup steps" landed on a collapsed section.** `reveal()`
   now opens the target itself and focuses its summary.
7. **D7: a preview went to the open panel every 250 ms tick** even when
   identical (about 4 per second). Now only on change: about 1 per second.
8. **D8: two buttons named "Copy"** for screen readers. They are now "Copy
   this key's settings" (or dial's) and "Copy shared settings".
9. **D9 (open, Low, plugin):** after the data source changes, the plugin
   holds the last values for about 15 s and the panel says "Live · Shared
   Memory" throughout, even though nothing updates and the source is no
   longer Shared Memory.
10. **D10 (open, Low):** with the source forced to Gadget and Gadget off,
    the hint says "HWiNFO is not running" while HWiNFO runs.
11. **D11 (fixed, Low):** a hand-edited configuration draft was
    overwritten when the Advanced fold was closed and opened again. Now
    only an untouched well refills (converges with 1.7's bd954c4).

Harness defects: **H1** `e2e:pi-panels` was not part of suite:full (fixed
in `hygiene.mjs`). **H2** headless Chrome on Windows fires no focus event
for a scripted `focus()`, so the scale checks failed 2/164 (fixed:
`cdp.mjs` enables focus emulation). **H3 (open, pre-existing)**
`hygiene.mjs` force-kills any new process whose command line matches
`com.lawrensen.hwinfo`, so restarting the real installed plugin during
suite:full kills it.

Owner-requested design changes (not defects):

- On a dual key with a pinned second row, each row's MIN, MAX or AVG now
  sits after its own label, so a value never shrinks or shifts on a press.
  The follow mode keeps one badge centered in the divider.
- Sections keep the folds a person chose. Each panel load started from the
  defaults, so every opened section snapped shut on the next key (1.6 had
  Alerts and Press always visible, so this was a regression in effort).
  Now a person's toggle is remembered per panel kind (key, dial, control),
  Alt-click on a section title opens or folds them all, and a script or a
  reveal is never remembered. Never a setting (zero writes), and the
  plugin keeps none of it: the panel's own storage holds it while the
  app runs (the app empties it when the plugin restarts, found live: a
  deploy emptied it). A header pair, Open all and Fold all (chevrons
  apart and together, Azure's pattern, one toolbar Tab stop), does what
  Alt-click does for anyone who never finds Alt-click. A durable
  plugin-side copy was built and then removed on the owner's call once
  the pair existed: a restart shows the defaults, one press from
  everything open. The pair was used in the real app on build f01j at
  22:28 (the then-durable copy recorded every key section open). Basis:
  NN/g ("Items that are opened or closed should remain in that state until
  the user changes it"), GOV.UK's accordion (remembers open sections by
  default), Blender's modifier-click on panel headers, Azure's expand
  and collapse all. e2e: 11 fold checks, including "toggling a section
  sends the plugin nothing".
- The picker list no longer closes when the pointer only leaves the
  panel (overshooting the edge while browsing closed it); a click, focus
  loss, Tab or a second click on the box closes it.
- The dial panel is shorter and shows its rotation first. The touchscreen
  face sits beside the dial's name at the app's panel width (373 CSS px
  with the scrollbar), so the header is about as tall as the face; the
  Reading section runs On the dial now, the rotation chips with the live
  "on dial" mark, the search that adds readings, then the title fields.
  Keyboard instructions under the pickers are read to screen readers but
  take no line. The dial panel is 1,277 px tall at 380 px against 1.6's
  1,374. Cost: the add-readings search is 25 Tab stops in on the
  three-reading fixture (6 before, 2 on 1.6), because each chip's move
  and remove buttons come first; one roving Tab stop for the chip list
  would fix it.

Observations outside this PR: an auto-cycling dial persists `readingKey`
on every step, so its page manifest is rewritten every few seconds with no
panel open (1.7.0.0 and this build); auto cycle clears a custom dial title
under "Title after a turn: Clears"; the plugin's global-settings registry
value changes bytes on every save (encrypted), so global settings can be
compared only by content.

## Lab assumptions the real app contradicts

- Escape reaches the panel. It does not, in any form.
- A click outside the list reaches the page. Clicks on the app's own
  disabled or unfocusable areas produce no event at all.
- `pagehide` can still send a save. It cannot.
- The header face (Chromium) looks like the device (QtSvg). It did not for
  inline gaps until D2.
- The panel is tall enough to pin its header. At the default window size
  it is 410 CSS px, so it never pins.
- Tab eventually leaves the page. Inside the app's webview it wraps.
- Held: a panel reloads per selection, the app never echoes the panel's own
  writes, and plugin writes arrive as didReceiveSettings.

## Incidents during the run

- While testing shared controls, my restore step repeated the change
  instead of reversing it: shared theme, text color, data source and read
  interval went one step further for about 20 s (every key showed
  "HWiNFO unavailable" for about 6 s while the source was Gadget). Restored
  at once to the exact values, and later to the exact original three-key
  document through the panel's own Replace.
- K3 and K5 swapped cells at 18:46 through an app-side drag while the
  observation loop ran (not a panel write; settings moved intact).
- The first two deploys hit a transient lock on `hwsm.node`; `deploy.ps1`
  now skips identical members and retries.
- About 20:00 local one scripted click meant for the Stream Deck canvas
  landed on another application's window the owner had in front of the app (the app
  window was behind it). OS-level clicking stopped there; the fold memory
  was verified in e2e and its storage on the real app, not by a live
  toggle.

## Updates to acceptance-ledger.md (applied)

```diff
-| 8 | Truthful states ... | PARTIAL | Simulated-host fixtures for each state ...
+| 8 | Truthful states ... | PARTIAL | Bench 2026-09-23: unavailable, missing and hung-plugin states true on the real app; stale NOT RUN on hardware (HWiNFO elevated); open: D9 "Live" during the source-reopen hold, D10 hint wording |
-| 9 | APG combobox ... keyboard complete | MET (simulated host) | ...
+| 9 | APG combobox ... keyboard complete | PARTIAL | The app never delivers Escape; dismissal by Tab, a second click and focus loss instead (bench D3, D5) |
-| 11 | Preview is the production-rendered device face ... | MET | ...
+| 11 | Preview is the production-rendered device face ... | MET after bench D2 | Same bytes, but QtSvg drew gaps differently until inlineGap + xml:space (bench 2026-09-23) |
-| 13 | Race handling and context validation | PARTIAL | ...
+| 13 | Race handling and context validation | MET after bench D1 | pagehide flush never landed (0/20); pointer-leave and blur flush 10/10 on hardware |
-| 14 | Performance ... Embedded-webview timing NOT RUN |
+| 14 | Performance ... | MET | Real webview, 543 readings: p95 53.4 ms, max 60.3 ms, all rows; previews only on change |
-| 24 | Live e2e, native suite, suite:full, physical devices, human study | NOT RUN |
+| 24 | Live e2e, native suite, suite:full, physical devices, human study | PARTIAL | Bench 2026-09-23: suite:full green on Windows with live HWiNFO; real app and XL canvas; NVDA, photos and human study NOT RUN |
```

## Machine state at the end (owner asked to keep the new build on the deck)

- Installed: candidate plus bench fixes and the owner's design pass
  (`plugin.js 4808487d...`, panel token `1.6.0.0-f01l`, manifest 1.6.0.0). The frozen 1.7.0.0 payload is one command away:
  `pwsh tools/restore-1.7.ps1` (hash-verified against the backup).
- Backup of `%APPDATA%\Elgato\StreamDeck` (8,751 files), the Elgato and
  HWiNFO registry keys and `HWiNFO64.INI`:
  `%USERPROFILE%\hwinfo-bench-backup\2026-09-23-1830\`.
- The "F01 Bench" profile is imported and active on the + XL; switch back
  to "HWiNFO Gaming" from the profile menu. Production profiles were never
  edited by the bench (disk diffs show only auto-cycle and key presses).
- Shared settings: the exact original content (`pollIntervalMs: "250"`,
  `theme: "void"`, `typeAccents: "off"`).
- The 1.7 soak is stopped. No bench process is left running (the WebSocket
  recorder was stopped after the final suite).
