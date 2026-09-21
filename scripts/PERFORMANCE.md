# Performance checks that answer a specific question

Use `npm run perf:smoke` for a short, deterministic correctness check of the
built plugin under 250 ms load. It needs Windows and the build, but no running
HWiNFO, Stream Deck app, profile, physical device or registry modification.
The CI job runs it after building the native addon and plugin. Its evidence
artifact is saved even on failure.

Use `npm run perf:scaling -- --label desktop --out release/scaling-desktop`
for capacity and scaling measurements. Defaults are 30 seconds warmup,
120 seconds measured, three repetitions, alternating case order. Run it on
an otherwise idle machine using the Node version bundled with Stream Deck.
Do not run benchmarks beside a clean hardware endurance observation.

```powershell
npm ci
npm run build:native
npm run build
npm run perf:smoke -- --out release/scaling-smoke
npm run perf:scaling -- --label desktop --out release/scaling-desktop
```

The output directory must not exist. Failed and partial runs are preserved.
Private plugin copies use ephemeral loopback ports, unique local mapping and
mutex names and an unavailable private Gadget fallback name. Normal socket
closure and publisher shutdown must both exit 0. Fallback cleanup uses
recorded process creation identities, never an image name.

## Workload matrix

Every case uses the production parser, poller, action handlers, SVG renderers,
SDK serialization and socket transport, with the production native addon.
Only the publisher and Stream Deck host are simulated. The JavaScript and
native hashes are recorded. Timer instrumentation is a separate Node preload;
it never modifies the bundle or the installed plugin.
Synthetic readings use integer fan/RPM values as recognizable generation
witnesses; this does not benchmark every unit formatter or real sensor mix.

| Case | Inventory | Keys / dials | Poll / producer ms | Question |
| --- | ---: | ---: | ---: | --- |
| small-250 | 256 | 8 / 4 | 250 / 250 | Small profile cost |
| reference-1000 | 512 | 36 / 6 | 1000 / 2000 | Slower-poll baseline |
| reference-250 | 512 | 36 / 6 | 250 / 2000 | Cost of polling unchanged data more often |
| changing-250 | 512 | 36 / 6 | 250 / 250 | Constant changing-value rendering |
| inventory-2048 | 2048 | 36 / 6 | 250 / 250 | Four times the sensor inventory |
| actions-84 | 512 | 72 / 12 | 250 / 250 | Twice the visible actions |
| mixed-250 | 512 | 36 / 6 | 250 / 250 | Mixed dense faces, rotations, links and open PI |
| control-250 | 512 | 36 / 6 | 250 / 250 | Timer instrumentation overhead control |

All keys enable sparklines. Mixed mode cycles single/dual/triple/quad key
layouts and single/two-row/overview dials, uses 64-member (full matrix) or 16-member (smoke) rotation sets with
two named groups, Elite controls, automatic cycling, alerts, sensor colors,
16 reading links and an open property inspector. It checks every expected
numeric value in each face, so one fresh cell cannot conceal stale siblings.
The other cases use 16-member dial rotation sets and no open PI.

This is a steady rendering benchmark. The existing gesture, detail-navigation,
Gadget, fault and hardware suites cover their distinct behaviors. It does not
claim to time every interaction or the physical display. Gadget capacity must
be measured separately with `scripts/gadget-scan-benchmark.mjs`; its registry
cost is different and may already exceed a 250 ms interval at large inventories.

## Read the evidence

`summary.json` and `results.json` contain results; each case has `raw.json`,
process identities, actual exit records, stock logs and sample production SVGs.
Machine CPU model/count, memory, OS, Node, active power plan, source revision,
dirty state, workload, bundle and addon hashes travel with the measurements.

- **Callback ms:** synchronous poll interval callback, including native read,
  decode, listeners, SVG composition and initial send calls. The unique timer
  registration and stack are retained. Immediate startup reads are outside it.
- **Loop-drain ms:** callback start until a following `setImmediate`, including
  queued microtasks and loop scheduling. This includes more work than the
  synchronous callback, but is not a host acknowledgement or physical latency.
- **Update ms:** publisher copy completion just before releasing its mutex to
  mock-host receipt. It includes polling phase, composition and socket delivery.
  Per-context and all-context completion distributions are separate.
- **Coverage:** every published generation times every visible context is the
  denominator. Duplicate frames do not increase it. Skipped generations remain
  visible even when the final state arrives. Equal 250 ms producer and consumer
  clocks can coalesce an update; investigate the actual gaps rather than calling
  every skip a defect. A slower producer must deliver every generation.
- **CPU:** CPU-time delta over measured elapsed time, as percent of one logical
  core. The Stream Deck host and synthetic producer are excluded. RSS is sampled
  inside the plugin; short-run RSS growth is not a memory-leak verdict.

Producer lateness, mutex abandonment, invalid frames, missing final contexts,
ambiguous timers, caught product warnings/errors, incomplete metrics and abnormal
exits invalidate the run. A stalled or late publisher cannot make a slow plugin
look cheap. Raw timings remain available to diagnose the failure.

Correctness and capacity are separate. The default run reports these explicit
capacity budgets: callback and loop-drain p95 at most half the poll interval,
CPU at most half a core, update p95 at most two poll intervals, and at least 95%
generation/context coverage. `--strict` makes an exceeded budget fail the run.
These are conservative harness targets, not historical release acceptance or a
promise about how much CPU the whole Stream Deck host uses. CI does not enforce
machine-dependent speed thresholds; it does enforce evidence integrity.

For a fast check use `--seconds 30 --warmup 5 --repeat 2`. For a custom workload,
`--config cases.json` accepts an array of named objects overriding the default
fields: `inventory`, `keys`, `dials`, `rotation`, `pollMs`, `producerMs`, `pi`,
`rich`, `timing`. Poll intervals are 250 or 1000 ms; producer intervals are 250
or 2000 ms. Exact parameters are embedded in the report.

## Compare a fast desktop with a lower-spec computer

Run the same build, Node version, workloads and duration on each real computer.
Use labels such as `desktop-ac-balanced` and `laptop-ac-balanced`; record power
mode and whether the laptop is charging. Keep unrelated work closed. Do not
simulate a slow computer by dividing results by core count or CPU frequency.
Affinity or throttling can be useful stress experiments, but is not evidence
for another CPU's cache, memory bandwidth, thermals or power management.

```powershell
node scripts/scaling-report.mjs release/scaling-desktop/summary.json
node scripts/scaling-report.mjs release/scaling-desktop/summary.json release/scaling-laptop/summary.json
```

The comparison refuses incompatible or incomplete runs. Different shipping
hashes are identified as a code/bytes comparison, not solely a hardware effect.
Investigate disproportionately growing inventory or action costs, worse tail
latency, shrinking update coverage and insufficient interval headroom. Compare
the timed and control cases before relying on small differences. No result from
a hosted CI runner alone qualifies a high-end desktop or a lower-spec laptop.
