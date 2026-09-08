# Audit remediation program

Audit baseline and original main:
`2ca44e95c2d8b3442c3ed411952621b254d4cbf0`.

The original checkout and prior candidate worktree are preserved. Work uses
isolated branches, production-module regressions, and serialized Windows
native/e2e fixtures. No competitor implementation was read. The user's
instruction authorizes draft PR preparation, not merging, tagging, release
publication or Marketplace submission.

## Current decision

**NO-GO for release.** Five reported wrong-data counterexamples have repairs
or prior candidate containment under review. A controlled Windows registry
writer additionally demonstrated U1: fields queried independently can form a
mixed-generation row. One bounded validation reread withholds detectable
interleavings. It cannot prove an atomic producer update when the producer
pauses between writes. The producer contract and exact-candidate hardware
qualification remain open.

The user's escalation rule suspends feature expansion on a confirmed S0.
The confirmed missing-label identity defect found during PR review is now
corrected. U1 separately proves an interface limitation under a controlled
writer; a real HWiNFO trigger remains unverified. Do not classify that
synthetic result as an established normal-producer S0. Its source-policy
decision and physical release gates remain open. Later features remain
queued/design-only; thirteen report files are not thirteen completed
sprints. Correctness fixes proceed without waiting for calendar boundaries.

## PR groups and owners

| Group | Owner | Scope | Dependency |
| --- | --- | --- | --- |
| Release integrity | root | D09 input validation, build/staging token separation, two dev dependency advisory fixes; [PR #25](https://github.com/slawrensen/hwinfo-streamdeck/pull/25) | main |
| Measurement foundation | statistics, identity and freshness agents; root integration | Sprints 1-3, D01-D05/D07, U1 experiment/containment and existing explicit-pair runtime; [PR #26](https://github.com/slawrensen/hwinfo-streamdeck/pull/26) | Release integrity |
| Recovery copy and PI designs | statistics/PI agent | Factual recovery instructions; setup, pairing and transactional-import specifications; [PR #27](https://github.com/slawrensen/hwinfo-streamdeck/pull/27) | Measurement foundation |
| Readability | identity/readability agent | D08 default value/stat contrast and persistent severity shapes; [PR #28](https://github.com/slawrensen/hwinfo-streamdeck/pull/28) | Recovery copy |
| Qualification and program | root; additional area review | Host/plugin measurements, hardware gates, later-sprint designs and release decision | Final reviewed software stack |

The same domain owner may cover related sprints sequentially. The session
supports three agents beside the integration owner; native/e2e tests use one
shared execution slot to prevent fixture and timing interference.

Native GitHub Stack #30 contains #25 -> #26 -> #27 -> #28 -> #29, all drafts.
The current [Gadget and soak correction evidence](gadget-soak-resolution-2026-09-08.md)
records 917 unit tests, 113 native tests and the full suite with zero orphaned
processes at runtime `6bc3fde`. It supersedes the earlier
[910-unit/99-native candidate validation](validation-2026-09-07.md) for these
new changes. Package and native hashes are pinned in the new report. The
physical, source-policy and guided-feature gates remain open.

## Sprint ledger

| Sprint | Planned dates | Status and next exit evidence |
| --- | --- | --- |
| 1 Statistics and units | Sep 7-20 | Implementation and production-composer regressions; final Windows stack qualification required. See sprint-01.md. |
| 2 Identity integrity | Sep 21-Oct 4 | Owner-only rewrite fixed; duplicate disappearance/restart containment reviewed. Guided repair remains queued. See sprint-02.md. |
| 3 Freshness/lifecycle | Oct 5-18 | Cold-start, topology and reopen evidence fixes; controlled U1 reproduction/containment. Atomic producer contract remains open. See sprint-03.md. |
| 4 Release integrity/baseline | Oct 19-Nov 1 | PR #25; local checks and Windows CI. Release staging itself not triggered. See sprint-04.md. |
| 5 Adaptive setup | Nov 2-15 | Factual copy corrections only; new adaptive flow and five uncoached clean-Windows trials are queued. See sprint-05.md. |
| 6 Readability | Nov 16-29 | Automated contrast/shape changes under review; 72-pixel physical, locale and 300-ms recognition acceptance remain NOT RUN. See sprint-06.md. |
| 7 Source continuity | Nov 30-Dec 13 | Existing explicit runtime pairing retained and tested; guided pairing UI is design-only. See sprint-07.md. |
| 8 Portability | Dec 14-27 | Existing Config format inspected; transactional preview/undo design queued. Live v1.5 migration remains NOT RUN. See sprint-08.md. |
| 9 Stable alerts | Dec 28-Jan 10 | Queued behind source truth gate. Monotonic deterministic state machine and controls must precede any runtime change. See sprint-09.md. |
| 10 Incident replay | Jan 11-24 | Queued behind source truth and resource gates. Opt-in bounded/redacted design required. See sprint-10.md. |
| 11 Resources/hardware | Jan 25-Feb 7 | Monitor now distinguishes host/plugin CPU and memory; eight-hour exact-candidate session remains NOT RUN. See sprint-11.md. |
| 12 Remote experiment | Feb 8-21 | Separate go/no-go evaluation; no network provider or production deployment. See sprint-12.md. |
| 13 Release candidate | Feb 22-Mar 7 | NO-GO until all required evidence exists, including 48-hour exact-pack soak and human submission approval. See sprint-13.md. |

Dates are the supplied 2026-2027 allocation, not delayed permission to fix a
known measurement error. A report's existence is not a passed sprint.

## Evidence rules and restart handoff

- Raw logs, fixture SVGs, package hashes and machine-local observations live
  under each worktree's ignored `release/audit-evidence/`. Prior candidate
  evidence remains under its original `release/integrity-evidence/` path.
- Each report records the base, changed contract, command results and
  remaining gate. Baseline-red and final-green results are distinguished.
- Renderer output is synthetic input through production renderers. Native
  fixtures are real Windows objects with a synthetic producer. Mock host
  e2e is not a physical Stream Deck test. None is novice-user evidence.
- The live installed plugin is still 1.6.0.0. A monitoring smoke test against
  it checks measurement tooling and is not candidate qualification.
- New work starts by fetching PR/check status and inspecting current HEAD,
  not assuming an earlier successful suite applies to a changed candidate.
- Required hardware, user trials, producer-contract confirmation, genuine
  install/upgrade/rollback, sleep/wake and long soak evidence remain named
  blockers. No agent can infer their completion from elapsed time.

Weekly regression, monthly surface rotation, pre-release and incident triage
use the standing prompts supplied by the user. No scheduled background Task
was created: this session has no callable Task Tool action. This checked-in
ledger is the restart point; it does not promise unattended daily execution.
