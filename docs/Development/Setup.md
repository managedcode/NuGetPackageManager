# Development setup

## Requirements

- .NET 10 SDK to build and test the shared engine and CLI.
- .NET 10 runtime to use the VS Code extension or global tool.
- Node.js 22 or later and npm to build, test, and package the VS Code extension.
- VS Code 1.100 or later for extension development and host integration.

## Restore and build

From the repository root:

```sh
dotnet restore NuGetPackageManager.slnx
dotnet build NuGetPackageManager.slnx --configuration Release
dotnet test NuGetPackageManager.slnx --configuration Release
npm ci
npm run check
```

Open the repository in VS Code and press F5 to launch the Extension Development Host. Open **NuGet: Open Package Workbench** against a file-backed workspace. The VS Code host invokes the bundled .NET tool assembly using a JSON bridge; it does not install packages or restore the target solution during activation. Install the .NET 10 runtime on the extension host machine and use the actionable startup error if it cannot be found.

## Command-line tool

After the NuGet package is published, install the global tool with:

```sh
dotnet tool install --global nuget-manager
```

Use `nuget-manager check` for a read-only scan and feed check. Use `nuget-manager update` to review and update packages interactively. Family selection is available in either command. For example:

```sh
nuget-manager update --family Microsoft.Orleans --policy minor
```

The supported options are:

| Option                                             | Purpose                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `--family <prefix>`                                | Select a first-segment family or narrower dotted package ID prefix                            |
| `--policy <value>` (`latest`, `minor`, or `patch`) | Select any newer version, remain within the current major, or remain within the current minor |
| `--prerelease`                                     | Include prerelease versions                                                                   |
| `--source <NuGet V3 index>`                        | Add a NuGet V3 source for the version check                                                   |
| `--path <workspace>`                               | Select the workspace path                                                                     |
| `--dry-run`                                        | Review proposed edits without writing files                                                   |
| `--json`                                           | Emit machine-readable output                                                                  |
| `--yes`                                            | Apply selected updates in noninteractive mode; use only when you intend to write files        |

See `nuget-manager --help` for the installed tool's current usage. Package publication is pending; a local build or packed tool does not make this global install available from NuGet.

## UI preview and npm scripts

For the standalone UI preview, run `npm run preview` and open the local URL printed in the terminal. Its bridge is simulated and does not read or write workspace files; it is for illustrative layout inspection only.

| Command                | Purpose                                    |
| ---------------------- | ------------------------------------------ |
| `npm run typecheck`    | TypeScript analysis without emitting files |
| `npm test`             | Extension core tests                       |
| `npm run test:host`    | VS Code extension-host integration tests   |
| `npm run check`        | Type check, core tests, and build          |
| `npm run format`       | Format repository files                    |
| `npm run format:check` | Check formatting without edits             |
| `npm run coverage`     | Measure extension core-test coverage       |
| `npm run package`      | Create a VSIX under `artifacts/`           |
| `npm run preview`      | Launch the illustrative browser UI preview |
