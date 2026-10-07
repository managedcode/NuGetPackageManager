# Release operations

The release flow versions the VS Code extension and `nuget-manager` tool together, verifies a successful main-branch build, publishes a version-tagged GitHub release, and can then publish the exact released VSIX to the VS Code Marketplace. NuGet and GitHub release success do not imply Marketplace publication. The technical extension name is `managedcode-nuget-package-manager`, its VS Code ID is `managedcode.managedcode-nuget-package-manager`, and its display name is **NuGet Package Manager by ManagedCode**. Marketplace publication is pending the publisher account connection; the publishing job currently has no authentication configuration. Automatic publication, including the first publication, can be enabled after the publisher identity is connected and verified once.

## Version and GitHub release

Version changes are explicit release decisions made by a human. Do not bump versions for ordinary commits or badge, workflow, and configuration changes. The current published version remains 0.1.1. Use the helper only after a release owner chooses a new version, to update the extension manifest, root lockfile metadata, and .NET tool project together:

```sh
npm run version:bump -- patch
```

Run a bump only as part of an explicitly chosen release. The other supported arguments are `minor`, `major`, or the exact stable version selected by the human release owner. Review and commit `package.json`, `package-lock.json`, and `dotnet/ManagedCode.NuGet.Tool/ManagedCode.NuGet.Tool.csproj` together with the release changes. Do not edit or move an existing release tag.

The main three-OS CI preserves historical tags and skips release creation when the current version already has a tag. After a human-approved new version reaches `main`, CI verifies it and creates the matching immutable `vX.Y.Z` tag. A tag push made with `GITHUB_TOKEN` does not trigger another `push` workflow, so CI explicitly dispatches the `Release` workflow at that tag. Release can also be dispatched manually for recovery, using the existing tag rather than rebuilding from `main`.

Release builds and validates the version-matched VSIX and NuGet tool package, then runs the public NuGet installation and live-feed checks. If publishing or verification fails, the GitHub release remains marked preview/pending; fix the cause and rerun the failed workflow jobs. Do not describe the version as delivered until the VSIX is attached and a fresh public NuGet install plus live feed check succeeds.

### Current 0.1.1 extension identity repair

Both the technical name `nuget-package-manager` and the display name `NuGet Package Manager` were taken on Marketplace. The initial unpublished extension now uses `managedcode-nuget-package-manager` and **NuGet Package Manager by ManagedCode** at unchanged version 0.1.1. The [VSIX](https://github.com/managedcode/NuGetPackageManager/releases/download/v0.1.1/managedcode-nuget-package-manager-0.1.1.vsix) must be qualified by the complete three-OS CI and its producing commit/hash recorded in the release notes before replacing the rejected initial artifact. Inspect both `extension/package.json` and `extension.vsixmanifest` for the branded display name. Preserve the existing `v0.1.1` tag and `nuget-manager` CLI package; do not create a new version or tag for this repair.

[Marketplace run 37675793048](https://github.com/managedcode/NuGetPackageManager/actions/runs/37675793048) failed at **Require publisher authentication** before any upload. Neither `MARKETPLACE_AZURE_CLIENT_ID`/`MARKETPLACE_AZURE_TENANT_ID` nor `VSCE_PAT` was available to the job. Complete one authentication path below, then run **Marketplace** from GitHub Actions with `release_tag=v0.1.1` at `main`. Enable `MARKETPLACE_PUBLISH=true` after verifying publication for future explicitly chosen releases. No Marketplace listing or publication is claimed yet.

## Marketplace publishing

The reusable/manual workflow is `.github/workflows/marketplace.yml`. It takes a `release_tag`, downloads the VSIX from that exact public GitHub release, checks the embedded publisher, extension ID, and version, and publishes that verified file. The current identity-repair artifact is `managedcode-nuget-package-manager-0.1.1.vsix`. For future human-approved versions, the filename follows `managedcode-nuget-package-manager-X.Y.Z.vsix`. It must not rebuild a different VSIX. The workflow status badge in the README reports automation status only; it does not assert that a Marketplace listing exists.

Automatic publishing is opt-in. Set the repository variable `MARKETPLACE_PUBLISH=true` after the publisher identity has been connected once and the workflow configuration is ready. This supports automatic publication on the first listing as well as later releases. Without it, the release is not automatically published to the Marketplace. A manual `workflow_dispatch` with `release_tag` remains available for explicit publication and recovery.

### Preferred authentication: Microsoft Entra workload identity

Configure an Entra application/service principal and GitHub Actions OIDC federation for the protected `marketplace` environment:

- Repository variables: `MARKETPLACE_AZURE_CLIENT_ID` and `MARKETPLACE_AZURE_TENANT_ID`.
- Federated credential issuer: `https://token.actions.githubusercontent.com`.
- Audience: `api://AzureADTokenExchange`.
- Subject: `repo:managedcode/NuGetPackageManager:environment:marketplace`.
- Add the identity as a Contributor to the `managedcode` publisher in the Visual Studio Marketplace management portal. Use the identity's Azure DevOps profile identity ID for the publisher permission; this is different from the Entra application/client ID.

The workflow uses the official [`azure/login` action](https://github.com/Azure/login/releases/tag/v3.1.0), pinned to v3.1.0, with OIDC. Follow Microsoft's [VS Code extension publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) for publisher management. Never put credentials in source, artifacts, or logs. A missing or invalid identity must make an explicitly requested publish fail clearly; it must never count as a successful Marketplace release.

### Transitional PAT authentication

If workload identity is not yet available, a `VSCE_PAT` with the Marketplace **Manage** permission can be used as a protected secret for the `marketplace` environment. Prefer OIDC for new setup. Microsoft retires existing global Azure DevOps PATs on December 1, 2026 ([official retirement notice](https://learn.microsoft.com/en-us/azure/devops/release-notes/2026/general/sprint-270-update)); plan to move off PAT-based publishing before that date. Do not request or paste tokens into chat or repository files.

### Optional manual first publication

If preferred, the first release can instead be published through the Visual Studio Marketplace management UI: choose **New extension → Visual Studio Code** and upload the already verified VSIX from the GitHub release. This is optional; once the publisher identity is connected, the Marketplace workflow can create the first listing automatically. Confirm the publisher, extension ID, and version in the gallery before claiming publication. No Marketplace listing or publication is claimed until that verification is complete.

## Rollback

Disable automatic publication by setting `MARKETPLACE_PUBLISH` to `false` or removing it. Existing versions and tags remain immutable; corrections use a new version. Use GitHub release controls to stop distributing a faulty VSIX, and follow NuGet's package deprecation/unlisting process for a defective tool package. Marketplace versions cannot be overwritten; follow Marketplace unpublish/deprecation controls and publish a corrected version. Users can uninstall either delivery. Package updates already applied to a workspace can be undone in VS Code or reverted through source control.
