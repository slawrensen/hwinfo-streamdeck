# Sprint 7: guided explicit source continuity

Reviewed from `fa9ec6d`. Status: guided pairing is not implemented and is queued
behind the Gadget producer-integrity gate described in [Sprint 5](sprint-05.md).
Existing `readingLinks` runtime support and manual Deck Config editing remain.

## Existing contract

`src/hwinfo/reading-links.ts` accepts at most 128 one-to-one links containing
Shared Memory key, Gadget key, native unit and sensor type. Conflicting
endpoints, unavailable endpoints and type/unit mismatches fail closed. Applying
a link never guesses from equal names or values. Saved per-action identities
remain unchanged; runtime aliases supply a verified alternate endpoint.

## Proposed guided flow, not implemented

1. Only an explicit Refresh pairing sources action opens both local providers
   for inspection. It must close every inspection handle and must not change
   the deck's source policy or poll interval.
2. Show the two independently sourced lists with exact identity, producer label,
   source name, native unit/type, statistic capability and freshness limits.
   Freshly opened Gadget storage starts unverified. If either source cannot
   be inspected, explain that condition without filling in a guessed endpoint.
3. Require the user to select both endpoints. Unit/type compatibility narrows
   validity but does not prove physical identity. Equal labels or values must
   never select a candidate automatically.
4. Present both endpoints and an explicit acknowledgement that the user has
   checked they describe the same physical measurement on this machine.
5. Revalidate the selected endpoints before confirmation. Refuse changed units,
   types, identity, conflicts or vanished readings. Existing unresolved or
   unknown link fields must be preserved, not silently sanitized.
6. Capture the current global settings and save the approved link in one global
   write only if those settings are unchanged. Verify the host's readback.
   Removal or undo is equally explicit and preserves unrelated settings.

The UI must distinguish source fallback from binding continuity, and source
change evidence from per-reading age. On transition, unavailable producer
statistics remain unavailable, dial sessions use their reset contract, and a
missing unpaired reading stays missing. No guided flow can make Gadget's
independently written registry fields atomic.

## Required tests and evidence, not run for this feature

Production-module tests must cover malformed/conflicting links, both transition
directions, unit/type changes, missing endpoints, duplicate names, cancelled
pairing, stale confirmation and global-setting concurrency. The actual PI must
show both endpoint identities and must write nothing when the user cancels.

Run `npm test`, `npm run test:native`, `npm run e2e:dead-fallback`,
`npm run e2e:gadget`, `npm run e2e:reading-links` and `npm run e2e:pi` on the
combined head. Retain wire frames, rendered source-transition examples and
settings before/after. Previous runtime-link tests do not qualify a guided UI
that has not been implemented.

Rollback disables the guided editor or removes its approved link via an
explicit global edit. Original action bindings and the user's exported
configuration remain intact. No push, merge, tag or publication is authorized
by this design report.
