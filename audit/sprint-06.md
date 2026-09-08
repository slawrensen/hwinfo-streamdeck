# Sprint 6: readability and non-color severity

Date: September 7, 2026. Original audit reference:
`2ca44e95c2d8b3442c3ed411952621b254d4cbf0`. Work starts from the existing
integrity candidate `7320a83436fa153ca37405378ea25367b9cd811e` on isolated
branch `fix/audit-readability-20260907`. The statistics patch `df4beeb` was
cherry-picked as `53dabdb` before composing production-action regressions.
The original checkout and integrity candidate worktree were preserved.
No competitor implementation or assets were inspected.

## Result

D08 is corrected for automatic measurement colors: normal and dim primary
values, units and numeric session statistics, quad identity values, and
dial warning/critical values meet an unrounded 4.5:1 contrast floor on
their actual theme or selected-row background. Alert numeric foreground
hues now have separate `alertValues` tokens in `themes.json`; alert fill
colors remain available for bars and whole-key surfaces.

Passing colors remain unchanged. Failing automatic colors move toward
black or white until the actual quantized color meets the floor. The
original identity hue remains recognizable as a hue family. Numeric unit
tokens were raised slightly; numeric statistics share those tokens. Dim
mode preserves the same numeric floor even when secondary labels dim
further. Selected two-row dial values and units are resolved against the
track fill, not the ordinary theme background.

Warning triangles and critical octagons persist without animation. Single
keys use the right side of the title/value gap; dense keys use the right
side of a separator gap. They keep clear of shared statistic badges and
the Back hook. Dials reserve title or row-label space for the shape while
keeping their value anchors fixed. Primary severity is wired through all
key layouts, mirrored Back and all three dial views. These primitives do
not depend on a particular font containing a severity symbol.

## Contrast matrix

These are calculated authored-color ratios, rounded here to three decimal
places for display. Every assertion uses the unrounded ratio. The complete
[machine-readable matrix](assets/sprint-06-contrast.json) includes normal
and dim unit/statistics colors and the selected-row cases.

| Theme | Normal value | Dim value | Quad minimum | Dim quad minimum | Units/statistics | Dim units/statistics |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Void | 21.000 | 6.923 | 8.627 | 4.502 | 4.514 | 4.522 |
| Graphite | 15.740 | 6.048 | 6.996 | 4.526 | 4.511 | 4.516 |
| Ultraviolet | 17.201 | 6.110 | 8.079 | 4.503 | 4.511 | 4.527 |
| Midnight | 17.383 | 6.331 | 7.772 | 4.513 | 4.540 | 4.503 |
| Forest | 17.782 | 6.452 | 7.808 | 4.500 | 4.503 | 4.502 |
| Ember | 12.215 | 4.506 | 8.627 | 4.502 | 4.504 | 4.526 |
| Paper | 15.006 | 4.530 | 4.506 | 4.511 | 5.284 | 4.518 |

| Theme | Dial warning | Dial critical | Selected dim | Selected dim unit | Selected warning | Selected critical |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Void | 9.807 | 7.996 | 6.574 | 4.510 | 8.146 | 6.642 |
| Graphite | 7.953 | 6.485 | 5.245 | 4.510 | 6.262 | 5.106 |
| Ultraviolet | 9.183 | 7.488 | 5.633 | 4.508 | 7.703 | 6.281 |
| Midnight | 8.834 | 7.204 | 5.806 | 4.531 | 7.442 | 6.068 |
| Forest | 8.875 | 7.237 | 5.862 | 4.513 | 7.364 | 6.004 |
| Ember | 9.807 | 7.996 | 4.517 | 4.503 | 8.523 | 6.950 |
| Paper | 4.517 | 4.504 | 4.507 | 4.500 | 4.511 | 4.506 |

## Rendered evidence and limits

