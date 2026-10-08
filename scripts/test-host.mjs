import { build } from 'esbuild';
import { runTests } from '@vscode/test-electron';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'nuget-workbench-host-'));
const fixtureRoot = path.join(temporaryRoot, 'workspace');
const userData = path.join(temporaryRoot, 'user-data');
const extensions = path.join(temporaryRoot, 'extensions');
const testBundle = path.join(temporaryRoot, 'host-tests.cjs');
const manifest = JSON.parse(
  await (await import('node:fs/promises')).readFile(path.join(extensionRoot, 'package.json'), 'utf8'),
);
process.env.NUGET_WORKBENCH_EXTENSION_ID = `${manifest.publisher}.${manifest.name}`;
// A terminal inside VS Code exports this; it would make the launched editor run as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;

try {
  execFileSync(process.execPath, [path.join(extensionRoot, 'scripts/build.mjs')], {
    cwd: extensionRoot,
    stdio: 'inherit',
  });
  await Promise.all([mkdir(fixtureRoot), mkdir(userData), mkdir(extensions)]);
  await Promise.all([
    writeFile(
      path.join(fixtureRoot, 'Directory.Packages.props'),
      [
        '<Project>',
        '  <!-- preserve this comment -->',
        '  <ItemGroup>',
        '    <PackageVersion Include="Central.Package" Version="1.0.0" />',
        '    <PackageVersion Include="Ignored.Package" Version="$(SharedVersion)" />',
        '    <PackageVersion Include="Conditional.Package" Version="1.0.0" Condition="\'$(Configuration)\' == \'Debug\'" />',
        '  </ItemGroup>',
        '</Project>',
        '',
      ].join('\r\n'),
      'utf8',
    ),
    writeFile(
      path.join(fixtureRoot, 'App.csproj'),
      [
        '<Project Sdk="Microsoft.NET.Sdk">',
        '  <ItemGroup>',
        '    <PackageReference Include="Regular.Package" Version="1.0.0" />',
        '    <PackageReference Include="Child.Version.Package">',
        '      <Version Condition="Debug">1.0.0</Version>',
        '      <Version Condition="Release">1.0.0</Version>',
        '    </PackageReference>',
        '    <PackageReference Include="Policy.Package" Version="1.0.0" />',
        '    <PackageReference Include="Microsoft.Orleans.Core" Version="1.0.0" />',
        '    <PackageReference Include="Microsoft.Orleans.Hosting" Version="1.0.0" />',
        // Applied by the automatic-check host scenarios: Automatic (saved Apply), Buffered (Apply into an unsaved buffer)
        // and Manual (Apply with autoCheck disabled). The feed answers HTTP 500 for Failing.Package's registration.
        '    <PackageReference Include="Automatic.Package" Version="1.0.0" />',
        '    <PackageReference Include="Buffered.Package" Version="1.0.0" />',
        '    <PackageReference Include="Manual.Package" Version="1.0.0" />',
        '    <PackageReference Include="Failing.Package" Version="1.0.0" />',
        '  </ItemGroup>',
        '</Project>',
        '',
      ].join('\r\n'),
      'utf8',
    ),
    writeFile(
      path.join(fixtureRoot, 'SdkApp.csproj'),
      [
        '<Project>',
        '  <!-- SDK and package versions are independently resolved -->',
        '  <Sdk Name="Microsoft.NET.Sdk" />',
        '  <Sdk Name="Aspire.AppHost.Sdk" Version="13.6.0" />',
        '  <ItemGroup>',
        '    <PackageReference Include="Aspire.Hosting" Version="13.6.0" />',
        '    <PackageReference Include="AspireExtra" Version="13.6.0" />',
        '  </ItemGroup>',
        '</Project>',
        '',
      ].join('\r\n'),
      'utf8',
    ),
    writeFile(
      path.join(fixtureRoot, 'Malformed.csproj'),
      '<Project><PackageReference Include="Broken" Version="1.0.0"></Project>',
      'utf8',
    ),
  ]);
  await build({
    entryPoints: [path.join(extensionRoot, 'tests/Features/PackageUpdates/host.test.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['vscode'],
    outfile: testBundle,
  });

  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
    version: process.env.VSCODE_TEST_VERSION ?? '1.100.0',
    extensionDevelopmentPath: extensionRoot,
    extensionTestsPath: testBundle,
    launchArgs: [
      fixtureRoot,
      '--no-sandbox',
      '--disable-gpu',
      `--user-data-dir=${userData}`,
      `--extensions-dir=${extensions}`,
    ],
  });
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
