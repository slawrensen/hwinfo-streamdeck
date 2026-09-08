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
