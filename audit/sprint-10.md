# Sprint 10: local measurement replay preflight

Status: design only, feature implementation suspended. Reviewed source is
`fa9ec6ddbe7c60008f9512b17eafeaa52fe245fd` on 2026-09-07. No measurement
recorder, import command, settings or network behavior were added here. The
unresolved Gadget source-consistency gate described in `audit/sprint-09.md`
precedes new capture/runtime feature work. Capturing observations cannot make
an incoherent source sample trustworthy.

## Existing recorder and replay boundary

`src/recorder.ts` has an always-bounded ring of 24 interaction/lifecycle events
for local support reports. `HWINFO_TRACE_EVENTS=1` additionally enables
synchronous JSONL append to `logs/trace-<pid>.jsonl`; that optional file has no
byte/time cap and stops attempting writes after its first write failure.
Current call sites record gesture, selection, lifecycle and render information,
not measurement samples. The general event type accepts a `note`, so future
callers still need redaction discipline.

`hashId` is a stable, truncated SHA-256 identifier. It allows correlation and
is not a per-capture privacy boundary. Gadget reading keys can contain names;
the current selection call sites hash them. Do not reuse raw key strings or
assume a stable hash cannot be matched against guessed labels.

`src/diagnostics.ts` assembles a support report locally on request from bounded
events and registered sections. It has no automatic upload. `test/replay.ts`
and `test/gesture-replay.test.ts` replay the production gesture/control/rotation
modules; they do not run a measurement provider, poller or statistics history.
The existing interaction format should remain compatible.

`src/poller.ts` owns acquisition, status and watched sparkline series. Its
snapshots/readings can be reused and mutated by the parser. A future recorder
must copy allowed scalar values at the capture boundary, rather than retaining
references to snapshots that later ticks change.

These are source observations, not a new load or physical recording test.

## Proposed bounded, opt-in capture

Use a separate `src/measurement-recorder.ts`; do not append sample streams to
the existing unbounded development trace file. Recording is off by default.
The disabled path performs no sample copying, serialization or file I/O.
Capture uses a bounded in-memory buffer with explicit Stop, Export and Clear;
export writes only after the user requests it. No background unbounded write
queue, automatic upload, unrelated system inventory or default raw labels.

The following are proposed limits to settle before implementation, not
measurements or approved performance-budget changes:

| Limit | Proposed cap and behavior |
| --- | --- |
| Encoded data | 8 MiB total uncompressed UTF-8, including metadata and terminal record. Reserve terminal-record space before accepting an event. |
| Duration | 10 minutes of local monotonic elapsed time. Wall-clock adjustment does not extend capture. |
| Event count | 25,000 complete events; a tick batch is admitted completely or capture stops before it. |
| Watched identity set | 64 explicitly chosen reading identities, including paired aliases. Ask for a subset if larger; do not silently omit configured readings. |
| Individual record | 16 KiB; bounded strings, arrays and nesting. Refuse oversized metadata before capture begins. |
| Terminal outcome | Explicit stopped-by-user, byte-limit, time-limit, event-limit or error reason. Never present a silently truncated stream as complete. |

Count actual UTF-8 bytes rather than JavaScript string characters. Prove an
allocation ceiling including token maps, object/string overhead and export
copies; an 8 MiB payload cap alone does not prove 8 MiB process memory. Copy
only the watched subset. Retention is one active capture and one bounded
completed capture at most, with an explicit replacement decision; avoid
keeping two full copies during serialization. The exact lifecycle is an open
product decision, and any chosen maximum must be executable in tests.

## Versioned envelope and redaction

Suggested envelope identifier: `hwinfo-measurement-incident`, version `1`.

| Component | Required evidence and boundary |
| --- | --- |
| Header | Format version, plugin/build/protocol versions, random capture ID and monotonic origin. Wall start is optional informational context, never replay time. |
| Identity dictionary | Fresh opaque tokens per capture for source, reading, owner, action and approved-pair relationships. A session-only map translates raw identities. No stable device/machine IDs, paths or Gadget-name-bearing keys in exports. |
| Reading descriptor | Tokenized identity, native unit, sensor type and statistic availability. Descriptor/domain changes are explicit events. Do not infer physical identity from matching labels. |
| Relevant configuration | Allowlisted values needed to reproduce formatting/statistics/alert decisions, with identity references tokenized. Never serialize an arbitrary settings object or arbitrary diagnostics section. |
| Ordered events | Increasing sequence, nondecreasing monotonic offset, source/read outcome, confidence/evidence marker, identity/domain revision and watched sample values. A marker records what the provider actually observed; it is not invented heartbeat proof. |
| Numeric values | Finite values or explicit tagged unavailable/nonfinite reasons. JSON's conversion of NaN/Infinity to `null` must not silently erase their meaning. Producer statistics retain scope/capability. |
| Transitions | Source loss/reopen, skipped read, binding change, native-unit/type change, visibility/selection when relevant, and explicit end reason. Use stable error codes, never raw exception messages or stacks containing local paths. |

