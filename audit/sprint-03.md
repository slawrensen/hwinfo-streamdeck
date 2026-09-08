# Sprint 3: freshness evidence and registry interleaving

Reviewed September 7, 2026 against audit baseline
`2ca44e95c2d8b3442c3ed411952621b254d4cbf0` and existing integrity candidate
`7320a83436fa153ca37405378ea25367b9cd811e`. This work starts from that
candidate and incorporates the Sprint 2 owner-check change
`11991dd69b8d83ec722874300567df2776fbf53e` before extending its parser.
AGENTS.md was read. No competitor implementation was accessed. No live
HWiNFO setting, installed plugin, profile, tag or release was changed.

## Result and release boundary

D02/D07 containment already existed in the candidate: an initial Gadget
scan has zero value evidence, and constant values display Age unknown
rather than claiming HWiNFO stopped. This patch closes additional evidence
and lifecycle gaps and detects observable registry field interleavings.
The automated checks below pass. This is **not release qualification**.

U1's controlled registry interleaving is now reproduced through the real
Windows native bridge and contained by a bounded validation reread. A
writer paused in a stable intermediate row remains indistinguishable from
a completed write. The actual HWiNFO producer's write ordering and timing
have not been captured. Atomicity and physical qualification remain open
release gates; passing these synthetic fixtures does not close them.

## Findings closed in this patch

| Trigger | Previous result | Result |
| --- | --- | --- |
| Open persistent Gadget data with no changes | Face says Age unknown, but diagnostics reports age since provider open as sample age | Diagnostic sample age is null |
| Rebuild shared-memory topology with unchanged producer timestamp and numbers | Rendering revision refreshes the watchdog | Separate evidence revision stays unchanged |
| Rewrite an owner or native unit without a producer sample | Rebuild can impersonate fresh measurement evidence | Only a producer timestamp or finite same-key/type/unit value change advances evidence |
| Invalid session reopens onto identical bytes | Reset timestamp creates another fresh window | Same-source evidence survives reopen and failed retry |
| Stale Shared Memory probe selects Gadget | Prior snapshot is briefly labelled as Gadget | Held snapshot retains its actual source until a new observation |
| Successful reopen repeatedly followed by a busy read | Open time can extend held freshness | Prior evidence age survives every retry |
| Gadget raw number changes spelling, or becomes finite from invalid | Raw-string difference supplies liveness evidence | Two finite, numerically different values are required |
| Any Gadget row field changes between validation observations | Mixed identity/unit/value can be returned | Whole scan returns null before identity journal, digest or evidence updates |
| Formatted 176 F is paired with raw 80 while the writer pauses | Two repeated rows agree but still contain contradictory numbers | Whole scan is withheld until raw and displayed numeric precision agree |
| First Gadget scan is withheld by validation | Could be confused with an empty source | Open closes the handle and reports busy; Auto preserves that observation when Shared Memory is absent |

The parser validates all entry identities/units before mutating cached
values. A later rebuild therefore cannot consume an earlier value change
before the evidence comparison. The standalone probe consumes the same
evidence revision as the poller. Existing settings and display-unit
preferences are not rewritten.

## State and sampling contract

| Observation | Display/status meaning | Sampling and recovery |
| --- | --- | --- |
| Initial or constant Gadget data, no observed numeric change | Freshness unknown; internal stale state, Age unknown copy | No invented sample age or sparkline points; check Gadget or use Shared Memory |
| Finite Gadget value changes in the same safe key/unit | Source-level change evidence within the existing grace | Resume sampling; evidence does not prove every row's age |
| Gadget stops changing past grace | Unknown whether steady or abandoned | Clear the history segment; do not assert a producer stall |
| Gadget field validation disagrees | Transient skipped scan | Withhold the entire scan, create a history gap and retry on the next poll |
| Shared timestamp or safe numeric value changes | Producer measurement evidence | Capture subsecond changes and steady values on a new producer timestamp |
| Shared topology/render revision only | No new measurement evidence | Continue watchdog age; do not invent a point |
| Mutex busy, reopen or stale probe | No new measurement evidence | Preserve the evidence baseline; stale/unavailable recovery still runs |
| Missing/nonfinite reading or native-unit/source change | Prior segment no longer applies | Clear its history while keeping subscriptions |

Gadget still has source-level evidence only. Another row changing does not
establish a producer timestamp for a constant row. Repeated row agreement
also does not establish atomicity or producer liveness.

## Controlled U1 investigation

`node --import tsx scripts/gadget-interleaving.mjs --expect-contained --expect-consistent`
uses a unique `HKCU\Software\HwinfoGadgetInterleaving_<pid>_<uuid>` fixture
and a child `reg.exe` writer. The wrapper pauses between real native field
queries. It does not change the native API or use HWiNFO's actual VSB key.

Before containment, the fixture returned:

- Before: `g:Fixture GPU A:Temperature A`, 40 C.
- Interleaved: `g:Fixture GPU A:Temperature B`, 80 C.
- After: `g:Fixture GPU B:Temperature B`, 80 C.

