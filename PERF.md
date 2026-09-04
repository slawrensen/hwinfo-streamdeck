# Performance log

Most entries below are emitted by `node scripts/perf-report.mjs <label>`: one
command that measures pack/bundle sizes (raw + gzip), per-component disk
usage, the live plugin process (PID attributed by command line, never by
process name; Discord also runs a `plugin.js` under node.exe), and the
parse-path microbenchmark against the **live** HWiNFO mapping
(`scripts/bench-parse.ts`, 1,000 iterations). The exceptions name their
harness inline: the every-sensor load test (`npm run e2e:load`), the
sparkline ring bench, the externally sampled soaks
(`scripts/soak-monitor.mjs`), and a few hand-run measurements described
where they appear.

Metric notes:

- **tick** = one production poll: mutex acquire + native region copy +
  decode to `SensorSnapshot`. `raw copy` is the copy alone, so
  `tick − raw copy` ≈ pure parse cost.
- **alloc/tick** = sum of positive `heapUsed` deltas per iteration (allocation
  rate, garbage included). **retained** = gc→gc `heapUsed` growth across the
  whole 1,000-iteration pass (not per tick); near zero means steady state.
- Process CPU % is lifetime average (CPU seconds / uptime).

v1.1 targets: ≥5× fewer µs/tick, near-zero steady-state alloc/tick, smaller
`.streamDeckPlugin` with zero behavior change, RSS soak slope < 1 MB/30 min,
zero orphan processes after the full suite.

## Entries

### 2026-09-04: 1.6.0.0 release candidate, and what the Gadget fix costs

`node scripts/perf-report.mjs` against the release candidate pack
(`fa305293…`, 284,822 B; gzip 274,714 B): the 2026-08-30 density cut
plus the issue #21 Gadget scan fix (#22), the Configure Sensors
guidance (#23), the corrected README and first-run tip, and the
1.6.0.0-2 panel cache tokens. bin/plugin.js is 185,561 B (the scan fix
is 47 B of bundle), ui/ is 243,963 B, and `hwsm.node` builds from the
same native source as 1.5.0.0 and 1.5.1.0 (`git diff v1.5.1..HEAD --
native/` is empty; the CI-built addon is the one that ships). The
shared-memory parse path is unchanged: 8.4 µs mean / 10.5 µs p95 over
548 live readings (1,000 iterations, 255.8 KB region).

The Gadget path is the one that changed, and it is dearer by design.
The old scan stopped at the first missing `SensorN`; the fix walks the
whole 1,024-slot bound on every read, because a missing slot is a
reserved one, not the end of the list (issue #21). On this machine's
real Gadget key (13 contiguous readings, HWiNFO 8.48) the same bench
run against both scans measures:

| Gadget tick (13 readings, 1,000 iterations) | mean µs | p50 µs | p95 µs | alloc/tick |
| --- | ---: | ---: | ---: | ---: |
| 1.5.1.0 scan (stops at the first hole) | 121.8 | 116.6 | 143.3 | 11,137 B |
| 1.6.0.0 scan (whole 1,024-slot bound) | 2,736.5 | 2,694.1 | 2,998.3 | 42,370 B |

About 2.6 ms of that is the 1,011 registry queries that answer
ERROR_FILE_NOT_FOUND, so the cost is set by the bound, not by how many
readings are ticked: at the default 1 s poll it is about 0.3% of one
core, at the fastest 250 ms poll about 1.1%, and the shared-memory
path, the default source and the one Auto mode prefers, pays nothing.
Earlier entries carry "n/a" for the Gadget tick because the key was
absent on this machine; this is the file's first before-and-after row
for it.

The soak this release rests on is the 2026-09-02 entry below: 48 h on
the 2026-08-30 pack (`54913122…`), whose runtime differs from this
candidate by the Gadget provider's scan loop (src/hwinfo/gadget-
registry.ts), a poller comment, and two user-facing strings. The
shared-memory poller, the renderers and the native bytes the soak
exercised are the same source; the changed Gadget path is covered by
the 24-case provider suite, the Gadget e2e (21 checks, 8 of them new,
all failing against the old scan) and a bench install of this pack.
`perf-report` could not attribute the live plugin process from this
shell (the Stream Deck app's child processes answer the WMI command-line
query with an empty string here), so the process row is not refreshed;
the soak's own samples stand for it.

### 2026-09-02: the 1.6.0.0 soak closed clean

`node scripts/soak-monitor.mjs --summary release/soak-1.6.0.0-20260830-1636.csv`,
the same code path that printed the live summary when the window
closed. The subject was the installed 1.6.0.0 pack (`54913122…`) under
two days of desk use, sampled from outside the process once a minute.

| Soak | Value |
| --- | ---: |
| Window | 2026-08-30T23:34:53Z to 2026-09-01T23:35:00Z (48.0 h, 2884 samples) |
| RSS slope, longest same-PID run (2615 samples, PID 31640) | -0.03 MB/30 min |
| Private bytes slope, same run | +0.03 MB/30 min |
| Private bytes, start to close | 50.1 MB to 61.4 MB (max 67.6) |
| Handles | 207 to 178 (max 207) |
| Threads | 16 to 12 |
| Avg CPU, same run | 0.15% |
| Plugin restarts / HWiNFO-absent samples | 2 / 0 |
| New log WARN / ERROR lines | 0 / 0 |
| Sampling gaps over 90 s | 0 |

Both slopes sit far inside the 1 MB/30 min gate. The two plugin
restarts were two Stream Deck app restarts, the planned one at
2026-08-30T23:37Z (plugin PID 66972 to 31640) and an orderly quit and
relaunch at 2026-09-01T19:10Z that left the plugin absent for two
samples (PID 31640 to 101052; the app log ends that session with
"Application event loop ended (0)", no crash). The RSS column ends at
1.2 MB because Windows trimmed the idle process working set late in
the window; private bytes cannot be trimmed, so they carry the
steady-state judgment. The HWiNFO restart and the sleep/wake the
runbook asks for did not happen inside this window. The machine
rebooted after it (2026-09-02T05:51Z), which restarted HWiNFO and the
app together: the plugin came back with the app at 05:59Z and opened
HWiNFO's shared memory on HWiNFO's own start eight minutes later, zero
WARN and zero ERROR. Sleep/wake stays unexercised on this cut; the
native bytes and the poller are the ones the 2026-07-31 soak covered.
The 2026-09-01 afternoon bench of the SPIKE clone (its own plugin id,
its own process) ran beside the subject and never touched it.

### 2026-08-30: 1.6.0.0 release snapshot, and the soak this tag waits on

`node scripts/perf-report.mjs` against the packed release artifact
(`54913122…`, 284,760 B; gzip 274,616 B). The pack grew about 27.5 KB
over 1.5.1.0, almost all of it ui/ (the tile editor and the Config
section in pi-common.js and pi.css, now 243,821 B); bin/plugin.js is
185,514 B, and `hwsm.node` builds from the same native source as the
1.5.0.0 and 1.5.1.0 releases (`git diff v1.5.1..HEAD -- native/` is
empty; the CI build is the one that ships, and the release workflow
proves it reproducible), so the native behavior is the one the
2026-07-31 48 h soak proved. The
parse path is unchanged: shared-memory tick 8.6 µs mean / 11.3 µs p95
over 521 live readings (1,000 iterations, 242.1 KB region). At
snapshot time the machine's two live plugin processes (retail
1.5.1.0 plus the dev clone) showed 0.16% / 0.01% avg CPU and
46.1 / 40.2 MB RSS after 24.5 h of desk use, the baseline the soak
below compares against. Dense-tile render cost was measured before the
feature shipped; see the 2026-08-03 entry.

