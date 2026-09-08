# Sprint 2: identity integrity

Date: September 7, 2026. Audit reference:
`2ca44e95c2d8b3442c3ed411952621b254d4cbf0` (v1.6.0).
Implementation starts from the existing integrity candidate
`7320a83436fa153ca37405378ea25367b9cd811e`, in isolated branch
`fix/audit-identity-20260907`. The original checkout and integrity candidate
worktree were preserved. No competitor implementation was inspected.

## Result

The owner-only descriptor counterexample D05 reproduces against the
production `SnapshotParser` and is fixed. Before accepting values through
the cached fast path, the parser now compares each SENSOR descriptor's ID
and instance against the cached owner. A change rebuilds the snapshot,
removes the previous owner's key when it is no longer present, and derives
the replacement's key from its actual owner. Native source and the
JS/native protocol are unchanged.

The new tests modify an already parsed buffer while retaining header,
entry identity and unit bytes. ID-only and instance-only changes failed
before the fix in both classic and UTF-8 layouts. Descriptor swaps also
failed in both layouts. These six failing production-module cases pass
after the fix. Ordinary entry reordering retains the correct values under
their existing stable keys. Existing unchanged-owner fast-path and unit
rewrite cases also pass.

This establishes the parser invariant for synthetic valid mappings. It
does not establish how often HWiNFO rewrites these descriptors on physical
hardware. That producer-trigger question remains open.

## Existing Gadget containment reviewed

The base candidate already contains D03 containment in
`src/hwinfo/gadget-identity.ts` and `src/hwinfo/gadget-registry.ts`:

- Duplicate source/label identities are withheld, with no ordinal suffix
  offered as a persistent Gadget identity.
- Observed ambiguous name hashes are persisted before a snapshot is
  returned. Removing one duplicate, reopening the provider or starting a
  separate process does not release the other reading under the old key.
- Delimiter-bearing names use an injective `g2:` encoding. Ambiguous legacy
  colon/suffix keys are not silently aliased to those new names.
- Journal corruption or failed persistence fails closed. Unique aliases
  provide a new selectable identity without rewriting existing settings.

The existing Windows provider tests exercise disappearance, reorder,
reopen, separate-process restart, unique-name compatibility and journal
failure. Those tests were read but not run in this isolated area pass;
native and fixture-mutating runs are coordinated centrally. The full unit
run here includes the existing production key-encoding/link regressions.

The journal cannot recover duplicate history that the candidate never
observed, detect a different physical device reusing a unique name, or make
separate registry queries atomic. These are explicit Gadget interface
limits, not solved cases. No new Gadget implementation or speculative
identity heuristic was added in this change.

## Compatibility and recovery

| Scenario | Behavior and evidence |
| --- | --- |
| Owner ID/instance unchanged | Cached snapshot fast path remains supported by existing parser tests. |
| Owner ID or instance changes | Snapshot rebuilds; the old key cannot receive the replacement owner's value. New production regressions pass. |
| Owner descriptors reorder | Current entries are joined to the current descriptors. Classic/UTF-8 regressions pass. |
| Entries reorder normally | Saved identity keys retain the correct measurement. Classic/UTF-8 regressions pass. |
| Previously observed Gadget duplicates shrink to one | Base candidate retains the deny-list entry; Windows regression source reviewed, central execution pending. |
| Unique Gadget alias changes | Old binding remains missing; user selects the new alias. No settings rewrite. |
| Unknown historical Gadget duplication | No physical-identity claim is possible from the available metadata. |

The existing PI receives alias instructions through `statusSentence` when
the snapshot contains withheld Gadget readings. It does not yet have a
replacement preview, candidate identity evidence or cancel/confirm repair
transaction. Existing explicit provider links are configured through the
Advanced Deck Config document. A guided identity review belongs with the
setup/source-pairing work; it is not claimed complete by this parser fix.

No settings fields, action UUIDs, layout choices or version numbers changed
in this patch. To roll back, revert the parser implementation while
retaining its regressions as a release gate. That reopens D05. Preserve
profiles and the existing Gadget identity journal; removing the journal
would erase observed ambiguity.

