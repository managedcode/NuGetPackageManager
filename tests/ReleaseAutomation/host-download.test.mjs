import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHostExecutable } from '../../scripts/host-download.mjs';

const networkError = (code) => Object.assign(new Error(code), { code });

async function attemptDownload(failures, extra = {}) {
  const calls = [];
  const waits = [];
  const warnings = [];
  const result = resolveHostExecutable({
    version: '1.100.0',
    download: async (options) => {
      calls.push(options);
      const failure = failures[calls.length - 1];
      if (failure) throw failure;
      return '/pinned/editor';
    },
    wait: async (delay) => waits.push(delay),
    warn: (...args) => warnings.push(args),
    ...extra,
  });
  return { result, calls, waits, warnings };
}

test('version lookup transport timeout recovers before launching the editor', async () => {
  const setup = await attemptDownload([networkError('ETIMEDOUT')]);
  assert.equal(await setup.result, '/pinned/editor');
  assert.deepEqual(setup.calls, Array(2).fill({ version: '1.100.0', timeout: 60_000 }));
  assert.deepEqual(setup.waits, [2_000]);
  assert.equal(setup.warnings.length, 1);
});

test('SDK idle timeout is retried only during setup', async () => {
  // The SDK subclass keeps Error.name unchanged; use its real constructor shape.
  class TimeoutError extends Error {}
  const failure = new TimeoutError('@vscode/test-electron request timeout out after 60000ms');
  assert.equal(failure.name, 'Error');
  const setup = await attemptDownload([failure]);
  assert.equal(await setup.result, '/pinned/editor');
  assert.equal(setup.calls.length, 2);
});

test('nested dual-stack connection failure is retried', async () => {
  const setup = await attemptDownload([
    new AggregateError([networkError('ETIMEDOUT'), networkError('ENETUNREACH')]),
    new Error('request failed', { cause: networkError('ECONNRESET') }),
  ]);
  assert.equal(await setup.result, '/pinned/editor');
  assert.equal(setup.calls.length, 3);
  assert.deepEqual(setup.waits, [2_000, 4_000]);
});

test('exhausted transport attempts fail with the original setup error', async () => {
  const failure = networkError('EAI_AGAIN');
  const setup = await attemptDownload(Array(3).fill(failure));
  await assert.rejects(setup.result, (error) => error === failure);
  assert.equal(setup.calls.length, 3);
  assert.deepEqual(setup.waits, [2_000, 4_000]);
});

for (const failure of [
  new Error('Invalid version'),
  networkError('EACCES'),
  new AggregateError([networkError('ETIMEDOUT'), new Error('archive checksum mismatch')]),
]) {
  test(`permanent setup error is never retried: ${failure.message}`, async () => {
    const setup = await attemptDownload([failure]);
    await assert.rejects(setup.result, (error) => error === failure);
    assert.equal(setup.calls.length, 1);
    assert.deepEqual(setup.waits, []);
  });
}

test('explicit editor executable bypasses network setup', async () => {
  const setup = await attemptDownload([new Error('must not download')], { executablePath: '/provided/editor' });
  assert.equal(await setup.result, '/provided/editor');
  assert.deepEqual(setup.calls, []);
});
