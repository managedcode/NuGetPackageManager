# Native NuGet sidebar

The user wants the installed extension on VS Code's Activity Bar. The current host only opens an editor panel. Add a native NuGet view container and a webview sidebar using the existing renderer, controller and shared .NET engine. An optional editor command keeps the wide workbench available.

Do not implement a launcher-only view or duplicate package logic. A cohesive presentation adapter owns both webviews and native diff previews; the controller retains discovery, review and edit safety. A second surface must receive current state without discarding review. Closing one surface must not cancel work displayed in the other.

Marketplace 0.1.1 is already published and installed. Preserve that public release while preparing and testing this functional change. Any new public version requires the human release decision specified in AGENTS.md.
