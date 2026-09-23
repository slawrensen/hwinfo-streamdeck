# F01 progress record (resumable)

Base: `main` 2ca44e95c2d8b3442c3ed411952621b254d4cbf0. Branch: `claude/sweet-shannon-lss3s9`.

## Done
- Baseline on main: lint 0, typecheck 0, unit 739/739. Simulated-host baseline captures and task metrics (not committed; regenerate with `git stash` of ui/ or from main).
- Plugin: preview carries context, kind, exact device face (last setImage/setFeedback SVG), effective values; push after settings change; getPreview.
- Panel shell (pi-shell.js), pure model (pi-model.js), token CSS, Sensor Reading panel migrated.
- Studies A/B/C captured; decision A + pinned face on tall panels (C) + tighter rhythm (B).

## Next
1. Dial, control, detail-slot panels.
2. Tests: unit (pi-model, pi-protocol effective/face), e2e-pi-panels (zero writes, lossless, keyboard, switching), update e2e-pi-persistence selectors.
3. a11y, perf, parity, package, docs, review record, issue, draft PR.
