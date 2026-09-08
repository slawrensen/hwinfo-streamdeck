# Sprint 11: resource and hardware qualification

Software base: `fa9ec6ddbe7c60008f9512b17eafeaa52fe245fd`.
Branch: `chore/audit-qualification-20260907`.

The external soak monitor now records Stream Deck host RSS, private bytes,
handles, threads and cumulative CPU independently from the plugin. Summary
CPU and slope calculations use each process's own contiguous lifetime
segments, including creation time and counter-reset checks for PID reuse.
An app restart cannot create a negative CPU estimate and a plugin restart
does not discard the host's history. Old CSVs remain readable with missing
host measurements reported as unavailable. Appending into an old-schema
file is refused; use a new output file for a new run.

Three production-script tests cover independent process restarts/CPU counters,
PID reuse and legacy CSVs. Nine selector tests cover parent/session evidence,
ambiguous hosts and retaining only a verified lifetime while the plugin is
absent. All twelve focused tests and lint passed after independent review.
The script remains an external observer. No in-process
instrumentation, app restart, key change or HWiNFO mutation was added.

## Execution boundary

The short `installed-v160-smoke.csv` run validates collection against the
existing installed 1.6.0.0 plugin, HWiNFO 8.48-5990 and Stream Deck
7.4.2.22730. It is not an eight-hour run or a candidate performance claim.
Other unrelated preview plugins are also installed; the monitor's exact
`com.lawrensen.hwinfo.sdPlugin/bin/plugin.js` selector excludes them.

The candidate's mock-host load suite configures keys/dials at 250 ms, but
does not measure host rasterization under that synthetic deck. Record its
output separately from actual-host and physical-device evidence.

Required candidate acceptance remains NOT RUN:

- Eight hours with the exact pack on 32 keys at 250 ms plus dials.
- P95 tick below 25 ms, post-warmup plugin RSS growth at most 20 MiB, no
  sustained handle growth. No budget was changed or implicitly accepted.
- Real source restart, host restart, USB reconnect, sleep/wake and locale
  matrix. Historical PERF.md rows are not current-candidate passes.
- GDI/resource attribution where applicable. The WMI monitor records kernel
  handle counts; it does not claim those are GDI object counts.

Use the exact pack/native/bundle hashes in the environment record. Run
`node scripts/soak-monitor.mjs --interval 60 --duration 28800 --out <new.csv>`
only after installing and verifying the candidate on the bench. Preserve
the stock shipping configuration and keep fault injection in the separate
adversary tool. Record both processes and the hardware configuration.

Rollback: revert the monitor changes. Retain raw CSVs; the old monitor will
not parse the new appended host columns, so preserve this summarizer with
the evidence. No user settings or installed plugin bytes were changed.

## PR review correction: observation gaps and host events

Review of `5d4c72d2241e77eb250c7adbe3251d69cbdc2906` found that a failed
WMI snapshot was summarized as a stopped plugin and absent HWiNFO. The CSV
had preserved the failure note, but the summary discarded it. Failed
observations now remain unknown, with an explicit count and the original
error note. The same correction applies to historical 14- and 19-column
files whose failure rows contain zero counts. Confirmed empty snapshots
still count as absence. WMI command errors are terminating, and resource
segments end at failed observations and detected sampling gaps.

Host lifetime events were calculated but omitted from the printed report.
They now appear with a Stream Deck host scope and a separate restart count,
including a reused PID with a changed creation timestamp. A missing or
ambiguous host association says observation unavailable, not process absent.
Notes cannot inflate restart counts just by containing the word restart.

Four new production `--summary` regressions failed before the correction.
Afterward the focused release-input, host-selector and monitor suites pass
21 tests, with zero skips; lint and typecheck pass. Commands and raw logs
are retained under `release/audit-evidence/review-soak-{red,green,lint,typecheck}.log`.
The focused command is `node --import tsx --test --test-concurrency=1
test/release-inputs.test.ts test/soak-host.test.mjs test/soak-monitor.test.ts`.
Only synthetic CSV summaries ran. No native, WMI, live-host or physical
test ran for this correction; the required hardware gates remain open.