The runbook's soak rule does not bind this release (`native/hwsm` and
`src/poller.ts` are untouched since the soaked bytes), but the tag is
held on a 48 h desk-use soak of the installed 1.6.0.0 pack anyway:
`node scripts/soak-monitor.mjs` external sampling into `release/`,
with one HWiNFO restart, one Stream Deck restart and one sleep/wake
inside the window. The summary is the 2026-09-02 entry above.

### 2026-08-11: 1.5.1 soak scope, and why this poller change did not get one

The runbook requires a hardware soak for any release touching the poller,
and 1.5.1 touches `src/poller.ts`, so this entry records the judgment
instead of leaving the rule silently unanswered.

The change is eight lines inside `setIntervalMs`, which runs only when a
global-settings frame changes the interval, never in the tick path.
`tick`, `probeReopen`, `openProvider` and the whole provider lifecycle are
byte-identical to 1.5.0.0, and `git diff v1.5.0..HEAD -- native/` is
empty, so the native bytes a soak exists to prove are the bytes the
2026-07-31 48 h run already soaked (slope -0.01 MB/30 min, handles 196 to
177, 0 WARN 0 ERROR). What the fix changes is which side of that soak the
steady state sits on: before it, a poll-interval change silently dropped
every sparkline ring, so the process held LESS state than a normal
session; after it, the rings behave exactly as they do for a user who
never touches the interval, which is every soaked session to date. The
retained cost is bounded by the ring cap (36 samples per subscribed
reading, measured at about 150 KB for 515 readings in the 2026-07-25
entry).

A 48 h RSS soak is therefore not proportionate here, but the claim the
changelog makes is behavioral and no automated gate covers it end to end
on real hardware, so it was checked live instead: install the pack, show
a sparkline key, change Poll every, confirm the line rebuilds rather than
dying, then restart the plugin with the non-default interval saved and
confirm the first sparkline of the session still appears. Checked live
2026-08-11 on this machine (app 7.4.2, real HWiNFO, Virtual Stream Deck
3): the line cleared and rebuilt within about 10 s of changing Poll
every from 1 s to 250 ms. After an app restart with the 250 ms interval
saved, the log showed the launch order the defect exploited and the
first sparkline of the session still appeared.

Automated coverage added with the fix, both proven red against the
reverted line: a unit leg that drives the real poller singleton and
asserts the ring empties in place while the key stays subscribed, and an
e2e leg that pushes a changed `pollIntervalMs` over the mock socket and
asserts the sparkline polyline returns on the live key. The e2e scenario
guard moved 60 s to 90 s in the same commit: the run already measured
57 to 58 s, so any added leg turned an assertion failure into an
indistinguishable timeout.

### 2026-08-03: dense detail tiles (readings per tile, issue #5 follow-up)

The detail view's tiles can now carry up to four readings, so the two
costs that scale with density got measured before shipping: face
payloads grow (dual/triple/quad SVG vs one reading), and every tile now
redraws when ANY of its readings moves. Harness:
`node scripts/perf-detail.mjs` (8 min per run, mock + XL, live HWiNFO
with 511 readings, 250 ms poll option, the real shipped detail-plus-xl
surface), with `PERF_DETAIL_FILTER="*"` so all 32 reading tiles are
LIVE at every density (source mode leaves most tiles blank when the
first source is small, which is what the 2026-07-29 row measured). The
unfiltered control run reproduced that row (0.04% avg / 0.20% p95,
1.0 frames/s), so the harness line is unbroken.

| Config (filter `*`) | CPU avg / p95 per 15 s | setImage frames | Handles |
| --- | ---: | ---: | ---: |
| density 1 | 0.05% / 0.20% | 5,245 over 490 s (10.7/s) | 215 flat |
| density 2 | 0.09% / 0.41% | 6,380 over 489 s (13.0/s) | 215 flat |
| density 3 | 0.12% / 0.41% | 7,079 over 489 s (14.5/s) | 215 flat |
| density 4 | 0.09% / 0.20% | 7,219 over 489 s (14.8/s) | 215 flat |

Frames saturate near the live-tile count times HWiNFO's ~2 s value
cadence (~16/s on 32 live tiles), not at the 250 ms poll: the tick
gate and byte dedupe still discard everything that did not actually
change, and packing four readings per tile costs at most a doubling of
average CPU against the same page at density 1, with p95 never past
0.41% of one core. Nothing here approaches the 1% line that would have
forced a detail-render cadence floor, so density ships without one.
RSS across each 8-minute window shows the same warmup high-water
pattern the 2026-07-29 entry describes (55-57 start to 61-65 MB end);
the steady-state slope judgment stays with the soak entries, not these
short windows.