Measurements themselves are part of the export and must be disclosed before
capture. Sensor/source labels, custom text and user names are omitted by
default. An optional label attachment would require a separate explicit choice
and preview, with the same caps; defer it if it is not necessary for reproducing
the incident. Fresh tokens limit cross-capture correlation but do not promise
anonymity, since units, values and timing can still be distinctive. Clear drops
the in-memory raw-to-token map too.

The envelope captures decoded observations. It cannot establish native mutex
correctness, the producer's real registry write ordering or an unseen atomic
generation. A decoder defect needs a separate minimal buffer fixture; a torn
registry row needs the controlled writer/native harness. Do not market a
decoded-value replay as proof of those boundaries.

## Offline replay and PI contract

Validate the whole file before replay. Bound bytes before JSON parsing, then
validate schema, supported major version, depth/string/collection limits,
numbers, enums, identity references, event order and declared duration. Reject
unknown executable-looking commands as data; the format carries no shell,
paths-to-open, callback or live-settings mutation instructions. Cancellation or
failure must leave the live plugin and its settings unchanged.

Build an offline provider adapter and isolated replay coordinator. Drive the
production state transitions, `SessionStatsStore`, series sampling, formatting
and eventual alert engine with a deterministic clock. Extract narrow pure
poller-transition seams if needed; avoid copying production algorithms into
the harness. Replay must not register with the live poller, native provider,
global command bus or SDK actions. Deeply owned snapshots make subsequent
mutation impossible. Emit a deterministic result/diff, not a live sensor feed.

PI commands should be explicit Start, Stop, Export and Clear, with request ID,
context and bounded selected identity tokens. Responses report active state,
elapsed time, counts, byte use and stop/error reason. Capture enablement is
session state, off on restart, not a silently persisted global setting.
The protocol must decline stale selections after a topology change. Any
remembered UI preference is a new optional field preserving unknown settings;
measurement recording must still require a deliberate session action.

Keep the normal support report small. It may include capture state and counts,
but must not silently include measurement history or raw identity dictionaries.
No send/upload control is part of this proposal. Export and offline replay
should remain distinct from settings import.

## Production integration and test plan

Inspect the final foundation before implementing: `src/poller.ts`,
`src/hwinfo/types.ts`, provider/reading-link contracts and evidence revisions
are changing in the correctness work. Attach capture after accepted read
classification, before mutable snapshots are reused. Record skipped/error
outcomes separately; a consumer callback alone cannot distinguish a new sample
from a held status. Preserve one shared acquisition loop.

Register new `test/measurement-recorder.test.ts` and
`test/measurement-replay.test.ts` in `package.json`. Tests must cover:

- Exact-cap and cap-plus-one UTF-8 data, huge strings, oversized dictionary,
  duration/event limits, reserved end record, cancellation and disabled-path
  zero serialization/I/O.
- Malformed files, unsupported version, illegal nonfinite values, reordered
  sequence, backward monotonic offsets, unresolved identity references and
  partial input; none may partially replay into live state.
- Redaction fixtures with sensitive labels in Gadget keys, custom settings,
  nested values and error text; raw identity and optional labels never leak
  into default exported bytes, summaries or failure messages.
- Same reading mutated after capture, duplicate labels/removal, source and
  native-unit changes, approved pairing revisions, unavailable statistics,
  missing/unknown/stale feeds, unchanged producer timestamp and skipped reads.
- One captured synthetic measurement incident replayed through real production
  modules into a repeatable regression; compare repeated replay results and
  resulting rendered values, not copied algorithm outputs.

Retain `test/diagnostics.test.ts` and gesture replay compatibility tests. After
implementation run Windows build/native checks, `npm test`,
`npm run e2e:resilience`, `npm run e2e:load`, `npm run e2e:pi` and
`npm run suite:full` with no orphan processes. No feature tests or recorder
measurements were executed for this docs-only preflight.

## Overhead qualification and unresolved choices

Compare capture-off and capture-on with the same final bundle, seeded feed,
32 keys plus dials at 250 ms, identical watched identity set and warmup. Record
run order, P50/P95 tick time, image submissions, plugin CPU/RSS/handles and host
CPU/RSS separately. Repeat with changing and unchanged readings; exercise cap
expiry, export, clear, reconnect and maximum-size replay. A short deterministic
benchmark complements, but does not replace, the real hardware session.

The roadmap's proposed overall gates are P95 tick below 25 ms, post-warmup
plugin RSS growth no more than 20 MiB and no sustained handle growth. No
incremental recorder budget has been agreed. Set that limit before enabling
capture; report both absolute results and incremental overhead. Do not increase
the overall budget or cite earlier `PERF.md` packs as current evidence.

Resolve payload/duration/count caps, watched-set selection, capture replacement,
optional labels, export transport and the incremental overhead budget before
implementation. The source-contract gate also remains unresolved. Rollback
disables capture commands/consumption while retaining ordinary plugin behavior
and regression fixtures. Do not delete a user's exported capture as part of
code rollback. This report completes planning only; the feature and its
acceptance remain blocked.
