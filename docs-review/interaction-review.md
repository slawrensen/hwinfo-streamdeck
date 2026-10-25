# Independent documentation review

Reviewer: release_accuracy, reviewing content and root shell written by other agents.
Scope: documentation accuracy and meaningful interaction regressions, not plugin qualification.
The final narrow Escape-order repair described below was authored by this reviewer after reproducing it, then independently reviewed and accepted by the coordinator.

## Source and content review

- Examined all 16 existing public Markdown pages, the added 404 page, edited content diffs, shared templates/configuration/navigation, and the new homepage against AGENTS.md and v1.7.1 source/release facts.
- Legacy heading audit: removed onboarding headings have explicit aliases; the homepage keeps `what-it-does` and `start-here` as explicit IDs. No unrepresented legacy heading was found in this static comparison. Generated-page crawl remains the stronger confirmation.
- Actual product labels checked include Reading, Reload the sensor list, Display > Background, all five background modes, Words in the accent color, and the Controls gesture labels.
- Requirements, local HWiNFO, the free 12-hour limit, explicit cross-source identities, Gadget freshness/history, local dial statistics, custom-color contrast limitations, and historical/simulated hardware coverage remain discoverable.
- Stable GitHub 1.7.1 and Marketplace 1.7 / 1.7.0.0 are presented separately. Unsigned native addon and channel-specific verification language remain correct.
- Homepage image dimensions match their actual files. App capture, sample rendering and hardware photograph labels remain distinct. A touch-strip picture is not represented as a full-strip graph.
- No em dashes or banned promotional phrases found in authored public Markdown.

## Findings and repairs

1. **LOW, installation.html, Updating and removing; all viewports.** Initial rewrite said updates should use the same channel. That adds a restriction not established by the release and discourages moving from Marketplace 1.7 to GitHub 1.7.1. Author corrected it to "your chosen channel". Re-read current source: corrected.
2. **LOW, whats-new-1.7.html, UX improvements; all viewports.** Condensed header description appeared to grant the Control panel a live sensor reading/data header. Original correctly scoped that behavior to key/dial. Author restored "On keys and dials". Re-read current source: corrected.
3. **LOW, shared long-article TOC, 1280px.** TOC initially opened at >=1000px, but moves beside article only >=1440px. Root changed the opening threshold to 1440px. **Resolved**.
4. **MEDIUM, shared search, desktop and phone.** Inherited Just the Docs search listened to `keyup`, not `input`. Paste or an input-only change could leave stale or empty results. Reproduced at 1280px: type `sensor missing`, then replace field via input with `twelve`; the Sensor missing result remained. Immediate entry while the index loads could also be lost. Root added input handling and replay when indexing finishes. **Resolved; delayed-index, paste, clear and keyboard cases PASS**.
5. **HIGH, shared mobile search, 390px.** Direct navigation rendered `#main-header` with computed `display:none`. Opening the menu revealed it; Escape or closing the menu hid it again. Root overrode the inherited closed-menu header rule. **Resolved; search visible on every phone page and mobile interaction test PASS**. Before screenshot: `/tmp/hwinfo-mobile-search-review.png`.
6. **MEDIUM, homepage gallery, 390px.** The three raw HTML h3 elements lacked IDs, causing the theme anchor helper to reuse the earlier `what-it-does` ID for each. Their anchor controls were 21x22.4px, too close to neighboring controls. Root omitted generated heading anchors on the compact homepage while retaining meaningful explicit IDs. **Resolved; axe PASS**.
7. **MEDIUM, scrollable code blocks, installation390, troubleshooting390 and FAQ1280/390.** Long preformatted examples overflowed their region but had no keyboard focus target. Root added unique named, focusable regions to overflowing code as for tables. **Resolved; axe PASS**.
8. **LOW/MEDIUM, troubleshooting checklist, all viewports.** Six Markdown task checkboxes were disabled and lacked labels. Content author replaced them with plain bullets. **Resolved; axe PASS**.
9. **MEDIUM, Sensor Dial long-image viewer caption, 390px.** The caption overflowed a short scroll region with no keyboard focus. Root removed scrolling and line-clamped the visible caption while retaining full accessible text and image alt text. **Resolved; interactive-state axe PASS**.
10. **MEDIUM, theme comparison, 390px.** The dense 1072x799 comparison board shrank to an unreadable scale. The assets reviewer confirmed this visual issue. Root replaced the visible image with an authentic seven-key strip supplied by that reviewer, in a named keyboard-focusable scroll region, retaining access to the complete board. **Resolved; keyboard pan, original-image opening, focus restoration and axe PASS**.
11. **MEDIUM, shared mobile search/navigation Escape ordering, 390x844; docs/assets/js/docs.js.** Open Menu, enter `Age unknown` in search, then press Escape. The navigation keydown handler moved focus to the menu button before Just the Docs' search keyup could run. The native search field became empty, but `search-active` and the stale results remained visible. This stranded keyboard users in an inconsistent state. The repair gives an open native image dialog first ownership of Escape; otherwise an active search is cleared through its input handler and retains focus, and a subsequent Escape closes navigation. The coordinator independently reviewed and accepted the small patch. **Resolved; two targeted browser cases PASS**, including menu+search dismissal and native modal Escape preserving background navigation.

## Browser regressions authored

`test/docs-browser.test.mjs` contains 15 cases, explicitly unavailable when DOCS_TEST_URL is not set:

