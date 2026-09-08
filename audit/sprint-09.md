# Sprint 9: stable alerts preflight

Status: design only, feature implementation suspended. Reviewed source is
`fa9ec6ddbe7c60008f9512b17eafeaa52fe245fd` on 2026-09-07. No alert engine,
settings, controls, notifications or threshold defaults were added here.

The coordinating audit reproduced a mixed-generation Gadget row with a
controlled Windows registry writer. Detectable interleavings have a separate
containment patch, but a writer paused between independent field writes lacks
an atomic transaction marker. This report does not reproduce that experiment
or claim a real HWiNFO interleaving. The source-contract decision remains a
prerequisite for expanding confident measurement behavior.

## Current production behavior

| Surface | Observation at the reviewed commit |
| --- | --- |
| `src/ui/format.ts`, `alertLevel` | Immediate comparison of current value; critical precedes warning; above uses `>=`, below uses `<=`. There is no dwell, hysteresis, cooldown or snooze state. |
| `src/actions/sensor-reading.ts`, `primaryContext` | The primary current value, converted into display units, determines the key palette. Dense layouts do not independently classify every slot. Key settings have no native-unit fence equivalent to dial `alertUnit`. |
| `src/detail/detail-faces.ts` | Back inherits the opener's current-value thresholds. Ordinary detail readings deliberately do not inherit thresholds. |
| `src/actions/sensor-dial.ts` | Single-view bar, overview rows and `criticalKeys` classify values independently. `criticalKeys` can affect `autoCycleTarget` when `alertInterrupt` is enabled. |
| Dial unit fence | `alertUnit` stores the native reading unit. Omitted legacy fields retain the existing unscoped behavior; the empty unit is meaningful. Threshold/bar edits request restamping when a reading resolves. This fence is distinct from the display unit in which a numeric threshold was entered. |
| `src/pi-protocol.ts`, `buildPreview` | Preview independently recomputes immediate thresholds. A temporal engine must not advance separately in preview and rendering. |
| Dial lifetime | Pausing or pinning stops automatic carousel motion, not measurement collection. Hidden dial statistics have a bounded retention period. Alert behavior needs an explicit lifetime independent of the visible carousel position. |
| `src/clock.ts` | `monotonicNow()` is available. Wall-clock time must not decide future alert durations. |

These observations are static reads, not newly executed alert tests. The
existing `alertLevel` remains the compatibility path until an explicitly
enabled replacement is implemented and qualified.

## Proposed state contract

Keep three independent concepts: measurement confidence, persistent condition
(`normal`, `warn`, `crit`), and suppression of an attention cue. A snoozed
critical condition remains visibly critical. This proposal adds no outbound
actions, default motion or universal hardware thresholds.

One production state machine per action and configured reading advances from
accepted acquisition events. Rendering, PI previews and carousel decisions
consume its immutable result. A render call, host timer or duplicate consumer
tick must not advance dwell. Bound state to the current configured reading set
and clear it on action disposal; define any hidden-action retention explicitly.

Use symbolic user thresholds `T` and a nonnegative hysteresis delta `H`. Above
alerts enter at `x >= T` and release only at `x < T - H`. Below alerts enter at
`x <= T` and release only at `x > T + H`. Equality at the release boundary
remains latched. Compute warning and critical latches consistently, with
critical precedence, before choosing a target severity. Reversed thresholds
must be exposed as invalid stable-mode configuration, without rewriting saved
legacy fields.

| Event | Proposed deterministic transition |
| --- | --- |
| Eligible new sample requests a different severity | Set pending target and its monotonic start. Zero dwell commits on this sample. |
| Next eligible sample requests the same pending target | Commit when elapsed time is at least its applicable dwell; exact expiry qualifies. |
| New sample requests a different target before expiry | Replace pending target and start time. Returning to the committed severity clears pending state. |
| Render, timer, duplicate evidence or held value only | Do not start or complete a severity transition. A timer may expire cue suppression without asserting a new measurement. |
| Missing, invalid, stale or unknown-freshness data | Clear pending dwell and suspend confident classification. Render the source status. A retained severity is explicitly last-known and cannot trigger new attention. |
| Evidence resumes in the same validated domain | Require a new eligible sample and restart pending dwell. Time without eligible data contributes nothing. |
| Native unit, source, reading type, owner or approved binding revision changes | Clear condition, pending transition and cooldown; expose the reset reason. Revalidate threshold units before classifying. |
| Display-only unit toggle | Preserve the physical threshold and alert history after validated conversion. It does not create a measurement-domain transition. |
| Committed severity changes while cues are eligible | Emit one transition cue if that cue has been explicitly enabled; start cooldown. Persistent severity always updates. |
| Same condition during cooldown | No repeated cue. Cooldown never conceals severity. |
| Explicit snooze | Suppress attention and alert-driven carousel interruption for the chosen duration; retain condition, shape and severity text. |
| Snooze expires or user resumes | Re-enable future transition cues; do not replay old notifications or move the carousel immediately without a new eligible transition. |
| Carousel pause or pin | Continue acquisition and alert state. Preserve the existing pause/pin navigation contract. |

