# Independent preview-publisher and crawl review

Reviewed release_accuracy-authored scripts/docs-preview-publish.mjs and test/docs-preview-stage.test.mjs; this agent did not author the publisher.

## Findings
- PASS: source staging reads committed git objects, not dirty index or working tree.
- PASS: structural YAML preserves the redesigned shell and theme settings. No header overwrite remains.
- PASS: release and generated build folders are excluded; committed CNAME/.nojekyll fail before staging.
- PASS: repository access errors propagate. There is no creation or visibility-change fallback.
- PASS: target must be the named, existing public preview repository with main as default.
- PASS: parent commit preserves previous preview history. Expected head is checked before fetch and push; the actual git lease rejects an intervening writer.
- PASS: immutable source/build identity is emitted in docs-build.json; publication explicitly reports deployment unverified.
- No critical/high findings in the reviewed publisher.

## Executed checks
20/20 black-box tests passed: 14 crawler HTTP-fixture tests and 6 publisher local-git tests. Tests used actual temporary HTTP servers and bare git repositories. Localhost binding required sandbox escalation; no external publication was attempted by this agent.

Crawler extension independently verifies reachable links, unlinked route/anchor contract entries, search JSON contents/URLs/fragments, all responsive source candidates, assets escaping the project base, private-path HTTP 404s, preview noindex, marker and consistent build/source metadata. It accepts an externally expected build ID.

## Limits
The actual staged Jekyll build and live preview must still be crawled. Browser behavior and visible marker/focus verification are separate. No physical device or plugin release qualification is implied.

## Final crawler additions

Two further HTTP-fixture cases cover draining a large HTTP/1.0 image response and rejecting a truncated asset stream. The final crawler group has 16 tests, alongside 6 immutable-source/publisher/lease tests. The actual production-base Jekyll build passed all 16 original routes, 87 URLs, the 192-fragment route contract, responsive images, search index and nine private-path 404 probes.
