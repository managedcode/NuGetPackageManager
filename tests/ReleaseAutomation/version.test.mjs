import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bumpReleaseVersion, checkReleaseVersion } from '../../scripts/release-version.mjs';

const initialVersion = '1.2.3';

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-version-'));
  await mkdir(path.join(root, 'dotnet/ManagedCode.NuGet.Tool'), { recursive: true });
  await writeFile(
    path.join(root, 'package.json'),
    `{
  "name": "fixture-extension",
  "version": "${initialVersion}",
  "description": "keep this formatting"
}\n`,
  );
  await writeFile(
    path.join(root, 'package-lock.json'),
    `{
  "name": "fixture-extension",
  "version": "${initialVersion}",
  "lockfileVersion": 3,
  "packages": {
    "": {
      "name": "fixture-extension",
      "version": "${initialVersion}"
    },
    "node_modules/unchanged": {
      "version": "9.8.7"
    }
  }
}\n`,
  );
  await writeFile(
    path.join(root, 'dotnet/ManagedCode.NuGet.Tool/ManagedCode.NuGet.Tool.csproj'),
    `<Project>\r\n  <PropertyGroup>\r\n    <Version> ${initialVersion} </Version>\r\n    <Description>keep this text</Description>\r\n  </PropertyGroup>\r\n</Project>\r\n`,
  );
  return root;
}

async function snapshot(root) {
  const names = ['package.json', 'package-lock.json', 'dotnet/ManagedCode.NuGet.Tool/ManagedCode.NuGet.Tool.csproj'];
  return Promise.all(names.map((name) => readFile(path.join(root, name), 'utf8')));
}

async function withFixture(run) {
  const root = await createFixture();
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('check returns the canonical version without modifying any files', async () => {
  await withFixture(async (root) => {
    const before = await snapshot(root);
    assert.equal(await checkReleaseVersion({ root }), initialVersion);
    assert.deepEqual(await snapshot(root), before);
  });
});

for (const [request, expected] of [
  ['patch', '1.2.4'],
  ['minor', '1.3.0'],
  ['major', '2.0.0'],
  ['7.8.9', '7.8.9'],
]) {
  test(`${request} updates all version metadata and preserves surrounding file contents`, async () => {
    await withFixture(async (root) => {
      assert.equal(await bumpReleaseVersion(request, { root }), expected);
      const [manifestText, lockText, projectText] = await snapshot(root);
      assert.equal(JSON.parse(manifestText).version, expected);
      const lock = JSON.parse(lockText);
      assert.equal(lock.version, expected);
      assert.equal(lock.packages[''].version, expected);
      assert.equal(lock.packages['node_modules/unchanged'].version, '9.8.7');
      assert.match(manifestText, /"description": "keep this formatting"\n\}\n$/);
      assert.match(lockText, /"version": "9\.8\.7"/);
      assert.equal(
        projectText,
        `<Project>\r\n  <PropertyGroup>\r\n    <Version> ${expected} </Version>\r\n    <Description>keep this text</Description>\r\n  </PropertyGroup>\r\n</Project>\r\n`,
      );
    });
  });
}

test('existing version drift is rejected before any file is written', async () => {
  await withFixture(async (root) => {
    const lockPath = path.join(root, 'package-lock.json');
    const lock = (await readFile(lockPath, 'utf8')).replace('"version": "1.2.3"', '"version": "1.2.2"');
    await writeFile(lockPath, lock);
    const before = await snapshot(root);
    await assert.rejects(bumpReleaseVersion('patch', { root }), /Version drift detected/);
    assert.deepEqual(await snapshot(root), before);
  });
});

for (const request of ['1.2.3', '1.2.2', '1.2.4-preview.1', '01.2.4', '1.2', 'next']) {
  test(`invalid, unchanged, or downgraded request ${request} is rejected without writes`, async () => {
    await withFixture(async (root) => {
      const before = await snapshot(root);
      await assert.rejects(bumpReleaseVersion(request, { root }));
      assert.deepEqual(await snapshot(root), before);
    });
  });
}

test('a competing invocation lock is preserved and prevents writes', async () => {
  await withFixture(async (root) => {
    const lockPath = path.join(root, '.release-version.lock');
    await writeFile(lockPath, 'another process\n');
    const before = await snapshot(root);
    await assert.rejects(bumpReleaseVersion('patch', { root }));
    assert.deepEqual(await snapshot(root), before);
    assert.equal(await readFile(lockPath, 'utf8'), 'another process\n');
  });
});

test('malformed project metadata is rejected before any file is written', async () => {
  await withFixture(async (root) => {
    const projectPath = path.join(root, 'dotnet/ManagedCode.NuGet.Tool/ManagedCode.NuGet.Tool.csproj');
    await writeFile(projectPath, '<Project><PropertyGroup><Version>1.2.3-beta</Version></PropertyGroup></Project>');
    const before = await snapshot(root);
    await assert.rejects(bumpReleaseVersion('patch', { root }), /stable major\.minor\.patch/);
    assert.deepEqual(await snapshot(root), before);
  });
});
