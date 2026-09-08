# Sprint 8: transactional configuration review and undo

Reviewed from `fa9ec6d`. Status: the proposed import review/undo feature is not
implemented and is queued behind the producer-integrity gate. Existing Config
export/import remains available. This report does not call the current Apply
button transactional or identity-aware.

## Current behavior observed in source

`pi-common.js` exports the existing settings object with a readable name appended
to Shared Memory keys. Gadget keys retain their full spaces. Import strips
those annotations from known identity fields while leaving other fields intact.
Current Apply accepts an object, writes it immediately and reloads after 350 ms.
It has no identity preview, undo snapshot, concurrent-edit check or host
readback check.

The vendored SDPI client's `setSettings`/`setGlobalSettings` methods transmit a
socket message. `getSettings`/`getGlobalSettings` wait for the corresponding host
response. Successful transmission is not a storage acknowledgement. The
existing PI mock stores action writes but returns a constant global object;
that mock must retain global writes before testing readback.

## Proposed transaction contract, not implemented

- Scope each transaction to the currently selected Key/Dial or Deck document.
  There is no claim of atomicity across independent action and global writes.
- Import is an explicit overlay: fields supplied by the imported object replace
  the corresponding current fields; omitted fields, including unknown current
  settings, remain unchanged. Imported unknown fields are preserved as data.
  Explain this policy before confirmation and expose every overwritten field.
- Parse and size-check the whole object before staging. Strip only supported
  name annotations from identity fields; never normalize all settings or drop
  unknown nested data. The raw document remains the established format.
- Preview retained settings, overwritten settings, exact-key-present readings,
  missing readings, ambiguous evidence and unsupported capabilities. An exact
  key present on a foreign PC does not prove it identifies the same hardware.
  Show source/group, label, key, native unit and capability alongside each
  binding, with no automatic remapping.
- Require explicit identity review before applying imported bindings, including
  bindings whose keys happen to exist on the new machine. Missing identities
  may remain saved only with their unavailable result clearly acknowledged.
- Capture the entire current object when previewing. Immediately before the
  single host write, fetch and compare it again. Refuse a stale preview rather
  than overwriting concurrent edits. Cancellation writes nothing.
- Retain a before/after snapshot in storage scoped to this PI context and
  document kind. Send once, then verify the host's readback with a bounded
  timeout. A timeout after transmission means outcome unknown, not proof that
  nothing changed. Do not retry automatically or claim success.
- After an uncertain result, reload and reconcile the actual object with the
  staged before/after states. Never automatically restore over a third state.
  Undo is offered only when the current full object still equals the committed
  after-state; otherwise refuse and preserve the snapshot for manual review.
- Panel reload follows verified application so every cached per-field control
  adopts the committed object. Repeated import is deterministic and reversible.

## Required tests and evidence, not run for this feature

Use a browser-shared pure transaction helper so unit tests execute production
logic. Cover malformed/oversized documents, preservation of unknown fields,
v1.5 omitted fields and mirrored Back behavior, mixed-density plans, foreign-PC
bindings, duplicate identities, unsupported statistics, cancellation, repeat
import, concurrent edits, send failure, lost acknowledgement, reload recovery
and undo after an intervening edit. Assert at most one host write per scope.

Update the real PI mock to retain global settings and explicitly drive Preview,
Confirm, Cancel and Undo. Run lint, typecheck, `npm test`, `npm run e2e:pi`
and `npm run e2e:drilldown` on the combined head. Keep actual v1.5 exports,
before/after settings and wire logs. Real host profile imports and downgrade
checks remain unperformed external acceptance gates.

Rollback of the future feature restores the pre-import object only after a
current-state conflict check. Reverting UI code alone is not an undo of settings
already applied. Preserve the original export and all transaction evidence.
