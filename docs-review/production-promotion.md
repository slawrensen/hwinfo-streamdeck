# Production promotion and legacy documentation

This extends the reviewed redesign after the owner explicitly requested production publication. The final reviewed source, merge commit, Pages deployment and served-build checks are recorded in [PR #60](https://github.com/slawrensen/hwinfo-streamdeck/pull/60). Plugin runtime code and the stable 1.7.1 package are unchanged.

## Readability correction

The owner supplied a Troubleshooting screenshot showing that secondary text remained too small. Independent browser measurements confirmed more than a visual preference: the inherited theme combined a smaller mobile root with important table-cell rules, producing 10.5px cells and technical names as small as 9.03px. Nested code styling also reduced commands to about 11.2px. Desktop contents links were 12px.

The shared scale now uses browser-relative units with these default sizes:

| Role | Default size |
| --- | --- |
| Article text | 17px desktop, 16px phone |
| Navigation, search, buttons and tables | 16px |
| Contents links, captions, requirements, labels and footer | 14px |
| Code and ordered-step markers | At least 14px |

The theme's important root, cell, navigation and sidebar-footer rules are explicitly corrected. Phones retain the readable scale. Tables scroll inside their own regions when needed. The contents rail is 240px wide and appears beside the article from 1600px; narrower screens use the existing inline contents disclosure. The complete workspace remains bounded at 1920px, prose at 72ch, and the authentic logo at 48px.

This follows the [U.S. Web Design System's guidance](https://designsystem.digital.gov/components/typography/) to use an effective size of at least 16px for most reading text and smaller companion text sparingly. [Carbon's web typography](https://www.carbondesignsystem.com/building-blocks/foundations/typography/type-sets) also distinguishes 16px body/action styles from 14px supporting styles. These are design references, not a claim that one numeric font size establishes accessibility compliance.

## Edition links and the frozen archive

Current production pages show **New documentation → Legacy docs**. The native link opens the same archived page. The new 404 page links to the archive homepage because it has no historical counterpart. Archive pages show **Legacy documentation → Current docs**. The preview keeps its separate **Documentation preview → Stable docs** identity.

The archive comes from immutable source `bb4aedecbce499e199df8af63793a1490c0fb6ed`, using Jekyll 3.10 and Just the Docs v0.10.1. It preserves all 16 original routes, 192 required fragments, authentic assets, credits, navigation and its own search. Internal archive URLs are document-relative so they also work below the preview base path.

`scripts/docs-legacy-build.mjs` generates static HTML without front matter, a route inventory and SHA-256 file records in `legacy-build.json`. The archive has `noindex` and stays outside current-documentation search. Private release files and CNAME are excluded. Old editing links are disabled.

Three focused repairs accompany the historical content: native modal inertness with explicit Tab boundaries, correct image-toolbar stacking, and enough intrinsic desktop-header height for the original title. Edition links preserve the page path; they do not blindly copy fragments that may exist in only one edition. Existing direct fragments are checked independently.

## Review and regression scope

Three independent agents covered archive implementation/provenance, browser journeys, and adversarial code/rendered review. The coordinator owned the shared shell, type system, integration and publication. Reviewers inspected work they did not author. Reproduced defects included the archive toolbar intercepting clicks, Shift+Tab losing dialog focus, a clipped archive title, a crawler accepting missing archive inventories, duplicated deep-link spacing, and inherited font reductions. Each received a targeted correction and retest.

The meaningful browser regressions cover both base paths, native edition round trips without JavaScript, search isolation, indexability, direct fragments, history, disclosure reveal, the exact whole-deck image focus reproduction, pointer controls and readable text floors. Deep-link targets use one responsive offset with a 16px gap below sticky chrome.

The crawler checks full source identities on production as well as preview, validates the archive's independent identity and nonempty inventory, follows inventory-only routes, checks search destinations and fragments, and probes private paths under both editions. A real Jekyll build validates the website; `npm run build` is not used as documentation validation.

Production identity comes from GitHub Pages' actual build revision. A merge commit therefore receives its own `docs-<sha>` identifier in HTML and `docs-build.json`. Preview staging retains its explicit reviewed-source identifier and expected-head lease. Publication is accepted only after the matching Pages deployment succeeds and served HTML/assets are verified.

Physical Windows/HWiNFO/Stream Deck testing and private release qualification remain unavailable and outside this documentation-only change. Automated accessibility checks supplement keyboard, visual, reflow and interaction review; they do not establish full compliance or field Core Web Vitals.
