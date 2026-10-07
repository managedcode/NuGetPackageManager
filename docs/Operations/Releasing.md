# Release operations

The intended release contains a VS Code `.vsix` and a `nuget-manager` global tool package. A tagged build or local package is not a completed release: verify the GitHub asset and the package's availability on the intended NuGet feed, then install the tool from that feed.

## Prepare

1. Update the VS Code extension version and .NET tool package version consistently, then add the release notes to `CHANGELOG.md`.
2. Run all checks in [Testing](../Testing/Testing.md), including the .NET Release build/tests, VS Code host tests, and VSIX packaging.
3. Merge reviewed changes to the main branch.
4. Push a tag matching the package version, such as `v0.1.0` for version `0.1.0`.

The release workflow checks .NET and extension builds/tests, formatting, host integration and packaging, and verifies that the tag matches both package versions. It creates the VSIX and NuGet package. NuGet publishing requires `NUGET_API_KEY` accessible to the `release` environment. If the key is absent or publication fails, the NuGet job fails clearly and the release is incomplete. GitHub still receives an explicitly marked preview release with both artifacts; a successful public-feed install promotes the release to normal status. Do not add the key to repository files, logs, or local documentation examples. After repairing a publication failure, rerun the failed workflow jobs; existing release assets and notes are updated by the workflow.

After the workflow succeeds, verify the `.vsix` is attached to the [GitHub Release](https://github.com/managedcode/NuGetPackageManager/releases). Confirm the package is listed on NuGet, then install it from the intended feed:

```sh
dotnet tool install --global nuget-manager
```

Run `nuget-manager --help` and a read-only check against a controlled workspace to confirm the published tool executes. Record the release tag, workflow run, GitHub VSIX asset, and NuGet package version in release evidence. No Marketplace publication is configured or implied.

## Rollback

Use GitHub release controls to stop distributing a faulty VSIX and publish a corrected version through a new tag. Follow NuGet's package deprecation/unlisting process if a published tool package is defective; package versions cannot be overwritten. Users can uninstall either delivery. Applied declaration edits are ordinary workspace changes and can be undone in VS Code or reverted through source control. There is no remote application state or migration.
