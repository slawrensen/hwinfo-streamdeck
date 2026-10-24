# Responsive follow-up interaction review

Reviewer: `/root/release_accuracy`. Date: 24 October 2026. Scope: the revised fluid documentation layout, wrapping theme samples, repository logo, and existing browser regressions. This review does not qualify plugin runtime or hardware.

## Finding and repair

**MEDIUM: image-only article paragraphs retained the prose-width limit.**

- Location: `docs/assets/css/docs.css`, generated `sensor-dial.html`; 1920 x 1080 and 3440 x 1440.
- Reproduction: Jekyll/Kramdown wraps standalone image anchors in paragraphs. The new `.main-content > p` prose rule therefore also constrained the whole-deck capture, background comparison and settings captures to 76ch, even though the outer article was fluid.
- Impact: widening the browser did not give useful product media the intended room; the responsive redesign appeared improved at the container level without fixing the actual images.
- Correction: the coordinator exempted paragraphs that contain the image/media anchors from the prose maximum.
- Retest: PASS. New browser tests measure the actual `dial-backgrounds-deck.jpg` image, require it to be materially wider than body prose, preserve its original aspect ratio and confirm no whole-page horizontal overflow at 1920 x 1080 and 3440 x 1440. The article also grows substantially beyond its 1280px layout while body text remains at least 16px and within approximately 80ch.

## New regression coverage

`test/docs-browser.test.mjs` now contains 22 cases, seven more than the initial reviewed implementation:

- Two large-screen cases check real article and image geometry at 1920 x 1080 and 3440 x 1440 while retaining readable prose.
- Three phone/tablet cases at 360, 390 and 768px check all seven named presets. Every image decodes, remains at least 120px in each dimension, preserves its original aspect ratio and stays within the viewport during ordinary vertical scrolling. Samples wrap into multiple rows with no gallery or page horizontal overflow. Keyboard activation opens the complete comparison and Escape restores focus.
- Two no-JavaScript cases at 1280 and 390px check that the repository logo loads through a native subpath image and the home link remains keyboard-operable. Asset authenticity is documented by the separate provenance review; a browser geometry test alone does not establish provenance.

All original 15 cases remain, including the exact Actual size / Shift+Tab defect, repeated modal focus containment, background blocking, focus restoration, mobile menu/search, delayed script/index loading, four support searches, disclosure history, subpath resources and essential no-JavaScript navigation.

## Results

- **PASS: 22/22 browser cases**, 12.07 seconds, on `http://127.0.0.1:4173/hwinfo-streamdeck/` with `/usr/bin/google-chrome`. No same-origin HTTP errors, network failures or page exceptions were reported.
- **PASS: ESLint** for the changed test file, Node syntax check and `git diff --check`.
- Output: `/tmp/hwinfo-responsive-browser-production.txt`.
- The coordinator had synchronized the repaired stylesheet into the actual local Jekyll output before this run. A fresh immutable-source build and exact preview rerun remain final integration gates; this report does not assert publication of the follow-up yet.

## Comparison Site static review

The separate comparison Site at `hwinfo-review-site/dist/` was inspected read-only. Its decision claims were compared with the source and review reports. All 13 authored redesigned-page links/fragments matched the actual Jekyll build. JavaScript syntax passed. PR #60 was verified open through GitHub; its separate automatic Codex review was unavailable because of account review usage limits, not an observed code failure.

- **MEDIUM:** screenshot enlargement initially used buttons with no native image fallback. The coordinator changed them to ordinary image links enhanced by JavaScript. Static retest confirms the native hrefs and modifier-key fallback; managed-browser review remains pending.
- **LOW:** comparison selectors initially appeared enabled without JavaScript. The coordinator now hides them until enhancement. Static retest confirms the initial hidden state and retained no-script explanation; managed-browser review remains pending.

The Site is still integrating complete snapshots, updated capture provenance and validation data. Browser review must use the supplied managed `sites-preview` URL through cloud `cua_repl`; no alternative Site server or browser has been used.
