# Gadget identity and soak observation corrections

Reviewed baseline: `5d4c72d2241e77eb250c7adbe3251d69cbdc2906`.
Validated integrated runtime: `6bc3fde04efdc46c2948c5fb92a0e8dc4b2fdb68`.
The changes are in native GitHub Stack #30, PRs #25 through #29. The Gadget
fix belongs to #26; the external measurement fixes and this evidence belong
to #29. PRs #27 and #28 were rebased without changing their scope.

The implementation uses two existing boundaries: validate producer identity
before publishing a reading, and preserve observation validity before
summarizing resources. It does not add another poller, retry timer, native
API, producer process probe or settings migration.

## Gadget: identity comes from the producer

The review found a deterministic defect separate from U1. A missing LabelN
became `Reading N`, and that display fallback also became the saved identity.
Two same-source, unlabeled rows could therefore move an existing selection
to another reading when the earlier slot disappeared.

The correction requires nonblank producer Sensor and Label fields. Absent
Sensor fields remain sparse holes. Incomplete rows are withheld; they do
not publish values or establish measurement freshness. Complete names retain
their exact spelling rather than being trimmed or rewritten.

There is a narrow legacy collision: a real producer can itself use the label
`Reading 0`. A previous plugin may have stored the identical key for an
unlabeled slot. Exact historical fallback labels `Reading 0` through
`Reading 1023` therefore use a distinct tagged named-key encoding. The old
key is not aliased to that new key. Genuine named readings remain selectable,
and affected users must reselect them explicitly. This avoids silent
adoption even when no earlier ambiguity journal exists. Other ordinary
complete names retain their keys. There is no bulk settings rewrite.

## U1: the producer transaction boundary remains unavailable

The controlled writer can store matching `50 F` and raw `50` under owner B,
pause, and only later replace the owner name with C. A reader sees the same
registry state as a legitimate new sample from B. No reader-only comparison
can distinguish those cases without additional producer evidence.

This proves a limitation under a synthetic allowed write sequence. It is
not proof that a supported real HWiNFO build emits that sequence, and it
must not be described as the cause of the GPU-driver incident.

Primary-source research supports the limited contract:

