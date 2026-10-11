# hwsm native testing

How the native addon is proven, and the manual host-condition matrix that
automation cannot reach.

## Automated layers

| Layer | Command | What it proves |
| --- | --- | --- |
| Native integration | `npm run test:native` | Real named mappings/mutexes/registry keys via `scripts/native-test-producer.mjs`: lifecycle, exact bounds (page-granular sections, 64 MiB cap, overflow math), every wait result (read-path busy, open-time busy fails fast without blocking, abandoned, injected WAIT_FAILED/release-failure via `hwsm_test.node`), registry variants (empty, no terminator, embedded NUL, growth, over-cap, wrong type, odd bytes, deleted-underneath), receiver forgery, hygiene soak (10k reads + 2k open/close, handle and RSS bounds), finalizer/teardown child, loaded-file locking |
| Boundary e2e | `npm run e2e:native-edge` | Full plugin: mapping-without-mutex never reads unguarded, recovery when the mutex appears, mid-run layout growth invalidates and reopens, a protocol-mismatched `hwsm.node` fails closed to the "Plugin damaged" screen |
| State machine e2e | `e2e:resilience` / `e2e:gadget` / `e2e:dead-fallback` | Poller staleness, DEAD magic, producer exit/restart, Gadget digest freshness, fallback and upgrade probes |
| ABI matrix | CI `abi-matrix` job / `node scripts/abi-check.mjs` | The SAME Node-20-built binary (no rebuild) completes require → getBuildInfo → open → read → close under Node 20, 22, and 24 |
| Packaging gate | `node scripts/validate-native.mjs` | `bin/hwsm.node` present, protocol/ABI/source-id consistent, no test addons, staging files, PDBs, or koffi in the pack |

Test-only builds: `hwsm_test.node` (compiled with `HWSM_TEST_HOOKS`; adds
`_testControl` fault injection) and `hwsm_protomm.node`
(`HWSM_PROTOCOL_VERSION=999`). Both exist only under
`native/hwsm/build/Release/`, are absent from the release addon's compile,
and are blocked from the pack by the packaging gate.

## Manual host-condition matrix

Conditions that depend on real elevation, sessions, or power transitions.
The addon opens the mapping and mutex with `FILE_MAP_READ` / `SYNCHRONIZE`
only, so what a non-elevated consumer may read is decided entirely by the
DACL HWiNFO puts on its own objects, not by elevation as such. Row 2
measured that directly on 2026-07-25: an elevated HWiNFO stayed fully
readable from a non-elevated Stream Deck. Treat "elevated producer means
`access-denied`" as unproven for HWiNFO; it is the behavior to expect only
where a producer restricts its objects deliberately.

Record for each executed row: date, Windows/Stream Deck/HWiNFO versions,
session and elevation relationship, observed error code. Never mark an
unexecuted row as passed.

`node scripts/soak-monitor.mjs` records the soak evidence for rows 11 to 13:
external process sampling only (RSS and handle slopes, timestamped restarts,
absences, and sampling gaps), never in-process instrumentation, so the
soaked bytes are exactly the shipped bytes.

