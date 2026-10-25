# Logo, navigation and image-viewer browser checks

## Scope and result

**PASS: 51 browser cases on each local Jekyll base path, 102 executions total, with zero failures or skips.** These checks ran against the final candidate based on `63861eb3d34fd5c6ee24b70168f2dca553c64014`, before publication. They are documentation checks, not plugin release qualification or a Pages deployment attestation.

The regression author owned [test/docs-browser.test.mjs](../test/docs-browser.test.mjs) and this report. Other agents implemented the shared shell, image assets and viewer repair. No implementation file was changed by this reviewer.

| Result | Check | Actual scope |
| --- | --- | --- |
| PASS | Preview base path | 51 cases at `/hwinfo-streamdeck-preview/` |
| PASS | Production base path | 51 cases at `/hwinfo-streamdeck/`, served locally; live production was not changed by these tests |
| PASS | Responsive branding | 320, 360, 390, 768, 1000, 1199, 1200, 1280 and 3440 CSS pixels; approved 56/72 px image sizes, text bounds, single-line name, spacing, Menu operation and no page overflow |
| PASS | Native home link and sharp image sources | JavaScript disabled at 360, 390 and 1280 px, all at DPR 2; encoded PNG dimensions supply sufficient pixels |
| PASS | First-screen content | Full identity, explanation, download and requirements paragraph at 390×844 and 1280×800, including the 12-hour qualification |
| PASS | Narrow navigation | 320 and 390 px; 16 px text, at least 44 px target height, complete labels inside their targets, coherent wrapped lines and real wrapped-link navigation |
| PASS | Viewer geometry | Small strip images at 2048×1220 and 3440×1440; full deck at 390×844 and 1280×800; complete Fit, native-size Actual, centering and reachable oversized edges |
| PASS | Viewer state changes | Resize while open, horizontal-only panning with vertical centering, a different image, cached reopening, mode reset and focus restoration |
| PASS | Existing documentation risks | Keyboard modal containment, background blocking, all four search terms, early search input, mobile navigation, deep-link disclosures, routes/assets, noindex and current/legacy return paths |
| PASS | Static validation | Node syntax check, ESLint on the modified test file and `git diff --check` |

## Defects found and retested

The first logo candidate wrapped the product name at 320 px and at the narrow and normal desktop sidebar widths. The corrected header gutters preserve the existing 16/14 px wordmark without wrapping.

The inherited navigation link line-height was 40 px despite 16 px text. A two-line label occupied 92 px. The corrected links retain 44 px minimum targets and use coherent line spacing. At 320 px, `Troubleshooting` also extended 11.66 px outside its own target. The narrow-menu gutter, column-gap and link-padding correction resolves that overhang without reducing text size. Both desktop-style reflow and mobile emulation at 320 px were captured and measured.

The supplied viewer screenshots matched `dial-backgrounds-looks.jpg`, a 1264×352 capture. The new 2048 px regression was run once against the unchanged before build and failed specifically because Fit did not enlarge the painted image to the available viewing area. It failed before any action-label or ARIA check. The same test passes after the repair.

Viewer tests account for `object-fit` letterboxing using the browser's element bounds, intrinsic image size, and computed fit and position. A large image element containing a small painted picture cannot pass merely because its outer box fills the viewer. Actual-size tests also exercise native wheel panning to both ends of every oversized axis.

The test author inspected the final 72 px desktop and 56 px phone header crops, the phone menu, and the 2048 px Fit/Actual viewer captures. Fit visibly enlarges the complete strip; Actual returns it to native size while keeping it centered.

## Reproduction and evidence

The final suites used isolated headless Chrome at `/usr/bin/google-chrome` against real Jekyll output. Run the same test file once for each base path:

```sh
DOCS_TEST_URL=http://127.0.0.1:4189/hwinfo-streamdeck-preview/ CHROME_PATH=/usr/bin/google-chrome node --test test/docs-browser.test.mjs
DOCS_TEST_URL=http://127.0.0.1:4189/hwinfo-streamdeck/ CHROME_PATH=/usr/bin/google-chrome node --test test/docs-browser.test.mjs
```

Coordinator evidence includes `logo-scale/final-candidate-preview-browser.txt`, `logo-scale/final-candidate-production-browser.txt`, final header/menu geometry and screenshots, and `viewer-scale/baseline-reported-defect.txt`. Earlier logo-only 46-case results are superseded by the final 51-case suites for this combined change.

Final source fingerprints checked with these runs:

| File | SHA-256 |
| --- | --- |
| `docs/assets/css/docs.css` | `18ad1c53adc1f4b7224e3456fe60a798628b23ab50c0f23ff4b3fde799e388e6` |
| `docs/assets/js/docs.js` | `a8b501b35d5d3b22945a6a0f330386229937c2b1b3f10d4283663f2d95763899` |
| `docs/_includes/components/sidebar.html` | `2e9634bcef4c8f00f81ee1f42eb9687b0df0e49b0fc5089d6a1eb2fd33645945` |
| `test/docs-browser.test.mjs` | `4ebc28611cf30c5a8eb72763aa71575c00ac331cbcdc67fa1d8edc25379cbd68` |

Physical Windows/HWiNFO/Stream Deck testing is **UNAVAILABLE** in this check and was not performed. These local checks do not claim field performance measurements, complete accessibility certification or successful publication. The coordinator records the reviewed commit, generated preview commit, matching Pages deployment and served-byte verification separately.

## Publication cache follow-up

The first live publication exposed an existing-session cache mismatch: new HTML loaded the prior unversioned stylesheet. The head template now versions the authored CSS and JavaScript with the generated build identity. An additional browser case checks home and article metadata, resolved asset subpaths, version parameters, and the actual requested URLs against `docs-build.json`. The deferred-startup test also recognizes the script's version query, so it continues to hold the real enhancement request. The final PR records the focused baseline failure, committed-build retests and live publication result for this follow-up; the fingerprints and 51-case results above describe the earlier sizing and navigation candidate.