- Homepage identity, explanation, stable download and essential requirement visible at 1280x800 and 390x844.
- Exact viewer Shift+Tab from Actual size, repeated forward/backward Tab containment, inert background focus, observable size toggle, Escape and Close focus restoration.
- Real pointer action cannot navigate the covered page while a modal is open.
- Search transparent background, 12 hours, Age unknown, sensor missing; click relevant result and confirm actionable content.
- Deliberately hold back the search index, enter a query before it arrives, and require replay; replace it using an input-only paste equivalent and clear it.
- Ctrl+K, keyboard entry, ArrowDown and Enter navigate to the concrete Age unknown fix.
- Phone navigation, active group, Escape and search.
- First-render phone navigation remains collapsed while docs.js is deliberately delayed, with search visible; after the request is released the menu is operable. A finally block always releases the held response.
- Direct/reload/back-forward hash entry reveals content inside real disclosures.
- Asset and search-index subpath checks, private text absent from search.
- Essential onboarding navigation and content without JavaScript.

ESLint: PASS.

## Initial generated-site execution

- Real Jekyll build at `http://127.0.0.1:4173/hwinfo-streamdeck/`.
- Chromium 156.0.8078.47 on Linux. Physical hardware testing is outside this review.
- Browser regression first pass: **8/12 PASS**, four failures trace to search input behavior and hidden mobile search above. Viewer focus containment, background navigation blocking, both first-screen dimensions, disclosure direct/reload/back-forward behavior, subpath resources and no-JavaScript essentials all passed.
- Separate normal keyboard input found expected results for **transparent background**, **12 hours**, **Age unknown**, and **sensor missing**. This confirms the failures are interaction behavior, not missing index content.
- axe-core 4.14.0 automated WCAG-tag checks across **17 pages x 2 widths (1280 and 390), 34 runs**. No document-wide horizontal overflow, exactly one H1 on every page, and no reported color-contrast violations. Reported failures are findings 6-8 above. Automated checks do not establish complete accessibility compliance.
- Machine-readable results: `/tmp/hwinfo-a11y-results.json`.

## Repair retest

- After root repaired search and mobile header behavior, all **14/14 real-browser regressions PASS** on the local production base path. This includes the deliberate delayed-index case, input-only replacement/clear, keyboard search, all four required terms, mobile menu/search, exact viewer focus regression, disclosure history and subpath behavior.
- Copied Just the Docs script was independently compared with v0.10.1: only a provenance header, input handling, initial query replay and removal of search's scroll-to-top behavior differ. The upstream MIT license is retained beside the script.
- Additional interactive-state axe runs found no violations in the desktop image viewer, phone menu or desktop search. A long phone viewer caption created an unfocusable scrolling region; root replaced its scroll behavior with visual line clamping while retaining complete accessible text. Final rendered retest passed.
- A full final audit script at `/tmp/hwinfo-a11y-audit.mjs` covers 38 states (all routes at both widths plus the four interactive states). It accepts DOCS_TEST_URL and DOCS_A11Y_OUTPUT so the same audit can check the committed preview build.

## Final local verdict

- **PASS: 15/15 browser regression tests**, canonical final run 11.27 seconds. The disclosure test covers a real indexed `Settings migration` heading inside a closed disclosure as well as existing direct `legacy-gadget-selections` aliases, refresh and back/forward navigation. The fifteenth case checks the first visible phone layout while deferred enhancement code is still held back.
- **PASS: 38/38 axe states** on the final local production-base build, Chromium 156.0.8078.47 and axe-core 4.14.0, at 1280/390 plus interactive phone navigation at 360. No reported WCAG-tag violations, no horizontal page overflow, exactly one H1 and visible search on every page. This is automated supplement to manual review, not complete compliance certification.
- Final machine-readable axe evidence: `/tmp/hwinfo-a11y-final-production-base.json`.
- **PASS: observed baseline defect reproduced** in a separate Jekyll build of audited commit bb4aedecbce499e199df8af63793a1490c0fb6ed at `/baseline/sensor-dial.html#transparent-background`: open whole-deck image, focus Actual size, Shift+Tab. Active element becomes `#edit-this-page`, while `.zoom-overlay` remains open and focus is outside. Evidence: `/tmp/hwinfo-baseline-focus-regression.json` and `.png`.
- The corresponding new native-dialog regression passes: Shift+Tab and repeated forward/backward Tab stay inside; pointer/background focus is blocked; Escape and Close restore the image opener.
- **PASS: theme comparison keyboard journey at 390x844.** The named region is 333px wide with 1072px of authentic image content. ArrowRight pans it; its link opens the complete themes-contact-sheet.png; Escape restores the link; the document does not overflow. Evidence: `/tmp/hwinfo-theme-scroll-review.json`.
- No remaining reproducible content or UI finding from this review. Committed-preview base and published deployment verification are still separate pending stages.

## Last Escape-order repair retest

The full production-base suite passed **15/15** before this narrow repair. After the repair, both changed cases passed in a targeted **2/2** run (1.86 seconds): the complete viewer Shift+Tab/Tab/restoration case now also verifies Escape does not change an open mobile menu behind the native dialog; the existing mobile-menu/search case now verifies first Escape clears and hides search, then second Escape closes the menu and restores focus. There are still 15 cases total. The exact committed preview will receive the complete suite again. The common page event capture also now rejects same-origin HTTP 4xx/5xx responses as well as network failures and page exceptions, including resource failures such as favicons.

## Independent performance-review follow-up

The independent_final reviewer subsequently found mobile layout shift caused by adding the `docs-js` class only when the deferred enhancement script ran. Root moved that class bootstrap into the head. I added the fifteenth browser regression, holding the deferred response while checking the first visible home content, then releasing and verifying menu operation. **Targeted retest PASS**, 0.92 seconds, and subsequently included in the full **15/15 PASS** run above. DOMContentLoaded is correctly awaited only after releasing the deferred response because that event depends on deferred scripts completing. This retest does not claim a fresh performance measurement; independent_final owns that measurement.