### 2026-07-29: the drill-down detail view (1.4.90.0 preview, issue #5)

Two questions: does a dense detail page cost anything at the fastest
poll, and does holding the view leak. Neither harness is perf-report.mjs
because the workload is new; both are in the repo.

Dense page, mock app (`node scripts/perf-detail.mjs`, 8 min): the real
shipped detail-plus-xl surface (32 reading tiles + 4 nav tiles) on a
mock + XL against live HWiNFO (516 readings) at the 250 ms poll option.

| Metric | Value |
| --- | ---: |
| CPU avg / p95 (per 15 s sample) | 0.05% / 0.20% |
| setImage frames after dedupe | 330 over 489 s (0.7/s) |
| Handles | 209 -> 209 |
| switchToProfile calls | 1 (the entry) |

The frame number is the dedupe working: 36 tiles at 4 ticks/s would be
144 potential frames/s, but HWiNFO itself advances about every 2 s and
identical faces are skipped, so under one frame per second actually
crosses the socket. p95 CPU sits far under the 1% line that would have
forced a detail-render cadence floor, so there is none: detail tiles
repaint at the poll rate like every other key.

Held view, real app and hardware (`node scripts/soak-monitor.mjs
--interval 30`, two windows back to back, retail install on the
physical + XL showing the 36-tile detail view at the default 1 s poll):

| Window | RSS slope | Handles | Avg CPU | Restarts | WARN/ERROR |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0-35 min (process start) | +5.28 MB/30 min | 175 flat | 0.03% | 0 | 0 |
| 35-65 min (warm) | +3.71 MB/30 min | 175 flat | 0.17% | 0 | 0 |

The slopes decay, not compound: within the warm window the first half
ran +9.3 and the second half -1.5 MB/30 min, with RSS settling around
47 MB and coming back down (44.1 to 48.1 over the window, max 50.8).
That is heap high-water maturation, not growth: handles never moved,
no restarts, no log noise. The multi-hour steady-state soak of the
kind that gated 1.4.0 (worst +0.11 MB/30 min over 48 h) stays a
final-release gate; these preview windows show where the process
settles, not a leak.

### 2026-07-04 20:21: baseline (v1.0, commit 3d70076)

| Artifact | Bytes | gzip |
| --- | ---: | ---: |
| .streamDeckPlugin pack | 561,887 B | 530,551 B |
| bin/plugin.js | 107,822 B | 32,159 B |
| bin/node_modules (total) | 1,108,849 B (1082.9 KB) | |
|   koffi.node | 1,045,504 B (1021.0 KB) | |
| ui/ | 79,495 B (77.6 KB) | |
| imgs/ | 37,257 B (36.4 KB) | |
| layouts/ + manifest + themes | 3,845 B (3.8 KB) | |

| Plugin process | RSS | Private | CPU | Uptime | avg CPU % |
| --- | ---: | ---: | ---: | ---: | ---: |
| PID 31336 | 30.9 MB | 61.0 MB | 4.6 s | 50 min | 0.15% |

Parse bench (1000 iters, live mapping, region 239.9 KB):

