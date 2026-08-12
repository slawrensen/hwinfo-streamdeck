# Changelog

One entry per version. Tagged versions are published as GitHub releases; the
Elgato Marketplace listing is a separate track.

## 1.5.1.0 - 2026-08-11

- Sparklines no longer disappear for good after a Poll interval change.
  The poller reset its sample rings by dropping them entirely, and those
  rings are what mark a reading as collected, so a key that was showing a
  sparkline stopped collecting one the moment the interval changed and
  never resumed until the key was reloaded. Bar and Ring keys lost the
  same evidence for their session bounds, and a two-row dial lost its row
  lines. The rings now empty in place: a cadence change still discards
  samples from the old rhythm, but the readings stay subscribed. Starting
  the plugin with a saved non-default interval hit the same path once per
  launch, so a custom interval could cost the first sparkline of every
  session.

## 1.5.0.0 - 2026-08-02

- The plugin could quit on its own about half a minute after every start,
  leaving every key frozen on its last reading until the Stream Deck app
  was closed and reopened. A safety check that exists to clean up after an
  app crash decided the app was gone whenever it could not inspect it,
  which on some machines is always, so it shut the plugin down 30 seconds
  into every session. That check now treats "cannot inspect" as what it
  is, never arms at all on a machine that cannot answer the question,
  waits for two sightings in a row, and asks the app directly before
  quitting: if the app answers, the check stands down for the rest of the
  session. It also logs why, so the next report needs no guesswork. The
  behaviour it protects against is unchanged: when the app really is gone,
  the plugin still exits instead of polling for nobody. This was wrong
  from 1.1.1.0 onwards. (Reported by @zekkragnos in issue #17, who sent
  the log that proved it.)
- "Copy support report" now says "Plugin not responding" if nothing
  answers within three seconds, instead of sitting there disabled. The
  report is built by the plugin, so a plugin that is not running could
  never answer, and the one button meant to diagnose that looked simply
  broken.
- A key or dial no longer keeps a stale picture after the Stream Deck app
  reconnects or the machine wakes. Both skip redrawing when the new face
  is identical to the last one they sent, and they were carrying that
  memory across a replayed appearance, which is exactly when the app's own
  image cache can be cold. A key showing a status screen, or a reading
  that sits on the same number, could stay on the old picture
  indefinitely. The detail view already did this correctly; now the key
  and dial do too, with the end-to-end suite parking both on a sensor
  HWiNFO does not publish, so the face cannot change by itself and the
  repaint is the only thing that can produce a frame.
- Two support paths that were dead ends: the sentence explaining WHY the
  native bridge was rejected went to a console nobody can read, so it now
  travels with the error into the log, and "Access denied" no longer
  insists the cause is always elevation. HWiNFO running as a different
  Windows user produces the identical error, and no amount of
  un-elevating fixes that one.
- An empty `HWINFO_SM2_NAME`, `HWINFO_SM2_MUTEX_NAME` or `HWINFO_VSB_KEY`
  environment variable is now treated as "not set" rather than as an empty
  name, which the native layer rejected and which left the keys stuck on
  "HWiNFO error" until the variable was deleted.
- A plugin whose connection to the Stream Deck app died while keys were on
  screen used to keep running: it went on reading HWiNFO and drawing
  frames into a closed pipe, forever, with nothing in the log. The app is
  now the only thing keeping the plugin alive, so a dead connection ends
  it and the app can start a fresh one. A new test covers exactly that
  case; the existing ones only ever closed the connection after the keys
  had already gone.
- "Not updating" could fail to appear on a machine whose clock stepped
  backwards, which happens on VM resume, on the first time sync after a
  boot with a flat CMOS battery, and on Windows and Linux dual boots that
  disagree about UTC. Elapsed time was measured against the wall clock, so
  a correction of an hour meant an hour in which frozen readings could not
  be reported as frozen. It is measured with a clock that only ever moves
  forwards now.
