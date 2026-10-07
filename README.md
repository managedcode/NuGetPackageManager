# NuGet Package Manager

Review NuGet updates across a .NET workspace before changing declarations. Select a package family, inspect every proposed version, and review the complete change set before applying it. The same .NET 10 engine powers the VS Code workbench and the `nuget-manager` command-line tool.

![NuGet Package Manager workbench](https://raw.githubusercontent.com/managedcode/NuGetPackageManager/main/media/screenshots/workbench.png)

## VS Code

Open **NuGet: Open Package Workbench** from the Command Palette, or use the context menu on a `Directory.Packages.props`, `.csproj`, `.fsproj`, or `.vbproj` file. Discover literal versions in central `PackageVersion` and project `PackageReference` entries, check available feed versions, then select updates by package, file, or family.

Families use the first package ID segment by default. You can select a narrower dotted prefix, such as `Microsoft.Orleans`; matching includes that exact ID and its dot-delimited descendants, not similarly named IDs such as `Microsoft.OrleansExtra`. Selected updates share one review with exact target versions and native VS Code diffs.

Choose the `latest`, `minor`, or `patch` policy. Stable releases are the default; prereleases are optional. Updates require a trusted workspace. The extension applies version text through VS Code documents, preserving surrounding formatting. Files that were clean are saved; files that already had unsaved edits remain unsaved. A changed document invalidates the full review before edits are applied. Changing a central version affects all projects that consume it.

Install a released `.vsix` from [GitHub Releases](https://github.com/managedcode/NuGetPackageManager/releases) using **Extensions → … → Install from VSIX…**. Release notes distinguish preview artifacts from verified public NuGet publication.

The extension supports VS Code 1.100 or later and requires the .NET 10 runtime to run its bundled engine. Install the runtime using Microsoft's [.NET download instructions](https://dotnet.microsoft.com/download/dotnet/10.0). No Node.js installation is needed to use the extension.

## Command-line tool

The tool package and command are named `nuget-manager`. Install a public release with:

```sh
dotnet tool install --global nuget-manager
```

Review and update the entire Orleans family in one operation:

```sh
nuget-manager update --family Microsoft.Orleans
```

Use `--family Microsoft` for the full first-segment family. Add `--dry-run` to inspect proposed changes without writing files.

The CLI and extension share the same parsing, NuGet version, feed listing, family matching, and edit engine. The CLI reviews proposed file changes before writing; use its dry-run/JSON options for automation and its confirmation option only when you intend to apply the reviewed updates. See [CLI usage](docs/Development/Setup.md#command-line-tool) for the agreed command syntax.

## Supported scope and limits

- Central Package Management in `Directory.Packages.props` and literal `PackageReference` versions in `.csproj`, `.fsproj`, and `.vbproj` files.
- First-segment package families and narrower dot-boundary prefixes, with bulk selection and review in both hosts.
- Listed versions discovered through configured NuGet V3 feeds. Stable versions are the default; prereleases can be included.
- Exact literal version edits with snapshot validation. Conditional declarations remain independently selectable.

Property expressions, ranges, wildcards, and other unsupported versions are visible for manual handling. The tool does not add or remove package references, resolve the .NET dependency graph, automatically restore projects, apply `NuGet.config` source mapping, or authenticate to private feeds. A failure from a configured source remains an error and cannot be represented as a complete successful check. Do not put credentials in source settings.

## Development and project

The project follows the [Managed Code Coding AI Framework (MCAF)](https://mcaf.managed-code.com/tutorial). See [development setup](docs/Development/Setup.md), [testing](docs/Testing/Testing.md), and [release operations](docs/Operations/Releasing.md). Public .NET skills are available in [ManagedCode dotnet-skills](https://github.com/managedcode/dotnet-skills). The extension and tool source are MIT licensed; imported MCAF skills carry CC BY 4.0 attribution in [.codex/skills/MCAF-SOURCE.md](.codex/skills/MCAF-SOURCE.md).