| Path | mean µs | p50 µs | p95 µs | alloc/tick | retained |
| --- | ---: | ---: | ---: | ---: | ---: |
| raw copy (session.read) | 3.3 | 3.1 | 4.4 | | |
| shared-memory tick (516 readings) | 361.2 | 350.2 | 424.7 | 333,116 B | 3,832 B |
| gadget tick | n/a: HKCU\HWiNFO64\VSB absent (Gadget reporting off on this machine; covered by e2e:gadget's synthetic key) | | | | |

Reading: the copy is 3 µs; the other ~358 µs and all 333 KB/tick of garbage
is decode: re-decoding ~516 labels/units (UTF-8 ×2 each) and rebuilding
every Reading object + byKey Map per tick when only the value doubles change.
That is the READER target.

### 2026-07-04 20:29: incremental reader (SnapshotParser)

| Artifact | Bytes | gzip |
| --- | ---: | ---: |
| .streamDeckPlugin pack | 561,887 B (repack pending) | 530,551 B |
| bin/plugin.js | 109,245 B | 32,663 B |
| bin/node_modules (total) | 1,108,849 B (1082.9 KB) | |
|   koffi.node | 1,045,504 B (1021.0 KB) | |
| ui/ | 79,495 B (77.6 KB) | |
| imgs/ | 37,257 B (36.4 KB) | |
| layouts/ + manifest + themes | 3,845 B (3.8 KB) | |

| Plugin process | RSS | Private | CPU | Uptime | avg CPU % |
| --- | ---: | ---: | ---: | ---: | ---: |
| PID 31336 (pre-change binary) | 31.0 MB | 62.5 MB | 5.5 s | 58 min | 0.16% |

Parse bench (1000 iters, live mapping, region 239.9 KB):

| Path | mean µs | p50 µs | p95 µs | alloc/tick | retained |
| --- | ---: | ---: | ---: | ---: | ---: |
| raw copy (session.read) | 3.1 | 2.9 | 4.0 | | |
| shared-memory tick (516 readings) | 5.8 | 5.0 | 10.4 | 466 B | 3,512 B |

**vs baseline: tick 361.2 → 5.8 µs mean (62×, target ≥5× ✓); alloc/tick
333,116 → 466 B (715×, ≈ measurement floor; the noop loop itself reads
~400 B/iter); retained ≈ 3.5 B/tick (noise). ✓**

What changed (`src/hwinfo/reader.ts`): `SnapshotParser` caches the full
skeleton (keys, labels, units, sensors, byKey, Reading objects) per header;
each tick verifies 8 header words + 3 identity words per entry and re-reads
only the four value doubles, in place. Any mismatch ⇒ full rebuild; the
parser lives on the `SharedMemoryProvider`, so an HWiNFO restart (new
session) always rebuilds. Two findings that mattered:

1. `Buffer.readDoubleLE` allocates a HeapNumber per call (not inlined);
   `DataView.getFloat64` is a TurboFan intrinsic: 20× faster, zero alloc.
2. Double field STORES also box; stores are conditional on value change.

Ruling: the gadget reader stays non-incremental. It cannot be benched live
(VSB key absent on this machine, Gadget reporting off) and its cost is
dominated by per-value `RegQueryValueExW` FFI round-trips, not decode;
typical gadget sets are a handful of readings. Covered by e2e:gadget.

Suites after change: lint ✓ typecheck ✓ 81 unit ✓ e2e ✓ e2e:resilience ✓
e2e:gadget ✓ (all this session).

### 2026-07-04 20:36: footprint

| Artifact | Bytes | gzip |
| --- | ---: | ---: |
| .streamDeckPlugin pack | 549,743 B | 520,365 B |
| bin/plugin.js | 108,573 B | 32,242 B |
| bin/node_modules (total) | 1,061,344 B (1036.5 KB) | |
|   koffi.node | 1,045,504 B (1021.0 KB) | |
| ui/ | 79,495 B (77.6 KB) | |
| imgs/ | 37,257 B (36.4 KB) | |
| layouts/ + manifest + themes | 3,823 B (3.7 KB) | |

**Pack 561,887 → 549,743 B (−12,144 B, −2.2%) with zero behavior change**
(lint/typecheck/81 unit/e2e/resilience/gadget all green after the trim; the
vendored runtime was smoke-tested by loading kernel32 through it).

KB won, per change:
- koffi vendor trim −47,505 B raw (1,108,849 → 1,061,344): runtime loads
  ONLY koffi/index.js → src/koffi/index.js → src/koffi/src/static.js →
  @koromix/koffi-win32-x64 (verified by require.cache/import tracing); the
  CJS twins, worker-thread `indirect` entry, index.d.ts and trampolines.cjs
  never load in a pure-ESM plugin. Filter lives in scripts/copy-koffi.mjs.
- terser passes:2 + comments:false −672 B raw on bin/plugin.js.
- manifest: dropped `Nodejs.Debug: "enabled"` (debug artifact in release;
  the inspector port has no place in a shipped pack).

Irreducible rulings (numbers, not vibes):
- **koffi.node 1,045,504 B (443,817 B in-pack)**: 79% of the pack. Trimming
  requires rebuilding the N-API binary from source; the no-user-toolchain
  ruling stands (koffi over node-gyp). Irreducible.
- **marketplace PNGs 34,702 B**: lossless re-encode (sharp, zlib 9 +
  adaptive filtering) comes out BIGGER (10,420 → 12,100; 24,282 → 26,366):
  already optimally compressed. Palette quantization saves ~47% but is lossy
  (max channel delta 113); rejected, listing images must stay exact.
- **ui/sdpi-components.js 55,823 B**: Elgato's PI component library, keep
  ruling stands.
- **ui/pi-common.js 11,651 B (2.8 KB in-pack)**: our readable PI source;
  minifying would save ~1.3 KB packed at the cost of a second build
  pipeline. Not worth it.
- **action/category SVGs 2,555 B total**: minification would win < 1 KB
  raw. Not worth it.
- ws is bundled exactly once and the SDK is ESM (tree-shaken); no duplicate
  to remove. No sourcemaps in release builds (watch-only).

| Plugin process (new binary, fresh launch) | RSS | Private | CPU |
| --- | ---: | ---: | ---: |
| PID 25404 | 36.4 MB | 54.3 MB | 0.1 s @ 1 min |

### 2026-07-04 21:15: memory / hangs

**RSS soak: PASS.** Live 12-key page (deck 20GBL9901, page 791A7BC8…),
1 s poll, new binary (PID 25404), sampled every 5 min for 35 min:

| local time | RSS MB | private MB | CPU s |
| --- | ---: | ---: | ---: |
| 13:37 | 36.71 | 54.88 | 0.2 |
| 13:42 | 37.51 | 55.52 | 0.3 |
| 13:47 | 38.99 | 57.07 | 0.5 |
| 13:52 | 38.61 | 56.30 | 0.6 |
| 13:57 | 38.77 | 56.88 | 0.9 |
| 14:02 | 39.65 | 57.90 | 1.0 |
| 14:07 | 37.52 | 57.75 | 1.2 |
| 14:12 | 33.18 | 58.09 | 1.5 |

Linear RSS slope: **−1.6 MB/30 min** (target < +1 MB/30 min). RSS peaked
at 39.65 MB and *fell* to 33.18 (GC compaction); no monotonic growth.
Heap stability: gc→gc retention in the 1,000-tick bench is 3.5 KB total
(≈ 3.5 B/tick, measurement noise). CPU over the soak: 1.5 s / 35 min =
**0.07 %** vs the 0.23 % baseline (3.2× less).

Leak-suspect audit: sparkline history capped at 36 samples with shift();
the dial keeps no history; theme-store listeners are a Set populated once
per singleton action class (bounded at 2); per-key state (incl. lastSvg) is
deleted on willDisappear; the poller closes its provider when refs hit 0.

**Zero orphans: PASS.** `npm run suite:full` (scripts/hygiene.mjs) runs
e2e + e2e:resilience + e2e:gadget + contact-sheet + marketplace-shots +
pi-harness/capture-pi and diffs all node.exe/chrome.exe processes
before/after: `new: 0 (0 ours, 0 unrelated)` on both post-fix runs. Bugs it
caught and their fixes: capture-pi held its CDP socket open (every run hung
60 s until a watchdog that also leaked the chrome tree; socket now closed
in finally, watchdog kills the tree, plus a pi-capture-profile sweep for
chrome children that re-parent past `taskkill /T`); pi-harness orphaned its
plugin child on Windows kill() (TerminateProcess skips signal handlers;
now takes "exit" on stdin like fake-hwinfo).

**Clean shutdown: PASS**, proven both ways:
- e2e (hard checks, now part of `npm run e2e`): zero frames within 3 s of
  every action disappearing; poller logs "Stopped (no visible actions)";
  the plugin process **exits by itself** when the app socket closes;
  nothing left holding the event loop.
- Live: `Stop-Process -Name StreamDeck` → 0 plugin node processes
  (verified twice, before and after the reader/footprint changes);
  relaunch → exactly one attributed plugin process.

### 2026-07-04 21:15: DONE (v1.1 before/after)

| Metric | v1.0 baseline | v1.1 | Δ |
| --- | ---: | ---: | --- |
| parse tick (mean, 516 readings) | 361.2 µs | 5.8–6.7 µs | **54–62× faster** (target ≥5×) |
| alloc/tick | 333,116 B | 466–993 B | **≈ measurement floor** |
| retained per 1,000 ticks | 3,832 B | 3,512 B | flat (noise) |
| .streamDeckPlugin pack | 561,887 B | 549,749 B (re-measure at DONE; the 20:36 footprint entry logged 549,743 B) | −12,138 B, zero behavior change |
| bin/node_modules on disk | 1,108,849 B | 1,061,344 B | −47,505 B |
| live CPU (12-key, 1 s poll) | ≈0.23 % | 0.07 % | 3.2× less |
| RSS soak slope | (unmeasured) | −1.6 MB/30 min | PASS < 1 MB/30 min |
| orphans after full suite | (unmeasured) | 0 | PASS, gated by suite:full |

Every FOOTPRINT remainder is ruled irreducible above (koffi.node without a
toolchain; PNGs already optimal; sdpi-components keep). Parse path is
incremental with full-rebuild invalidation on any header/identity change.
Suites at DONE: lint ✓ typecheck ✓ 81 unit ✓ suite:full (e2e ×3 + all
screenshot pipelines) ✓ zero orphans ✓.

### 2026-07-04 22:25: every-sensor load test (npm run e2e:load, v1.1.0)

One key context for EVERY live reading (518) + 8 dials, 250 ms poll,
12 appear/disappear churn waves (~260 contexts each) with settings variants
and dial rotations, 45 s full-visibility soak, then idle + shutdown proofs:

| Check | Result |
| --- | --- |
| every reading rendered (518 contexts) | PASS: 518 first frames |
| all 8 dials rendered feedback | PASS |
| invalid frames | 0 |
| churn survival | PASS: 6,622 frames during churn |
| RSS under 518-context 250 ms load | 128.0 → 128.7 MB peak (+0.7 MB over soak; 300 MB limit) |
| poller idle after mass disappear | PASS: 0 late frames |
| self-exit on socket close | PASS: exit 0 |

Total: 7,278 key frames + 250 dial feedbacks, zero invalid. The load suite
is part of `npm run suite:full` (45 s soak variant). On-device coverage:
two injected "HWiNFO test" pages on the live deck hold one key per sensor
source (all 21) across all seven themes with threshold/°F/stat variants.

### 2026-07-04 18:15 to 21:15: competitor comparison entries (removed 2026-07-25)

Four entries here compared this plugin against two rival HWiNFO plugins
measured on 2026-07-04: page-cycling CPU/RSS in the real app, a 30-key
headless sweep, cold-start timing, and the benchmark teardown. I removed
them in the 1.4.1 honesty pass. They recorded no version for either rival,
the comparison harness was never committed to this repo, and the teardown
note pointed at pack URLs and a session ledger that are not in the repo
either, so nobody, including me, can rerun or verify those numbers today.
The claims about this plugin's own behavior that they illustrated stand on
what the repo itself proves: the poller stops when no Sensor Reading key or Sensor Dial is
visible (`src/poller.ts`, logged as "Stopped (no visible actions)") and
first-frame rendering is covered by the e2e harness. One finding from that
session survives as its own entry below: the 21:40 parent-liveness
watchdog, which hardened this plugin regardless of what it was compared to.

### 2026-07-04 21:40: 1.1.1.0 parent-liveness watchdog

Hardening from the benchmark finding: an unref'd 30 s interval probes the
parent PID (signal 0); if the Stream Deck app dies without its job-object
teardown, the plugin exits instead of polling for nobody. Proven: ephemeral
parent spawned the built plugin (1.5 s check interval), key visible and
rendering, parent died → plugin self-exited within one interval; 8 s
survivor check clean. Ruling: socket-close-while-parent-alive still lingers
by design; that state only occurs during app-initiated restarts, where the
app kills the process itself. All suites green (96 unit, e2e ×3, load).
Pack 1.1.1.0: 554,076 B, SHA d710959… (+94 B for the watchdog).

### 2026-07-09 01:15: Stream Deck + XL hardware day (42 live actions)

First run on real Stream Deck + XL hardware (20GBX9901, DeviceType 13,
9×4 keys + 6 encoders, fw 1.0.2.2, app 7.4.2). Validation profile filled
the whole device: 36 sensor keys (all 7 themes, sparklines, warn/crit
alert keys, edge-case screens) + 6 touchscreen dials, all live on shared
memory at the default 1 s poll. Plugin debug log confirmed willAppear for
all 36 key coordinates (0,0–8,3) and all 6 encoder columns; zero
errors/warnings.

Live process while driving the full 42-action device (45 s window,
TotalProcessorTime delta): **0.1 % CPU, 42.6 MB RSS**. Renders stay
frame-deduped (identical SVG skipped before send). Ruling: the 12-key
numbers hold at 3.5× the action count; no render dirty-check needed at
this scale (the remaining pre-compose skip would save single-digit µs per
tick against a 0.1 % budget).

### 2026-07-10 03:27: control presets + capability registry pass

The gesture router, control presets, per-reading session stats, hidden-state
cache, HWiNFO Control action, capability registry, recorder and diagnostics
landed together; measuring for regressions against the entries above.

Pack: **571,421 B** (554,076 B at 1.1.1.0; the delta carries the new action,
its settings panel and the preset/gesture code). plugin.js 144,189 B raw,
42,924 B gzip. Parse bench unchanged: shared-memory tick mean 6.5 µs over
516 live readings (was 6.5 µs class before), raw copy 3.5 µs.

This build's runtime, from the load e2e (516 keys + 8 dials at 250 ms poll,
soak + churn): **RSS growth +0.0 MB over the soak window**, 0 late frames
after mass disappear, clean self-exit, zero orphans in suite:full's process
sweep. The per-tick additions (per-reading stat folding for current +
rotation-set members, threshold unit checks) are O(set size) map operations
against a 6.5 µs decode; nothing measurable moved. Note: the snapshot
table's "plugin process" row samples the machine's installed release, not
this working tree; this build's numbers are the load-e2e ones above.
Ruling: no material CPU or RSS regression.

