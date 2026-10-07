# Changelog

Changes are recorded here for each verified release.

## 0.1.1

- Decode compressed NuGet V3 responses in the shared engine used by both hosts.
- Retry public tool installation while NuGet metadata is being indexed and verify a read-only live-feed check before completing a release.

## 0.1.0

- Add a shared .NET 10 package update engine for the VS Code extension and `nuget-manager` global tool.
- Add first-segment and dotted-prefix package families with bulk review in both hosts.
- Add CLI check, update, dry-run, JSON, source, and noninteractive confirmation options.
