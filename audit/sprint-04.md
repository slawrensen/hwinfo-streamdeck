# Sprint 4: release inputs and Windows qualification

Baseline: `2ca44e95c2d8b3442c3ed411952621b254d4cbf0`.
Branch: `fix/release-inputs-20260907`. No release was triggered.

## Result

D09 is contained by reading the tag through `RELEASE_TAG`, validating the
exact stable `vX.Y.Z` grammar, and requiring manifest, package and both
lockfile version fields to agree. Validation runs before dependency
installation. Shell metacharacters are rejected as data without executing
the old vulnerable PowerShell interpolation.

Build and draft staging now run in separate jobs. The build token has
`contents: read`; checkout does not persist credentials. Only the staging
job has `contents: write`. It downloads three validated artifacts and
invokes pinned actions without checking out or executing repository code.
Native double-build reproducibility and draft-first publication remain.

These choices follow GitHub's [script injection guidance](https://docs.github.com/en/actions/concepts/security/script-injections),
[job permission model](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions),
and [artifact transfer documentation](https://docs.github.com/en/actions/tutorials/store-and-share-data).
They do not establish independent builder provenance.

## Dependency findings

The complete lockfile audit reported two vulnerable development dependencies:
`brace-expansion` 5.0.7 through ESLint/minimatch and `undici` 6.27.0 through
node-gyp. Targeted lockfile updates resolve them to 5.0.9 and 6.28.1.
Production dependencies and direct version ranges are unchanged. npm audit
reports zero known vulnerabilities after the update; this is a registry
advisory check, not proof of absence of every vulnerability.

## Repository permission observations

Read-only GitHub API observations on September 7, 2026:

- Default workflow permission is `read`; workflow approval of PR reviews
  is disabled.
- The rulesets response lists one active branch ruleset, Protect Main,
  containing deletion and non-fast-forward restrictions. It lists no tag
  ruleset. The legacy tag-protection endpoint returns HTTP 404, so it does
  not establish a separate legacy protection policy.
- The collaborators response lists `slawrensen` with admin/push access.
  These responses do not enumerate every installed app or external token
  that might also write a tag.
- The audited release workflow explicitly granted `contents: write` to
  the entire build job regardless of the read-only repository default.

No rules, collaborator permissions, tokens or settings were changed.

## Evidence and remaining gates

`test/release-inputs.test.ts` invokes the actual validator in isolated
fixtures: valid tag, malformed tags, shell syntax, version mismatch and
output-file safety. A workflow regression failed against the original
workflow before the change. Raw logs are retained locally under
`release/audit-evidence/`.

Local lint, typecheck, unit, native build and packaging checks are recorded
in the command ledger alongside this report. Executing the tag-triggered
GitHub release job is NOT RUN because no tag or release is authorized.
Draft PR CI provides the ordinary Windows build/ABI evidence when it runs.

Sprint 4 remains qualified only for its software checks. Current candidate
hardware/lifecycle/resource qualification and the no-open-S0 release gate
are tracked in the foundation report. Historical soaks are not substituted
for current-candidate evidence. No Marketplace or signature-policy claim
is made. Revert these commits to roll back; public releases are untouched.
