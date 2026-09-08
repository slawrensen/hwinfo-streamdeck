# Sprint 1: statistic capability and unit resets

Audit baseline: `2ca44e95c2d8b3442c3ed411952621b254d4cbf0`.
Implementation base: `7320a83436fa153ca37405378ea25367b9cd811e`.
Branch: `fix/audit-statistics-20260907`.

The existing integrity candidate already withheld Gadget historical numbers
with NaN fields and reset dial sessions on native-unit/backend changes. This
follow-up makes the capability explicit, proves the actual rendering paths,
and explains automatic resets on the selected dial. It does not claim the
existing candidate still mixed Celsius and Fahrenheit.

## Behavior

- `Reading.statistics` is optional for compatibility. Omitted or `producer`
  retains the existing producer-history contract; `unavailable` forces every
  historical mode to unavailable even if a numeric placeholder field exists.
  Gadget explicitly declares `unavailable` and retains NaN historical fields.
- Current remains available. Keys and detail tiles render N/A for unavailable
  MIN/MAX/AVG across single, dual, triple and quad layouts.
- Dial statistics remain sample-weighted local observations. Changing the
  native unit, reading type, backend or approved-pair revision resets the
  affected session before consuming the new sample. A selected reading shows
  the corresponding reset reason through the existing 1.6-second dial hint.
  Off-screen readings reset without replacing the selected reading's hint.
- Changing only the plugin's Fahrenheit display option preserves native
  history. The regression checks 45 C converted to 113 F separately from a
  producer-native transition from 45 C to 113 F, which starts a new session.
- No settings fields are rewritten, renamed or removed. The optional runtime
  capability is not a settings-schema change. Native source/API/version and
  the package version are unchanged by this follow-up.

## Evidence

Production-module regressions were added before implementation. On the
implementation base they produced three failures: unsupported numeric fields
were still accepted when explicitly marked unavailable, and native-unit and
backend resets did not return an explainable reason. Eight existing cases
passed; no tests were skipped. The earlier NaN containment and unit arithmetic
were already correct and are not misreported as newly repaired here.

The new rendering assertions import `compose`, `composeChunkFace`, and the
dial sampling/composition methods used by the plugin. They exercise the
45 to 65 to 50 Gadget sequence across every historical mode and key/detail
density. All three dial views show the new 113 F session and its reset reason.
The tests use synthetic readings, not a physical-device reproduction.

Local raw evidence is kept in ignored `release/audit-evidence/`:

| Command or artifact | Result |
| --- | --- |
| `npm ci` | Exit 0. Existing lockfile reports one moderate and one high advisory; dependency remediation belongs to release integrity. |
| `npx tsx --test test/measurement-integrity.test.ts` before implementation | 8 pass, 3 fail, 0 skipped; `sprint-01-red.log`. |
| `npx tsx --test test/stats.test.ts test/measurement-integrity.test.ts` | 23 pass, 0 fail, 0 skipped; `sprint-01-green.log`. |
| `npm run lint` | Exit 0, zero warnings; `sprint-01-lint.log`. |
| `npm run typecheck` | Exit 0; `sprint-01-typecheck.log`. |
| `npm test` | 758 pass, 0 fail, 0 skipped; `sprint-01-unit.log`. |
| `npx tsx release/audit-evidence/render-statistics.mts` | Exit 0; four SVG examples produced by the production composers. |

The SVG examples are `key-gadget-current.svg`, `key-gadget-max.svg`,
`dial-before-unit-change.svg`, and `dial-after-unit-change.svg`. They are
labelled synthetic fixture output and are not marketing or hardware captures.
New tests are in the already registered `test/measurement-integrity.test.ts`.

## Remaining gates and scope

The integration owner must run build/native, `test:native`, `e2e:gadget` and
`suite:full` against the combined final head. They were not run concurrently
from this worktree because native/live fixtures share host state. Prior
candidate logs do not qualify this new head. Real HWiNFO and physical Stream
Deck acceptance remain external gates; there is no release approval here.

Backend transitions have explicit reset domains. A same-backend producer
restart that is entirely hidden inside the existing reconnect grace is not
an independently authenticated producer epoch. This follow-up does not infer
one from a successful provider reopen. Freshness evidence and continuity
remain the responsibility of the source/poller contract.

Recommended PR grouping: combine this follow-up with the existing measurement
integrity foundation and the owner/freshness fixes, because all share the
reading and snapshot contract. Keep release-workflow hardening and readability
separate so their review and rollback remain independent.

Rollback: revert this follow-up without changing saved settings. The existing
candidate still supplies NaN Gadget history and unit-safe local resets; the
new capability enforcement and visible reasons would be removed. Preserve
the red/green logs and regression fixtures when preparing any rollback.

## Follow-up: restored dial first-frame integrity

Integration base: `2b352a312e61593378a01d6c02632ded6422cb93`.
Branch: `fix/audit-dial-restore-20260907`.

A lifecycle review found a remaining D04 path after the per-tick correction:
when the last dial was hidden, its cached session could contain a 45 C minimum.
On return, `retain()` could synchronously acquire a new 113 F reading before
the cached state was restored to the visible instance map. The first
`onWillAppear` render then used the old 45 minimum with the new F unit. The
next ordinary tick corrected the session, leaving the first frame wrong.
Replayed appearances could also draw retained history before checking its
current source, unit, or availability.

