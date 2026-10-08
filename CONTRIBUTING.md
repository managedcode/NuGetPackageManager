# Contributing

Thanks for helping improve NuGet Package Manager. The repository follows the Managed Code Coding AI Framework (MCAF). Before changing behavior, read [Architecture](docs/Architecture.md), the [PackageUpdates feature contract](docs/Features/PackageUpdates.md), and [ADR-0002](docs/ADR/ADR-0002-shared-dotnet-engine.md). English is used for code and documentation.

## Development

Install the .NET 10 SDK and Node.js 22 or later. Run `npm ci` for extension dependencies. Build and test the shared engine and CLI with `dotnet build NuGetPackageManager.slnx --configuration Release` and `dotnet test NuGetPackageManager.slnx --configuration Release`; run `npm run check`, `npm run test:host`, and `npm run format:check` for the extension. See [development setup](docs/Development/Setup.md) and [testing](docs/Testing/Testing.md).

The .NET `PackageUpdates` engine is the sole owner of parsing, version selection, listed-version lookup, family matching, and text patch validation. Do not recreate these rules in TypeScript. The VS Code host owns editor documents, trust, snapshots, native diffs, and applying reviewed edits. The CLI host owns terminal interaction and file I/O. Both hosts must offer the same family selection and review behavior.

Families match case-insensitively at an exact ID or dot boundary. Preserve the first-segment default and support narrower dotted prefixes. Keep unsupported declarations visible, feed errors explicit, and stale plans all-or-nothing. Preserve user formatting, BOM, line endings, conditional declarations, and unsaved editor buffers. Add focused regressions for behavior changes in the owning engine or host.

The browser preview uses a simulated bridge and sample data; it cannot prove engine, CLI, feed, or editor behavior. Use .NET and actual VS Code host tests. Report measured coverage and its scope; do not promise an unverified percentage. Never include credentials, private upstream code, or enterprise configuration.

## Pull requests

Describe the user-visible behavior and the evidence you ran. Include the relevant AC identifier from [the feature contract](docs/Features/PackageUpdates.md) when the change implements or alters an acceptance condition. Report failures and unverified areas directly.

## License

The extension and tool source are MIT licensed. Imported MCAF skills carry CC BY 4.0 and include their source attribution; retain that notice when modifying or redistributing them.
