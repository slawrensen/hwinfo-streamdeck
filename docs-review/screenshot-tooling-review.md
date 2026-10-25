# Docs screenshot tooling review

## Changes owned

- `scripts/docs-site-shots.mjs`
- `test/docs-site-shots.test.mjs`

The screenshot script now discovers Chrome on Windows, macOS and Linux, with explicit `CHROME` or `CHROME_PATH` overrides. It launches only a new disposable profile and discovers its debugger from that profile's `DevToolsActivePort`. Windows keeps the existing process-identity cleanup. POSIX closes the browser and signals only the child it spawned. SIGINT and SIGTERM also clean up that owned browser; no name-based kills or inherited browser sessions are used.

Default coverage is all 16 public routes and the new 404 page, at 1280×800 and 390×844. Set `DOCS_SHOTS_VIEWPORTS=360x800,768x1024,1440x900,2560x1440` for the extended pass. Each page gets a full PNG without the old 16000px truncation and a separate first-viewport PNG. The manifest records document status, dimensions, timestamp, supplied commit identity, overflow, broken images, script errors and failed requests. Navigation failures and failure to settle fonts/images abort instead of accepting a blank capture.

## Tests actually run

- PASS: `node test/docs-site-shots.test.mjs`: ten ownership/configuration tests; optional browser integration skipped in this initial unit-only invocation.
- PASS: `DOCS_SHOTS_BROWSER_TESTS=1 node test/docs-site-shots.test.mjs`: eleven tests, including real Chrome against a localhost HTTP fixture. A page over 19000px tall produces a PNG with the full document height; the opening screenshot is exactly 844px tall. A broken image is recorded with its 404 and exits nonzero.
- PASS: ESLint on both changed files, zero warnings.
- PASS: `git diff --check` on both changed files.

## Environment limits

Chrome cannot start inside the restricted filesystem/network sandbox (SIGTRAP); disposable Chrome works with execution escalation. Direct HTTPS navigation to the live docs hits this environment's certificate trust error. A temporary SPKI exception experiment was stopped, its code removed, and all its incomplete captures quarantined outside accepted evidence. No certificate-ignore flags remain. No system trust configuration was changed. Those images are not audit evidence. The coordinator's working cloud browser supplies live production/preview verification. Accepted baseline screenshots use a separately built audited source, clearly labelled as a source baseline.

## Accepted screenshot evidence

- Baseline: `/workspace/scratch/58e7f1b5d8fb/evidence/before/`. Source baseline built with real Jekyll 3.10 / Just the Docs v0.10.1 from audited `bb4aedecbce499e199df8af63793a1490c0fb6ed`, served at `http://127.0.0.1:4173/baseline/`. This is not a direct production capture. Home, Installation, Get started, Sensor Dial, Themes and Troubleshooting at 1280×800 and 390×844; 12 route/viewport pairs, each with full-page and opening-view captures. All capture checks pass.
- Initial candidate: `/workspace/scratch/58e7f1b5d8fb/evidence/after-local/`. All 17 public routes at the two default viewports; 34 pairs. Initial capture checks pass. These images precede fixes found during review and are not final acceptance evidence.

## Final capture reliability and acceptance

The final implementation fixes an observed Chrome full-page capture issue on very tall pages with lazy settings images. The script eagerly requests images, waits for load, awaits decode, visits each image with an instant scroll and waits two animation frames before returning to the top. This is capture tooling only; it does not alter website runtime behavior.

PASS: The real Chrome integration test now includes a below-fold SVG under `html { scroll-behavior: smooth }` and asserts that the corresponding PNG pixel is `[240, 40, 20]`. This tests painted output rather than only image naturalWidth. The tall-document, viewport-size, broken-image 404 and nonzero-failure assertions remain. The final optional browser suite passed all eleven tests. ESLint and diff whitespace checks also passed.

Final accepted evidence is in `evidence/after-final/` (all 17 routes, desktop and phone; 34 pairs), `evidence/after-final-extended/` (six representative routes at four extended widths; 24 pairs), and `evidence/table-final/` (four focused captures after the final reference-table repair, merged into the final 34-entry manifest). All final capture manifests report no page overflow, broken images, console errors or failed requests. Full-content visual acceptance, findings and retests are recorded in `/tmp/hwinfo-visual-review.md`.
