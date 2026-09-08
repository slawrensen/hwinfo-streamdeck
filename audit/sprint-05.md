# Sprint 5: observed-state setup and repair

Initially reviewed from `fa9ec6d`; recovery-copy integration was rechecked
against the newer `2b352a3` foundation on 2026-09-07.
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
- `Access denied / open settings` covers Shared Memory and Gadget registry
  access failures without claiming a proven elevation mismatch.
- `Source busy / retrying` covers contention and a Gadget scan that changed
  while being read, without asserting mutex ownership or process liveness.
- `Source error / open settings` covers feed validation and saved Gadget
  identity-data failures without promising a HWiNFO restart repairs them.
  The PI points to the existing **Copy support report** button; it does not
  expose a new repair control or copy raw error messages into the UI.
- An existing empty Gadget store does not prove reporting is currently enabled.
- The Shared Memory dial says `No new data`; the PI names missing measurement
  evidence instead of asserting a stalled process.

Current status documentation and the native-edge, dead-fallback and resilience
harnesses' expected text are updated with these copy changes. Historical changelog entries and old images
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
| Source busy or changed during read | Explain automatic retry; if persistent, copy the existing support report. |
| Shared Memory disabled marker | Show the actual sharing instructions and source policy. |
| Existing Gadget store without readings | Show reporting and per-reading selection instructions. |
| Gadget freshness unknown | Explain steady versus persistent data and the source's consistency limits. |
| Access denied | Explain observable access failure; copy the existing support report and review account/session/privilege settings. |
| Feed or saved identity data could not be validated | Copy the existing support report; retain the relevant plugin log entry for diagnosis. |
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

The initial local copy-change run on the earlier foundation passed lint with
zero warnings, typecheck and all 773 unit tests with zero skipped tests.
`npm ci` completed with zero audit advisories on that lockfile. Those are prior
results, not combined-head qualification.

For the `2b352a3` integration follow-up, regressions cover changing Gadget scans,
registry access denial and failed Gadget identity history, alongside shared
memory failures. The pre-fix targeted run had 8 passing and 5 failing tests;
after the copy changes all 13 state-screen tests passed with zero skips. Lint
and typecheck passed. Logs are in ignored
`release/audit-evidence/recovery-copy-integration-*.log`. Both sensor PI pages
were inspected to confirm **Copy support report** already exists. New key
lines retain the existing two-line geometry and are at most 13 characters.

No native/e2e/fixture/live-source commands ran from this worktree during the
integration follow-up. The central host was investigating a reported physical
stale screen; changing this wording is not a claim to fix its underlying
measurement issue. Matching harness strings were updated but await execution
on the combined head.

Before feature completion, run lint, typecheck, unit tests, `e2e:pi` and
`e2e:native-edge` on the combined final head. Mocked UI trials must cover every
supported observation, source recovery, missing selection and cancelled repair.
Five uncoached clean-Windows trials must each record all interactions after
plugin installation, including installer/UAC steps, elapsed time and any
documentation visit. Those trials are not run and block the proposed
180-second/six-interaction claim.

Rollback of the copy change affects only displayed guidance and matching test
expectations. It does not rewrite settings or change source acquisition.