- A sensor key can act like a folder. The Sensor Reading key's Press
  setting can open a detail view: the deck switches to a bundled
  one-page profile listing a whole group of readings, Previous and Next
  page through a long group, a title tile (every deck but the Mini)
  shows the group and the visible range, and pressing a listed reading
  cycles its current, min, max and avg for that visit. Back returns to the profile and page you
  came from. One profile is installed per deck type, and what it shows
  is decided at press time by the key you pressed, so one key opens a
  CPU breakdown and the next a GPU one. (Requested by @FattSlice in
  issue #5 and shaped by three rounds of his testing.)
- Each key picks its own grouping. Detail contains offers every reading
  of the key's sensor source (the default), a custom list you order by
  hand, or a glob filter matched against source name and label taken
  together: `*4090*` gathers everything that card publishes,
  `*gpu*fan*` just its fans. The panel shows a live match count under
  the field before you ever press, and a filtered page re-resolves
  every poll, so readings that appear or vanish in HWiNFO follow along.
- The way out is an ordinary Sensor Reading key. The view's Back tile
  is a real key: give it a sensor, any of the four layouts, a theme,
  custom text, thresholds and the Show stat, and because the page is an
  editable profile you can move it where you want it. Only its press is
  reserved for returning. Left unconfigured it shows the sensor you
  drilled down from.
- A second Back under your finger, when a key asks for it. Tick "Repeat
  Back under this key's own cell" on an opener and, inside the view, a
  reading cell at the pressed key's position doubles as a second Back:
  tap in, tap out without moving your hand, with the listed readings
  flowing around it. Off by default: the issue #5 testers found one
  movable Back better than two fixed ones.
- Three press behaviors, default unchanged: cycle stats exactly as
  before, open details on press, or tap to cycle with a half-second
  hold opening details. A key that never touches the Press section
  behaves byte for byte as it did in 1.4.
- Detail pages ship for the Mini (3x2), every 15-key (5x3), the Neo
  (4x2), Stream Deck + (4x2 keys), XL (8x4) and + XL (9x4 keys), plus
  the Virtual Stream Deck, which borrows whichever bundled layout fits
  its grid. Decks that cannot host a page (Mobile, Studio, Galleon,
  pedals, G-keys, virtual decks under 3x2) refuse the press with the
  alert cue; everything else about the key keeps working normally. The
  profiles are generated deterministically from one layout table and
  carry no user or sensor data.
- Opening a view starts from black instead of flashing a stale page.
  The Stream Deck app repaints a profile from each key's last cached
  image, so the plugin paints pure black on the way out and the live
  faces paint over black on the way in.
- Hardening from an adversarial review of the navigation: entry cannot
  dispatch twice on a double press, a profile install accepted after
  the prompt expires bounces back out instead of stranding a dead view,
  unplugging a deck mid-view cleans up its session, an orphaned sensor
  no longer groups every other orphan with it, and hostile filter
  patterns (regex metacharacters, emoji, 500-character strings) compile
  safely under a 128-character cap. Repaints coalesce into one pass and
  unchanged polls skip rendering entirely; that skip is gated on a
  provider value revision rather than HWiNFO's one-second poll stamp, so
  an HWiNFO polling period set under a second keeps moving the detail
  tiles (found by an automated review of the merged branch). The same
  review caught the picker's "+ all" button binding to its source by
  display name: two identically named sources resolved to the first;
  the button now binds by position. The detail view rides the existing
  single shared poller; the dense + XL page at the 250 ms poll option is
  measured in PERF.md.
- The detail profile is named "HWiNFO Details". The Stream Deck app
  never updates a profile that is already installed, so the first
  drill-down after upgrading asks once per deck to install it. If you
  tested a preview, remove its detail profiles first, or this one
  installs alongside them as "HWiNFO Details copy".
- Flipping HWiNFO's own unit setting (Fahrenheit, and any other unit it
  rewrites in place) now updates the keys and dials on the next poll.
  The snapshot parser's fast path re-checked only reading identities and
  values, never units, so a mid-session flip left the old unit on screen
  and, with the plugin's "Show temperatures in °F" also on, converted an
  already-converted value: 80 °C became 348.8 °F. The parser now treats a
  unit rewrite like an identity change and rebuilds. The conversion and
  alert-threshold functions gained their first direct tests, and the
  resilience e2e now flips units mid-run against the built plugin.
- Opening HWiNFO's shared memory no longer blocks. The native open path
  waited up to 500 ms, twice, on HWiNFO's consistency mutex while keys and
  dials went unserviced; it now fails fast like the read path always has
  and simply retries on the next poll (native addon 1.1.0).
- A busy HWiNFO no longer shows "Start HWiNFO". Open-time contention used
  to be folded into the not-running screen, telling you to start software
  that was running in front of you. It now has its own transient state:
  the keys say "HWiNFO busy, retrying" and values hold in the meantime.
  In auto mode a busy open retries shared memory on the next poll
  instead of silently switching to the Gadget source and back.
- The pack-version floor is scoped to the release line being packed:
  tags reachable from the commit, not every tag in the repository. Without
  this, tagging v2.0.0 in the future would have silently made every 1.x
  maintenance pack impossible. Covered by a new test suite that builds
  throwaway repositories and proves the floor cases, the release-workflow
  tag exclusion and the fallbacks for repositories git cannot answer.
- An honesty pass over every published claim. Sparkline docs no longer
  promise that history survives any absence (polling stops when no
  Sensor Reading key or Sensor Dial is visible; the docs now say exactly what
  survives and what pauses). The credited original plugin is no longer
  called archived (it changed maintainers and is active again). PERF.md's
  competitor comparison entries from 2026-07-04 were removed rather than
  kept: they named rival builds without versions and their harness was
  never committed, so they could not be verified by anyone, including me.
- Trust a stranger can check: every GitHub Action is pinned to a commit
  SHA (including the third-party release publisher, which runs with write
  permissions), the Elgato CLI install in the release job is pinned to an
  exact version (bumped by hand on purpose; Dependabot keeps the action
  pins and the npm tree current), SECURITY.md documents a
  private disclosure route, and the README, FAQ, install guide and release
  notes now say plainly that `bin/hwsm.node` is unsigned and show the
  one-line PowerShell command to verify it against each release's
  published SHA-256.

