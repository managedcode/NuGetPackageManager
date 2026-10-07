# Release automation plan

- [x] TASK-015 (lead): establish OP-/AC- contract and ADR; own manifests, workflows, governance and joins. Implement version-driven tag/dispatch, exact released-VSIX Marketplace workflow and link architecture. Preserve existing release gates and tags.
- [x] TASK-016 (bounded tooling worker): own scripts/release-version.mjs and tests/ReleaseAutomation/version.test.mjs only. Implement read-only validation and stable atomic version bump for package.json, lock roots and Tool.csproj. Lead alone changes real manifests. Join real temporary-file regressions and inspected diff.
- [x] TASK-017 (documentation worker): own README.md and docs/Operations/Releasing.md only. Add truthful badges and precise version/Marketplace OIDC/PAT setup and recovery commands. Do not claim Marketplace delivery. Join formatting and lead review.
- [x] TASK-018 (independent reviewer): read-only release/event/permission/version/asset checks after integration. Escalate reproducible defects; lead joins fixes before push.
- [ ] Run relevant local checks and packaging; push only scoped changes. Verify main CI preserves the existing v0.1.1 tag and skips publication at the unchanged version. Download the qualified renamed VSIX and attach the corrected initial Marketplace identity asset to the existing release, recording its source commit. Do not publish another NuGet version.
- [ ] Exercise manual Marketplace workflow to establish whether inherited authentication exists. Report exact connection requirements if absent; never ask for tokens in chat. Update status/evidence and deliver concise user instructions.

Final skills: MCAF ADR Writing for deployment/auth decision, MCAF Code Review for the independent integration gate. Native collaboration tools govern completed/blocked worker joins. Marketplace account membership cannot be delegated or simulated from unavailable credentials.

Local joins: TASK-016 passes 14 real temporary-file version regressions. TASK-017 badges/operations documents are formatted and retain 0.1.1. TASK-018 found VSCE_PAT precedence over Azure credentials; OIDC now unsets the PAT explicitly. Final independent pass found no further code defects. The user explicitly cancelled the local 0.1.2 bump before any commit/tag/publication; all versions are restored to 0.1.1. Hosted artifact qualification and publisher authentication remain the next gates.