### 2026-07-16 18:00: 1.3.0.0 (bar/ring gauges, data units, text colors, quiet sections)

Measured with `node scripts/perf-report.mjs 1.3.0.0` AFTER `npm run pack`,
so the pack row is the shipping 1.3.0.0 artifact (SHA 863fe0bb…).

| Artifact | Bytes | gzip |
| --- | ---: | ---: |
| .streamDeckPlugin pack | 583,133 B | 551,595 B |
| bin/plugin.js | 154,964 B | 46,826 B |
| bin/node_modules (total) | 1,062,461 B (1037.6 KB) | |
|   koffi.node | 1,045,504 B (1021.0 KB) | |
| ui/ | 143,038 B (139.7 KB) | |
| imgs/ | 33,750 B (33.0 KB) | |
| layouts/ + manifest + themes | 5,031 B (4.9 KB) | |

Pack 571,421 → 583,133 B (+11,712 B vs the 1.1.10-era preset build; the
delta is the gauge/measure/text-color modules in plugin.js, 144,189 →
154,964 B raw, and the sectioned settings panels in ui/; repacked after
a one-line PI help-string sync, 583,072 → 583,133 B). koffi stays
aboard at 1,021 KB; the hwsm swap is staged for the next release
(internal design note).

| Plugin process | RSS | Private | CPU | Uptime | avg CPU % |
| --- | ---: | ---: | ---: | ---: | ---: |
| PID 13604 | 46.5 MB | 65.0 MB | 45.8 s | 425 min | 0.18% |

