# Bench validation prompt: F01 essentials-first panels on real Windows, Stream Deck app and hardware

Paste everything below the line into a fresh session on the Windows bench
machine. It assumes no memory of the work that produced it.

---

You are validating a pull request on real hardware. Your job is to try to
prove it wrong. Every claim below was measured only in headless Chromium
on Linux against a simulated Stream Deck host with sample data. None of
it has run in the Stream Deck app's own webview, against live HWiNFO, on
a physical device, or with a screen reader. Treat every claim as an
unverified assumption until you have first-hand evidence on this
machine.

## 0. Rules (read before touching anything)

**Authorized:** reading the repository; building and running the
candidate on a test profile of this machine; driving the Stream Deck
app, HWiNFO, Windows settings and assistive technology with computer
control (screenshots, mouse, keyboard); attaching Chrome DevTools to the
property inspector; reading app and plugin logs and the settings files
on disk; running the repository's own scripts; writing evidence files
under `review/pi-essentials/bench/<YYYY-MM-DD>/` in your local checkout.

**Needs the owner's explicit OK first:** committing or pushing anything,
commenting on GitHub, installing or uninstalling the plugin on a machine
that runs a soak or a production profile, changing HWiNFO settings on a
machine other than this bench, rebuilding docs screenshots into the
repository.

**Never:** merge, tag, release, publish, submit to the Marketplace,
force-push, change repository rules, secrets or permissions, disable a
security control, interrupt a running soak, kill a Node, HWiNFO or
Stream Deck process you did not start, or edit a production profile. If
the machine turns out to be a soak or production host, stop and report.
Kill only processes you started, identified by PID.

**Evidence standard:**
- Every verdict cites a file you saved in this run (screenshot, DevTools
  export, log excerpt, settings file before and after, hash, recording,
  photo) and the exact versions it ran against.
- Verdicts are CONFIRMED, REFUTED, INCONCLUSIVE or NOT RUN. Absence of
  an error is not confirmation. A claim you could only check on the
  simulated host is NOT RUN on the bench.
- Do not fix code during this pass. Record defects with repro steps,
  severity, and the file and line you suspect.
- Do not weaken a test or regenerate a golden image to make something
  pass.
- Keep the Unicode em dash out of any prose you write into the
  repository (repository rule).

**Safety net before the first change:** back up
`%APPDATA%\Elgato\StreamDeck\` (profiles and plugin data). Export the
HWiNFO settings. Note the currently installed plugin version and its
file hashes. You must be able to put the machine back exactly as you
found it, and you must do so at the end.

## 1. What you are validating

- Repository: `slawrensen/hwinfo-streamdeck` (Windows-only Elgato Stream
  Deck plugin that shows HWiNFO sensor readings on keys and Stream Deck +
  dials). Read `AGENTS.md` first; it is the contributor guide.
- PR: #38, "Unify the Property Inspector and device preview around an
  essentials-first design". Draft. Issue #37.
- Branch `claude/sweet-shannon-lss3s9`, based on `main` at `2ca44e9`
  (release 1.6.0.0).
- The candidate is identified in `review/pi-essentials/candidate.md` by
  commit, tree and file hashes. The branch history was rewritten once
  without changing any tree, so trust the tree hash over any short hash
  quoted elsewhere.
- The claims live in `review/pi-essentials/`:
  - `README.md`: the review record.
  - `coverage-map.md`: one row per setting.
  - `acceptance-ledger.md`
  - `reviews.md`: two code reviews and their dispositions.
  - `human-test-script.md`: a moderated study, NOT RUN.
- In short, the PR:
  - Rebuilt all four property inspector panels (`ui/sensor-reading.html`,
    `sensor-dial.html`, `control.html`, `detail-slot.html`, plus
    `pi-shell.js`, `pi-model.js`, `pi-common.js`, `pi-command.js`,
    `pi-slot.js` and `pi.css`) around one order: header, Reading,
    Display, Alerts, Press or Controls, Advanced.
  - Extended the plugin's preview message: `src/pi-protocol.ts`, the two
    sensor actions, and the new `src/ui/key-layout.ts`.
  - Updated the docs.

Action UUIDs: `com.lawrensen.hwinfo.reading` (Sensor Reading key),
`.dial` (Sensor Dial, Encoder), `.control` (HWiNFO Control key),
`.detail-slot` (tiles of the managed detail profile). The manifest
requires Stream Deck 6.9 or later, SDK 3, Node 20.

## 2. Set up your instruments

Record each version in `bench/<date>/environment.md`:
- Windows build and display scaling.
- Stream Deck app version.
- The property inspector webview's engine: `navigator.userAgent` read
  through DevTools.
- Every connected device: model, firmware, key and dial count.
- HWiNFO version and edition (free vs Pro), Shared Memory and Gadget
  state.
- Node version.
- NVDA version.
- Whether the machine hosts a soak (if it does, stop).

1. **Computer control.** Screenshot the Stream Deck app window before and
   after every step that matters. Name files `<claim-id>-<step>.png`.
2. **DevTools on the real property inspector.** Enable Stream Deck
   developer mode (`streamdeck dev` from the Elgato CLI, or the app's
   documented switch). Open `http://localhost:23654/` in Chrome and
   attach to the open panel. Confirm that port on this app version; if
   it differs, find the documented one. Through the console or the
   Chrome DevTools Protocol you can:
   - read `window.__hwPanel`, the panel's state object, including its
     write counters;
   - watch the WebSocket frames between panel and app (Network,
     WS: every `setSettings`, `setGlobalSettings`, `sendToPlugin` and
     `sendToPropertyInspector`);
   - inject axe-core;
   - measure layout;
   - run the same Tab and Shift+Tab traversal the lab ran.
   `scripts/pi-lab.mjs` shows exactly how the lab probed (functions
   `a11y`, `tasks`, `perf`); port those probes to the real webview
   instead of reimplementing them.
