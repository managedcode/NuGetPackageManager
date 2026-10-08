# Testing

Install .NET 10 SDK and Node.js 22 or later, then restore dependencies:

```sh
dotnet restore NuGetPackageManager.slnx
npm ci
```

Run the shared-engine and CLI checks:

```sh
dotnet build NuGetPackageManager.slnx --configuration Release
dotnet test NuGetPackageManager.slnx --configuration Release
```

Then run extension checks:

```sh
npm run typecheck
npm test
npm run build
npm run test:host
npm run format:check
npm run package
```

`npm run check` combines TypeScript checking, engine publication, bridge tests, .NET tests and both format checks. `npm run coverage` measures only the TypeScript subprocess adapter; it does not measure .NET algorithms, the VS Code host or webview rendering.

Exercise the shared engine for declaration parsing, NuGet version precedence, listed feed metadata, family boundary matching, and exact text changes. Test family prefixes with exact IDs, descendants, case differences, and neighboring names such as `Microsoft.OrleansExtra`. CLI tests should cover read-only check, interactive update, dry-run, JSON, noninteractive mode, source errors, and stale snapshots.

The NuGet feed regression test must exercise compressed HTTP responses from a real local V3 test feed, including decoding before JSON parsing and enforcing decoded-size limits. A successful local feed test does not replace the release smoke check: install the candidate tool from the public NuGet feed and run a read-only check against a real package family such as `Microsoft.Orleans`.

VS Code host integration tests exercise discovery, JSON bridge behavior, review, trust, snapshots, and editor operations. Tests cover automatic checks, cache reuse versus explicit refetch, failed feed checks never cached, and the Activity Bar badge. Verify that dirty buffers remain unsaved and clean files are saved. CI runs on Linux, macOS, and Windows with the minimum supported VS Code 1.100.0; Linux host tests use Xvfb. Set `VSCODE_TEST_VERSION=stable` to test the latest editor, or `VSCODE_EXECUTABLE_PATH` to use an installed editor. Use the actual Extension Development Host for manual checks. The suite saves its generated temporary documents only after dirty-buffer assertions, to allow the isolated editor to shut down.

Node.js tests for the renderer model (`tests/Features/PackageUpdates/model.test.ts` and `groups.test.ts`) exercise family construction and dot boundaries, the groups-first and flat list views, stable groups under filters, tri-state selection, filter application and version diff calculation against the shipped `model.js`. Version cache tests (`tests/Features/PackageUpdates/versionCache.test.ts`) validate cache reuse windows and expiry. Both run with `npm test`.

`npm run preview` is an illustrative frontend preview with a simulated bridge and sample data. It emulates VS Code's injected webview defaults and theme tokens; pass query parameters to test layout and behavior: `theme=light-plus|light-modern|dark-modern|hc-black` for theme, `surface=sidebar|editor` for layout, and `scenario=checking|unchecked|untrusted|nofolder|empty` for state. The host is simulated and never reads or writes workspace files; it cannot establish that the shared engine, CLI, feeds, file writes, trust checks, or native diffs work. Restore and test a target .NET solution separately after package updates; neither host runs restore or solution compatibility tests for you.
