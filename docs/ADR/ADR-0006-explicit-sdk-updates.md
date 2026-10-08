# ADR-0006: Explicit NuGet project SDK declarations

Status: Accepted; implementation and independent review complete, CI/publication pending.

## Context and decision

The parser currently discovers PackageReference and PackageVersion only. The user's Aspire AppHost SDK uses a direct Project child `<Sdk Name="Aspire.AppHost.Sdk" Version="13.6.0" />`, so a family update leaves the SDK behind. Microsoft documents this project SDK form: https://learn.microsoft.com/en-us/visualstudio/msbuild/sdk-element-msbuild.

REQ-013 / AC-017 extend the existing PackageUpdates engine to this explicit form. SDK Name maps to packageId, literal Version to the existing UTF-16 range and kind becomes Sdk. The TypeScript contract adds Sdk; the generic renderer already displays the declaration kind. Discovery is restricted to a direct child of the root Project. Existing feed, family, review and application algorithms are reused. Versionless SDKs have no locally owned version and are not feed targets. Nonliteral/invalid explicit versions remain manual notices.

Alternatives: host-specific SDK parsing would duplicate the shared engine; forcing one version on every family dependency could select nonexistent versions; supporting all SDK syntaxes at once would expand ownership into global.json and import evaluation. These are rejected for this bounded request. A family review does not prove dependency compatibility; each declared dependency uses its own listed versions and selected update policy.

## Ordered implementation and ownership

1. TASK-040 lead (inherited planning tier) owns this ADR, PackageUpdates feature spec, Architecture/README/CHANGELOG docs, src/Features/PackageUpdates/Contracts/types.ts and tests/Features/PackageUpdates plus its host fixture script. Define contract before worker integration.
2. TASK-041 bounded engine worker (inherited tier) owns dotnet/ManagedCode.NuGet.Core/Features/PackageUpdates/PackageDocuments.cs, dotnet/ManagedCode.NuGet.Tests/SdkDeclarationTests.cs and LocalFeedTests.cs only. Implement discovery/edit support and focused positive, negative and actual local-feed CLI family regressions. No version or release edits, no local tests (user requests tests in CI).
3. TASK-042 independent reviewer (inherited tier), read-only, joins after TASK-040/041 complete. Use mcaf-code-review to inspect shared contracts, XML ownership, test quality and unintended SDK/feed targets. Report complete/blocked/failed/cancelled and findings before lead commit.
4. Lead inspects all worker diffs and resolves findings, formats changed files, runs canonical builds and pushes the scoped commit on main. CI runs engine, bridge and actual VS Code host tests on all three platforms. The user explicitly requested the next patch release: bump canonically to 0.1.4, preserve existing immutable tags and let green CI dispatch publishing.

Join: native agent completion/status/wait, exact disjoint write scopes, final lead integration. Ambiguity or verification failure returns to lead; do not widen SDK syntax or hide failures. This is one in-repository PackageUpdates slice; no dependency, runtime, credential or hosting changes.

## Verification and rollout

TST-SDK-017: direct SDK discovery, literal spans, conditional independence, same-family mixed review/apply, per-package feed versions and dotted sibling exclusion. Negative cases: comments/CDATA/nested elements, missing versions, properties/ranges/wildcards/invalid IDs and stale edits. Preserve BOM/CRLF/quotes. CLI uses actual isolated HTTP feed and real executable. Bridge uses packaged shared engine; VS Code host uses real documents and WorkspaceEdit.

Build: npm run build; dotnet build NuGetPackageManager.slnx -c Release. Formatting: Prettier and dotnet format. CI owns npm test, dotnet test, test:host and VSIX packaging. Pass: all required CI jobs green and the approved 0.1.4 release successfully published. Implementation status remains pending until evidence exists.

Compatibility: additive declaration kind coordinated with the bundled engine and TypeScript host. No persisted schema or configuration migration. Existing explicit package behavior remains unchanged. Rollout is the user-approved 0.1.4 release; rollback reverts the scoped implementation commit without moving historical tags.

## Implementation join evidence

TASK-040 and TASK-041 are complete. TASK-042 independent read-only review found no high/medium defects. Canonical solution and extension builds passed; no local tests were run. CI is the required regression and publication gate for 0.1.4.

Maintainability exception: LocalFeedTests exceeds the 350-line outer-type limit because the CLI HTTP regressions share its isolated disposable server. It remains below the 500-line file limit. Split the feed fixture and scenarios before another change would exceed that file limit; no product-code limit changes.
