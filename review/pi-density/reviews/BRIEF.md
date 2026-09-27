# Shared brief for the independent review agents (density pass, 2026-09-25)

You are one of several independent, read-only reviewers. Do not edit, create
or delete any file inside `C:\Users\stephen\git\hwinfo-pi-density` or any
other repository. Scratch files go only under your own temporary folder
(`%TEMP%\hw-review-<your role>`). Do not start, stop or restart the Stream
Deck app, HWiNFO, or any process you did not launch; do not touch the
clipboard; do not run `npm run suite:full`, `npm run e2e`, or anything that
spawns the plugin. Report evidence with file paths, fixture names and
reproduction commands. Label every claim as MEASURED (you ran it),
READ (from code or files), or INFERRED (your judgment).

## The product

A Windows Stream Deck plugin that shows live HWiNFO sensor readings on keys
and dials. Its settings panels ("property inspectors") are narrow HTML pages
the Stream Deck app embeds. Real host facts (bench 2026-09-23, Stream Deck
7.4.2, QtWebEngine 6.9.3 / Chrome 130): the panel is **378 x 410 CSS px at
DPR 1.5, 373 px client width**; Escape never reaches the page; each key
selection loads a fresh page; saves from `pagehide` never land.

Panels (worktree `C:\Users\stephen\git\hwinfo-pi-density`, branch
`claude/pi-density`, uncommitted on top of `4bf09c0`):
`com.lawrensen.hwinfo.sdPlugin/ui/` `sensor-reading.html` (key),
`sensor-dial.html` (dial), `control.html`, `detail-slot.html`, `pi.css`,
`pi-shell.js` (header, status, bindings, folds), `pi-common.js` (pickers,
rotation editor, gallery, summaries), `pi-model.js` (pure summaries).
Plan and baseline: `review/pi-density/PLAN.md`. The original assignment is
the "master prompt" in the user's review kit (not needed to do your job).

## The owner's concern (the question under test)

"The color palette (the theme gallery: Default, Void, Graphite, Ultraviolet,
Midnight, Forest, Ember, Paper) is the product's core identity. It must not
drop so low that you have to expand or collapse something to reach it."

Five placements of the SAME, unmodified gallery were built as injected
studies (`scripts/pi-studies/palette.js` + `palette.css`, never shipped):

- **A** control: gallery first inside the foldable Display section.
- **B** look band: gallery in an always-open band right under the header,
  before Reading; it never folds and is not pinned.
- **C** header palette: swatch-only row inside the pinned header; names only
  on hover (title) and in the accessible name.
- **D** Display section moved above Reading.
- **E** band B pinned together with the header.

## Evidence already produced (simulated host, sample data, headless Chrome on Windows)

- Measurements: `review/pi-density/palette-study/density-{A..E}.json` and the
  before build `review/pi-density/baseline/density-4bf09c0-b.json`; table:
  `node review/pi-density/palette-study/tabulate.mjs`. Heights are content
  heights; "Tab" is a real keyboard route from nothing focused.
- Full-page screenshots: `%SCRATCH%\shots-palette-{A..E}\<fixture>--<state>--<W>x<H>.png`
  and before: `%SCRATCH%\shots-baseline\...` where `%SCRATCH%` is
  `C:\Users\stephen\AppData\Local\Temp\claude\C--Users-stephen-git-hwinfo-streamdeck\91b47c1b-9d80-49d5-bfea-6c93b12f0164\scratchpad`.
  First-screen crops at 378x410: `%SCRATCH%\first\`.
- The variant runs used a frozen copy of the candidate panels
  (`%SCRATCH%\cand-v1\com.lawrensen.hwinfo.sdPlugin`), taken BEFORE the dial's
  rotation editor became a listbox + toolbar. The working tree has that newer
  editor.

## Running your own measurements

From `C:\Users\stephen\git\hwinfo-pi-density` (Chrome at the default path):

```
set PI_LAB_PORT_BASE=<your port base>
npx tsx scripts/pi-lab.mjs capture <outDir outside the repo> --widths 378 --only dial-configured,dial-groups [--study palette-B]
npx tsx scripts/pi-lab.mjs density <out.json outside the repo> --sizes 378x410 --study palette-B
npx tsx scripts/pi-lab.mjs a11y <out.json outside the repo> --widths 378 --height 410 --study palette-B
```

`a11y` adds axe-core when `AXE_CORE=C:\Users\stephen\git\slawrensen-site\node_modules\axe-core\axe.min.js`.
Set `PI_SIM_PLUGIN_DIR` to the frozen copy above to measure the variants on
identical panels; leave it unset to measure the working tree. Fixtures are
listed in `scripts/lib/pi-fixtures.mjs`. Use only the port base you were
given (each lab owns base..base+2).

## Deliverable

A report under ~900 words: findings ranked P0 (breaks trust, integrity or
access) / P1 (materially worse task or density) / P2 (polish), each with
evidence and a concrete fix; your recommended palette placement with
confidence (high/medium/low) and what evidence would change your mind.
