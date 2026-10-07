# Release automation brainstorm

The user requests useful GitHub badges, version-driven releases after a normal successful build, and automatic VS Code Marketplace publishing. Current 0.1.1 GitHub/NuGet delivery is verified, but tags are manual and Marketplace credentials are not connected.

Use stable package.json versions with one bump command that also updates the lockfile and .NET tool. After the existing three-platform CI passes on main, create an immutable matching vX.Y.Z tag and explicitly dispatch Release at that tag. GitHub suppresses workflow push events created with GITHUB_TOKEN, so tag push alone is insufficient. Keep manual tag/release recovery.

Publish the exact released VSIX through a reusable/manual Marketplace workflow. Prefer Entra ID/OIDC; support an existing VSCE_PAT as a transitional alternative. Automatic Marketplace publishing is enabled by MARKETPLACE_PUBLISH=true only after the publisher identity is connected. No credential values enter source or logs. Add real build/release/NuGet/license/runtime badges; do not invent coverage or claim a Marketplace listing exists.

Rejected: unrelated release frameworks, separate host versions, automatic versions on every commit, rebuilding a different VSIX during Marketplace publishing, and silently treating missing credentials as successful publication.
