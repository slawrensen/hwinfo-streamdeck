# Independent final review

## Verdict

**PASS for the reviewed documentation candidate. No remaining critical or high defects were identified in this independent review.** The coordinator corrected the reproducible layout-stability, tablet measure and code-control defects found here, and focused retests passed. Publication and the exact served preview/deployment identity remain the coordinator's separate completion gate; this report does not assert a deployment that this reviewer has not inspected.

Reviewer: `/root/independent_final`, an independent agent that did not author the implementation. Source baseline: `bb4aedecbce499e199df8af63793a1490c0fb6ed`, stable release `v1.7.1`. Reviewed branch: `docs/dark-preview-20261024`, before its publication commit. Tested the actual Jekyll output at `http://127.0.0.1:4173/hwinfo-streamdeck/`.

## Findings, corrections and retests

### HIGH: Mobile navigation caused a large first-load layout shift

- **Location:** `docs/assets/js/docs.js`, `docs/_includes/head_custom.html`, mobile navigation CSS; homepage and Sensor Dial at 390 × 844.
- **Reproduction:** Start a fresh browser context, disable HTTP cache, apply 150 ms latency / 1.6 Mbps down / 750 kbps up / 4× CPU slowdown, then directly load either page. The unenhanced expanded navigation appeared before deferred `docs.js` added the `docs-js` class and collapsed it.
- **Impact:** The document moved substantially after the first paint. All three initial phone-home samples and all three initial phone-dial samples measured CLS **0.6193**. Desktop home had no corresponding shift.
- **Correction:** The coordinator added a small synchronous head bootstrap for the class. The no-JavaScript expanded navigation fallback remains available.
- **Retest:** Three accepted cold phone-home samples now measured **CLS 0.0000**. Phone Sensor Dial measured **0.0541**, attributable to its subsequently inserted on-page contents. Desktop home measured 0.0000; desktop Sensor Dial measured 0.0230. The observed large mobile-navigation jump is resolved. Other reviewers added a browser regression that holds the deferred enhancement script before first visible content.
- **Evidence:** `review-performance-before-cls-fix.json`, `checks/performance.json`; both are under the evidence directory below.

### MEDIUM: Tablet article lines expanded beyond the intended reading measure

- **Location:** `docs/assets/css/docs.css`, the `max-width: 999px` breakpoint; Sensor Dial at 960 × 900.
- **Reproduction:** Load the article at 960 CSS pixels. The breakpoint reset article width to `max-width: none`.
- **Impact:** The measured text column was **897 px / 100.8ch**, considerably wider than the 65–75-character target. Desktop and ultrawide articles were 676.28 px / 76ch.
- **Correction:** The coordinator retained the 76ch maximum for article content, its header and contents at tablet widths. The homepage retains its separate image-friendly width.
- **Retest:** **676 px / 75.97ch** at 960 × 900, with no document overflow. See `targeted.json` and `960-sensor-dial-viewport.png` for the corrected result.

### LOW: Inherited code-control styling did not match the shared skin

- **Location:** `docs/assets/css/docs.css`, generated JTD `div.highlighter-rouge > button` and `pre.highlight`; Install page.
- **Reproduction:** Scroll to the GitHub checksum example and focus/activate its copy button. Initial custom selectors did not target the inherited button, and theme specificity retained the old code surface. The first correction also exposed a content-box sizing interaction that enlarged the glyph.
- **Impact:** Inconsistent code surfaces and an oversized clipboard icon, although the command copy itself worked.
- **Correction:** The coordinator used the actual inherited selectors, a 44 × 44 border-box control, an 18 × 18 glyph, explicit surface/border styling and 62 px right padding to keep the end of a horizontally scrolled command clear of the control.
- **Retest:** At 390 × 844 the target was **44 × 44**, the glyph **18 × 18**, the visible keyboard outline remained present, the preformatted region scrolled without document overflow, and the copied text exactly matched `Get-FileHash .\com.lawrensen.hwinfo.streamDeckPlugin -Algorithm SHA256` plus its newline. See `checks/copy-control.json` and `copy-code-final-phone.png`.

