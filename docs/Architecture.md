# Architecture

One repository owns NuGet Package Manager for VS Code and the `nuget-manager` global tool. A single .NET 10 PackageUpdates engine parses declarations, compares official NuGet versions, checks listed feed metadata, matches package families and validates version-only text patches. Presentation and file I/O belong to each host.

```mermaid
flowchart LR
  UI[Theme-aware workbench] -->|validated messages| VS[VS Code host]
  VS -->|JSON stdin and stdout| Engine[PackageUpdates .NET engine]
  CLI[nuget-manager console host] --> Engine
  Engine --> Feed[NuGet V3 feeds]
  VS --> Editor[WorkspaceEdit and native undo]
  CLI --> Files[Snapshot-validated file writes]
```

| Surface                                            | Canonical owner                                       |
| -------------------------------------------------- | ----------------------------------------------------- |
| VS Code composition/commands                       | src/extension.ts                                      |
| Shared domain and contracts                        | dotnet/ManagedCode.NuGet.Core/Features/PackageUpdates |
| Console and JSON bridge host                       | dotnet/ManagedCode.NuGet.Tool                         |
| Editor contracts                                   | src/Features/PackageUpdates/Contracts                 |
| Sidebar/editor lifecycle, bridge, document adapter | src/Features/PackageUpdates/Host                      |
| Frontend resources                                 | media/Features/PackageUpdates                         |
| Engine/CLI regressions                             | dotnet/ManagedCode.NuGet.Tests                        |
| Bridge/HTTP and actual editor tests                | tests/Features/PackageUpdates                         |
| Feature truth                                      | docs/Features/PackageUpdates.md                       |
| CI/packaging                                       | .github/workflows and scripts                         |

The native NuGet Activity Bar container hosts a Packages sidebar. Its open command focuses that view; `nugetPackageManager.openEditor` opens the wide editor workbench. Both surfaces share the same controller, discovery results, selected review, validated bridge, and editor writes. Hiding or revealing one surface preserves state, and closing one surface does not cancel work while another remains open. The sidebar's compact styles are scoped to `body.surface-sidebar`; the editor keeps its adjacent family, package, and inspector columns.

The VSIX bundles the same framework-dependent engine assembled for the NuGet tool. Users need the .NET 10 runtime and `dotnet` on PATH. The extension never downloads an executable at activation. Bridge requests read supplied text and return data; writes remain in the trusted editor host. VS Code saves previously clean documents and preserves previously dirty buffers. The console validates complete original file snapshots before writing and reports failures.

First-segment families are the default; engine-provided dotted prefixes allow narrower selection. A family update opens one exact review across every affected file. Feed errors remain explicit. The frontend uses VS Code theme variables with Managed Code orange accents, three adjacent panes at normal widths and an inspector drawer at narrow widths.

Read [PackageUpdates](Features/PackageUpdates.md), [ADR-0002](ADR/ADR-0002-shared-dotnet-engine.md), [ADR-0004](ADR/ADR-0004-sidebar-workbench.md), the [sidebar acceptance](../sidebar-workbench.acceptance.md), and [acceptance](../bootstrap.acceptance.md) for contracts. [ADR 0001](ADR/0001-native-workbench.md) records the superseded prototype. No server, database or separate product repository is required.

Version-driven release and Marketplace publishing are defined in [ADR-0003](ADR/ADR-0003-versioned-publishing.md) and [release acceptance](../release-automation.acceptance.md). Successful main CI creates an immutable version tag and explicitly dispatches Release. Marketplace publishing consumes the verified GitHub VSIX through a separately authenticated workflow.
