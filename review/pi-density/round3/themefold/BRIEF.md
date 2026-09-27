# Foldable theme band: mockup review brief

## The owner's request (2026-09-26, verbatim intent)

Make the theme band at the top of the Sensor Reading and Sensor Dial
settings panels collapsible like the other sections, but when collapsed
it still shows the selected theme's chip and color, so it keeps a visual
representation and takes up less space. It should be open by default on
the first open, and its folded state is remembered the usual way (no
change to how folds are kept). Deliver design mockups that are
adversarially reviewed and approved on UI/UX grounds.

This relaxes the owner's earlier rule that the palette never folds. The
owner's other rules still hold: every theme name visible without hover
while the band is open; Default's link mark and shared meaning; the
resolved theme visible on screen (folded included); theme controls
directly under the reading header; the 28 px control scale; no new
modes, global settings, banners or animation systems.

## How folds work today (unchanged by any variant)

- `details.hw-sec[id]` and `details.hw-sub[id]` are sections. The shell
  (ui/pi-shell.js lines 260-382) remembers a person's toggle per panel
  kind in the plugin's memory (src/panel-folds.ts: ids `sec-[a-z]{1,24}`,
  up to 12 per kind, RAM only, reset on an app or plugin restart). A
  section starts at its HTML default (open) until the person folds it.
- Open all and Fold all in the header, and Alt-click on a section title,
  act on every section. Sections are hidden (`visibility: hidden`) until
  the plugin answers with the remembered folds, at most 300 ms after the
  panel connects, so a restored fold never flashes.
- A folded section's summary line states its effective result; open, the
  line steps aside.

## The prototypes (copies of the frozen d04 panels; product files untouched)

All three wrap the band in `<details class="hw-sec ..." id="sec-theme" open>`
and use one prototype script (`ui/proto.js`) that clones the checked chip's
face into the summary. Folded, the resolved theme stays named.

- **A, section row.** A standard section summary ("Theme", bold like
  Reading and Display) above today's band. Folded: "Theme [mini chip]
  (shared: Void)". Open: the summary row plus today's line and chips.
- **B, the line is the fold row.** Today's "Theme Default (shared: Void)"
  line becomes the summary, with the fold marker in front. Change moves
  to the row's right end, outside the summary (a sibling positioned over
  the row). Folded: "Theme [mini chip] (shared: Void)", the chip taking
  the name's place.
- **C, as B with a full-size chip.** Folded shows the chip at its grid
  size (83 x 30).

Plugin dirs (serve one with `PI_SIM_PLUGIN_DIR=<dir>`):

- d04 reference: `%S%\r3-cand-d04\com.lawrensen.hwinfo.sdPlugin`
- A: `%S%\themefold\proto-A\com.lawrensen.hwinfo.sdPlugin`
- B: `%S%\themefold\proto-B\com.lawrensen.hwinfo.sdPlugin`
- C: `%S%\themefold\proto-C\com.lawrensen.hwinfo.sdPlugin`

Prototype sources: `%S%\themefold\proto.js`, `proto-A.css`, `proto-B.css`,
`proto-C.css`, `build.py`. Measurements and 40 captures (373 x 410 at
DPR 1.5 and 160 px wide, open and folded, key Default, dial Ember, key
Default on a Paper shared theme, all sections folded):
`%S%\themefold\shots\` with `measure.json`; the script is
`%S%\themefold\measure.mjs`.

`%S%` = `C:\Users\stephen\AppData\Local\Temp\claude\C--Users-stephen-git-hwinfo-streamdeck\91b47c1b-9d80-49d5-bfea-6c93b12f0164\scratchpad`

## Measured so far (simulated host, 373 x 410 CSS px)

| | d04 (no fold) | A | B | C |
| --- | ---: | ---: | ---: | ---: |
| Band open, px | 106 | 130 | 113 | 113 |
| Band folded, px | n/a | 35 | 33 | 41 |
| Band folded at 160 px wide | n/a | 53 to 73 | 50 | 76 |
| Tab stops to the checked chip (Default key) | 3 | 4 | 4 | 4 |
| Text color field top, open / folded | 405 | 429 / 334 | 412 / 332 | 412 / 340 |
| Fold remembered on the next panel | n/a | yes | yes | yes |

Questions the review must settle:

1. Which variant, and with what changes, so a first-time user can still
   answer "what is drawn and where does it come from" folded and open?
2. Should Open all, Fold all and Alt-click include the theme band?
3. Is hiding the band until the fold answer arrives acceptable (all
   sections do this today)?
4. What must the folded row say to assistive technology, and is the
   extra Tab stop justified?
5. What happens with no reading picked, an unknown stored theme, a
   Paper (light) shared theme, and at 200% zoom?