- HWiNFO's author describes volatile Gadget indices as intentional and
  recommends Shared Memory for advanced functionality. This does not
  specify a transaction boundary for Gadget updates.
  [Author response, September 2025](https://www.hwinfo.com/forum/threads/gadget-reporting-volatile-indices.10695/)
- For temporary invalid sensor readings, the author says the relevant
  registry entry is deleted without reordering indices in that case. That
  narrower behavior does not establish a universal topology-update rule.
  [Sensor-loss behavior](https://www.hwinfo.com/forum/threads/hwinfo-loses-some-sensors.8380/)
- Microsoft documents an atomic registry-state read with
  `RegQueryMultipleValuesW`. Such a call could avoid reads spanning multiple
  registry states, but an already stored intermediate producer state would
  still be returned. That latter limitation follows from the controlled
  counterexample; it is not a claim made by the Microsoft page.
  [Microsoft API contract](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regquerymultiplevaluesw)

| Approach | Result | Decision |
| --- | --- | --- |
| Require complete producer names and separate historical fallback keys | Closes the reproducible positional-identity defect | Implement |
| Existing bounded row reread and numeric agreement | Withholds detectable interleavings and contradictory values | Retain |
| New atomic native batch-read API | Can avoid read-side interleaving but cannot close coherent intermediate producer states | Defer; not a solution to residual U1 |
| More retries, delays, process-presence checks or invented heartbeat | Supplies no proof of a completed producer measurement | Do not add |
| Producer transaction/sequence contract | Could establish a completed measurement boundary if supplied and verified | No such contract obtained |
| Shared Memory-only candidate | Removes the Gadget path and its compatibility fallback | Separate product/source-policy decision |

The proposed release policy remains Gadget as a bounded compatibility
source, Shared Memory preferred, and no atomic Gadget guarantee. Current
source defaults and saved choices are preserved by these corrections.
Research and implementation do not accept residual release risk on the
maintainer's behalf. Exact-pack hardware qualification and the source-policy
disposition remain open. Earlier wording that automatically classified U1
as a confirmed normal-HWiNFO S0 was stronger than the evidence supports.

## PR29: collection failure is an unknown observation

The old collector wrote zero HWiNFO processes and no plugin PID when WMI
collection failed. Its CSV parser discarded the error note, so the summary
turned a collection failure into a claim that applications had stopped.
Separately, host restart events were calculated but not included in output.
These are qualification-tool defects, not plugin sensor failures.

The correction preserves error notes and reports unknown observations
separately from confirmed absence. It recognizes the old failure-note
format in historical CSVs as well as new blank-count failure rows. Resource
segments end at unknown observations and detected sampling gaps. Host
events are emitted with their own scope and restart count; an unattributed
host is described as unavailable, not asserted to be stopped.

The existing synthetic CSV tests run the production `--summary` path. They
cover healthy/unknown/healthy observations, confirmed absence followed by
unknown collection, historical schemas, same-PID host replacement and
resource calculation gaps. Exact integrated results and hashes are recorded
after the final implementation commits.

## Integrated validation

The final runtime passed on Windows x64. No candidate was installed,
merged, tagged, published or submitted. The local candidate remains
1.6.1.0; the proposed full-bundle 1.7.0 version is a separate scope freeze.

| Check | Result |
| --- | --- |
| Gadget regression before correction | 12 failures, 56 passes, zero skips |
| Gadget provider after correction | 68 passes, zero failures or skips |
| Soak regression before correction | Four new tests fail; three existing tests pass |
| Focused release/host/monitor tests after correction | 21 passes, zero skips |
| `npm ci` and `npm run build` | Passed |
| `npm run release:validate` | Passed; lint/typecheck and 917 unit tests, zero skipped |
| `npm run suite:full` | Passed; all e2e/image suites, 113 native tests, 23 PI captures, zero orphaned processes |
| `npm run pack`, native manifest and Elgato CLI validation | Passed |
| `npm audit --json` | Zero known advisories |
| Package inspection | 43 entries; exactly one production native addon, no test addons/PDBs/staging/logs |
| External collector smoke | Eight observations over about 13 seconds; zero unknown snapshots, separate host/plugin attribution |

The full suite ran from 04:12:18 to 04:20:37 UTC on September 8. Its load
case used 548 mock key contexts and eight dials with zero invalid frames;
that is not a physical 32-key test. Native source, API and bytes were
unchanged. The release-copy check retains its expected administrative
warning that the private Marketplace log has no submission for 1.6.1.0.

The collector smoke observed the unchanged installed 1.6.0.0 plugin, not
the new candidate. It verifies collection plumbing only; its short resource
slopes are not performance evidence. A read-only invalid-class WMI query
also confirmed that the terminating-error command returns exit code 1
instead of an empty successful snapshot. Synthetic CSV fixtures remain the
deterministic failure-path evidence.

The new package is 289,078 bytes. SHA-256:
`0ce86c04f21ef560662240362cd76648561412e984ac603eb648a58305e50423`.
The native SHA-256 remains
`be3527d829d84efc54473c235c35a0454272b3d32f3d36c825369e1cbd3f2453`.
Actual native signature status is `NotSigned`; that does not establish a
security block or a Marketplace rejection.

Portable command/log hashes and artifact facts are in
`audit/evidence/commands-6bc3fde.json` and `package-6bc3fde.json`. Full raw
logs and images remain in the ignored
`release/audit-evidence/gadget-soak-resolution/` directory. The previous
validated pack is preserved there as `previous-pack-232d368.streamDeckPlugin`.
Per-area red/green logs remain in their original worktrees.

The only rebase conflict was the stale-state sentence in #27. Resolution
retained both the improved Shared Memory evidence wording and the new
incomplete-or-ambiguous Gadget explanation. Independent review verified
the integrated correction; the final suite tests both paths.

The concrete Gadget missing-label finding and both PR29 reporting findings
are corrected. U1's producer-contract limitation and the exact-pack physical,
upgrade/rollback, novice and recognition gates remain explicitly separate
from these software passes. No new hardware qualification is claimed.