The live-process row sampled the dev-junction `bin/plugin.js` launched at
~10:55 with the morning presentation-pass bundle (pre ring-stroke edit),
driving the full live deck for 7 hours, NOT the artifact packed above;
this build's own runtime numbers are the load-e2e ones below.

Parse bench (1000 iters, live mapping, region 241.7 KB):

| Path | mean µs | p50 µs | p95 µs | alloc/tick | retained |
| --- | ---: | ---: | ---: | ---: | ---: |
| raw copy (session.read) | 3.6 | 3.0 | 3.7 | | |
| shared-memory tick (520 readings) | 6.9 | 5.8 | 11.6 | 470 B | 3,512 B |
| gadget tick | n/a: HKCU\Software\HWiNFO64\VSB absent (Gadget reporting off on this machine; covered by e2e:gadget's synthetic key) | | | | |

Tick 6.5 → 6.9 µs mean against 520 readings (was 516): parse-path noise,
same class since the incremental reader. Render-path ruling: bench-parse
never executes gauge.ts, measure.ts or text-colors.ts (it stops at the
decoded snapshot), so the 1.3 render additions are judged by the compose
path under load instead. This session's suite:full (ALL GREEN, ZERO
ORPHANS) ran e2e:load against this working tree with gauges and text
colors live: 520 key contexts + 8 dials at 250 ms, 520 first frames, 0
invalid frames, 3,956 frames through 12 churn waves (~260 contexts each),
45 s soak RSS 130.2 → 130.3 MB (**+0.1 MB**), 0 late frames after mass
disappear, clean self-exit. computeGauge is O(zones) arithmetic and
resolveTextColors a palette lookup, both per-render not per-tick, and the
load numbers show no measurable cost. Ruling: no CPU or RSS regression;
pack growth accepted and staged to shrink ~380 KB at the hwsm swap.

### 2026-07-22 04:32: hwsm bridge lands (koffi out), adaptive labels + bottom-zone + badge fixes

| Artifact | Bytes | gzip |
| --- | ---: | ---: |
| .streamDeckPlugin pack | 191,087 B | 186,160 B |
| bin/plugin.js | 157,823 B | 47,956 B |
| bin/node_modules (total) | 0 B (0.0 KB) | |
| bin/hwsm.node | 113,664 B (111.0 KB) | |
| ui/ | 145,075 B (141.7 KB) | |
| imgs/ | 33,750 B (33.0 KB) | |
| layouts/ + manifest + themes | 5,031 B (4.9 KB) | |

| Plugin process | RSS | Private | CPU | Uptime | avg CPU % |
| --- | ---: | ---: | ---: | ---: | ---: |
| PID 11960 | 46.8 MB | 59.8 MB | 0.8 s | 4 min | 0.33% |

Parse bench (1000 iters, live mapping, region 238.5 KB):

| Path | mean µs | p50 µs | p95 µs | alloc/tick | retained |
| --- | ---: | ---: | ---: | ---: | ---: |
| raw copy (session.read) | 3 | 2.6 | 5.2 | | |
| shared-memory tick (513 readings) | 6.7 | 5.2 | 10.9 | 469 B | 3,512 B |
| gadget tick | n/a: HwinfoError: HWiNFO Gadget registry key HKCU\Software\HWiNFO64\VSB is not present (Win32 error 2): enable Gadget reporting in HWiNFO, or start HWiNFO. | | | | |

Reading: the koffi FFI (1,045,504 B raw, 443,817 B in the pack) is replaced
by hwsm, a purpose-built 113,664 B N-API addon exposing the plugin's exact
11-call Win32 surface (native/hwsm, internal design note). Pack lands
at 191,087 B against the 500,000 B target. The raw copy path holds at ~3 us
(readInto copies into the same reusable scratch RtlMoveMemory filled), so
the swap costs the hot path nothing; ui/ grew with the sdpi vendor and the
four PI panels since v1.0, and bin/node_modules is now empty. The quality
review re-verified the bridge (error-5, quarantine and dlopen paths), added
the bridge-failed status screen and unified the loader's two load paths;
sizes above are the post-review build. VirusTotal on this entry's build of
hwsm.node at the time: 0/70; releases attach each build's own SHA-256 in
`release-native-manifest.json` for anyone re-checking.

