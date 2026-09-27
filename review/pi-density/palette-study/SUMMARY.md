# Palette placement study

Question (owner, 2026-09-25): the theme palette is the product's identity;
it must not drop so low that reaching it takes an expand, a collapse or a
long scroll.

Method: five placements of the same, unmodified theme gallery, injected
into the real panels (`scripts/pi-studies/palette.js`, `palette.css`;
never shipped), measured with `npx tsx scripts/pi-lab.mjs density --study
palette-X` on a frozen copy of the candidate panels, at the Stream Deck
app's own panel size (378x410 CSS px, bench 2026-09-23) and at 380x720 and
320x560. Simulated host, sample data, headless Chrome on Windows. An
expert measurement, not a user study.

- **A** gallery first inside the foldable Display section
- **B** look band: always open, directly under the header, not pinned
- **C** swatch-only row inside the pinned header, names on hover and to
  screen readers
- **D** Display section moved above Reading
- **E** band B pinned together with the header

Screens: `first-screen-key-378x410.png`, `first-screen-dial-378x410.png`
(first 410 px of each, the "before" build on the left). Data:
`density-A..E.json`, before `../baseline/density-4bf09c0-b.json`; table
from `node review/pi-density/palette-study/tabulate.mjs` (`table.md`).

## At 378x410

| Variant | Pinned px key / dial | Palette y key (default / all folded) | Palette y dial (default / all folded) | Tab to palette key / dial | Tab to reading picker | Tab to rotation search |
| --- | --- | --- | --- | --- | --- | --- |
| before (4bf09c0) | 0 / 0 (never pins below 560 px) | 662 below / folded | 791 below / folded | 12 / 23 | 3 | 16 |
| A | 89 / 105 | 299 in view / folded | 610 below / folded | 8 / 20 | 3 | 5 |
| B | 89 / 105 | 116 in view / 116 in view | 132 in view / 132 in view | 2 / 2 | 5 | 7 |
| C | 113 / 0 (dial header 156 px, too tall to pin) | 80 / 80 | 97 / 97 | 2 / 2 | 4 | 6 |
| D | 89 / 105 | 146 in view / folded | 162 in view / folded | 3 / 3 | 12 | 15 |
| E | 204 / 220 | 116 / 116 | 132 / 132 | 2 / 2 | 5 | 7 |

Read with care: "in view" means on the first 410 px at load; "folded"
means a closed section hides it; Tab counts start with nothing focused.

## What the numbers say

- A keeps the key's palette on the first screen but not the dial's (the
  rotation editor comes first), and any fold of Display hides it: the
  failure the owner described.
- B is the only placement that is on the first screen in every fold state
  for both panels without adding pinned height. It costs two Tab stops on
  the way to the reading picker and about 9 px of page height.
- C wins on persistence for keys only; on the dial the header grows to
  156 px, more than a third of 410, so it stops pinning. The theme names
  become hover-only.
- D keeps the palette foldable and doubles to quadruples the keyboard
  route to the reading and the rotation.
- E pins half the app's panel (204 to 220 of 410 px).

Decision and the review agents' critiques: see `../REPORT.md`.