## Independent visual and interaction checks

- **PASS:** Geometry across **42 representative route/viewport pairs**: Home, Install, Sensor Dial, Themes, Data sources, Troubleshooting and Changelog at 360, 390, 768, 1280, 1440 and 2560 CSS pixels. No whole-page horizontal overflow; one H1 per page. The initial tablet measure issue was corrected and retested separately.
- **PASS:** Desktop/ultrawide article measure is approximately 76ch / 676 px inside a centered 1560 px shell. The sidebar, article and optional contents column retain deliberate spacing at 2560 px.
- **PASS:** Full-page and viewport visual inspection of Home, Sensor Dial and Themes at phone, laptop and ultrawide widths. Some very tall initial screenshots did not paint decoded images beyond the viewport; those screenshots are not evidence of a page defect and should not be used as final handoff images. The asset reviewer repaired screenshot settling/decoding and owns the accepted all-page screenshot set.
- **PASS:** Reduced-motion context reports `prefers-reduced-motion: reduce`, `scroll-behavior: auto`, no active animations, and zero-duration transitions on inspected menu, search and image links.
- **PASS:** With JavaScript disabled at 390 × 844, all 16 navigation destinations remained available, the nonfunctional menu control stayed hidden, the stable download target and image fallback links remained native links, and following Get started reached the correct article. Search enhancement is JavaScript-dependent; no claim is made that client-side search works with JavaScript disabled.
- **PASS:** Exact command copy, visible keyboard focus and a readable/scannable horizontal code region on phone.
- **PASS:** Actual browser zoom at 200%, detailed below.

This review intentionally did not duplicate the other agent's 15-case browser regression suite or 38-state axe pass. Those are separate evidence. Manual visual review and automated checks do not establish full accessibility conformance.

## Actual 200% browser zoom

This was **actual Chrome page zoom**, not only a narrowed-viewport simulation. A fresh owned temporary profile was opened with a 1280 × 900 outer window and no Playwright viewport override. In `chrome://settings/appearance`, the actual Page zoom select (`#zoomLevel`) was changed from value `1` to `2` (200%). No system settings or user browser profiles were changed.

The resulting browser measurements were:

| Measurement | 100% | 200% |
| --- | ---: | ---: |
| Outer width | 1280 | 1280 |
| Inner CSS width | 1280 | 640 |
| Inner CSS height | 813 | 406 |
| Device pixel ratio | 1 | 2 |
| Visual viewport scale | 1 | 1 |

Home, Install, Sensor Dial, Themes, Data sources and Troubleshooting all retained content with no whole-page horizontal overflow at the actual 200% setting. Screenshots use native CDP viewport capture so they include the entire 1280 × 813 rendered surface; ordinary Playwright screenshots at page zoom had cropped this surface and were replaced.

Evidence: `checks/actual-zoom.json`, `actual-200-zoom-index.png`, `actual-200-zoom-data-sources.png`. Earlier 640 × 400 / DPR2 reflow-equivalent checks also passed five routes, but the actual Chrome zoom check supersedes that limitation.

## Cold-load lab performance

**Conditions:** Google Chrome 156.0.8078.47, Linux, headless owned process; a new browser context for every sample; cache disabled through CDP; 150 ms emulated latency, 1.6 Mbps download and 750 kbps upload; 4× CPU slowdown. Other reviewers paused their Chrome processes during measurement. The server was local Python HTTP serving uncompressed actual Jekyll output. Samples ended after load, network idle and a 500 ms settling period. No user input or scrolling was used during measurements.

These are synthetic local lab observations. They are **not field Core Web Vitals**, an INP assessment, a Lighthouse score, or a guarantee of production visitor performance. A single sample that overlapped a coordinator stylesheet rebuild was explicitly discarded and replaced. All 12 accepted samples used the same 24,937-byte stylesheet. These measurements describe the local review candidate. Later CSS additions make the theme comparison and long reference tables readable without shrinking their contents. Those components were validated separately by the visual, browser and accessibility reviewers; their final bytes are not reflected in these measurements. The coordinator also replaced an implicit root favicon request that returned 404 with a tiny explicit subpath SVG favicon after measurement. That correction has no layout effect, but the byte/request counts above predate it and are not claimed as exact final deployment measurements. The final interaction-only Escape coordination repair also postdates these measurements.

