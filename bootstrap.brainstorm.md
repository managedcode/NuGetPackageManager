# NuGet extension bootstrap

The source idea is selective, family-based updating of central NuGet declarations. The initial scratch prototype predates the MCAF bootstrap; this document governs integration and delivery, not a claim that discovery artifacts preceded that prototype.

Options: wrap the source console tool, invoke the .NET CLI for each edit, or implement a VS Code-native declaration workbench. Choose native workspace edits: one review step across multiple files, exact version replacements, standard editor undo, no XML reserialization. Use NuGet V3 indexes to discover flat-container version endpoints.

Scope: central PackageVersion and literal project PackageReference versions; family selection, policy filters, prerelease, failed checks, review, diff and apply. Exclude new package installation, transitive dependency resolution, credential handling and NuGet.config source mapping in v0.1.

Risks: stale offsets, central versions affecting multiple projects, properties/ranges, unlisted versions, private feeds, network failures, compatibility inference. Mitigations: full document snapshots, strict literal/version validation, listed-version registration checks, fail visibly on incomplete feed checks, compatibility note and explicit review.

Product name remains the user's decision. Code and docs stay in the scratch workspace until the name is chosen. Public delivery contains original TypeScript implementation, no private source diff or enterprise branding.

Final scope before first release: the user approved NuGet Package Manager and `nuget-manager`, and required a common .NET engine for both hosts. ADR-0002 supersedes the native TypeScript prototype. The product keeps first-segment families and supports dotted subfamilies, uses the Managed Code orange brand, automatic editor themes and compact adjacent panes. Actual NuGet publication and feed installation are required before reporting full delivery; GitHub VSIX availability is independently useful if that publication is blocked.