### 2026-07-22 19:56: hwsm becomes a capability API (opaque sessions, mandatory mutex)

| Artifact | Bytes | gzip |
| --- | ---: | ---: |
| .streamDeckPlugin pack | 215,713 B | 210,842 B |
| bin/plugin.js | 157,680 B | 47,812 B |
| bin/node_modules (total) | 0 B (0.0 KB) | |
| bin/hwsm.node | 156,160 B (152.5 KB) | |
| ui/ | 145,075 B (141.7 KB) | |
| imgs/ | 33,750 B (33.0 KB) | |
| layouts/ + manifest + themes | 5,031 B (4.9 KB) | |

| Plugin process | RSS | Private | CPU | Uptime | avg CPU % |
| --- | ---: | ---: | ---: | ---: | ---: |
| PID 74428 | 39.1 MB | 52.1 MB | 0.3 s | 1 min | 0.64% |

Parse bench (1000 iters, live mapping, region 239.4 KB):

| Path | mean µs | p50 µs | p95 µs | alloc/tick | retained |
| --- | ---: | ---: | ---: | ---: | ---: |
| raw copy (session.read) | 3 | 2.8 | 3.7 | | |
| shared-memory tick (515 readings) | 5.9 | 4.9 | 10.5 | 395 B | 3,584 B |
| gadget tick | n/a: HKCU\Software\HWiNFO64\VSB absent on this machine (covered by e2e:gadget's synthetic key) | | | | |

Reading: the 11-generic-call export surface is replaced by three capability
calls (getBuildInfo, openSharedMemory, openGadgetKey) returning opaque
type-tagged sessions; no handle, address, or BigInt crosses the boundary
anymore. Every read is now one native transaction: 0 ms mutex attempt,
header re-validation against the session's exact mapped length (checked
arithmetic, 64 MiB bound), copy, release; the mutex became mandatory and
WAIT_ABANDONED/WAIT_FAILED poison the session instead of degrading to an
unguarded read. Cost of all that guarding: none measurable. Raw copy holds
at 3.0 us mean (was 3.0-3.6 across prior entries) because the old path
already took the mutex per read; the new path only adds a 44-byte header
memcpy + integer checks under it. Tick mean 5.9 us vs 6.7 at the previous
entry (noise class), alloc/tick down 469 -> 395 B. The addon grows
113,664 -> 156,160 B for the session/validation logic, a version resource,
CFG + CET, and /Brepro deterministic linking (two clean builds hash
identical: ff72a2ab878f5bfa...); pack lands at 215,713 B, still well under
the 500,000 B target. Gadget reads now reuse one native WCHAR buffer per
provider instead of allocating a Node Buffer per registry value.

### 2026-07-23 03:45: sparkline rings collect for the process lifetime

The 60 s series eviction (shipped since 1.1.6.0) is gone: the poller now
feeds every tracked ring on every fresh snapshot, on screen or not, for as
long as a Sensor Reading key or Sensor Dial keeps the poller alive; with none visible the
poller still stops entirely, and a returning page resumes its line from the
samples it already had. Cost at full
saturation, measured with a 520-ring feed loop over the production
pushSample shape (20,000 iterations, Node 24): 12.2 µs per tick, 0.0012 %
of one core at the 1 s poll and 0.0049 % at the 250 ms floor. Ring count
is bounded by distinct readings ever shown, never by pages or keys
(about 515 publishable on this machine, roughly 150 KB of rings at total
saturation), and the ceiling case equals the standing e2e:load scenario
(520 contexts at 250 ms), green in the same gate. Rings stay
index-spaced: a poll-cadence change still clears them, and history stays
process memory, so a plugin restart starts lines fresh on purpose.

### 2026-07-24 15:35: 48 h hardware soak, preview 2 (1.3.90.0) on the live deck

`node scripts/soak-monitor.mjs --duration 172800 --out release/soak-20260722-1502.csv`,
external observation only at 60 s intervals (monitor PID 80696, exited on
schedule and printed its summary; per-stretch numbers recomputed with
`--summary` over per-PID splits of the same CSV). Window 2026-07-22T22:02:00Z
to 2026-07-24T22:08:00Z: 48.1 h, 2,887 samples, zero ERROR lines, 17 WARN
lines (every one attributed below), seven plugin restarts and two Stream Deck
app restarts (every one deliberate), one real sleep, one monitor-side
sampling failure.

Soaked bytes: `bin/hwsm.node` sha256 ff72a2ab878f... was byte-identical across
the entire window (deterministic /Brepro build; installs rewrote the file with
the same hash). The release-candidate stretches ran the exact preview 2 pack
(sha256 d1b58dea8905..., GitHub pre-1.4-issue3-2, manifest 1.3.90.0,
bin/plugin.js d9b327eabb35), installed 2026-07-23T14:17:12Z with the process
up from 14:21:24Z; the stretches before that ran the two dev builds noted in
the events list, carrying the same native addon.

| Stretch (PID, bytes) | Span (UTC) | Hours | RSS slope | Private slope | Handles | Avg CPU | WARN / ERROR |
| --- | --- | ---: | ---: | ---: | --- | ---: | --- |
| 24356, dev (sparkline-lifetime build) | 07-23 03:12 to 14:21 | 11.1 | -0.38 | +0.06 | 203 to 205 | 0.23% | 1 / 0 |
| 35524, preview 2 | 07-23 14:22 to 07-24 02:24 | 12.0 | -0.48 | +0.03 | 212 to 213 | 0.27% | 0 / 0 |
| 81412, preview 2 | 07-24 02:26 to 15:08 | 12.7 | +0.11 | +0.11 | 179 to 180 | 0.22% | 0 / 0 |
| 7816, preview 2 | 07-24 15:09 to 22:08 | 7.0 | -0.19 | -0.04 | 179 to 178 | 0.18% | 0 / 0 |

