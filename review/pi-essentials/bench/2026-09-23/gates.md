# Gate results quoted from the bench logs

The repository ignores `*.log`, so the raw logs stay on the bench
machine; these are their result lines, verbatim where quoted.

## Current candidate (`835b046`, panel token `1.6.0.0-f01l`)

| Gate | Result |
| --- | --- |
| `npm run lint` | 0 problems |
| `npm run typecheck` | 0 errors |
| `npm test` | `ℹ tests 791`, `ℹ pass 791`, `ℹ fail 0` |
| `npm run e2e:pi-panels` | 184 PASS, 0 FAIL, `ALL GREEN` |
| `npm run e2e:pi` | 551 PASS, 0 FAIL, `PI PERSISTENCE E2E: ALL CHECKS PASSED` |
| `npm run e2e` | 102 PASS, 0 FAIL, `E2E: ALL CHECKS PASSED` |
| `node scripts/validate-release-copy.mjs` | `release copy OK: 57 files checked, 0 warning(s).` |

## Bench build with the same `plugin.js` (`4808487d...`)

`npm run suite:full` on Windows with live HWiNFO present, every suite in
order: `E2E: ALL CHECKS PASSED` (102), `e2e:resilience`,
`GADGET E2E: ALL CHECKS PASSED`, `e2e:dead-fallback`,
`NATIVE-EDGE E2E: ALL CHECKS PASSED`, `LOAD E2E: ALL CHECKS PASSED`,
`E2E DRILLDOWN: ALL CHECKS PASSED`,
`PI PERSISTENCE E2E: ALL CHECKS PASSED` (551), `e2e:pi-panels`
`ALL GREEN` (177 on that panel build), `SOCKET-CLOSE E2E: ALL CHECKS PASSED`,
`test:native`, contact sheet, marketplace shots, the pi-harness capture,
then:

```
=== hygiene ===
processes before: 105, after: 105, new: 2 (0 ours, 2 unrelated)

SUITE: ALL GREEN, ZERO ORPHANS
```

| Gate | Result |
| --- | --- |
| `npm test` | `ℹ tests 791`, `ℹ pass 791`, `ℹ fail 0` |
| `npm run test:native` | `ℹ tests 69`, `ℹ pass 69`, `ℹ fail 0` |
| `node scripts/validate-native.mjs` | `NATIVE VALIDATION: OK (hwsm.node present, protocol/ABI consistent, pack clean)` |

## Candidate as submitted (`34dd1fc`), first run here

`e2e:pi-panels` before the harness fix H2 (headless Chrome on Windows
fires no focus event for a scripted `focus()`):

```
2 FAILED
  - scale: all 5,000 readings are options
  - scale: the deep saved reading is selected and in view on open
```

## Freeze legs

- B2.5, plugin suspended: `suspended pid 61416 at 01:55:24.618Z`,
  `resumed at 01:55:38.634Z`; the panel showed "The plugin is not
  responding" after about 3 s and returned to Live on resume.
- B4.2, HWiNFO suspended: not possible from this shell (HWiNFO runs
  elevated; `NtSuspendProcess` refused the handle).
