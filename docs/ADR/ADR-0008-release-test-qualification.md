# ADR-0008: Shared release qualification and reliable editor setup

Status: accepted and implemented. Date: 2026-10-08.

## Context and decision

REQ-017 / AC-021 requires every publication route to depend on successful code, rendered UI and actual editor tests. CI run 37794763453 failed before editor tests: resolving the pinned VS Code version timed out. Upstream retries archive download, but not the preceding version lookup. Release 0.1.6 had passed its tests; the later documentation commit was incorrectly reported complete before its own CI result.

CI and Release will call one reusable three-platform verification workflow. Linux renders the production UI in both themes across seven viewports; every OS runs engine, Node and real VS Code host checks. Release publication consumes packages from this successful matrix. A verification-only dispatch exercises the current Release workflow without version changes or upload.

Editor download is a separate setup operation with at most three attempts for transient transport failures and bounded backoff. A permanent error fails immediately. Host tests execute once after setup, outside the retry. Cache only the pinned editor by OS, architecture and version; the existing downloader validates complete installations.

Manual Marketplace recovery must find successful Release verification for the exact immutable tag commit and compare the public VSIX bytes with that run's retained package artifact. Automatic Marketplace uses the producing Release run. A public release and matching manifest alone are insufficient proof of tests. The historical single-platform Release qualification is allowed only for existing v0.1.6 at commit 77693eb; new releases require the complete three-OS matrix. Missing/expired qualification artifacts block recovery explicitly; do not silently rebuild or publish an unqualified file.

Alternatives: rerunning the entire host suite would hide assertion failures; ignoring setup errors would publish without tests; maintaining two copies of verification lets gates drift. Rejected all three. Shared verification adds macOS/Windows testing to manually dispatched releases. Qualified artifact comparison adds an Actions-artifact retention dependency to manual recovery, without feed/gallery indexing checks.

## Ordered plan and ownership

TASK-048 independent worker reads workflows/downloader and reviews the final diff; writes none. TASK-049 lead owns setup helper, focused transport regressions, shared workflows, qualification helper/tests and documentation. Dependencies: read current failure log first, define REQ-017/AC-021 and this decision, then implement. Native collaboration joins the read-only review before commit.

Verification: formatting and syntax checks locally; all automated tests run in CI only. Focused setup tests cover transport recovery, nested network errors, exhaustion, permanent errors and explicit executable overrides. Qualification tests reject failed/skipped checks, wrong commits and changed VSIX bytes. Follow the pushed commit's entire three-OS CI, then dispatch Release verification-only at that same commit and follow it to success. No new version, no moved tags, no publication of 0.1.6 from changed source. Rollback reverts this scoped infrastructure change; never bypass failed tests.

## Evidence

Failure diagnosis: [CI 37794763453](https://github.com/managedcode/NuGetPackageManager/actions/runs/37794763453) failed on editor setup `AggregateError [ETIMEDOUT]`, before assertions. Its engine, Node and 16 rendered browser cases passed. [Release 37794021241](https://github.com/managedcode/NuGetPackageManager/actions/runs/37794021241) ran all configured code/UI/editor checks successfully before publishing 0.1.6. Repair commit d5f74fd passed [Release verification-only on all three platforms](https://github.com/managedcode/NuGetPackageManager/actions/runs/37799310309): 36 release/setup/qualification cases, 69 Node cases, .NET regressions, 16 rendered browser cases and actual VS Code host flows. [Credential-free Marketplace qualification](https://github.com/managedcode/NuGetPackageManager/actions/runs/37799315964) matched the public 0.1.6 VSIX against the tested artifact from Release 37794021241. All publication steps were skipped in these verification-only runs. TASK-048 independent review completed after timeout-class and incomplete-matrix corrections. No version/tag changed. Main CI of the final pushed commit remains a separate required delivery gate, including documentation-only follow-up commits.
