# Changelog

Changes are recorded here for each verified release.

## 0.1.6

- Add a visible Open manager action in the sidebar and use native theme colors for primary controls.
- Fix search segment height, overflowing deep family buttons, short-window filters and long declaration text.
- Keep every multi-file review change reachable through scrolling and show narrow review versions below package names.
- Keep keyboard focus inside the detail drawer and restore the workbench with Escape.
- Add CI browser regressions for responsive layouts, long content, review containment and keyboard recovery in light and dark themes.

## 0.1.5

- Add All, Stable, Minor and Patch update search presets while keeping independent package and family selection.
- Describe version changes numerically without inferring API breakage, features or fixes; remove major warning colors and the patch-only recommendation.
- Fix selected search button contrast on hover and verify compact editor and sidebar layouts in light and dark themes.

## 0.1.4

- Include existing explicit NuGet project SDK declarations, such as Aspire.AppHost.Sdk, in family reviews and updates in VS Code and the CLI. Preserve versionless or absent SDKs; resolve each dependency's own available versions.
- Replace the retired Marketplace version badge provider in the README.

## 0.1.3

- Redesign the Packages view around groups: each package family is one row with an Update button, nested families such as Microsoft.Orleans are one-click selections, and a Groups/List switch shows the same updates flat.
- Add a visible Prerelease option, an options panel for version policy, update types, up-to-date packages and package file, and removable filter chips.
- Check feeds automatically when a view opens, after updates are applied and after package files change; reuse successful version lists for 10 minutes and disable with `nugetPackageManager.autoCheck`.
- Show the number of packages with updates on the NuGet Activity Bar icon and native progress while checking.
- Keep the list, scroll position and selection stable while checks run; fix overlapping controls and red version text from injected webview styles.
- Show groups, packages and details side by side in wide layouts and open details in a drawer in the sidebar; add keyboard navigation.
- Add the Configure Package Feeds command and move Rescan Package Files to the view's overflow menu.

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
