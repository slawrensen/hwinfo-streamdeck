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

## Done after the reviews

9. Both independent reviews folded in (reviews.md); every gate rerun on
   `34dd1fc` (was `47b34e2` before the history rewrite; same tree): lint 0, typecheck 0, unit 789/789, e2e-pi-panels 164/164,
   e2e-pi-persistence 551/551, axe 0 violations and 0 traversal issues
   (forward and Shift+Tab) over 31 states at 400 and 320 px, captures 0
   overflow at 480, 320 and 240 px.
10. Candidate identified (candidate.md); issue #37; draft PR #38.

## Done on the Windows bench (2026-09-23)

11. Benched in the real Stream Deck app with live HWiNFO and a + XL
    (bench/2026-09-23/report.md): defects D1 to D8 and D11 fixed with
    checks, harness defects H1 and H2 fixed; D9, D10 and H3 open.
12. The owner's design pass: dual pinned-row badges on the label line;
    folds kept per panel kind while the app runs, with Open all and Fold
    all in the header (a durable plugin-side copy was built and removed);
    the picker closes only on a click or focus change; the dial's
    rotation sits under the reading on the dial and its face beside the
    name.
13. Gates on the new candidate (candidate.md): lint 0, typecheck 0, unit
    791/791, e2e-pi-panels 184/184, e2e-pi-persistence 551/551,
    `npm run e2e` all passed; `suite:full` all green on the same
    `plugin.js` (4808487d).

## Next

Integration with the 1.7 line (#33, #32, #36) per rebase-1.7-plan.md
before the PR leaves draft; the remaining gates below.

## Remaining gates

See README "Remaining gates (NOT RUN)".