`onWillAppear` now passes the current snapshot through the existing session
sampling and domain validation before its first render. Source/native-unit
changes reset with the existing visible reason, missing/nonfinite readings
drop their history, and stale/unavailable sources clear the session. New dials
seed their first observed sample. A repeated observation keeps its history
without being counted twice. This changes no saved setting and adds no timer
or acquisition loop.

The registered `test/measurement-integrity.test.ts` exercises the actual
`SensorDialAction.onWillAppear` method and production `composeDialSvg`. It
replaces only the SDK output sink and shared poller's acquisition boundary,
including the synchronous cold-retain ordering. Hidden, replayed and new
appearances cover all three dial views; stale, unavailable, missing and
nonfinite first-frame histories are also covered. A frozen settings object
and a `setSettings` spy assert that the lifecycle does not rewrite settings.

Evidence in this worktree's ignored `release/audit-evidence/`:

| Command | Result |
| --- | --- |
| `node --import tsx --test --test-name-pattern="dial appearance" test/measurement-integrity.test.ts` before the fix | 0 pass, 15 fail, 0 skipped; `sprint-01-restore-red.log`. |
| The same command after the fix | 15 pass, 0 fail, 0 skipped; `sprint-01-restore-green.log`. |
| `npm test` after adding preservation and nonfinite cases | 809 pass, 0 fail, 0 skipped, including all 25 lifecycle cases; `sprint-01-restore-unit.log`. |
| `npm run lint` | Exit 0, zero warnings; `sprint-01-restore-lint.log`. |
| `npm run typecheck` | Exit 0; `sprint-01-restore-typecheck.log`. |

These are deterministic action/module tests on Windows, not physical Stream
Deck captures. The integration owner must run the final combined full suite.
Rollback is the small appearance synchronization block; keep the regressions
and evidence, and do not rewrite user settings.

## Follow-up: selecting a retained dial session

Integration base: `c5f404448359e7024d801537ec62caeb6272e6c6`.
Branch: `fix/audit-dial-selection-20260907`.

The first-frame appearance fix does not cover every immediate render. In
single view without a rotation set, A can accumulate 45/65 C and then become
untracked when B is selected. The relevance-bounded store deliberately keeps
A's session. If the producer changes A to 113 F while B remains selected,
reselecting A through settings or dial controls used to draw its old minimum
and maximum using the new unit until the next ordinary poller callback.

All immediate render entry points were inspected:

| Entry point | Required invariant |
| --- | --- |
| `onWillAppear` | Preserve the existing cold-retain and replay validation before the first frame. |
| `onDidReceiveSettings` | Validate newly selected readings and newly visible rows before drawing. |
| `adoptReading`, shared by rotation, taps, carousel and control selection | After the awaited settings write, use the latest poller observation and validate the current visible state. |
| State-only gestures and controls | Repainting MIN/MAX/AVG or a reset cannot bypass domain validation. |
| Theme callback and overlay expiry | A redraw must not revive an old session under the current reading unit. |
| Ordinary poller tick | Preserve sampling for the configured set, hidden dials and unchanged-observation deduplication. |

Production-module regressions exercise settings, selection and the
real `renderAll` method, replacing only the SDK frame sink and poller status.
The matrix covers all three dial views, same/native-unit/source domains,
repeated renders, display-only conversion, stale status, source changes while
a host settings write is pending, and disappearance before that write returns.
Frames capture statistics as scalar copies at submission, so a later update
cannot retroactively make the first frame look correct.

`renderAll` now runs the existing domain-aware sampler before each composition
and clears history for a non-ok source. Unchanged observation deduplication
prevents replays from adding samples; configured and hidden-set sampling on
ordinary ticks remains intact. The appearance correction is preserved.
`adoptReading` obtains the latest poller status after its awaited settings write,
so an older captured observation cannot be drawn after an intervening source
transition. No saved setting, native contract or acquisition loop changes.

After the central test slot was granted:

| Command | Result |
| --- | --- |
| `npm ci --ignore-scripts` | 156 packages installed, zero advisories; no install scripts executed. |
| `node --import tsx --test --test-name-pattern="dial selection validates" test/measurement-integrity.test.ts` before the runtime fix | 8 pass, 14 fail, zero skips; `sprint-01-selection-red.log`. |
| `node --import tsx --test test/measurement-integrity.test.ts test/stats.test.ts` after the fix | 70 pass, zero failures/skips; `sprint-01-selection-green.log`. Includes all 22 selection cases and existing appearance regressions. |
| `npm run lint` | Exit 0, zero warnings; `sprint-01-selection-lint.log`. |
| `npm run typecheck` | Exit 0; `sprint-01-selection-typecheck.log`. |

Logs remain under this worktree's ignored `release/audit-evidence/`. These are
production action/module tests with mocked SDK output, not device captures.
No native, e2e, registry fixture or installed-plugin operation ran here. The
integration owner must rerun required combined-head checks and resource gates;
this change does not claim new performance measurements. Rollback reverts the
render validation and latest-status selection changes while retaining the
appearance fix, saved settings, regression fixtures and evidence.
