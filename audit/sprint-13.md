# Sprint 13: candidate release decision

**NO-GO.** Draft PRs and successful software checks do not authorize a
release. No merge, tag, publication or Marketplace submission occurred.

The audit starts at `2ca44e95c2d8b3442c3ed411952621b254d4cbf0`. The inherited
local candidate is 1.6.1.0; the installed stable plugin remains 1.6.0.0.
The final software-stack hash, package hash and command ledger must be
recorded after the last runtime edit. Earlier packs and soaks do not qualify
later code, even when the native bytes happen to be identical.

## Required decision evidence

| Gate | Required evidence | Current disposition |
| --- | --- | --- |
| Wrong data | Production regressions for D01-D05/D07, plus U1 controlled-writer result and producer-contract decision | Software containment under review; U1 atomic contract unresolved |
| Build and native | lint/typecheck/unit, native integration, full mock-host suite, ABI matrix | Exact command results recorded per PR and final stack |
| Version/package | Four-file version agreement, production-only native contents, exact pack/native/bundle hashes | Local packaging gate required after final edits |
| Dependencies | Complete lockfile advisory results and reviewed deltas | Two development-only transitive fixes; zero known npm advisories on updated lock |
| Signatures | Actual Get-AuthenticodeSignature and SHA-256 facts | Record the exact candidate; unsigned is not asserted to be a Marketplace rejection |
| Upgrade/rollback | Genuine clean install and preserved v1.5/current profile imports; personalization and unknown fields retained | NOT RUN |
| Lifecycle/resources | Eight-hour current candidate plus 48-hour exact final-pack physical soak, restart/sleep/wake/reconnect matrix | NOT RUN |
| Setup | Five uncoached clean-Windows trials, each <=180 s and <=6 interactions including installer/UAC | NOT RUN |
| Readability | 72px device, non-Latin fallback, randomized 300ms value/unit/severity recognition | NOT RUN |
| Marketplace | Current official requirement checklist and human review/submission approval | No submission authorized |

Current official manifest requirements were checked against Elgato's
[manifest reference](https://docs.elgato.com/streamdeck/sdk/references/manifest/).
The manifest declares Windows 10, Stream Deck 6.9 and Node 20. A newer SDK
getting-started page's prerequisites are not automatically applied as a
new minimum to this pinned plugin. CLI validation and actual host behavior
remain separate checks. No unsupported rejection or signing rule is inferred.

The public HWiNFO [shared-memory support page](https://www.hwinfo.com/forum/threads/shared-memory-support.18/)
directs developers to request the detailed specification. It does not
supply the owner-rewrite/version contract needed to close U2 in this session.
No producer-version allowlist was invented and no vendor was contacted.

Before any future approval request, fix the final source/pack, retain the
previous verified package and configuration export, run the required gates,
and present exact artifacts and residual risk for review. A missing trial,
unexplained crash, open confirmed S0/S1 or unreviewed package delta blocks
shipping. Preserve all failure evidence during rollback.
