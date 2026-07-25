# Marketing assets

The Elgato Marketplace listing images for HWiNFO Sensors. Nothing here is a
mockup: the boards are drawn by the plugin's own renderers (`src/ui/`) from
live HWiNFO readings on the dev machine, and the one photograph is the plugin
running on real hardware, perspective-straightened and nothing staged. The
marketing is the product output. That is the point, and it is why these files
live in the open repo instead of a private drive.

| File | Use | Spec |
| --- | --- | --- |
| `app-icon-288.png` | Marketplace app icon | 288x288 |
| `thumbnail.png` | Listing thumbnail | 1920x960 |
| `shot-1-hero.png` | Gallery 1: full deck of live readings | 1920x960 |
| `shot-2-hardware.png` | Gallery 2: real Stream Deck + XL photograph board | 1920x960 |
| `shot-3-themes.png` | Gallery 3: all seven themes + alert states | 1920x960 |
| `shot-4-settings.png` | Gallery 4: the real settings panel | 1920x960 |
| `shot-5-dials.png` | Gallery 5: Stream Deck + dials | 1920x960 |
| `hwinfo-streamdeckxlplus.png` | Photo master: Camera Raw develop of the Sony A7 III capture | source |
| `hwinfo-streamdeckxlplus-squared.png` | Photo master as the board consumes it; the board's default source | source |

`scripts/validate-release-copy.mjs` checks every fixed-spec asset above exists
at the dimensions listed, so a missing or wrong-sized asset fails `npm run
release:validate`. The two photo masters are sources, not portal uploads, and
are not size-checked.

## Regenerate

Shots 1, 3, 5 and the thumbnail render straight from the renderers with live
HWiNFO running:

```bash
npx tsx scripts/marketplace-shots.mjs marketing
```

Shot 4 composites two real property-inspector screenshots, so it needs a
capture directory. Full pipeline:

```bash
npm run build
node scripts/pi-harness.mjs                 # keep running in its own terminal
node scripts/capture-pi.mjs <dir>           # captures: pi-settings, pi-picker,
                                            # pi-dial-rotation, pi-dial-groups,
                                            # pi-dial-presets, pi-dial-custom,
                                            # pi-control
npx tsx scripts/marketplace-shots.mjs marketing <dir>
```

Shot 4 uses `pi-settings.png` and `pi-picker.png`; the dial/control captures
feed the docs site (`docs/assets/img/`).

Shot 2 wraps the real-hardware photograph in the standard board chrome:

```bash
node scripts/shot2-hardware.mjs             # rebuilds from the squared master
node scripts/shot2-hardware.mjs <photo>     # or from any new export
```

The photo masters are `hwinfo-streamdeckxlplus.png` and
`hwinfo-streamdeckxlplus-squared.png`, which for the current shot hold the
same pixels: the frame was taken square on to the deck, so it needed no
perspective pass, and the "squared" name is kept because the board reads it by
default.

Current master, replacing the earlier iPhone ProRAW capture: Sony A7 III, FE
85mm at f/2.5, 1/400, ISO 1600, developed once in Adobe Camera Raw from an XMP
sidecar. Exposure +0.55 into the 1.07 EV of highlight headroom the frame had
spare, highlights -45 to hold the screens, shadows +75 and blacks +12 to bring
the chassis and dials out of black. Nothing clips. There is no exposure
blending and no compositing: the touch strip sits slightly outside the depth of
field at f/2.5, and it was recovered with a bounded deconvolution of that
region rather than by borrowing a sharper strip from another frame, because the
other frames have a different sensor configured on the strip and would have
shown a deck state that never existed.

The app icon is resized from the plugin's own marketplace icon:

```bash
npm run icons                               # renders imgs/plugin/marketplace(@2x).png
# then: sharp-resize marketplace@2x.png -> app-icon-288.png (288x288)
```

All copy baked into these images follows `docs/release/COPY_RULES.md` (no em
dashes, no "telemetry", claims that map to real behavior). The validator cannot
read text inside a PNG, so check rendered strings by eye after regenerating.
