# Documentation image audit

Audited source and stable release: `bb4aedecbce499e199df8af63793a1490c0fb6ed` / `v1.7.1`. GitHub tree comparisons confirmed identical candidate asset blobs on `main` and the release tag at audit time.

## Selection and provenance

The hero is an authentic Stream Deck app capture with live readings, not a physical hardware photo. It shows 36 Midnight keys and six independent Tint dials with Words in the accent color over the Cosmic Cliffs. Source: `docs/assets/img/dial-backgrounds-deck.jpg`; release documentation: `docs/sensor-dial.md#transparent-background`; source: `src/ui/dial-background.ts`. The picture spans the touch strip; no full-strip graph is claimed. Credit: NASA, ESA, CSA, STScI.

The strip comparison is also Stream Deck app captures with live readings. `docs/assets/img/dial-backgrounds-strip.jpg` and `.github/readme/backgrounds.jpg` are byte-identical. Source captions in README.md and docs/sensor-dial.md identify Cosmic Cliffs, ISS auroras (NASA), and maintainer gradients. Preserve these credits.

The Keys and Dials samples are production-renderer boards with sample values, not app or physical screenshots. Provenance is scripts/readme-boards.mjs. Keys is cut from docs/multi-readouts style captures via the board script; the extracted quad and two-row dial are attainable released configurations. Dials use ordinary Theme text and an Ultraviolet theme in the selected crop. No synthetic recoloring.

The theme derivative crops the first two rows of `.github/readme/themes.png`, omitting alert examples. This is intentional: its direct low-level overview alert example supplies raw alert color, whereas 1.7 runtime composition performs contrast adjustments; do not promote that direct-rendered alert row as identical released device output without checking the composer. Seven healthy themes retain their baked labels and type-accent explanation.

`docs/assets/img/dial-reading-colors-1.7.png` embeds HWiNFO Sensors 1.7.0. It is fixed sample data rendered by the production dial action; its adjacent provenance JSON confirms source/settings and its current bytes. `pi-dial-reading-colors-1.7.png` embeds UI build 1.7.1.0-1 and is a real property-inspector capture through the local test host with live Shared Memory, not an installed-app or physical capture. These should remain settings/reference illustrations, not hero images.

The hardware photograph docs/assets/img/plusxl-photo.jpg is authentic and 1600×1452, 440447 bytes. marketing/README.md identifies July 2026 on an earlier version; it includes intentional Warn/Crit demonstration keys and is not a clean healthy hero. The two 17.9 MB marketing photo masters are identical and were preserved, never copied into docs.

## Visual inspection

Inspected the original deck, all seven README candidate boards, docs strip/color/PI/photo images, and marketing shots 1–9 (1200 px contact sheets with readable titles and controls). Then inspected the exported phone and gallery detail crops. Marketing assets contain embedded promotional headlines and more whitespace, so the unobstructed app/renderer visuals are better for documentation. The status board belongs in troubleshooting, not the opening view.

## Export inventory

All exports live in `docs/assets/img/showcase/`. Intrinsic width/height and hash records are also in `provenance.json`. Original masters remain unchanged.

| File | Dimensions | Bytes |
|---|---:|---:|
| deck-1300.webp | 1300 × 710 | 129498 |
| deck-960.webp | 960 × 524 | 90260 |
| deck-640.webp | 640 × 350 | 53388 |
| deck-detail.webp | 422 × 406 | 28466 |
| deck-detail.jpg | 422 × 406 | 59112 |
| keys.webp | 976 × 732 | 37210 |
| keys.png | 976 × 732 | 73579 |
| keys-detail.webp | 288 × 288 | 7946 |
| keys-detail.png | 288 × 288 | 15986 |
| dials.webp | 1312 × 880 | 112768 |
| dials.png | 1312 × 880 | 163867 |
| dials-detail.webp | 400 × 200 | 12466 |
| dials-detail.png | 400 × 200 | 27525 |
| backgrounds.webp | 1264 × 694 | 173790 |
| backgrounds-detail.webp | 621 × 332 | 55472 |
| backgrounds-detail.jpg | 621 × 332 | 95402 |
| themes.webp | 2224 × 804 | 129518 |
| themes.png | 2224 × 804 | 271795 |

## Suggested captions

- Hero: “Live Stream Deck app capture. Midnight keys and transparent Tint dials.” Follow with the Cosmic Cliffs credit. The phone crop can say “Detail of the same deck.” Its enlargement should open the complete original.
- Keys detail: “Four readings on one key. Sample rendering.” Link to sensor-reading.html#layout-four-readings-the-quad-grid.
- Dials detail: “Two readings with trends. Sample rendering.” Link to sensor-dial.html#overview-view.
- Backgrounds detail: “Live dials over touch strip pictures.” Link to sensor-dial.html#transparent-background; retain NASA/ESA/CSA/STScI and NASA credits.
- Themes: “Seven themes, with sensor-type accents on and off. Sample renderings.” Link to themes.html.

## Implementation guidance

Use eager loading and fetchpriority=high only for the principal image. Responsive deck WebP widths are 640, 960 and 1300; full JPEG fallback already exists at /assets/img/dial-backgrounds-deck.jpg. Below 600 CSS pixels, use deck-detail.webp with JPEG fallback and full-original lightbox. Do not upscale the native 422×406 crop excessively. Use intrinsic width and height. Below-fold gallery images should be lazy. New images live within docs so the existing preview publisher copies them. All full boards have an accessible complete original target, and text captions convey meaning separately from baked small labels.

## Limits

No new Windows/HWiNFO capture or physical-device test was run. This is reuse and faithful technical optimization of the checked-in released images. Private release copy runbooks were absent; public AGENTS.md and marketing/README.md rules were applied.

## Final phone theme comparison repair

Exported the healthy seven-key top row from released `docs/assets/img/themes-contact-sheet.png`, crop `[0, 0, 1072, 168]`. `themes-key-strip.webp` and PNG fallback preserve exact pixels (lossless), source hash and derivative hashes in showcase/provenance.json. Intended visible use is an accessible horizontally scrollable strip on phones, retaining the full original board as the image-viewer link. Caption: “Seven presets with sample readings. Open the full comparison for layouts and alert states.”
