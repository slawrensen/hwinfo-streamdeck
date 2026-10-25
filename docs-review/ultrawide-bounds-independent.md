# Independent review: bounded ultrawide layout

Date: 2026-10-24. Reviewer: `uw_visual_judgment`, independent of the CSS author.

## Decision

**PASS for the reviewed candidate. Keep the 1920px maximum complete working frame.** The user's concern was supported by the supplied screenshot and reproduced in the browser: ordinary tables and the on-page contents could spread across the monitor while prose stayed narrow. The candidate resolves those two findings without shrinking text or limiting every kind of content to prose width.

The reviewed build identified itself as `uw-candidate`, based on source commit `92429bfc2fcb1ba415e1f4097811694ba03ee192` plus the coordinator's pending width and logo changes. This is a local candidate review, **not a deployment attestation**.

## Method and limits

Reviewed the current user screenshot, `image(20261024-231429).png`, and current CSS in `docs/assets/css/docs.css`. The supplied screenshot is 2048 by 780 raster pixels; its original CSS viewport, device pixel ratio, and browser zoom are unknown. It was not treated as an exact 2048px CSS reproduction.

Rendered the candidate through the existing managed Site at `http://terminal.local:4173/after/` in cloud Chrome. A temporary internal harness used real iframe CSS viewports and ordinary native controls to compare the 1920px candidate, a 1760px alternative, and the previous unbounded layout. Large viewports were visually scaled to fit the review browser, with the scale stated in each screenshot. This affects the presentation of the screenshot, not media queries or measured CSS geometry. The unbounded reproduction retained the candidate's 48px logo, so it is a focused layout reproduction, not a historical screenshot.

The browser used a 15px scrollbar. For example, a 3440px iframe had a 3425px document client area. Every reviewed candidate had equal document client and scroll widths. Narrow technical tables could still scroll inside their own wrappers.

This review inspected the relevant rendered sections and interactions, not every public page or every possible device. It does not establish physical-device testing, field performance, complete accessibility conformance, search correctness, or successful Pages publication. The coordinator's functional and deployment checks are separate.

## Resolved findings

| Severity | Location and reproduction | Previous user impact | Candidate evidence |
| --- | --- | --- | --- |
| Medium | `sensor-dial.html#the-touchscreen-readout`, 3440 by 1440 CSS viewport; ordinary table styles in `docs/assets/css/docs.css` | Descriptive rows stretched across the monitor, creating long eye movements and weak row association. | The reproduced unbounded table was 2781px wide. Candidate ordinary tables are 960px wide; at 1440px they shrink with the available article to 836.75px. |
| Medium | Same route and viewport; desktop article grid and `.page-toc` | The local contents became detached from the material it navigated. | The old TOC began at x=3153. Candidate TOC begins at x=2400.5 inside a centered 1920px body beginning at x=752.5. It remains a usable 208px column. |
| Low | Shared shell, mixed text, tables, media, and on-page contents | Inconsistent right boundaries made the page feel stretched despite short prose lines. | The complete frame is bounded; prose remains 76ch, ordinary tables 960px, and useful reference content can use up to 1280px. The fixed sidebar follows the centered frame. |

No new critical, high, or reproducible usability defect was found in the reviewed candidate states.

## Why 1920px rather than 1760px

Both alternatives are defensible and both fix the original problem. The narrower alternative does not produce a meaningful reading benefit after ordinary tables are capped independently.

| Measured item | 1920px frame | 1760px frame |
| --- | ---: | ---: |
| Article with a 208px TOC | 1276px | 1116px |
| Ordinary readout table | 960px | 960px |
| Theme sample size | 144 by 144px | 144 by 144px |
| Theme samples across | 7 | 7 |
| Homepage deck visual | 895.2px | 799.2px |

The seven themes require 1104px for seven native 144px samples and six 16px gaps. A 1760px frame fits them, but leaves only 12px beyond that minimum in the article. The 1920px frame gives captions more space and retains a larger useful deck image and reference-table area. Neither choice lengthens the 76ch prose or the 960px ordinary tables.

At both 3440px and 5120px viewports, the 1920px candidate kept the same 1540px homepage content width and 895.2px deck image. Additional monitor width became balanced outer space. That is appropriate for this documentation: related content remains grouped, while reference material and product examples remain larger than body text. Further narrowing everything would sacrifice useful imagery without fixing an additional observed defect.

## Rendered checks actually performed

| State | CSS viewport | Result |
| --- | --- | --- |
| Sensor Dial readout, unbounded reproduction vs 1920px and 1760px | 3440 by 1440 | PASS: bounded table and nearby contents; no page overflow. |
| Seven theme samples, both bounded alternatives | 3440 by 1440 | PASS: all seven native 144px images in one row; caption spacing favors 1920px. |
| Homepage, both bounded alternatives | 5120 by 2160 | PASS: balanced outer margins, attached sidebar, stable content geometry. |
| Homepage and theme samples, 1920px candidate | 3440 by 1440 and 5120 by 2160 respectively | PASS: stable width cap and complete samples. |
| Homepage and Sensor Dial readout | 1440 by 900 | PASS: readable article and table, distinct TOC, no page overflow. |
| Homepage first screen | 390 by 844 and 360 by 800 | PASS: real 48px logo, wordmark, and Menu fit. Identity, explanation, Download, Get started, Windows x64 requirement, and 12-hour limit appear before the image. |
| Mobile navigation open | 360 by 800 | PASS: grouped navigation opens without clipping labels or causing horizontal overflow. |
| Theme samples | 360 by 800 | PASS: two columns of native 144px examples, readable captions, no page overflow. One wider technical table remains inside its scroll wrapper. |

## Evidence

Fresh browser screenshot files were saved under `/workspace/scratch/58e7f1b5d8fb/` for the coordinator's handoff. They include the labelled QA controls and therefore should not be represented as unscaled physical-device captures.

- `uw-dial-3440-prior-unbounded.jpg`
- `uw-dial-3440-cap1920.jpg`
- `uw-dial-3440-cap1760.jpg`
- `uw-themes-3440-cap1920.jpg`
- `uw-themes-3440-cap1760.jpg`
- `uw-home-3440-cap1920.jpg`
- `uw-home-5120-cap1920.jpg`
- `uw-home-5120-cap1760.jpg`
- `uw-themes-5120-cap1920.jpg`
- `uw-home-1440-cap1920.jpg`
- `uw-dial-1440-cap1920.jpg`
- `uw-home-390-cap1920.jpg`
- `uw-home-360-cap1920.jpg`
- `uw-home-360-menu.jpg`
- `uw-themes-360-cap1920.jpg`
- `uw-review-geometry.json`

The first attempted 1760px measurement reused an iframe URL without reloading its override and therefore still measured 1920px. It was rejected, the harness was corrected to navigate per variant, and the accepted 1760px measurement was repeated and confirmed as 1760px. The rejected record is excluded from the saved geometry file.

The temporary `dist/qa-uw.html` harness was removed after review and the coordinator's capture. It must not be published as part of the Site or documentation.