## 1.4.93.0 - 2026-07-31

- The second Back is now opt-in (@FattSlice's follow-up on the preview 3
  behavior). By default the tile at the pressed key's position is an
  ordinary listed reading again and the movable top-left Back is the one
  way out; tick "Repeat Back under this key's own cell" in the key's
  Press section to bring the tap-in, tap-out tile back, with the listed
  readings flowing around it. Left off, a page runs its full reading
  stride.
- Fixes from two review passes over the merged drill-down: detail tiles
  keep moving when HWiNFO polls faster than once a second, the picker's
  "+ all" binds its source by position instead of display name, a NaN
  value can no longer freeze the render gate, provider swaps can no
  longer collide revision lines, a busy probe reopen no longer fakes
  fresh data or doubles sparkline samples, leaving a view under a frozen
  tick no longer strands a black surface, and a failed install retry no
  longer eats the prompt's expiry tombstone.
- The settings panel and the docs now show the second Back: the Press
  section screenshot with the checkbox ticked, and a detail page
  rendered with both Back tiles.

## 1.4.92.0 - 2026-07-30

- A drill-down key can now shape its own page, so the one shared
  detail profile behaves like a folder per key (issue #5, shaped by
  @FattSlice's testing). Detail contains picks the list: every reading
  of the key's sensor source (the default), a custom list you build by
  hand, or a new glob filter matched against source name and label
  taken together. `*4090*` gathers everything the card publishes,
  `*gpu*fan*` just its fans; the panel shows a live match count under
  the field before you ever press, and a filtered page re-resolves
  every poll so readings that appear or vanish in HWiNFO follow along.
- The key you pressed is Back under your finger. Inside the view, the
  tile sitting in the pressed key's position shows the return face and
  returns on press, alongside the fixed top-left Back; listed readings
  flow around it.
- Opening a view starts from a black beat instead of a stale flash.
  The Stream Deck app repaints a profile from each key's last cached
  image, so the plugin now paints pure black on the way out and the
  live faces paint over black on the way in.
- A Virtual Stream Deck sized 9x4 or larger now borrows the + XL page:
  32 reading tiles per page instead of the XL page's 28. Its dial bank
  is empty on a virtual deck, and the app installs it cleanly on a
  deck without encoders.
- Hardening from an adversarial review pass: entry cannot dispatch
  twice on a double press, a profile install accepted after the prompt
  expires bounces back out instead of stranding a dead view,
  unplugging a deck mid-view cleans up its session, and hostile filter
  patterns (regex metacharacters, emoji, 500-character strings)
  compile safely under a 128-character cap. Repaints coalesce into one
  pass and unchanged polls skip rendering entirely.
- The updated page ships as profile revision "HWiNFO Details"; the
  numbered names end with this cut. The first drill-down after
  upgrading asks once per deck to install it. Copies from earlier
  previews stay in your profile list until you remove them, and if a
  preview 1 copy still holds the name, the app installs the new one as
  "HWiNFO Details copy".

## 1.4.91.0 - 2026-07-29

- The detail view's Back tile is now a normal Sensor Reading key you
  can configure: pick its sensor, use the single, dual, triple or quad
  layout, themes, custom text, thresholds and the Show stat, exactly
  like any other key. Pressing it is still fixed to returning to the
  profile you came from, and a small return hook stays visible on
  every layout so the way out is never ambiguous. Left unconfigured,
  the tile keeps showing the sensor you drilled down from. (Requested
  by @FattSlice in issue #5.)
- The bundled detail profiles are editable now instead of read-only,
  so you can add your own keys to the detail page and configure the
  Back tile in place. Stream Deck never updates a profile that is
  already installed, so this ships as a second profile revision named
  "HWiNFO Details 2": the first drill-down after upgrading asks once
  to install it, and a copy installed from the previous preview stays
  untouched in your profile list (remove it there if you no longer
  want it).
- Ordinary keys are unaffected: a key without the internal Back marker
  behaves exactly as before, settings are never rewritten, and the
  marker survives every panel edit.

## 1.4.90.0 - 2026-07-29

- A sensor key can act like a folder. The Sensor Reading key's new
  Press setting can open a drill-down detail view: the deck switches
  to a bundled one-page profile listing every reading of that sensor's
  HWiNFO source (or a custom ordered list you build in the panel),
  with the pressed key staying live as the Back tile, top left, where
  the native folder back key sits. Previous and Next page through long
  sources, a title tile shows the source and visible range, and
  pressing a listed reading cycles its current / min / max / avg for
  that visit. Back returns to the profile you came from. (Requested by
  @FattSlice in issue #5.)
- Three press behaviors, default unchanged: cycle stats exactly as
  before, open details on press, or tap-to-cycle with a half-second
  hold opening details. Keys that never touch the Press section
  behave byte-for-byte as they did in 1.4.
- Six read-only detail profiles ship, one per deck type: Mini (3x2),
  15-key (5x3), Neo (4x2), + (4x2 keys), XL (8x4) and + XL (9x4
  keys). The Virtual Stream Deck borrows whichever keypad layout fits
  its user-sized grid (a 10x10 virtual deck runs the XL layout, a 3x2
  one the Mini layout). The Stream Deck app asks to install the
  matching profile the first time details open on a deck; unsupported
  decks (Mobile, Studio, Galleon, pedals, G-keys, virtual decks under
  3x2) refuse the press honestly with the alert cue and keep the
  ordinary key behavior. The profiles are generated deterministically
  from one layout table and carry no user or sensor data.
- The detail view rides the existing single shared poller and dedupes
  identical frames; the dense + XL page (32 live tiles) at the 250 ms
  poll option is measured in PERF.md. HWiNFO stopping mid-view
  degrades the tiles to the ordinary status screens with Back still
  working, and recovery is automatic; a plugin restart inside the view
  renders honest "No detail selected" tiles instead of stale data.

## 1.4.0.0 - 2026-07-25

- Three readings on one key. The key Layout setting gains "Three
  readings, rows": three full-width rows, each with its own sensor,
  label, value and inline unit, split by thin rules. Every row shows
  the same stat and the key press cycles all three together;
  thresholds follow the first sensor and recolor the whole key on
  alert. The third slot is the quad layout's third sensor, so moving a
  key between the three-reading and quad layouts keeps what you
  picked. (Requested by @FattSlice in issue #3.)
- Key labels size themselves to fit. A label now steps down through a
  ladder of sizes until it fits the row instead of being cut at one
  fixed size, measured against per-glyph Segoe UI Semibold advances
  rather than a character count. Names like "Total CPU Usage", "CPU
  CCD1/CCD2 (Tdie)" and "Current DL rate" render whole again. Across
  my own profiles no label came out smaller than it did in 1.3.0.
- The MIN/MAX/AVG stat badge moved from the key corner into a gap
  under the title, the same idiom the two-reading layout already used
  in its divider. A badged label no longer gives up width to a corner
  clip, so "Core2 (CCD1)" with an AVG badge renders whole at 20px
  where it used to cut at 16px.
- The unit on a single-reading key sits on baseline 114 at 18px. A
  sparkline riding its session maximum used to draw over the unit's
  descenders; the spark strip is now inset so its worst-case ink stops
  at the band edge, and the unit clears it. (Measured, see PERF.md.)
- Sparkline history lives for as long as the plugin runs. The
  poller keeps a ring for every reading a key or dial row has asked
  for and feeds it on every fresh snapshot, on screen or not, while a
  Sensor Reading key or Sensor Dial stays visible somewhere, so
  paging back to a key returns its line instead of one that rebuilds
  from scratch. With none visible, polling stops and collection pauses
  until a key returns. Changing the poll interval still clears
  the history, because the ring is spaced by sample, not by clock, and
  a plugin restart still starts the lines fresh on purpose.
- An HWiNFO layout change no longer flashes an error screen. Starting
  a game that adds GPU readings changes the shared-memory layout; the
  poller now reopens the data source at the new size and re-reads it
  within the same tick, so live values never leave the keys. If that
  reopen does not land at once, the last values stay on screen for up
  to 15 seconds before any status screen appears. Access denied,
  disabled and damaged-install still surface immediately.
- I replaced the koffi FFI dependency with hwsm, my own Node-API
  addon built from `native/hwsm` in this repo and covered by the same
  MIT license. The download drops from 583,133 B to 215,672 B. Nothing
  about reading sensors changes for you, with one exception worth
  knowing: hwsm reads HWiNFO's shared memory only while holding
  HWiNFO's consistency mutex, and there is no unguarded read path.
  Earlier versions read without the mutex when it was missing, so on a
  host that publishes the mapping without a mutex this version reports
  HWiNFO as not running and, in auto mode, falls back to Gadget
  reporting.

## 1.3.90.0 - 2026-07-23

- Preview build for the issue #3 testers, published as the GitHub
  pre-release `pre-1.4-issue3-2` only; nothing was submitted to the
  Marketplace. It carries the 1.4 branch as of this date: adaptive
  label sizes, the three-reading key layout, the stat badge under the
  title, the balanced unit corridor, the hwsm native bridge,
  reopen-in-place on HWiNFO layout changes, and sparkline history that
  lives for the plugin lifetime (collected while a Sensor Reading key
  or Sensor Dial is visible).
- Preview builds now version in the 1.3.9x band. The first preview
  reported 1.3.0.0, and Stream Deck keeps the installed copy when a
  plugin file's version is not higher than what is installed, so
  installing that preview over 1.3.0 changed nothing (caught by
  @FattSlice in issue #3). `npm run pack` now refuses any package
  whose manifest version does not clear the newest released tag.

## 1.3.0.0 - 2026-07-16

- A Display select for keys: None, Sparkline (recent history), Bar, or
  Ring. Bar draws a rounded track along the bottom of the key showing
  where the value sits in its range (0 to 100 for percentages,
  otherwise the values seen this session); Ring is an automotive-style
  arc opening downward, sweeping from bottom-left over the crown to
  bottom-right, so a high-is-bad redline lands at the lower right. With
  Warn at or Critical at set, both gauges mark the threshold zones in
  muted amber and red, blended toward the face background so the live
  fill always reads over them, toward the alarmed end (the low side
  when Direction alerts below). Existing keys are untouched: the new
  Display setting wins over the legacy sparkline checkbox when both
  exist, and a key that never touched the select renders exactly as
  before.
- The dial's range bar marks the same warn/critical zones on its
  track. An automatic session range widens just enough to keep the
  zones visible; a manual Bar min/max is never widened, and zones
  outside it are clipped.
- Deck-wide Data units: byte and rate readings re-tier as decimal
  (KB, MB, GB, rates in Mbps) or binary (KiB, MiB, GiB, rates in
  MiB/s). Thresholds keep comparing in the reading's native display
  unit, so flipping the preference never re-arms an alert.
- The Text setting: Theme, Dim, or Custom text per key, per dial, or
  once for the whole deck (the Deck text row under Advanced). Custom
  paints the main value your exact color, with a "Dim labels, units
  and stats" checkbox for the secondary text; warn and critical
  colors always win, and status screens keep their fixed safety
  colors. (Requested in issue #2.)
- Sectioned settings panels. Both property inspectors group their
  rows under flat headers (Sensor, Format, Appearance, Layout and
  Alerts on keys; Sensor, Rotation, View, Format, Appearance, Bar
  range and Alerts on dials) with a left rule marking the blocks a
  select reveals. The dial's "Rotation" row is renamed "Bump guard",
  the deck-wide Text row "Deck text", and the Bar min/max fields hide
  on the overview views, where the bar does not draw. Every control
  keeps its place in the panel and its stored setting.

## 1.2.0.0 - 2026-07-13

- Two readings on one key. A new Layout setting on the Sensor Reading
  action stacks a second readout under the first: two rows, each with
  its own label, value and inline unit, split by a thin divider. The
  second reading has its own sensor picker and label (so one key can
  pair CPU with GPU, both RAM sticks, or the same sensor's minimum and
  maximum). By default the second row follows the first's stat, the key
  press cycles both rows together, and a non-current stat shows as one
  MIN/MAX/AVG badge centered in the divider gap; "Second shows" can
  instead pin the second row to a fixed stat. When the rows show
  different stats, each non-current row carries its own badge inline
  after its unit, the dial's idiom, so labels never lose width to a
  corner badge. Decimals and the °F toggle apply to both rows;
  warn/critical thresholds and the type accent follow the first
  reading, and an alert recolors the whole key
  exactly like the single layout. The sparkline stays a single-layout
  feature: the second row takes its space. Existing keys are untouched;
  the single layout remains the default and renders exactly as before.
  (Requested in issue #1.)
- Four readings on one key: the quad grid. A third Layout option splits
  the key into a 2x2 grid, one reading per cell, behind a hairline
  cross. The first two cells reuse the single and dual fields, so
  switching from the stacked layout keeps both sensors; cells three and
  four get their own pickers, and a quad with only two or three sensors
  picked leaves the spare cells empty. By default each value is drawn
  in its cell's color, so you can tell the four readings apart at a
  glance: a preset select offers four hues, row pairs, or uniform
  blue, and four color wells set any cell individually. A "Cell
  labels" toggle switches to a short uppercase label above a plain
  value instead.
  Values compact to at most four characters per cell (48700 shows as
  49k) and the font steps down rather than overflow a cell. Every cell
  shows the same stat, the key press cycles them together, and a
  non-current stat badges once at the cross center. Decimals and the
  °F toggle apply to all cells; warn/critical thresholds and the
  type accent follow the first sensor, and an alert recolors the whole
  key over the cell colors, so warn and crit stay unmistakable. A cell
  whose sensor drops out of HWiNFO's output shows a placeholder while
  the rest keep updating, and junk in any slot costs only that cell.
  The sparkline stays a single-layout feature.
- Overview views for the dial touchscreen. "Overview (three rows)"
  lists up to three readings of whatever rotation already moves
  through (the rotation set, the active rotation group, or the picked
  sensor's readings), each with its label and live value. "Overview
  (two rows, big values + trend)" trades one row for size: two tall
  rows with 26 px values, a full label line each, and the space beside
  the value put to work: a long label word-wraps onto it, a short one
  frees it for a live sparkline of that reading's recent values (the
  keys' own recent-history line, fed for the visible rows; the reading
  on the dial is marked with a full-width highlight band and an accent
  bar). The three-row face is the wide tile: the reading on the dial is
  a small accent thumb riding a left rail that spans the rows, which
  also shows where the window sits in the full list; rotating moves the
  thumb and scrolls the window. One context line (top by default, or
  below the rows via the new Context line setting) carries the shared
  name and the session low/high: the numbers always render in full,
  right-anchored, and only the name shortens, so a long name can never
  eat a stat. Values share one right-anchored column at a fixed
  edge, sized by a ladder so the widest visible value fits, with units
  in a fixed column beside it; row labels draw as small uppercase text
  that fills the room up to its own row's value and shortens only when
  a name truly runs out of space, and thin separator lines between rows
  can be turned off with the new Separators setting. The pinned and cycle-paused tags and the stat
  badge share the context line's name region; a transient hint (a
  group-jump name, a reset confirmation) briefly takes the whole line,
  then the name and numbers return. Alerts recolor a row's value text
  only. Rows stay readable the same three ways in both views:
  leading words the visible rows share are lifted
  into the context line ("GPU Temperature / GPU Hot Spot" reads as
  "Temperature / Hot Spot" beside a "GPU" context; a Row labels setting
  restores full names), values line up in one column, and any reading
  can be renamed by clicking its chip's name in the rotation set (the
  name also titles the dial when that reading is selected). Auto cycle,
  alert interrupts (an alerting row can pull the window to itself),
  pin, pause, touch taps, group jumps and the HWiNFO Control key all
  drive the overview unchanged. The single view remains the default
  and is pixel-identical to 1.1.11.
- All of 1.2.0's additions are append-only settings: profiles written
  by 1.2.0 degrade cleanly on older plugin versions (the extra fields
  are ignored and the dial or key runs its single face), and malformed
  values resolve to the nearest working layout, down to the single
  face.

## 1.1.11.0 - 2026-07-12

- Named rotation groups for the dial, optional and off until you build
  them. "Split into groups" under the rotation set turns the set into
  group 1 and adds a collector group; tick readings into it, name the
  groups, and the dial gets two speeds: plain rotate stays inside the
  active group, while a gesture set to "Switch sensor or group" (Elite's
  press+rotate) jumps between groups and shows the landing group's name
  on the dial for a moment. The HWiNFO Control key's "Next/Previous
  sensor or group" commands honor the groups on every preset. The auto
  cycle steps inside the active group, and with "On alert" ticked it
  still watches every group: a critical reading anywhere in the set
  interrupts across group boundaries. Legacy keeps rotating through
  everything as one flat list, exactly as before, and a Custom map with
  no group-switching gesture does the same, so no group can ever become
  unreachable. Dials without groups behave exactly as they did, and
  older plugin versions read the groups as one flat rotation set, so
  downgrading loses nothing.
- The rotation set in the dial's settings panel now shows where the dial
  is: the chip of the reading on screen is highlighted in blue and
  follows rotation, group jumps and the auto cycle while the panel is
  open.
- Switching the Controls preset from Elite to Custom now copies Elite's
  gesture map into every select you have not set yourself, so "Elite
  minus the one gesture you want different" is a single change instead
  of rebuilding the whole map from the Legacy defaults. Gestures you
  already assigned are never touched.
- The Custom preset's command lists are aligned across gestures:
  Press+rotate gained "Cycle stat mode", and Short push, Long push and
  Long touch now offer the same full command set (reset session stats,
  pause/resume auto cycle, pin/unpin, cycle stat mode, back to current
  value) instead of each listing a different subset.
- Fixed: dial status faces ("Start HWiNFO, not detected", "Access
  denied" and the rest) and the "rotate to pick" face drew their message
  at the numeric value size and ran off the right edge of the
  touchscreen slot. Longer value text now steps down to a size that
  fits.

## 1.1.10.0 - 2026-07-11

- New dial rotation controls. A rotation set: tick readings in the dial's
  sensor picker and rotation moves through just those, in your order, even
  across different sensors. An "Ignore turns" switch: the dial ignores
  rotation entirely, so a bump can never move you off your reading. An auto
  cycle: the dial steps through the rotation set (or the picked sensor's
  readings) on a timer, from every 5 seconds to every 5 minutes, and it
  works with turns ignored for a hands-off tour.
- Rotating a dial whose saved sensor has temporarily vanished (HWiNFO
  restart, device dropout) no longer jumps to an unrelated reading and
  overwrites the selection. The dial shows "Sensor missing / waiting" and
  ignores turns until the sensor returns.
- Dial session stats are now kept per reading, keyed by HWiNFO's stable
  sensor identity: rotate away and back and that reading's own session
  min/max/average is still there, and no reading can ever show another
  one's numbers. Stats for rotation-set members keep accumulating while
  they are off screen (whenever a Sensor Reading key or Sensor Dial is visible,
  which is what keeps the poller running), and the whole set survives
  reconnects, wake replays, page switches and profile changes (up to 30
  minutes off screen).
- Fixed stale dial titles when rotating through readings: a custom label
  written for one reading stayed on as the touchscreen title after rotating
  to another, so the name no longer matched the value. Rotating now clears
  the custom label and the title follows the reading (a new "Label mode"
  setting keeps it instead, as a fixed title for the slot).
- New control presets for the dial. "Legacy" (the default, and what every
  existing dial keeps) is the exact previous behavior. "Elite" adds
  press+rotate to jump between sensors, a short press that pauses the auto
  cycle, and a long press (half a second) that resets session stats.
  "Custom" assigns each gesture individually, including optional two- or
  three-zone touch (left/right switch readings, center taps). Pressed
  rotation never triggers the plain-rotation action, and a press that saw
  rotation executes nothing on release. The Stream Deck app's own gesture
  hints follow the selected preset.
- New "HWiNFO Control" key action: drive Sensor Dials from any key, pedal,
  G-key or Multi Action step, on any connected device. Commands: previous/
  next reading or sensor, stat mode, pause/resume auto cycle, pin/unpin,
  reset session stats. Targeting is explicit (a per-dial "Link ID", or all
  dials), and the key ticks or alerts by whether any dial took the command.
- Thresholds and manual bar ranges are now unit-scoped: they only apply to
  readings in the unit they were typed against, so a warn level meant for
  a temperature can no longer fire on a fan RPM after rotating to it.
  Scoping starts with the first threshold you edit after updating;
  thresholds saved by earlier versions keep their old reach until then.
- Alert-aware auto cycle, opt-in via the "On alert" setting: ticked, the
  cycle holds instead of rotating away while the shown reading is critical
  and its next step goes to a critical member of the set instead of the
  next one in order. Unticked (the default), alerts do not steer the cycle.
- New pause and pin states (from Elite/Custom gestures or the Control key):
  pause stops the auto cycle timer, pin locks the selection against turns,
  taps and the cycle. Both survive page switches (up to 30 minutes off
  screen), both show on the dial's bottom line, and the display mode a
  dial was left in also survives page navigation now.
- A device capability registry derives each deck's grid, encoder count and
  touch geometry from the Stream Deck registration (Stream Deck + XL: six
  200x100 touch segments) and degrades safely for unknown and untested
  devices: they fall back to a keys-only profile and input is never gated.
  Hardware the plugin has not been proven on is not listed as supported.
- New redacted local diagnostics: a "Copy support report" button in every
  settings panel (devices by model and hashed ID, data-source state, action
  states; no sensor values, no names, no upload), and an opt-in event
  recorder (`HWINFO_TRACE_EVENTS=1`) whose traces replay through the test
  suite's gesture machine. See the new "Hardware compatibility" docs page.
- Verified on the Stream Deck + XL (9x4 keys, six dials): a full 36-key,
  6-dial layout ran live on real hardware with every theme, sparklines,
  alert states, and touchscreen dials rendering correctly at 0.1 % CPU.
  The e2e suite now registers a Stream Deck + XL mock device and drives the
  dial on its sixth encoder, so this coverage holds without the hardware.
- The plugin log now names each connected deck (model and key grid), so
  support logs say exactly what hardware was involved.
- New `HWINFO_LOG_LEVEL` environment override (`trace`/`debug`/`info`/
  `warn`/`error`) for support diagnostics; the default stays `info`. At
  `debug`, each key and dial logs where it appeared (device and position).
  `trace` needs a debug launch of the plugin; on a normal Stream Deck
  launch it falls back to `debug` and the log says so.
- The Marketplace listing, README, FAQ, installation guide, Sensor Dial
  page and troubleshooting page now name the Stream Deck + XL alongside
  the Stream Deck + when they describe dial support.

## 1.1.9.0 - 2026-07-05

- Fixed the key sparkline clipping the bottom edge. The strip sat too low, so
  at a session low the line and its end dot were scissored by the key edge with
  no margin beneath. Moved the strip up (now y 120-134) so the line and the r=5
  dot always clear the edge. Regenerated the marketing and docs images to match.

## 1.1.8.0 - 2026-07-05

- Meets the current Marketplace intake requirements (surfaced in the live
  Maker Console): manifest `SDKVersion` 3 and minimum Stream Deck app 6.9.
  **The plugin now requires Stream Deck software 6.9 or later.**
- Upgraded the runtime SDK from `@elgato/streamdeck` 1.4.1 to 2.1.0, which
  SDKVersion 3 requires. Migrated the property-inspector messaging off the
  removed `streamDeck.ui.current` onto `streamDeck.ui`, and moved the
  `JsonValue`/log-level imports to their new homes. Same behavior: all unit,
  e2e (harness, resilience, gadget, dead-fallback, load), and live-load
  checks pass, and the poller/render/status paths are unchanged.
- The plugin URL and the docs links now point at the documentation site
  (docs.slawrensen.com/hwinfo-streamdeck) instead of the raw GitHub repo.

## 1.1.7.0 - 2026-07-05

- Copy pass over everything a user reads, ahead of the Marketplace
  submission: manifest description, settings-panel text, status-screen and
  probe wording, README and docs. Plain punctuation throughout. No
  functional changes.
- New icons across the board: the app, category, and action icons now show
  what the plugin actually renders (a key face with a value and sparkline;
  a knob for the dial action) instead of a radial gauge it never draws.
- Repo: added `npm run release:validate` (lint, typecheck, tests, plus a
  copy/manifest/asset/version validator).

## 1.1.6.0 - 2026-07-05

- Sparklines now persist across page changes. The recent-history graph used to
  reset to empty every time a key reappeared (switching pages, waking the
  machine, the app reconnecting) and had to rebuild from scratch. History now
  lives with the poller and survives those, so switching away and back keeps
  the graph drawn. It also survives a °C/°F toggle now (same data, just
  relabelled), and a frozen HWiNFO no longer flattens the line; it holds its
  last real shape. (A graph on a page you haven't viewed in a while still
  rebuilds, and fills at HWiNFO's own update rate.)
- Redesigned the status screens (Start HWiNFO, Shared Memory off, Not updating,
  etc.) to be calmer and OLED-friendly: a true-black background instead of dark
  grey, two lines of soft-white text instead of three lines of hard white. Same
  guidance, much less glare.

## 1.1.5.0 - 2026-07-05

- Theme gallery: the "Deck default" chip is now **structurally** distinct from
  the preset it resolves to. It keeps its truthful resolved-palette face but
  wears a dashed accent border and a small link/follow badge, so it can never
  be mistaken for the Void (or any) preset chip at a glance, even when the
  deck theme it follows happens to render an identical palette. (v1.1.3/v1.1.4
  tried text-only cues that still failed the eye.)
- Fixed a data-source fallback bug: when free HWiNFO disables shared memory
  after 12 hours it leaves the named mapping behind with a "DEAD" marker. The
  reader now validates that marker at open time, so "auto" mode correctly falls
  back to the Gadget registry instead of getting stuck on the "Shared Memory
  off" screen, and a shared-memory upgrade probe no longer closes a working
  gadget provider for the dead mapping. (New `e2e:dead-fallback` regression.)
- Fixed the sensor picker silently replacing your saved sensor: pressing Enter
  with the picker open but no search text typed used to select the first
  sensor in the list. It now leaves the current selection untouched.
- The dial's "HWiNFO stalled" touchscreen text now says "check Gadget" when the
  dial is reading from the Gadget registry, matching the key screen and PI hint
  instead of always pointing at Shared Memory.

## 1.1.4.0 - 2026-07-04

- Theme gallery: the "Deck default" chip face now reads "auto" (in the
  resolved theme's colors) instead of a sample value, so it no longer looks
  like a duplicate of the theme it currently resolves to.

## 1.1.3.0 - 2026-07-04

- Fixed the theme gallery layout: the longer "Deck default" label introduced
  in 1.1.2.0 blew its grid column wide (CSS grid min-width:auto). Chips are
  equal-width again; the resolved deck theme now appears in the help line
  under the gallery ("currently Void") and in the chip tooltip.

## 1.1.2.0 - 2026-07-04

- Theme system truthfulness: the settings panel's "Deck default" chip now
  shows the plugin's actual resolved deck theme (labelled with its name,
  e.g. "Deck default · Void") instead of guessing from raw global settings,
  and updates live when the deck-wide theme changes. Added help text making
  the precedence rule explicit: a per-key theme always wins; the Advanced
  "Deck theme" only affects keys set to Deck default.
- Fixed: an empty or invalid stored deck theme could permanently block the
  legacy-migration default while silently failing to apply; the migration
  can no longer overwrite a theme the user picked concurrently.
- The effective deck theme is now logged at startup and on every change.

## 1.1.1.0 - 2026-07-04

- Hardening: the plugin now watches its parent process and exits if the
  Stream Deck app dies without cleaning up (hard-crash scenario found during
  competitive benchmarking; previously the poller could keep the process
  alive with nobody to render for; normal operation already relied on the
  app's job object). No functional changes.

## 1.1.0.0 - 2026-07-04 (first tagged build)

The baseline feature set. Tag: `v1.1.0`.

**Features**

- Live HWiNFO sensor readings on Stream Deck keys: value, unit, custom label,
  sparkline history, stat modes (current/min/max/avg; a key press cycles).
- Stream Deck + dial/touchscreen action: live value with session min/max and
  a range bar; rotate to switch readings, push to reset session stats, touch
  to cycle stat modes.
- Seven display themes (per key or deck-wide) with sensor-type accent colors
  and aviation-style alerting: amber/black at warn, red/white at critical.
  Alert colors are global and never themed.
- Searchable sensor picker in the settings panel with live values for all
  ~500+ readings, grouped by source.
- Dual data source with auto-fallback: HWiNFO Shared Memory (full stats)
  preferred, Gadget registry (free version, no 12-hour limit) as fallback,
  automatic upgrade back to shared memory when it returns.
- Resilient status screens for every failure mode: HWiNFO not running,
  Shared Memory disabled or expired, privilege mismatch (with the concrete
  fix), Gadget reporting enabled but no sensors ticked, stale data.
- First-run setup guide inside the settings panel.

**Performance** (measured, see PERF.md)

- Incremental shared-memory decoder: ~6 µs and near-zero allocation per poll
  tick for ~516 readings (up to 62× faster than the naive decode).
- ~0.07 % average CPU with a 12-key live page at a 1-second poll.
- Memory-stable under a 35-minute soak (RSS slope negative); the plugin
  process exits cleanly when Stream Deck stops and idles when no keys are
  visible.

**Notes**

- Requires HWiNFO (free or Pro) with Shared Memory Support or Gadget
  reporting enabled. Windows x64 only (Windows-on-ARM shows a clear
  unsupported-platform screen).
- This is an independent project, not affiliated with or endorsed by
  REALiX/HWiNFO. No ads, no telemetry.