3. **Logs.**
   - Plugin logs: `%APPDATA%\Elgato\StreamDeck\Plugins\com.lawrensen.hwinfo.sdPlugin\logs\`
     (including `trace-<pid>.jsonl`).
   - App logs: `%APPDATA%\Elgato\StreamDeck\logs\`.
   - Tail both during every scenario and save the excerpts.
4. **Settings on disk.**
   - Find where this app version persists action settings: profile
     folders under `%APPDATA%\Elgato\StreamDeck\` (for example
     `ProfilesV2` or a newer name).
   - Find where it persists plugin global settings.
   - Prove each location by making one known change and watching which
     file changes.
   - Before and after every scenario, save the relevant files and their
     SHA-256 (`Get-FileHash`). Byte-level diffs of these files are the
     ground truth for every "zero writes" and "lossless" claim.
5. **HWiNFO as a fault source.** Live HWiNFO for real trees. The
   repository's `scripts/fake-hwinfo.mjs` publishes a real synthetic
   shared-memory mapping and takes stdin commands:
   - `alive`, `freeze`, `dead` (disabled sensor data);
   - `hold` / `release` (holds the consistency mutex);
   - `grow`, `cores`, `fahrenheit`, `exit`.

   `scripts/soak-adversary.mjs` injects timed faults against the live
   stack. Use them only on this bench.
6. **Repository harnesses.**
   - Run: `npm ci`, `npm run build:native`, `npm run build`, `npm test`,
     `npm run test:native`, `npm run e2e`, `npm run e2e:resilience`,
     `npm run e2e:gadget`, `npm run e2e:pi`, `npm run e2e:pi-panels`,
     `npm run suite:full`, and `node scripts/validate-native.mjs`.
   - `npm run probe` smoke-tests the reader against live HWiNFO.
   - `scripts/pi-harness.mjs` plus `scripts/capture-pi.mjs` produce the
     docs screenshots against the real plugin.
   - `npm run watch` and `streamdeck link` restart or install the
     plugin, so run them only on this bench and never on a protected
     host.
7. **Assistive technology.**
   - NVDA with Speech Viewer on, and its log at debug level, saved per
     scenario.
   - Windows Narrator for a spot check.
   - Accessibility Insights for Windows (or Inspect) for the UI
     Automation tree of the embedded webview.
   - Windows display scaling at 100, 150 and 200 percent.
   - High Contrast (forced colors).
8. **The physical device.** Photograph or film the keys and touchscreens
   (phone or webcam, fixed position, no glare) at every face comparison.
   Also screenshot the app's own canvas, which mirrors what the plugin
   sent. When they disagree, the device wins.

## 3. Phase A: build and identify

A1. Check out the PR branch.
- Verify the tree hash against `candidate.md`.
- Set `core.autocrlf` so line endings match the repository; if hashes
  differ, explain why before going on.

A2. Run the harness list in section 2 step 6 and save every log.
- `test:native` and the build already pass in CI on a Windows runner
  without HWiNFO. Here they must also pass with live HWiNFO present.
- For every failure, first decide whether it is this PR's or reproduces
  on `main`: check out `2ca44e9` in a separate worktree and run the
  same command.

A3. Rebuild `bin/plugin.js` twice.
- Compare the SHA-256 with `candidate.md`. The recorded hash came from
  Node 22 on Linux; a different Node or line ending can change it.
  Record the hash and say why.
- Pack with the Elgato CLI (`npm run pack`) and hash the
  `.streamDeckPlugin`. The pack has never been built for this candidate.

A4. Baseline on 1.6.0.0.
- Install the released 1.6.0.0 build on a dedicated test profile.
- Build these fixtures on it:
  - a single key, and a dual, a triple and a quad key with per-cell
    colors and labels;
  - a key whose press opens details with a custom list and a hand-made
    tile plan;
  - a key that follows the shared theme and one with its own;
  - a key with a custom text color;
  - a key with thresholds (and one with "alert below");
  - a dial with a three-reading rotation set, named readings and two
    rotation groups;
  - a dial on the Elite preset and one on Custom;
  - a Control key targeting a Link ID;
  - a detail view opened once on each supported device.
- Save the settings files and their hashes, and screenshot every panel
  and every face. This is your "before".

A5. Upgrade to the candidate on the same profile.
- Record the settings files again **before opening any panel**.

## 4. Phase B: adversarial claim checks

Each item has an ID. For each one: do the step, do the adversarial
variant, save the evidence, write the verdict.

### B1. The real webview can run this code

B1.1: Record the engine version, then prove each feature works in the
real panel from the DevTools console:
- `ResizeObserver`
- CSS `content-visibility` and `contain-intrinsic-size`
- CSS `aspect-ratio`
- `:is()`
- `Element.toggleAttribute`
- `DOMParser` with `image/svg+xml`
- `CSS.escape`
- `navigator.clipboard.writeText`
- `pagehide`
- document-level capture listeners that fire before target listeners

Any missing feature is a defect. Name what breaks.

B1.2: Measure the real panel viewport: width and height of the
property-inspector area at each display scaling and each app window
size you can set.
- The design assumed about 320 to 480 CSS px wide.
- The header pins only when the panel is at least 560 px tall and the
  header takes less than a third of it.
- Does pinning ever happen in the real app?
- Is the pinned header ever taller than a third of the panel?
- Does anything overflow horizontally at any real size?

B1.3: Keyboard reach inside the app.
- Do Tab, Shift+Tab, Escape, the arrow keys, Home, End and Enter reach
  the panel, or does the app take any of them (for example Escape
  closing something, Tab leaving the webview)?
- Is focus visible at every stop?

B1.4: Copy support report and Copy configuration.
- Does the clipboard write succeed in the real webview? Paste into
  Notepad to prove it.
- If it fails, is the failure message honest?

### B2. Protocol and lifecycle

B2.1: Panel lifecycle.
- Selecting another key of the same action: does the app reload the
  panel page (a new registration), or reuse it? Prove it with DevTools
  (the page reloads) and the WebSocket log.
- The code's context guard and timers assume a reload.
- Adversarial: switch between two keys of the same action ten times a
  second for five seconds. Then verify that the panel shows the right
  key, and that no write landed on the wrong key (settings files).

B2.2: Echo rules.
- The code assumes the app does not echo the panel's own `setSettings`
  back, and does deliver `didReceiveSettings` when the plugin writes.
  Prove both from the WebSocket log.
- Adversarial: turn a dial while its panel is open (the plugin writes
  `readingKey`), and edit a threshold at the same moment (the plugin
  stamps `alertUnit`).
- Is anything lost? Compare against the settings file.

B2.3: The header face is the device image.
- The plugin sends the exact SVG it last sent to the device (`setImage`
  on keys, feedback on dials), only when it changed and only to the
  visible panel.
- For every fixture in A4, compare three things at the same moment:
  - the header image (save `img.src`),
  - the app canvas,
  - the physical key or touchscreen (photo).
- Adversarial: during a warn or critical alert, a stat cycle, a theme
  change from another panel, an HWiNFO stall, and a device unplug and
  replug.

B2.4: No work while closed.
- With no panel open, the plugin must build no preview. Show that from
  the plugin log or trace, and from plugin process CPU sampled for 10
  minutes with the panel closed versus open (sample from outside the
  process, as `scripts/soak-monitor.mjs` does).

B2.5: Plugin restart with the panel open.
- Restart the plugin (`streamdeck restart com.lawrensen.hwinfo`, on
  this bench only).
- Does the panel say "The plugin is not responding" after about 3
  seconds, and recover by itself when the plugin is back?
- Does anything get written while it is disconnected?

B2.6: A text edit typed less than 200 ms before switching to another
key is saved to the key it was typed on (pagehide flush), never to the
next key. Repeat 20 times.

### B3. Settings are never lost

B3.1: Zero writes on observation.
- For every fixture: open the panel, expand every section, open and
  browse every picker with arrows, press Escape, hover, scroll, wait 60
  seconds, then switch away.
- The settings files must be byte-identical (SHA-256), and the
  WebSocket log must show no `setSettings` or `setGlobalSettings`.
- Adversarial: HWiNFO stopped, stale, or missing a sensor during the
  observation.

B3.2: Declared paths only.
- For each control in `coverage-map.md`, change it once.
- Diff the settings file: exactly the declared key changes, and every
  other byte of the document is identical.
- Include the global settings for the Advanced controls.

B3.3: Future and junk data survive.
- Use Advanced, Configuration documents, Replace (or edit the profile
  file while the app is closed, on the test profile only) to store:
  - unknown top-level fields;
  - unknown fields inside a rotation group and a detail tile;
  - a non-object entry inside `rotationGroups` and `detailTiles`
    (for example `3`, `"marker"`, `{ "size": 6 }`);
  - non-string and blank entries inside `rotationKeys` and
    `detailKeys`, in the middle of the list;
  - junk inside `rotationNames`;
  - extra entries in `quadColors`;
  - an option value no menu offers (`keyLayout: "hex"`,
    `autoCycleMs: "15000"`, `theme: "neon"`);
  - a default-on flag stored as junk (`detailMirrorBack: "false"`).
- Then edit an unrelated control in each area. Everything unrelated
  must survive, at its original position.
- The panel must show unknown options as kept ("not in this list,
  kept"), not silently replace them.

B3.4: Two-click shared Replace.
- One click only arms, for about 5 seconds, and writes nothing. The
  second click writes once.

B3.5: Upgrade and downgrade.
- After A5, do a round of edits on the candidate.
- Reinstall 1.6.0.0 on the same test profile: every key and dial must
  still render and behave.
- Upgrade again: nothing is lost.

B3.6: Recorded residuals, known to exist on main too; try to make each
one bite and report how likely it is in practice:
- a rotation edit is two writes, so it can race a plugin write;
- with fewer than two non-empty groups the panel edits the group and
  rewrites the flat mirror;
- duplicate `detailKeys` are dropped;
- a key stored with a pasted friendly name is written back bare.

### B4. Truthful states with real HWiNFO

For each state, record the header text, the Reading status block, the
picker placeholder, the device face and the NVDA announcement:

| ID | State | How to produce it |
| --- | --- | --- |
| B4.1 | Unavailable | Quit HWiNFO |
| B4.2 | Stale | Close the Sensors window, or `fake-hwinfo freeze` |
| B4.3 | Saved reading missing | Disable the sensor in HWiNFO, or remove the reading from Gadget |
| B4.4 | Shared Memory disabled | Free-version expiry, or `fake-hwinfo dead` |
| B4.5 | Gadget-only source | |
| B4.6 | Gadget with nothing ticked | |
| B4.7 | Access denied | HWiNFO elevated, Stream Deck not |
| B4.8 | Plugin damaged | Rename `bin/hwsm.node` on the bench copy only, then restore it |
| B4.9 | Zero and negative values | |
| B4.10 | Missing reading on a dial | |

Expected in every case:
- Unavailable is never called missing.
- Stale is never "Live".
- The key or dial face and the header agree.
- The Retry now and HWiNFO setup steps buttons work.
- The status region is announced once when the kind of problem changes,
  never every second (NVDA Speech Viewer transcript over 60 seconds of
  stale).
- A focused "Retry now" keeps focus while the stale counter runs.

### B5. The summaries tell the truth

For each section summary, make the device do the thing and compare:
- Alerts:
  - warn and critical fire at or beyond the value (test exactly at the
    threshold, just below it, and with "alert below");
  - thresholds are in the displayed unit, °F included;
  - on a dial, thresholds apply only in the unit that was on screen
    when they were set (rotate to an RPM reading);
  - one field that is not a number is flagged and ignored.
- A Press summary on a device that has a detail view, and on one that
  does not (Stream Deck Mobile or a pedal if available), and with an
  empty filter: does a press do what the summary says?
- Dial Controls summary for Legacy, Elite and Custom presets, with 0, 2
  and 3 touch zones, auto cycle off and on:
  - every gesture listed must do exactly that on hardware;
  - a tap the zones made dead must not be listed.
- Display summary "(shared)" marks: change the shared theme and text
  color from another panel; only keys set to Default follow.
- Reading summary for rotation: a one-reading set, two groups where one
  is empty, and three groups. Compare with what turning the dial
  actually steps through.
- Picking Custom while Elite is shown copies the Elite gestures into
  the unset ones, and the selects show them at once. Replacing the
  document with `controlPreset: "custom"` writes nothing extra
  (settings file diff).

### B6. Keyboard, screen reader, zoom, contrast, in the real app

Run each at 100, 150 and 200 percent scaling, plus High Contrast:
- B6.1: axe-core injected into the real panel, for every fixture and
  every expanded state. Save the JSON. The lab found 0 violations; any
  violation here is a finding.
- B6.2: a Tab and Shift+Tab walk through every stop:
  - each stop has an accessible name (check the UIA tree too);
  - each has a visible focus ring;
  - none is inside a collapsed section;
  - none is fully or partly under the pinned header.
- B6.3: the reading picker with NVDA:
  - arrows announce options without changing the saved reading;
  - Enter commits;
  - Escape restores;
  - Tab commits nothing.

  Verify on disk as well as by ear.
- B6.4: the rotation and detail checklists:
  - one Tab stop;
  - Down Arrow enters and arrows move;
  - each box announces reading, source and value;
  - source groups are announced;
  - two same-named readings (Drive #0 and Drive #1 temperatures) are
    distinguishable by ear.
- B6.5: the theme gallery is one Tab stop, and arrows pick with one
  write each. Reorder buttons are announced by reading name, and focus
  stays on the moved item.
- B6.6: the IME. Type Japanese into a label field with the Microsoft
  IME. Nothing is saved mid-composition, and the committed text is
  saved once.
- B6.7: the header image's alt text reads the words the face draws,
  including status screens ("Not updating", "Start HWiNFO").

### B7. Performance in the real webview

- B7.1: picker filtering on this machine's real HWiNFO tree. Record the
  count of readings, and the p50, p95 and max from input event to next
  frame, measured the way `scripts/pi-lab.mjs perf` does.
- B7.2: the same on a large synthetic tree (thousands of readings) if
  you can produce one on the bench; say how. The target is p95 of 100
  ms or less per query, with no row cap and the saved reading visible
  when the list opens.
- B7.3: first open of each panel, and memory after 30 minutes of the
  panel open with live data (DevTools performance and memory panels).

### B8. Documentation and screenshots

B8.1: Every label named in `docs/*.md` and `README.md` exists in the
real panel with the same wording.

B8.2: With the owner's OK, regenerate the panel screenshots with
`scripts/pi-harness.mjs` and `scripts/capture-pi.mjs` against the real
plugin and live HWiNFO, and update their alt texts to describe the new
images. These are currently stale (they still show the 1.6.0 panel):
- `settings-panel.png`
- `pi-*.png`
- `sensor-picker.png`
- `detail-press-panel.png`
- `detail-custom-tiles-panel.png`

### B9. Nothing else broke

- Detail view on every connected device type, including the Back tile
  and the second Back.
- A Control key driving a dial by Link ID and "every dial".
- Sleep and resume with panels open.
- An HWiNFO restart.
- A Stream Deck app restart.

Run `npm run suite:full` last and confirm zero orphaned processes.

## 5. Report

Write `review/pi-essentials/bench/<date>/report.md` with:
1. Environment and versions (section 2).
2. A verdict ledger: one row per ID above, with the verdict, the
   evidence file paths, and one line on what was observed.
3. Defects, most severe first: title, severity, repro steps,
   expected vs actual, evidence, and the suspected file and line.
4. Assumptions the lab made that the real app contradicts (webview
   version, viewport size, keyboard capture, echo rules, reload
   behavior), even when nothing visibly broke.
5. The proposed updates to `acceptance-ledger.md` rows, as a diff for
   the owner to apply.
6. Confirmation that the machine was restored (settings files and
   plugin version back to their backed-up hashes).

Then stop and wait for the owner. Do not commit, push, comment on the PR
or fix code unless the owner says so.
