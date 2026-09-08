# Sprint 5: observed-state setup and repair

Reviewed from `fa9ec6d`, the integrated measurement-integrity foundation.
Status: feature work queued behind the producer-integrity gate. The adaptive
setup card is not implemented. No first-run timing or click-count target has
been demonstrated.

## Escalation and completed correctness work

The freshness owner reproduced a mixed-generation Gadget row with a controlled
Windows registry writer. Detectable interleavings have a containment regression,
but a writer paused between independent registry writes has no transaction
marker the reader can use. This is not a captured real-HWiNFO interleaving.
The supplied escalation rule suspends new capabilities while the measurement
integrity decision remains unresolved.

Only factual recovery copy is changed in this area:

- Bridge load failure says `Bridge failed`, not `Plugin damaged`. Recovery
  recommends reinstalling the release package and retaining an actual Windows
  or security report for support, without recommending exclusions or restoring
  a blocked file.
- `Access denied / check access` does not claim a proven elevation mismatch.
- A busy consistency mutex does not prove the producer process is running.
- An existing empty Gadget store does not prove reporting is currently enabled.
- The Shared Memory dial says `No new data`; the PI names missing measurement
  evidence instead of asserting a stalled process.

Current status documentation and the native-edge harness's expected text are
updated with these copy changes. Historical changelog entries and old images
are retained as historical evidence; no new physical capture is claimed.

## Proposed setup contract, not implemented

One card should use the existing source status plus explicit observation fields
from the plugin's preview payload: unavailable reason, source, source-level
freshness classification, selected key, missing-binding state, native unit/type,
and producer-statistic capability. A source-level change does not establish
every reading's sample age. Process existence must never stand in for polling.

| Observation | Primary next step |
| --- | --- |
| Feed could not be opened | Open inline HWiNFO setup instructions; acquisition remains an explicit external step. |
| Busy consistency mutex | Refresh status; explain automatic retry without claiming process liveness. |
| Shared Memory disabled marker | Show the actual sharing instructions and source policy. |
| Existing Gadget store without readings | Show reporting and per-reading selection instructions. |
| Gadget freshness unknown | Explain steady versus persistent data and the source's consistency limits. |
| Access denied | Explain observable access failure; review account/session/privilege settings. |
| Bridge load failure | Reinstall the release package; retain actual security events for support. |
| Unsupported platform | Show the package's actual supported OS/architecture requirements. |
| Source available, no selection | Focus the existing sensor picker. |
| Saved binding absent | Review the exact identity and choose an explicitly verified replacement. |
| Available selection with honest freshness | Show Ready and optional Customize. |

Missing mapping alone cannot distinguish absent software, stopped software,
disabled sharing or permissions. Portable startup, verified executable launch
and consent to startup registration require separate observations and controls;
they are not silently implemented by this card. Appearance can be disclosed
after setup, but existing profiles and the one-reading first-run default must
retain their stored behavior.

## Validation and pending gates

The copy regressions run against production `statusScreen`, `statusDialText`
and `statusSentence` functions. Local logs are in ignored
`release/audit-evidence/recovery-copy-*.log`; the pre-fix run fails the factual
copy assertions. No PI feature or hardware acceptance result is claimed.

The final local copy-change run passed lint with zero warnings, typecheck and
all 773 unit tests with zero skipped tests. `npm ci` completed with zero audit
advisories on this foundation's lockfile. The native-edge harness expectations
were updated but the native/e2e suite was not run from this worktree while the
central integration host was in use.

Before feature completion, run lint, typecheck, unit tests, `e2e:pi` and
`e2e:native-edge` on the combined final head. Mocked UI trials must cover every
supported observation, source recovery, missing selection and cancelled repair.
Five uncoached clean-Windows trials must each record all interactions after
plugin installation, including installer/UAC steps, elapsed time and any
documentation visit. Those trials are not run and block the proposed
180-second/six-interaction claim.

Rollback of the copy change affects only displayed guidance and matching test
expectations. It does not rewrite settings or change source acquisition.