After containment, that intermediate scan is null. Tests exercise a change
in each of Sensor, Label, formatted Value and raw Value fields, plus busy
cold-open behavior. No evidence or ambiguity history is committed from the
withheld scan.

A second fixture deliberately pauses after changing formatted `80 C` to
`176 F`, before changing raw `80` to `176`. Both validation observations
agree on the intermediate row, but the numeric consistency check withholds
it. Once the writer completes, it returns 176 F. Raw remains authoritative:
the formatted value supplies a precision interval, not a replacement number.
Tests cover dot/comma decimals, space/NBSP/narrow-space/apostrophe grouping,
Indian grouping, signs, scientific notation and rounding boundaries.
Ambiguous punctuation accepts either valid numeric interpretation. Boolean
and nonnumeric formatted text keeps its previous behavior. Synthetic
writers now update formatted and raw fields together in complete samples.

A third fixture writes a new owner's matching `50 F`/`50` fields, pauses
before replacing the old owner name B with C, and reads between those steps.
The provider still returns 50 F under B's saved key; after the writer
finishes it returns that value under C. **This residual identity failure
is recorded, not called a passing atomicity test.** A transaction/sequence
contract or stronger source policy is needed before claiming atomic Gadget
measurements. It does not establish that real HWiNFO uses this write order.

## Validation and evidence

Raw logs are local, ignored artifacts under
`release/audit-evidence/` in `hwinfo-audit-freshness-20260907`.

| Check | Result | Evidence file |
| --- | --- | --- |
| npm ci | Passed; lock audit reported one moderate and one high advisory for release review | Command transcript |
| Four initial poller regressions before fix | Failed as expected | sprint-03-red.log |
| Three parser evidence regressions before fix | Failed as expected | sprint-03-parser-red.log |
| Numeric Gadget formatting regression before fix | Failed as expected | sprint-03-gadget-red.log |
| Interleave and cold-open regressions before containment | Failed as expected | sprint-03-interleave-red.log |
| npm run build:native | Passed, production and test variants | sprint-03-build-native.log |
| npm run build | Passed | sprint-03-number-build.log |
| npm test | 774 passed, zero skipped | sprint-03-number-unit.log |
| npm run test:native | 84 passed, zero skipped | sprint-03-native-number-green.log |
| npm run lint; npm run typecheck | Passed | sprint-03-number-lint.log; sprint-03-number-typecheck.log |
| npm run e2e:resilience | Passed | sprint-03-resilience.log |
| npm run e2e:gadget | Passed including numeric follow-on | sprint-03-number-gadget-e2e.log |
| npm run e2e:reading-links | 64 checks passed including numeric follow-on | sprint-03-number-reading-links.log |
| npm run e2e:socket-close | Passed | sprint-03-socket-close.log |
| Controlled U1 before and after | Mixed row reproduced, then withheld | sprint-03-u1.json; sprint-03-u1-contained.json |
| Paused numeric contradiction before fix | Failed as expected | sprint-03-number-red.log |
| Numeric contradiction containment and residual owner fixture | Numeric contradiction withheld; paused owner replacement remains unprotected | sprint-03-u1-number-contained.json |
| Native scan benchmark | Measured, see PERF.md | sprint-03-scan-before.json; sprint-03-scan-after.json; sprint-03-scan-final-isolated.json |
| Process cleanup check | No matching node/reg child processes remained | Command transcript |

The final integrated candidate still requires the root agent's full suite
and package checks. A final small preservation of the old evidence clock
during a source-changing reopen was unit-tested after the e2e runs; it is
included in the pending integrated full-suite gate.

The bounded reread adds four queries per occupied row. At 39 sparse rows,
500 measured scans after 50 warmups changed from 1,141 to 1,297 queries.
The final run with row and numeric checks measured mean 5.15 ms and P95
5.78 ms, versus baseline 4.56/4.95 ms, on this Windows machine with Node
v24.16.0. The earlier row-only run was 6.03/7.95 ms; these separate short
runs include system variance and do not attribute a speedup to the later
check. These are synthetic scan measurements, not host CPU,
an eight-hour resource result or physical-device evidence. PERF.md names
the exact benchmark harness and records the full-range query bound.

## Still blocked or not run

- Supported Gadget producer write-order/transaction contract and actual
  HWiNFO captured rewrite sequences. The paused intermediate fixture above
  remains a demonstrated limitation of independent registry fields.
- Current exact-pack installation, real sensor comparison and physical
  Stream Deck operation, sleep/wake, USB/reconnect and session/RDP matrix.
- Eight-hour and 48-hour exact-pack resource/physical soaks.
- Clean-Windows novice trials, locale/physical recognition and real
  previous-version profile import/rollback.

Rollback reverts these implementation changes without bulk settings edits.
Preserve the identity journal, profiles and all red/green evidence. An older
provider can return the mixed scan again; rollback is not a Gadget
atomicity fix. No merge, tag, publishing or Marketplace approval follows
from this report.