Slopes are MB/30 min, least squares per same-PID stretch (mixing PIDs would
fake a negative slope). Gates: RSS slope under +1 MB/30 min on every stretch
of 6 h or more: PASS, worst is +0.11. Private-bytes slopes match RSS: PASS.
Handles drift at most 2 inside any stretch, and the last stretch ends net
negative: PASS. CPU 0.18 to 0.27% lifetime average per stretch with no upward
trend across consecutive stretches; the 0.07% precedent above was v1.1
over a 35 min window, while these builds keep sparkline rings for the
process lifetime (03:45 entry; the poller still stops with nothing
visible) and drove the full Stream Deck + XL day and night, so the
comparable precedent is the 7 h live-deck 0.18%
(2026-07-16 entry): PASS. The four sub-6-h dev stretches (74428 3 min, 72260
2.7 h, 41696 33 min, 70144 1.8 h) sat under heavy local suite activity and
are below the gate floor; their endpoint deltas are unremarkable.

Preview 2 total: three stretches, 31.7 h, 1,903 samples, zero WARN, zero
ERROR, and a plugin log silent between startup lines.

Events, every one timestamped and attributed:

- 07-22 22:05Z pid 74428 to 72260: deliberate restart validating the
  monitor's own restart detection at soak start.
- 07-22 22:26 to 23:14Z, 10 WARN inside pid 72260: capability-API
  final-review suites; e2e harness plugins log WARN into the linked plugin's
  logs directory, excluded by timestamp per the runbook.
- 07-23 00:35 to 00:47Z, 6 WARN plus log rotations, then 00:50Z pid to
  41696: layout-change-fix gate suites, then that build's deploy.
- 07-23 01:23Z pid to 70144: unit-corridor plus in-place-reopen build
  deploy (commits landed 01:22:41Z).
- 07-23 03:12Z pid to 24356: sparkline-lifetime build deploy (8ec6f0b,
  committed 03:11:46Z).
- 07-23 03:27Z: real HWiNFO restart test (TESTING.md row 12); the single
  03:28Z WARN is the designed staleness warning.
- 07-23 14:05 to 14:25Z: excluded suite window (unit tests, test:native,
  pack for the preview 2 cut); 14:22Z pid to 35524 is the preview 2 install.
- 07-23 18:30Z: one sample row failed monitor-side (powershell exec error
  under system load) and the next two samples never landed; same plugin PID
  and handle count on both sides, working set dipped to 9.9 MB (trim) and
  recovered. Not a plugin event, not sleep.
- 07-24 02:25Z app restart #1 (sdAppPid 29760 to 49796), plugin back
  02:26:00Z as 81412 with a fresh shared-memory session (row 11).
- 07-24 05:59:45Z: real HWiNFO layout growth mid-soak; the poller logged
  "Data source layout changed; reopened in place", no WARN, no error frame.
- 07-24 14:51 to 14:58Z: sleep testing at the desk; the long sleep shows as
  the only true sampling gap (14:53:00 to 14:56:34Z, 214 s) with PID 81412
  continuous across it, device reconnects on each resume, and zero staleness
  WARN: resume beat the 15 s hold window (row 13).
- 07-24 15:08Z app restart #2 (49796 to 26868), plugin back 15:09:00Z as
  7816 (row 11 again).
- Post-window note: the Stream Deck app process ended abruptly at 22:21Z,
  13 minutes after the window closed, leaving no fault record; the plugin
  was idle at the time and exited with it. Outside the window, recorded here
  only so the timeline stays complete.

Verdict: every soak gate PASS with margin. Nothing in 48.1 h of external
observation blocks promoting the preview 2 bytes to 1.4.0.0.

### 2026-07-25 20:56: unit-guard re-measure (1.4.1 fast path)

The 1.4.1 stale-unit fix adds up to 8 unit-word compares per entry to the
fast path (`SnapshotParser.refresh`). Re-measured with the documented
invocation, `node --expose-gc --import tsx scripts/bench-parse.ts`, against
the live mapping (520 readings, region 247,480 B): tick mean 10.5 µs, p50
9.4, p95 13.8; alloc/tick 411 B (measurement floor); retained 3.5 KB across
the 1,000-iteration pass (noise). The pre-guard figure was 5.8 µs mean at
516 readings, so the guard costs about 5 µs per tick, roughly 0.001% of one
core at the 1 s poll, and steady-state allocation stays at the floor.

### 2026-07-29 15:05: adversarial soak (1.4.1 deployed retail build)

First run of the paired soak harness: `node scripts/soak-monitor.mjs
--interval 30` observing the deployed 1.4.1 plugin (stock log level, no
debug env), with `node scripts/soak-adversary.mjs` injecting real faults
against the live stack and `--events` folding its verdicts into the
summary. Window 21:08 to 22:04Z (0.9 h, 113 samples), CSV
`release/soak-20260729-adversarial.csv`, events
`release/soak-adversary-20260729.jsonl`.

All five injected faults survived, 5/5 PASS:

- 6 s and 8 s consistency-mutex holds (inside the 15 s grace): silent
  ride-through, zero log lines, values held, no restart.
- 25 s mutex hold (past grace): degraded to WARN "HWiNFO unavailable
  [busy]", reopened shared memory on its own after release, same PID. The
  1.4.1 busy path proven against the real provider.
- plugin kill: the app restarted it (PID 38272 to 15212), fresh instance
  reopened the source.
- app restart: full stack back (app 22052 to 34044, plugin 22828).

Monitor corroboration: exactly 2 restarts, both within one sample of an
injected kill, none spontaneous; exactly 1 WARN, the provoked busy line; 0
ERROR; 0 HWiNFO-absent samples; handles 176 to 175 (max 189); CPU 0.21%.
RSS 47.3 to 48.0 MB (max 51.3). The +3.70 MB/30 min RSS slope over the
longest same-PID segment (75 samples) is warmup-dominated by construction:
the adversary restarts the process mid-window, so the segment starts at
boot. Steady-state leak behavior is owned by the 48 h soak above (+0.11
MB/30 min); this entry's claim is fault recovery, not slope.
