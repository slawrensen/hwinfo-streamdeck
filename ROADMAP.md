# Six-month roadmap, grounded in the September 7 verification

Objective: make HWiNFO Sensors the easiest trustworthy local hardware
readout. Obtain the correct reading quickly, preserve identity through
interruptions, make personal workspaces useful, and reveal advanced tools
only when needed. Windows, lightweight, local only, no telemetry.

This is an outcome sequence, not a promise to ship six monthly releases.
A stage advances only when its exit evidence exists. Recheck at each weekly
review; carry failed gates forward by name. Do not replace bench results
with unit counts, a renderer image, or elapsed time that was never observed.

## Verified starting point

- GitHub main and latest stable v1.6.0 resolve to
  `2ca44e95c2d8b3442c3ed411952621b254d4cbf0` on September 7, 2026.
  The downloaded stable pack matches its published SHA-256
  `57fdf219a4b33cd006f565ed8e82b0d5c90a01bb84cfbdee78fd8a77a98f6d0d`.
- The live Marketplace listing now says version 1.6, published September 7,
  and its release copy names 1.6.0.0. A cached search result still said 1.5.
  Marketplace installer bytes and GitHub bytes have not been equated.
- PR #20 remains a workspace spike at
  `9e2142315e8638bf78a020ac97689872b715cdc8`. A historical bench checklist
  records page-number deletion/renumbering hazards. It is evidence to
  investigate, not evidence that today's candidate passed or a reason to
  merge the spike.
- Exact v1.5.1 provider code stops at the first Gadget hole. Exact v1.6.0
  retains sparse readings but substitutes 80 for a removed 40 under the
  old duplicate base key. The defect is reproduced, not a reason to revert
  sparse scanning.
- The 1.6.1 development candidate withholds observed ambiguous Gadget names,
  remembers them locally across restarts, adds explicit provider links,
  separates value evidence from initial/topology observations, withholds
  unavailable historical numbers, and captures subsecond value changes.
  Automated proof and remaining release gates are recorded in the
  [measurement-integrity handoff](docs/measurement-integrity.md).

## 1. Measurement integrity: September to early October

Deliver the narrow identity repair and separately review its evidence,
source-link, freshness and sampling follow-ons. Exercise every saved
selection on both providers, including dense tiles, named dial sets,
custom lists and mirror Back. Preserve all existing settings and UUIDs.

Exit evidence: exact-baseline red/final-head green tests; Windows native
integration; built-plugin wire tests; PI persistence; real-host and physical
bench runs; exact candidate installer identity and upgrade/rollback proof.
Run the poller soak across real desk use, restart and sleep/wake before a
release. Automated load duration does not substitute for the runbook soak.

Known limit: Gadget has no IDs or heartbeat. Name reuse and duplicate
history already lost before first observation cannot be reconstructed.
Steady values alone cannot prove producer liveness. A source-specific
reading without an explicit verified pair remains missing on the other
provider. Never guess a replacement from a label or value.

Smallest next PR: a guided, optional pairing control using the explicit
`readingLinks` contract. Show both provider readings with source, unit and
current value, require the user's pair selection, preview the result and
allow removal without editing action settings. Test unavailable, duplicate,
renamed and unit-mismatched endpoints. This removes today's Config-document
step without inventing automatic hardware identity.

## 2. Beginner onboarding: October

Reduce the path from dragging an action to a verified first reading.
Offer the minimal HWiNFO setup checklist, a clear choice of temperature,
fan, load or power, and a preview identifying the actual source. Show
advanced source pairing only when the user wants provider continuity.
Explain Age unknown and missing/ambiguous readings with a direct next step.

Exit evidence: observe at least five first-time bench attempts and record
completion, assistance, time to the correct first reading and every wrong
selection. These measurements do not exist yet. Fix observed failures
before expanding setup choices; store research locally with consent.

## 3. Safe personal workspaces: November

Design from users' named tasks and saved selections. Review PR #20 only
against current main, its actual diff and executable tests. Keep user
labels, colors, custom tiles and existing profiles. A workspace return must
be device-scoped and survive nested detail navigation and restarts.

Exit evidence: a reversible migration/backup and rollback path, two-device
isolation, renamed/reordered/deleted-page cases, first-install prompts,
mirror Back and stale/missing readings. No required profile reset. A page
number that can silently select a different workspace blocks advancement.
Run actual app and physical-device navigation before counting it done.

## 4. Humane per-reading alerts: December

Give each reading its own unit-aware threshold, hysteresis and sustained
condition interval. Show which reading triggered the state. Add local
acknowledgment/snooze and a clear recovery indication. Missing or uncertain
data must not be presented as a healthy measurement or a fresh crossing.
Keep alerts quiet by default and entirely local.

Exit evidence: traces for noisy threshold crossings, pending durations,
provider transitions, unit edits, snooze, clear/retrigger, restart and two
readings with opposing states on one dense key. Observe the controls on
hardware before deciding whether additional alert outputs are needed.

## 5. Focused typed computations and local sessions: January

Start with a small set of justified computations, such as a temperature
difference or a same-unit sum, rather than an unrestricted expression
language. Inputs must be explicitly identified; units, missing data and
freshness propagate. Distinguish producer statistics, sample-weighted
observations and time-weighted summaries. Offer named local sessions with
visible collection, reset, gap and retention rules.

Exit evidence: dimensional checks, golden numerical fixtures, bad-input
and stale/gap propagation, source changes, bounded memory and restart
semantics. Add export only when the exported record names its sources,
units, observation times and limitations. No invented historical samples.

## 6. Compatibility and exact-artifact release proof: February to early March

Exercise Windows 10+, supported Stream Deck software and device families,
Node 20/22/24 against identical native bytes, session/elevation/RDP,
sleep/wake, HWiNFO changes and both data interfaces. Publish a capability
matrix where unexecuted combinations say NOT RUN.

Exit evidence: reproducible native builds, manifest/version/lock agreement,
pack validation and hashes, fresh install plus in-place upgrade through
the genuine installer on the exact proposed artifact, rollback with user
personalization intact, and separate Marketplace acceptance/install proof.
GitHub and Marketplace are independent tracks. Tags, merges, publishing,
Marketplace submission and permission changes require explicit user
instruction.

## Weekly operating review

1. Re-resolve main, stable tag, candidate SHA, PR heads and both distribution
   tracks. Record dates and exact artifacts, including any differences.
2. Reproduce one important user-visible failure on the baseline. Preserve
   the raw failing result before changing production code.
3. Implement the smallest repair, add meaningful adversarial cases, and
   review identity, units, gaps, migration and rollback separately.
4. Run applicable gates. Label mocked-provider, native Windows, mocked
   host, actual host, physical and installer results independently.
5. Update the handoff and compact restart checkpoint: changed files,
   commands/exits, evidence paths, surviving findings, next smallest PR.
   Promote a roadmap outcome only from executed evidence.

No theme expansion, network service, telemetry, remote monitoring or
competitor implementation is required by this sequence. Solutions and
configuration shapes are designed within this project.