| Scenario | Samples | Median FCP | Median LCP | LCP range | Median CLS | Median transferred bytes | Requests |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| Home, 390 × 844 | 3 | 1.760 s | 1.768 s | 1.760–1.780 s | 0.0000 | 679,368 B | 12 |
| Home, 1280 × 800 | 3 | 2.096 s | 2.096 s | 2.096–2.096 s | 0.0000 | 741,162 B | 12 |
| Sensor Dial, 390 × 844 | 3 | 1.740 s | 2.052 s | 2.048–2.056 s | 0.0541 | 724,916 B | 10 |
| Sensor Dial, 1280 × 800 | 3 | 1.760 s | 2.076 s | 2.036–2.080 s | 0.0230 | 724,916 B | 10 |

The largest eager resource was the uncompressed search index (approximately 323 KB including resource-timing overhead); the inherited theme CSS was approximately 134 KB. The phone hero uses the truthful 28,466-byte detail crop and desktop uses the 90,260-byte 960 px WebP. Native lazy image loading remains in place for below-fold examples; the browser may fetch nearby lazy images before they become visible.

For transparency, the sum of long-task time beyond 50 ms after FCP until the end of the capture was approximately **390–419 ms** across scenario medians under 4× CPU slowdown. This is a bounded laboratory blocking-time calculation, not a Lighthouse TBT result or an INP measurement. The retained JTD search/indexing work is visible in the initial-load cost.

## Source, claims and publication boundaries

Independent code/content inspection found no new release-accuracy blocker. The stable download points to the existing v1.7.1 asset; the plugin package identity is shown separately from the website preview identity. Install explicitly distinguishes the checked Marketplace listing (1.7 with 1.7.0.0 notes) from GitHub 1.7.1 and does not equate package hashes. Unsigned native-addon status and channel-specific verification remain discoverable.

The inspected guides retain Windows x64 / Stream Deck 6.9+ / local HWiNFO requirements, the free Shared Memory 12-hour limit, Gadget's missing producer timestamp and history, explicit provider identity links, and dial-local session statistics. The source and authentic UI markup contain the documented Glass, Tint, Outline, Clear and Words in the accent color controls. The content distinguishes per-encoder dials from the picture spanning the strip. Hardware compatibility distinguishes dated physical evidence, simulation and expected compatibility. Custom-color and transparent-background contrast qualifications remain visible.

The source diff stays within documentation, assets and necessary docs tooling. The generated changelog change is matched in `scripts/gen-changelog-page.mjs`. The inspected build contained no `release/` path and no multi-megabyte photo master; the coordinator's crawler and publisher tests own the exhaustive privacy, route and subpath gates. No repository CNAME is introduced.

## Limitations and handoff

- **UNAVAILABLE / outside this review:** Physical Windows/HWiNFO/Stream Deck testing, plugin installation, plugin release qualification, private release-only runbooks and private validation inputs. Runtime behavior was not changed by this docs task.
- **Not claimed:** Field CWV, INP, screen-reader certification or full WCAG compliance. The actual browser checks here used Chrome on Linux; cross-browser/device evidence must be stated separately.
- **Separate coordinator gate:** Published preview repository commit, exact successful Pages deployment and served build identifiers. This independent review does not mark that publication gate passed in advance.
- **No outstanding critical/high defect from this review.** The reproducible findings above were corrected and retested; no speculative backlog was created.

Evidence directory: `/workspace/scratch/58e7f1b5d8fb/evidence/final-review/`. Key machine-readable files are `review-geometry.json`, `review-performance-before-cls-fix.json`, `checks/performance.json`, `targeted.json`, `checks/copy-control.json` and `checks/actual-zoom.json`. Scripts used were `review.mjs`, `targeted.mjs` and `actual-zoom.mjs`; they use fresh owned Chrome sessions and no certificate-ignore or SPKI exception flags.
