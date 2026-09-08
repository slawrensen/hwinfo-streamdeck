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
