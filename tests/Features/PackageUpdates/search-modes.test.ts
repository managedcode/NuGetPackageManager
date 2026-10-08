import assert from 'node:assert/strict';
import { test } from 'node:test';

const model = require('../../../media/Features/PackageUpdates/model.js') as {
  searchModes: Record<string, { label: string; policy: string; prerelease: boolean; description: string }>;
  searchMode(policy: string, prerelease: boolean): string;
};

// REQ-014 / AC-018: search choices have explicit numeric scopes, with stable as the default.
test('search presets map to engine policies and retain prerelease refinements', () => {
  const expected = [
    ['all', 'latest', true],
    ['stable', 'latest', false],
    ['minor', 'minor', false],
    ['patch', 'patch', false],
  ] as const;
  for (const [id, policy, prerelease] of expected) {
    assert.equal(model.searchModes[id].policy, policy);
    assert.equal(model.searchModes[id].prerelease, prerelease);
    assert.equal(model.searchMode(policy, prerelease), id);
  }
  assert.equal(model.searchMode('minor', true), 'minor');
  assert.equal(model.searchMode('patch', true), 'patch');
});