| # | Condition | Expected | Status |
| --- | --- | --- | --- |
| 1 | Standard HWiNFO / standard Stream Deck | Live readings via shared memory | PASS 2026-07-22, Win 10.0.19044, SD dev-linked, HWiNFO SM v2.1: 21 sensors / 515 readings via probe + live deck |
| 2 | Elevated HWiNFO / standard Stream Deck | Live readings: HWiNFO's objects carry a DACL the interactive user can read, so elevation alone does not deny the consumer | PASS 2026-07-25, Win 10.0.19044, real deck. Elevation confirmed by token query, not inferred: HWiNFO64 pid 36424 `TokenElevation` nonzero (ELEVATED), StreamDeck pid 86416 and the plugin's node pid 92660 both not elevated. Plugin log across the relaunch: 15:59:48Z mapping gone while HWiNFO was down (`HWSM_NOT_FOUND: OpenFileMappingW failed (Win32 error 2)`) held the last values, 16:00:02Z surfaced the honest "Start HWiNFO" screen once the hold window passed, 16:00:04Z reopened shared memory against the now-elevated producer, 16:00:48Z absorbed a layout change in place. One WARN (the legitimate one while HWiNFO was genuinely down), zero ERROR. **No mutex regression:** every failure was `OpenFileMappingW` error 2, never error 5 and never `OpenMutexW`, so the non-elevated plugin acquired the consistency mutex and completed guarded reads throughout. This is the condition where the mandatory-mutex path could have diverged from 1.3.0's unguarded fallback, and it did not |
| 3 | Standard HWiNFO / elevated Stream Deck | Live readings (elevated consumer may read non-elevated objects) | not executed |
| 4 | Elevated HWiNFO / elevated Stream Deck | Live readings | not executed. Supporting evidence only, not a pass: on 2026-07-25 `npm run probe` happened to run from an elevated shell against the elevated HWiNFO of row 2 and read 20 sensors / 496 readings through the same reader and addon the plugin uses. That exercises the elevated-consumer direction of the access model but not Stream Deck itself, so the row stays open. Rows 3 and 4 both put an elevated consumer against a producer a non-elevated consumer already reads (row 2), so neither is expected to fail |
| 5 | Different Windows user runs HWiNFO | `Global\` mapping readable only with rights; typically `access-denied` or `not-running` | not executed |
| 6 | Fast User Switching (plugin session inactive) | Polling continues or idles; recovery after switch-back | not executed |
| 7 | Separate interactive session (console + RDP concurrently) | Same-session objects only; `Global\` namespace readable per ACLs | not executed |
| 8 | RDP session | Live readings within the session | not executed |
| 9 | Producer using `Global\` namespace | Default production path; live readings | PASS 2026-07-22 (row 1 is the `Global\` producer) |
| 10 | Test helper using `Local\` namespace | Native suite and e2e producers use `Local\`; all suites green | PASS 2026-07-22 (`test:native` 43/43, all e2e suites) |
| 11 | Stream Deck restart while HWiNFO keeps running | Fresh session opens on restart; live readings resume | PASS 2026-10-11 on the 1.7.0.0 candidate, soak-1.7.0.0-d28-20261011-1236.csv: a real app restart with HWiNFO up at 19:44:47Z (app PID 17272 to 72300, plugin PID 3192 to 89788); the new plugin logged "Opened HWiNFO data source: shared-memory" at 19:44:48Z, zero WARN. First passed 2026-07-24 (soak-20260722-1502.csv, two restarts) |
| 12 | HWiNFO restart while Stream Deck keeps running | stale → reopen probe → live (resilience e2e mirrors this synthetically) | PASS 2026-10-11 on the 1.7.0.0 candidate, same CSV and plugin log: HWiNFO quit 19:45:04Z, values held 13 s, then not-running (WARN 19:45:17Z); HWiNFO back 19:45:20Z, one busy-mutex WARN while it started (19:45:27Z), reopened 19:45:28Z (8 s after it returned), startup layout growth reopened in place at 19:45:53Z, zero ERROR. First passed 2026-07-23 |
| 13 | Sleep and resume | Frozen pollTime → stale → recovery on resume | PASS 2026-10-11 on the 1.7.0.0 candidate, same CSV: real S3 sleep at the desk (Windows logs sleep entered 19:46:39Z, clock resynced 19:46:45Z to 19:48:51Z on resume), sampling gap 19:46:00Z to 19:48:55Z (176 s), plugin PID 89788 on both sides, devices reconnected 19:49:00Z and 19:49:03Z, zero WARN and zero ERROR after resume. First passed 2026-07-24 |
| 14 | Sign out and sign in | Plugin process restarts with the session; live readings | not executed |
| 15 | Plugin reinstall/update while the old plugin process is active | Replacement fails cleanly; old binary byte-identical; clear stop-the-plugin message | PASS 2026-07-22 (`copy-hwsm.mjs` against the live plugin: EPERM path, dest hash unchanged, no staging leftovers) |
| 16 | Plugin reinstall/update after the old process exits | Replacement succeeds; new hash verified | PASS 2026-07-22 (post-stop vendor + `test:native` locking case) |

## Local ABI runs (2026-07-22)

Node-20.20.0-header build `sha256 ff72a2ab878f5bfa…` (the vendored release binary):

- Node 20.20.0 (the Stream Deck bundled runtime): PASS (napi 9, modules 115)
- Node 24.16.0: PASS (napi 10, modules 137)
- Node 22: no local runtime on this machine; covered by the CI `abi-matrix` job
