# Responsive layout, branding and installation follow-up

Reviewed 24 October 2026 after source `321f1d991ca57e427588092d0b847ef1e21091b2` and preview `3c54517b908b525e011a4f69432f1ddec1c04704`.

## User feedback and decisions

The user identified a concrete weakness in the first redesign: the Themes article constrained the comparison to the prose column and required horizontal scrolling despite available desktop space. This follow-up replaces that treatment and retains the existing documentation stack, routes, source qualifications and preview-only scope.

- **Fluid shell, readable prose.** The sidebar stays at the viewport edge and the overall site has no fixed maximum width. Paragraphs retain a 76ch measure. Media and tables can use the wider article region, with a separate page-contents rail on wide screens. Large homepages place the product image alongside the introduction.
- **Wrapping theme samples.** Seven native 144×144 crops of the released renderer output form a responsive gallery. Each sample has a real text label and concise description. The complete original board remains accessible through a native link and the image viewer. Phones require no horizontal gallery pan.
- **Readable technical tables.** Independent review found that unrestricted description cells became too wide on ultrawide displays. Only prose-heavy reference-table wrappers are capped at 1280px. Other media and the site shell remain fluid; narrow technical tables may scroll inside their named region.
- **Authentic branding.** The header and favicons use derivatives of the shipped CPU 62°C tile with its cyan sparkline, selected by the released manifest's `Icon`. The generic bars mark is removed. The original raster master remains unchanged in the plugin repository. [Brand provenance](../docs/assets/img/brand/manifest.json) records the released source and derivative hashes.
- **Minimal Pro recommendation.** Install recommends [buying HWiNFO Pro](https://www.hwinfo.com/licenses/) for continuous Shared Memory use without the 12-hour limit. Free HWiNFO remains supported; its timer, re-enabling option and Gadget limitations stay visible. [Source and focused checks](pro-recommendation.md).

The theme crops are faithful source pixels, with no changed readings, colors or geometry. [Crop provenance](../docs/assets/img/showcase/theme-tiles/provenance.json) records their relationship to released v1.7.1 output.

## Adversarial review and repairs

The environment allows four concurrent agents including the coordinator. This wave used that capacity. The coordinator owned shared CSS, templates and integration; reviewers owned separate tests, assets and reports.

| Finding | Severity | Correction and retest |
| --- | --- | --- |
| Image-only paragraphs still inherited the prose width after the shell became fluid | Medium | Removed the measure from image/picture/link wrappers. Browser regression compares the actual large image with adjacent prose at 1920 and 3440px. |
| Prose-heavy reference-table cells stretched across most of an ultrawide monitor | Medium | Capped these table wrappers separately; retained fluid media and checked the corrected rendered tables. |
| The comparison Site's provisional copied pages rewrote external GitHub repository links | High, separate Site | Replaced copied/rebased HTML with real Jekyll builds under `/before/` and `/after/`. The exact stable download, release and security destinations were independently retested. No published documentation source had this defect. |

Independent reports: [interaction](responsive-followup-interaction.md), [visual and aspect-ratio](responsive-followup-visual.md), [targeted layout and actual zoom](responsive-followup-independent.md).

## Checks and scope

- Real Jekyll 3.10 builds, retaining Just the Docs v0.10.1.
- Expanded browser regression suite: 22 cases, including the original modal/search/deep-link behavior and seven new responsive/branding cases.
- All 17 public pages reviewed at 1280×800 and 390×844, with representative 1920×1080, 2560×1440, 3440×1440, 3840×1080, 768×1024 and 844×390 states.
- Targeted 360px theme geometry, native image dimensions, whole-page overflow, real 200% Chrome zoom and navigation without JavaScript.
- All 38 automated accessibility states passed on the revised candidate. This supplements manual review and is not an accessibility certification.
- The route crawler passed all original routes, 192 important fragments, search targets, linked images and nine private-path 404 probes.

Machine-readable evidence is in `checks/responsive-*`. Publication-specific source SHA, previous/new preview commits, matching Pages deployment and served-byte verification are recorded in PR #60 after the exact committed stage is built and deployed.

The separate comparison Site has its own source, checks and deployment. Historical source321 metrics are not attributed to this responsive revision. No new field performance measurement, physical Windows/HWiNFO/Stream Deck test, plugin release qualification or private runbook check is claimed. Production promotion remains outside this work.
