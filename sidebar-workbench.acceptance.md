# Native NuGet sidebar acceptance

REQ-008 extends PackageUpdates. AC-010: a native NuGet Activity Bar icon activates a working Packages sidebar and discovers workspace declarations without requiring an editor tab. AC-011: opening an editor view or hiding/revealing the sidebar preserves shared review state; closing one surface leaves the other working. AC-012: the sidebar remains usable at 300–400 px with theme tokens and reachable family selection, package list and review controls; the wide editor layout remains adjacent columns. The user rejects orange: use neutral monochrome Managed Code branding in both light and dark themes.

Proof: actual VS Code host integration, narrow/light/dark visual checks, integrated check, final build, VSIX manifest inspection and independent review. Existing stale-review/edit/undo tests remain required. No public 0.1.1 asset is overwritten with sidebar changes. Publication remains gated by an explicit human version decision.

Logo acceptance: use the recognizable NuGet mark in Managed Code monochrome colors in Activity Bar, webview and package artwork; preserve attribution for the official source.
