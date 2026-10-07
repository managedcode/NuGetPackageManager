import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EngineClient } from '../../../src/Features/PackageUpdates/Host/engine';

const engine = new EngineClient();

test('shared engine uses NuGet numeric version ordering and normalization', async () => {
  assert.equal((await engine.resolve('1', ['1.0.0.0'], 'latest', false)).target, undefined);
  assert.equal((await engine.resolve('1.2.3', ['2.9.9', '2.10.0'], 'latest', false)).target, '2.10.0');
  assert.equal((await engine.resolve('1.2.3.4', ['1.2.3'], 'latest', false)).target, undefined);
});

test('shared engine preserves prerelease precedence and stable promotion', async () => {
  const ordered = ['1.0-alpha', '1.0-alpha.2', '1.0-alpha.10', '1.0-beta', '1.0-rc.1', '1.0'];
  for (let index = 0; index < ordered.length - 1; index++) {
    const result = await engine.resolve(ordered[index], [ordered[index + 1]], 'latest', true);
    assert.equal(result.target, ordered[index + 1]);
  }
  assert.equal((await engine.resolve('1.0-RC.1', ['1.0-rc.1'], 'latest', true)).target, undefined);
  assert.equal((await engine.resolve('1.0-a', ['1.0-2'], 'latest', true)).target, undefined);
});

test('shared engine applies patch, minor, latest and prerelease policies', async () => {
  const versions = ['1.2.3', '1.2.4', '1.3.0', '2.0.0', '3.0.0-preview.1'];
  const patch = await engine.resolve('1.2.3', versions, 'patch', false);
  assert.equal(patch.target, '1.2.4');
  assert.deepEqual(patch.versions, ['1.2.4']);
  assert.equal((await engine.resolve('1.2.3', versions, 'minor', false)).target, '1.3.0');
  assert.equal((await engine.resolve('1.2.3', versions, 'latest', false)).target, '2.0.0');
  assert.equal((await engine.resolve('1.2.3', versions, 'latest', true)).target, '3.0.0-preview.1');
  assert.equal((await engine.resolve('3.0.0', versions, 'latest', true)).target, undefined);
});

test('shared engine classifies major, minor, patch, revision and prerelease promotion', async () => {
  assert.equal((await engine.resolve('1.2.3', ['2.0.0'], 'latest', false)).updateKind, 'major');
  assert.equal((await engine.resolve('1.2.3', ['1.3.0'], 'latest', false)).updateKind, 'minor');
  assert.equal((await engine.resolve('1.2.3', ['1.2.4'], 'latest', false)).updateKind, 'patch');
  assert.equal((await engine.resolve('1.2.3', ['1.2.3.1'], 'latest', false)).updateKind, 'revision');
  assert.equal((await engine.resolve('1.2.3-rc.1', ['1.2.3'], 'latest', false)).updateKind, 'prerelease');
});

test('unsupported version expressions cannot become eligible targets', async () => {
  for (const value of ['1.*', '[1,2)', '$(Version)', '1.2.3.4.5', '1.0-', '2147483648.0']) {
    const result = await engine.resolve('1.0.0', [value], 'latest', true);
    assert.equal(result.target, undefined, `${value} must not be recommended`);
    assert.deepEqual(result.versions, []);
  }
});
