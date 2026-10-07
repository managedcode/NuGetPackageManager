# Release operations

The intended release contains a VS Code `.vsix` and a `nuget-manager` global tool package. A tagged build or local package is not a completed release: verify the GitHub asset and the package's availability on the intended NuGet feed, then install the tool from that feed.

## Prepare

1. Update the VS Code extension version and .NET tool package version consistently, then add the release notes to `CHANGELOG.md`.
2. Run all checks in [Testing](../Testing/Testing.md), including the .NET Release build/tests, VS Code host tests, and VSIX packaging.
3. Merge reviewed changes to the main branch.
4. Push a tag matching the package version, such as `v0.1.1` for version `0.1.1`.

The release workflow checks .NET and extension builds/tests, formatting, host integration and packaging, and verifies that the tag matches both package versions. It creates the VSIX and NuGet package. NuGet publishing requires `NUGET_API_KEY` accessible to the `release` environment. If the key is absent or publication fails, the NuGet job fails clearly and the release is incomplete. GitHub still receives an explicitly marked preview release with both artifacts; a successful public-feed install promotes the release to normal status. Do not add the key to repository files, logs, or local documentation examples. After repairing a publication failure, rerun the failed workflow jobs; existing release assets and notes are updated by the workflow.

## NuGet feed verification gate

Version 0.1.1 fixes a release-blocking defect where compressed NuGet V3 registration responses could reach JSON parsing without being decoded. A green local-feed regression test alone is insufficient: the candidate must be available from the public NuGet feed, install successfully as a complete tool package, and pass a real read-only feed check.

After publication, install the exact candidate version and check a package family against nuget.org:

```sh
dotnet tool install --global nuget-manager --version 0.1.1
nuget-manager check --family Microsoft.Orleans
```

NuGet may take time to index a newly published version. If installation reports that the version cannot be found while indexing is still in progress, wait and retry the entire `dotnet tool install` command; do not treat a partial or cached install as proof. Run the CLI check only after the full install succeeds. The check must fetch and parse live feed metadata successfully, not merely print help or report an empty result. If install or live check fails, leave the release marked preview/pending and continue diagnosis; do not announce 0.1.1 as delivered.

After the gate passes, verify the `.vsix` is attached to the [GitHub Release](https://github.com/managedcode/NuGetPackageManager/releases), confirm the NuGet package version, and record the release tag, workflow run, GitHub VSIX asset, install result, and live-feed check in release evidence. No Marketplace publication is configured or implied.

## Rollback

Use GitHub release controls to stop distributing a faulty VSIX and publish a corrected version through a new tag. Follow NuGet's package deprecation/unlisting process if a published tool package is defective; package versions cannot be overwritten. Users can uninstall either delivery. Applied declaration edits are ordinary workspace changes and can be undone in VS Code or reverted through source control. There is no remote application state or migration.
