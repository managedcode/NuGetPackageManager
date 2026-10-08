# Changelog

Changes are recorded here for each verified release.

## 0.1.2

- Add a dedicated NuGet icon to the VS Code Activity Bar and a compact package manager sidebar.
- Keep grouped update review shared between the sidebar and the full editor workbench.
- Use theme-aware monochrome Managed Code colors and the NuGet mark for the extension logo.

## 0.1.1

- Use the branded Marketplace technical name `managedcode-nuget-package-manager` and display name `NuGet Package Manager by ManagedCode` to resolve initial publication name collisions.
- Add GitHub badges and explicit version-driven release/Marketplace automation; the current version remains 0.1.1.

- Decode compressed NuGet V3 responses in the shared engine used by both hosts.
- Retry public tool installation while NuGet metadata is being indexed and verify a read-only live-feed check before completing a release.

## 0.1.0

- Add a shared .NET 10 package update engine for the VS Code extension and `nuget-manager` global tool.
- Add first-segment and dotted-prefix package families with bulk review in both hosts.
- Add CLI check, update, dry-run, JSON, source, and noninteractive confirmation options.
