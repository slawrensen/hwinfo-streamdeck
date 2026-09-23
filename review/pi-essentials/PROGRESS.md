# F01 progress record (resumable)

Base: `main` 2ca44e95c2d8b3442c3ed411952621b254d4cbf0. Branch:
`claude/sweet-shannon-lss3s9` (the session's designated branch; the brief
asked for the issue number in the branch name, which this environment
does not allow).

## Done

1. Preflight on main: lint 0, typecheck 0, unit 739/739; baseline
   captures, task metrics, a11y and perf recorded on the simulated host.
2. Plugin: the preview carries context, kind, the exact device face and
   `effective` values resolved by the runtime; pushed after settings
   changes and on `getPreview`; nothing built without a visible panel.
3. Panel shell (`pi-shell.js`), pure model (`pi-model.js`), token CSS;
   Sensor Reading, Sensor Dial, HWiNFO Control and detail-tile panels on
   the shared order.
4. Studies A/B/C captured and measured; decision A + C's pinned face +
   B's spacing (README).
5. Lossless writes (groups, tiles, names, colors, lists, unknown enums);
   picker built once per tree, no row cap; APG combobox, checklists,
   reorder buttons, radio-group theme gallery.
6. Tests: unit 782/782; e2e-pi-panels 154/154; e2e-pi-persistence
   551/551; axe 0 violations over 31 states; reflow 0 px at 320/240.
7. Docs, CHANGELOG Unreleased, docs changelog page regenerated.
8. Evidence: README (review record), coverage map, acceptance ledger,
   human test script (NOT RUN), before/after sheets, device-face sheet.

## Next

1. Fold in the two independent reviews (reviews.md), rerun every gate.
2. Identify the candidate (candidate.md), push, issue, draft PR.

## Remaining gates

See README "Remaining gates (NOT RUN)".