[Key contact sheet at 72 pixels per key](assets/sprint-06-keys-72.png)
and [dial contact sheet at 200 by 100 pixels per slot](assets/sprint-06-dials-200.png)
are rasterized output from the production action composition and renderer
functions. Inputs are explicitly synthetic measurement fixtures. These
are neither live measurements nor physical-device photographs, and are
not marketing assets.

The key sheet covers every theme in normal, dim, quad, dim quad, labeled
quad, warning, critical, dense-alert and ring-alert states. It includes a
mixed Chinese/Greek label fixture. The dial sheet covers normal and
selected surfaces, all views and both severity shapes. Visual inspection
found the fixture digits and units intact, distinct severity shapes and
no collisions with the reserved badge/Back/value regions. Existing label
ellipsis behavior remains visible on long labels.

Arbitrary **Custom Text** remains the exact user-selected color, including
its optional secondary dimming. Such choices can fail 4.5:1. The broad
claim that every possible user-selected color is contrast-safe is therefore
not made. A PI warning for low-contrast custom choices is a follow-up; no
settings are silently rewritten. Automatic quad identity colors may be
adjusted at rendering time for the background, preserving saved colors.

Secondary labels retain their established dim styling and may remain
below 4.5. This work is not a claim of complete WCAG conformance. Actual
72-pixel recognition of values, units and shapes within 300 ms remains
unmeasured. The synthetic locale fixture does not certify non-Latin font
fallback across Windows languages or physical Stream Deck models.

## Regressions and execution

Logs are retained in the ignored `release/audit-evidence/` directory of
the readability worktree. No live registry, named mapping or host process
was modified by these checks.

| Command / check | Result | Evidence |
| --- | --- | --- |
| Production color-resolution tests before primary fixes | 8 expected failures | `sprint-06-contrast-red.log` |
| Renderer severity regressions before shape support | 6 expected failures | `sprint-06-shapes-red.log` |
| Production dial composition with pre-readability action code | 21 expected failures | `sprint-06-dial-action-red.log` |
| Numeric unit/statistics floor before secondary correction | 13 expected failures | `sprint-06-secondary-numbers-red.log` |
| `npm test` after implementation | 820 pass, 0 fail, 0 skipped | `sprint-06-unit.log` |
| `npm run lint` | Exit 0, zero warnings | `sprint-06-lint.log` |
| `npm run typecheck` | Exit 0 | `sprint-06-typecheck.log` |
| Final theme assertions | 57 pass, 0 skipped | `sprint-06-themes-final.log` |
| Final marker geometry and production-action assertions | 236 pass, 0 skipped | `sprint-06-geometry-final.log` |
| `npm run contact-sheet -- release/audit-evidence/sprint-06-rendered` | Exit 0; output visually inspected | `sprint-06-contact-sheet.log` |
| `node --import tsx scripts/readability-report.mjs` | Exit 0; both sheets and all ratios generated | `sprint-06-rendered/` |

Tests check the production composed SVG's numeric value, unit and session
statistics colors against their actual surface. Geometry tests prove shape
placement and point counts, unchanged value anchors and no idle animation.
Historical compatibility fixtures remain stored intact; comparisons
authorize only the explicit numeric-unit foreground replacements. Dense
face hashes were updated for that intentional token change. Intermediate
failures from updating the old exact-color expectations remain in
`sprint-06-secondary-token-transition.log`.

## Compatibility, rollback and pending gates

Settings, layouts, density defaults, action UUIDs and native code are
unchanged. Existing profiles retain their choices. No density change or
new default is justified by these unrun physical trials. Reverting this
patch restores the prior numeric colors and removes severity shapes;
profile rollback does not require any settings rewrite.

Central `build`, `e2e:pi` and `suite:full` checks remain pending on the
combined candidate. Physical recognition trials, real device captures and
the Windows locale matrix are also pending, not passed or silently skipped.
The automated D08 correction is ready for its own review, while the full
sprint's physical acceptance criteria remain open.
