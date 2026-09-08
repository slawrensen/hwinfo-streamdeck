# Combined Windows validation

Validated runtime and package source:
`232d3681a6aa5944c64498050f07b1f940756d4d`.
Subsequent qualification commits add evidence and documentation only.

**Software checks pass; release remains NO-GO.** The Gadget atomic-update
contract/source-policy decision and required physical acceptance are open.
No candidate was installed, merged, tagged, published or submitted.

## Execution

Windows x64 10.0.19044, Node 24.16.0, native addon built against Node
20.20.0 headers. Installed Stream Deck: 7.4.2.22730; HWiNFO: 8.48.5990.0.
Native source/API were unchanged. The final runtime uses native 1.1.0,
Node-API 8, protocol 1, native source identifier `2149f0b3307c1344`.

| Check | Result |
| --- | --- |
| `npm ci` | Passed; installed lockfile preserved across integration |
| `npm run build:native` | Passed on the same native source before final TypeScript changes; production/test variants built |
| `npm run build` | Passed on the final runtime |
| `npm run release:validate` | Passed: lint, typecheck, 910 unit tests, release copy and native packaging checks; zero skipped tests |
| `npm run suite:full` | Passed, 02:07:48-02:16:06 UTC September 8; all e2e suites, 99 native tests, image generation and 23 PI captures; zero orphaned processes |
| `npm run pack` | Passed; local 1.6.1.0 candidate only |
| `streamdeck validate ... --no-update-check` | Passed |
| Packed native inspection | Exactly one production addon, matching the validated local hash; no test addons, PDBs, staging leftovers or logs |
| `npm audit --json` | Zero known advisories on the complete lockfile |
| External collector smoke | Six samples over about nine seconds against installed 1.6.0.0; host and plugin attributed separately; no candidate performance claim |

The full suite includes base e2e, resilience, Gadget, 64 explicit-link
checks in both directions, DEAD fallback, native-edge, load, drilldown,
PI persistence and socket closure. Its mock-host load run had 539 key
contexts plus eight dials and no invalid frames. It is not a physical
32-key, eight-hour test. Required hardware cases below are not counted as
passing or silently skipped.

The release-copy validator emitted one expected administrative warning:
the private Marketplace submission log has no 1.6.1.0 submission row.
There has been no submission. Lint emitted no warnings.

## Exact artifacts

Local pack: `release/com.lawrensen.hwinfo.streamDeckPlugin`, 288,995 bytes,
43 entries. SHA-256:
`54378ed01ea3597d8002b8e716a4c9f791145563c8132959f920b0d5f3a58d4c`.

Bundle SHA-256:
`67616f21d359ea5cb32acde2b5884d6599095f5089c21621a3e1c27dfe21a4ee`.

Native and packed-native SHA-256:
`be3527d829d84efc54473c235c35a0454272b3d32f3d36c825369e1cbd3f2453`.

The native signature status is `NotSigned`. It loaded and passed the native
tests; no quarantine or Marketplace rejection is inferred. PE inspection
reports ASLR/high-entropy VA, NX, CFG, CET compatibility and reproducible
link flags. Imports are KERNEL32/ADVAPI32 with delayed node.exe. Compiler
and Windows SDK versions were not exported into this bare-shell manifest
and remain `unknown`. These facts are not independent end-to-end provenance
or a claim that the local rebuild equals the installed 1.6.0 binary.

The normalized package/command evidence index is in `audit/evidence/`.
Raw logs, command timestamps, captures, manifest and pack inventory remain
locally under this worktree's ignored `release/audit-evidence/` directory,
using the `verified-` prefix. No crash dump or private log was uploaded.

## Failed and interrupted attempts retained

- Runtime `9e50600`: 888 unit and 84 native tests passed, but the first full
  suite failed one obsolete exact-color e2e assertion. The quad salvage
  fixture now uses an already-readable custom slot color; malformed cells
  and per-entry fallback remain asserted. The final full rerun passed.
- Runtime `96102b6`: 910 unit tests passed. The next suite was intentionally
  stopped after independent review found that a duplicate row's own numeric
  rejection could discard its identity evidence. The owned test process tree
  was terminated and checked for leftovers. This run is not a pass. New
  production regressions failed before the fix; the final 99 native tests
  and full suite include the correction.
- Per-area red/green evidence, including the restored/reselected dial
  first-frame regressions, is recorded in sprint reports 1-3 and 6.

## Remaining gates

U1's paused, internally consistent Gadget rewrite can still change physical
ownership without an atomic producer transaction contract. That documented
residual/source-policy decision keeps feature expansion and release blocked
under the user's S0 rule. No unsupported producer-version allowlist or
automatic name-based repair was introduced.

Eight-hour and 48-hour exact-pack physical soaks, sleep/wake/USB/session
qualification, genuine v1.5/current installation and rollback trials, five
uncoached first-run trials, and physical 72-pixel/300-ms/locale acceptance
remain NOT RUN. Explicit custom text colors may remain below the built-in
contrast floor. The local incident's recovered source is real evidence,
documented separately, and does not substitute for these candidate gates.
