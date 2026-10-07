# Repository governance

Use [MCAF](https://mcaf.managed-code.com/tutorial). Start from [docs/Architecture.md](docs/Architecture.md), then the owning feature spec and ADR. Preserve existing root/local rules when updating governance (`MCAF-GOV-001`).

## Commands

- Install: `npm ci` (Node 22 or later).
- Build: `npm run build`.
- Analyze: `npm run typecheck`.
- Test: `npm test`.
- Integrated check: `npm run check` (TypeScript, published engine, bridge tests, .NET tests and both format checks).
- .NET build: `dotnet build NuGetPackageManager.slnx -c Release`.
- .NET tests: `dotnet test NuGetPackageManager.slnx -c Release`.
- .NET formatting: `dotnet format NuGetPackageManager.slnx --verify-no-changes --no-restore`.
- NuGet tool package: `dotnet pack dotnet/ManagedCode.NuGet.Tool/ManagedCode.NuGet.Tool.csproj -c Release -o artifacts`.
- VS Code host integration: `npm run test:host`.
- Format: `npm run format`; verify: `npm run format:check`.
- Core coverage: `npm run coverage`.
- Package: `npm run package`.
- Version: `npm run version:bump -- patch|minor|major|X.Y.Z`; verify synchronized versions: `npm run version:check`.
- Release helper regressions: `npm run test:release`.
- UI preview: `npm run preview`; this supplements actual host tests.

## Architecture and boundaries

`MCAF-ARCH-001` is mandatory: the entire product, host, frontend, contracts, tests, CI and docs live in this repository. Canonical slice convention: `src/Features/<SliceName>/{Contracts,Host}`, `media/Features/<SliceName>`, `tests/Features/<SliceName>` and `docs/Features/<SliceName>.md`. The shared .NET engine is `dotnet/ManagedCode.NuGet.Core/Features/PackageUpdates`; the console host is `dotnet/ManagedCode.NuGet.Tool`. The initial slice is `PackageUpdates`. Root extension.ts is composition only. Global packaging assets/scripts and CI are solution-wide.

One .NET engine owns XML declaration parsing, NuGet version semantics, listed feed discovery, family matching and validated version edits for both hosts. Do not duplicate this logic in TypeScript. VS Code calls the bundled engine through a JSON stdin/stdout bridge and applies its reviewed text ranges with WorkspaceEdit. Grouped updates are the primary flow: preserve first-segment families from the source idea and allow narrower dotted prefixes such as Microsoft.Orleans. Honor VS Code light/dark/high-contrast theme tokens. The CLI package/command name requires the user's explicit selection before publication.

The workbench must stay compact: families, package list and inspector remain beside each other at ordinary editor widths. Do not stack the inspector below a long package list at tablet/editor widths. At genuinely narrow widths use an explicit inspector drawer. Keep the header and summary concise and the package list scrollable within the workbench; avoid a tall sequence of promotional blocks.

Read actual editor buffers; preserve unsaved edits, XML formatting, BOM and line endings. Update only reviewed literal version ranges. Capture complete discovery and review snapshots and reject the entire stale plan before edits. Keep conditional declarations independently selectable. Shared central version changes affect all consumers. Trust gates every write. Never interpret a failed feed check as up-to-date.

The webview is a renderer: host code owns file/network access. Validate messages against known state; never accept arbitrary paths/URLs/versions from the UI. Keep a restrictive CSP, escaped dynamic markup, and visible loading/error/empty states. Version candidates must be listed registration entries; do not silently recommend unlisted releases.

## Task delivery and verification

For non-trivial work, create root `<slug>.brainstorm.md`, `<slug>.acceptance.md`, then `<slug>.plan.md`; feature specs contain stable REQ-/AC- IDs and traceability (`MCAF-REQ-001`). Boundary/dependency/security/deployment decisions need an ADR with ordered implementation, ownership, rollout/rollback, tests and join evidence before integration. Keep statuses truthful.

Implement tests with behavior. Run focused checks, full relevant tests, host integration, formatting, final build and VSIX packaging. Do not skip/disable tests to get green. Prefer real HTTP test feeds and actual VS Code host tests; no mocked dependency calls as delivery proof. Report measured coverage, scope and remaining gaps; critical edit flows need success and stale/error scenarios.

`MCAF-AI-001` is mandatory for substantial independent work: the strongest suitable lead owns requirements, architecture, plan, integration and final review; use the least expensive capable worker for bounded disjoint tasks. Each packet names TASK-/REQ-/AC- IDs, exact reads/writes, constraints, dependencies, commands, evidence, escalation and join condition. Shared contracts/manifests/governance have one lead owner. Workers end complete/blocked/failed/cancelled. Use native status/wait tools, inspect every diff and rerun integrated gates before completion. Record concrete reasons for tasks that cannot be safely delegated.

Never commit credentials, private upstream diffs or enterprise configuration. Preserve unrelated work. Never stash, automatically stash, force-push or bypass branch protections. Scoped new-project commits/pushes and GitHub VSIX release are authorized by the creation request. Marketplace publishing requires a configured publisher credential and explicit requested scope; do not claim it is published there from a GitHub release alone.

ManagedCode dependencies are owned projects: locate the sibling owning repo, read its AGENTS.md, repair there with regression tests and required checks, increment its canonical patch version, commit relevant changes and push. Follow its release to successful intended NuGet publication, update this consumer and test it. Do not substitute implementations, hide defects with consumer workarounds or claim delivery from local packages/project references. Report exact credentials/source/publication blockers. When asked to commit all changes, include the full requested scope on the current branch.

## Skills and self-learning

Installed `.codex/skills`: mcaf-solution-governance (governance/topology), mcaf-feature-spec (requirements/acceptance), mcaf-adr-writing (decisions), mcaf-code-review (independent final review). Use the matching skill when the task meets its trigger. Playwright is the optional runtime skill for visual interaction checks.

Durable user corrections and repeated mistakes become precise repository rules after checking scope; one-off task directions do not become global policy. Keep rule changes merge-only. Daily collaboration language is Ukrainian; code/docs are English.

## Maintainability limits

- `file_max_loc`: 500, excluding declarative styles/templates and imported skills.
- `type_max_loc`: 350.
- `function_max_loc`: 100, excluding declarative UI templates.
- `max_nesting_depth`: 4.
- `exception_policy`: justify exceptions in the nearest ADR with scope, reason and split/removal trigger. ADR 0001 documents the cohesive initial host/UI template exception.

## Release identity and automation

The Marketplace technical name is managedcode-nuget-package-manager; displayName remains NuGet Package Manager and publisher managedcode. The original short name is already reserved on Marketplace. Update all version files with the canonical helper, never move release tags, and do not rely on GITHUB_TOKEN tag push to trigger another workflow: explicitly dispatch Release after successful main matrix checks. Publish the exact GitHub VSIX artifact. Marketplace credentials belong to the marketplace environment and automatic publication is opt-in through MARKETPLACE_PUBLISH=true. A missing publisher identity is pending configuration, never evidence of publication.

Version increments require an explicit human release decision. Preserve 0.1.1 for the current badge/workflow and first Marketplace identity correction; do not create or publish a new NuGet version to test automation.