The proposed critical-escalation policy is to allow one newly confirmed
critical cue through a warning cooldown, while snooze still suppresses it.
This is a product decision to confirm before implementation, not current
behavior. Enter and release dwell are separate; escalation uses enter dwell,
de-escalation uses release dwell. A changed threshold configuration resets
pending/latches rather than evaluating elapsed time against an old threshold.

Eligibility must come from the final provider/poller evidence contract, not
process presence, provider opening, UI repaint, value equality or a renamed
snapshot revision. Source-level evidence does not prove individual Gadget row
atomicity. Do not manufacture a producer epoch from reconnects. If the source
cannot establish the required evidence, stable alerts remain suspended with
an explicit reason. This unresolved condition is why implementation is held.

## Append-only settings and PI proposal

Suggested per-action fields, all new and opt-in:

| Field | Proposed meaning |
| --- | --- |
| `alertStability` | Boolean; absent/false retains the legacy immediate threshold behavior. |
| `alertHysteresis` | Finite nonnegative decimal text in the explicitly recorded threshold unit. |
| `alertEnterDwellMs`, `alertExitDwellMs`, `alertCooldownMs` | Bounded nonnegative durations parsed from stored settings; malformed input safely disables the new configuration and reports why. Exact maximums remain a product choice. |
| `alertThresholdUnit` | Unit in which the numeric thresholds and hysteresis were intentionally configured; distinct from dial `alertUnit`, which fences native units. |

Retain `warnValue`, `critValue`, `alertBelow`, `alertUnit`, `alertInterrupt` and
all unknown settings. Do not restamp or normalize profiles during startup.
Enabling stable alerts on a legacy profile requires explicit threshold-unit
review; do not infer it from today's display toggle or reading. Absolute
temperature conversion and hysteresis-delta conversion are different (the
delta has no offset). Existing `convertUnit` does not constitute a complete
bidirectional unit-normalization contract; add production tests before using
one. Incompatible producer-unit/source domains reset or suspend safely.

PI commands should carry action context plus a bounded duration for snooze,
or an explicit resume command. Snooze is session state expressed in monotonic
time, not a persisted wall-clock deadline. PI responses expose current
condition, confidence/reason, pending dwell, snooze remaining and cooldown
remaining from the same engine. Settings acknowledgement/conflict handling
must follow the single-scope contract in `audit/sprint-08.md` once integrated.

## Implementation and acceptance surfaces

Implement a pure `src/alerts.ts` with explicit input/output types and injected
monotonic time. Feed it from action acquisition handling using the poller's
accepted evidence, then wire key/dial composition, `criticalKeys`, Back and PI
preview to one result. Do not advance once per renderer or create a new native
poller. Preserve ordinary detail-face semantics unless separately approved.

Register a new `test/alerts.test.ts` in the explicit `package.json` unit list.
Cover exact boundaries, oscillation, candidate replacement, zero and exact
dwell, hysteresis in both directions, critical precedence, cooldown escalation,
snooze expiry, malformed settings, source/unit/type/binding resets, unknown
freshness, reconnect, duplicate evidence and wall-clock jumps. Tests must use
production code and a deterministic clock.

Extend `test/measurement-integrity.test.ts`, `test/format.test.ts`,
`test/rotation.test.ts`, controls/gesture traces and relevant renderer tests.
Assert the actual key, all dial views, Back, PI preview and carousel observe
the same state; a paused carousel still collects; display conversion preserves
physical thresholds; incompatible units never classify. Keep D01-D05 closed.

Required after implementation: Windows native/build, `npm test`,
`npm run e2e:resilience`, `npm run e2e:pi`, `npm run contact-sheet` and
`npm run suite:full` with no orphan processes. Physical severity recognition
and real source transitions remain separate acceptance. No commands were run
as alert-feature validation in this docs-only change.

## Open decisions and rollback

Resolve source eligibility/atomicity, maximum duration bounds, critical bypass
of cooldown, snooze scope (one reading versus the whole action), restart and
hidden-action lifetime, and threshold-order UX before implementation. Numeric
thresholds remain user-owned; this plan supplies none.

Roll back by disabling consumption of the optional stable-alert fields and
returning to the legacy path. Preserve all saved fields, profile exports and
regression evidence. Feature completion and release acceptance are blocked;
this document only completes the bounded source/design preflight.