## Execution ledger

Commands ran on Windows x64 with repository dependencies installed by
`npm ci`. Logs are retained locally under the ignored
`release/audit-evidence/` directory in the identity worktree.

| Command | Result | Log |
| --- | --- | --- |
| `node --import tsx --test test/reader.test.ts` before implementation | Expected failure: 21 pass, 6 fail, 0 skipped | `sprint-02-reader-red.log` |
| `node --import tsx --test test/reader.test.ts` after implementation | 27 pass, 0 fail, 0 skipped | `sprint-02-reader-green.log` |
| `npm run typecheck` | Exit 0 | `sprint-02-typecheck.log` |
| `npm run lint` | Exit 0, zero warnings | `sprint-02-lint.log` |
| `npm test` | 761 pass, 0 fail, 0 skipped | `sprint-02-unit.log` |

`npm ci` reported one moderate and one high dependency advisory. Dependency
review is owned by the release-integrity work; no automatic dependency
changes were applied here.

## Outstanding acceptance gates

This area pass does not mark the whole sprint or release qualified.
`build:native`, `build`, `test:native`, `e2e:gadget`, `e2e:pi` and
`suite:full` await the central serialized validation run on the combined
candidate. These are pending checks, not passes or silently skipped cases.
Physical HWiNFO topology-change captures, physical key/dial results and
guided repair/cancellation captures also remain outstanding. The D05 fix
can be reviewed and delivered with the existing measurement-integrity
containment without waiting for a future calendar sprint boundary.

## Follow-up: ambiguity from a rejected Gadget scan

Base: `c5f404448359e7024d801537ec62caeb6272e6c6`. The integration review found
a D03 regression at the boundary between duplicate containment and the
subsequent U1 scan validation. This follow-up does not establish an atomic
Gadget producer contract.

Start with a selected unique name at slot 0. Add its indistinguishable
duplicate at slot 1, then make unrelated slot 8 fail validation. The reader
verifies both duplicate rows, but rejects the scan before its old journal
call. Removing slot 0 and repairing slot 8 can then publish slot 1 under
the saved key. An explicit cross-source link can propagate that wrong key.

The scan now journals the coherently decoded prefix in a `finally` block.
Later field disagreement, formatted/raw disagreement or a query exception
cannot discard already observed ambiguity. A rejected scan still publishes
no snapshot and commits no digest or measurement freshness. Failed journal
access throws `invalid`; it is not hidden behind a retryable `null` result.
Successful scans read the journal once, as before. A rejected scan now also
does that bounded journal operation; no measured overhead claim is made.

The added Windows production-provider regressions cover all three abort
paths, duplicate removal and reopen, explicit-link containment, unchanged
freshness on rejection, unique-reading recovery and failed journal access.
The centrally serialized run produced this evidence:

| Command and source | Result | Ignored raw evidence under `release/audit-evidence/` |
| --- | --- | --- |
| `node --import tsx --test --test-name-pattern="verified duplicate history\|rejected unique prefix\|rejected scan fails" test/gadget-provider.test.ts`, original provider | Four failures, one pass, zero skips. All three abort paths returned the survivor's 80 under the saved 40's key; failed journal access returned `null` instead of `invalid`. | `partial-scan-red.log` |
| `node --import tsx --test test/gadget-provider.test.ts`, patched provider | 44 pass, zero failures or skips | `partial-scan-green.log` |
| `npm run lint` | Pass, zero warnings | `partial-scan-lint.log` |
| `npm run typecheck` | Pass | `partial-scan-typecheck.log` |

The unchanged production addon was copied from the qualification worktree;
its SHA-256 was
`BE3527D829D84EFC54473C235C35A0454272B3D32F3D36C825369E1CBD3F2453`.
Native source was not rebuilt or modified for this follow-up. The matching
Gadget e2e and full integrated candidate qualification remain the root
coordinator's execution gates; these local results do not replace them.

Native production source and the physical producer are unchanged. The tests
use the existing per-process synthetic registry key and a query seam; they
do not write the real HWiNFO Gadget key or touch its shared-memory mutex.
