# Ultrawide bounds and logo follow-up

## Scope and starting state

This documentation-only follow-up responds to the supplied Sensor Dial ultrawide screenshot and the request to enlarge the actual project icon. The screenshot is 2048 by 780 image pixels; it does not establish the original CSS viewport or browser zoom.

- Reviewed source before this change: `92429bfc2fcb1ba415e1f4097811694ba03ee192`.
- Existing preview head before publication: `7969a31a478f7aa5e85c6c62ab9c3dcaebbfd21c`. Publication must recheck and lease this head.
- Stable release and production source remain v1.7.1 at `bb4aedecbce499e199df8af63793a1490c0fb6ed`.
- The current PR remains #60 on `docs/dark-preview-20261024`. No production promotion is authorized by this follow-up.

## Findings and corrections

| Severity | Location and reproduction | User impact | Correction |
| --- | --- | --- | --- |
| Medium | Sensor Dial, `#the-touchscreen-readout`, at a 3440px CSS viewport. The ordinary Markdown table inherited unrestricted width. | A short two-column explanation spans about 2781px, making related cells harder to scan. | Default table wrappers stop at 960px. Explicit settings matrices retain up to 1280px and their accessible internal scroll region. |
| Medium | Long articles at ultrawide widths. The contents rail follows the edge of an unbounded grid while prose stays at its reading measure. | Navigation, explanation and page contents feel disconnected. | Center the complete navigation, article and contents workspace within 1920px. Attach the fixed sidebar to that same frame. |
| Low | Shared brand header, especially the 28px phone override. | The authentic icon is too small relative to the wordmark. | Display the released icon at 48 by 48 CSS pixels on desktop and phone, using fresh 48px and 96px derivatives. |

The 1920px frame was compared with the unbounded layout and a 1760px alternative using the actual generated pages. Both bounded options resolve the spread. The selected size preserves more space for authentic product imagery and all seven theme samples without lengthening prose or ordinary tables. This is a tested design choice, not a standards-mandated width.

Prose remains at 76ch. Product images preserve their aspect ratios and can use the wider article area. The image viewer still offers the full original. Smaller screens keep their existing fluid layout and wrapping theme samples.

## Logo provenance

Both new PNGs derive directly from the released 512px master at `com.lawrensen.hwinfo.sdPlugin/imgs/plugin/marketplace@2x.png`, Git blob `c730a058f230e76b4c304ca6eb2152d501699a27`. The master matches v1.7.1. The transformation is a Lanczos resize only; readings, colors and geometry are unchanged. Masters and existing favicon derivatives remain intact. The asset manifest records dimensions, byte counts and hashes.

## Actual review team

Three independent specialists and the coordinator worked with four concurrent slots:

- `uw_visual_judgment`: screenshot-grounded audit and independent rendered comparison of the coordinator's CSS.
- `uw_css_mechanics`: independent CSS diagnosis, meaningful browser regression updates, and execution of the candidate suite.
- `uw_reading_navigation`: independent navigation/reading audit, authentic logo derivatives, and comparison-Site branding.
- Coordinator: shared layout integration, own desktop/phone rendered inspection, source review, immutable builds and publication.

No claim of 100 concurrent agents or physical-device testing is made. The source CSS was reviewed by people who did not author it. See [independent visual review](ultrawide-bounds-independent.md).

## Candidate validation

| Result | Check | Scope |
| --- | --- | --- |
| PASS | Real Jekyll build | Pinned Just the Docs v0.10.1; preview path and managed comparison snapshot. |
| PASS | 24 browser regressions | Candidate `uw-candidate`, based on source92429bf; 0 failures or skipped tests. [Output](checks/ultrawide-browser-candidate.txt). |
| PASS | Ultrawide geometry | 1920 by 1080, 3440 by 1440 and 5120 by 2160 CSS pixels: centered bounded workspace, attached sidebar, adjacent readable contents, bounded tables, wider truthful media and no page overflow. |
| PASS | Brand and progressive enhancement | 1280, 390 and 360px; native home link with JavaScript disabled, no clipping/overflow, adequate encoded image dimensions at DPR2. |
| PASS | Existing interaction risks | Modal Tab/Shift+Tab containment, background blocking, search terms, early search input, keyboard shortcut, mobile navigation, disclosure direct-entry/reload/history and subpath assets. |
| PASS | Independent visual comparison | Actual generated pages in managed-browser CSS iframe viewports, comparing 1920 and 1760px bounds with the prior unbounded layout. See the independent report for exact reviewed views. |
| UNAVAILABLE | Physical Windows/HWiNFO/Stream Deck use | Not performed; this change does not modify plugin runtime behavior. |
| UNAVAILABLE | New field or lab performance measurement | This narrow correction does not claim new Core Web Vitals or a repeated lab benchmark. |

Candidate tests are not a deployment attestation. The PR and comparison Site record the final immutable source, generated preview, matching Pages deployment and served build checks after publication. Earlier broad accessibility and responsive reports retain their original source scope.
