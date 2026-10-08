import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMatchingVsix, hasSuccessfulQualification } from '../../scripts/qualified-release.mjs';

const tag = 'v0.1.6';
const commit = 'tested-commit';
const run = { head_sha: commit, head_branch: tag, path: '.github/workflows/release.yml' };
const checkNames = [
  'Engine regressions',
  'Release automation regressions',
  'Bridge and renderer model regressions',
  'Rendered responsive UI regressions',
  'VS Code host integration tests',
];
const job = (name, checks = checkNames) => ({
  name,
  status: 'completed',
  conclusion: 'success',
  steps: checks.map((name) => ({ name, status: 'completed', conclusion: 'success' })),
});

const matrix = () => [
  job('verify-and-package / verify (ubuntu-latest)'),
  job(
    'verify-and-package / verify (macos-latest)',
    checkNames.filter((name) => !name.includes('responsive')),
  ),
  job(
    'verify-and-package / verify (windows-latest)',
    checkNames.filter((name) => !name.includes('responsive')),
  ),
];

test('an incomplete modern OS matrix cannot qualify', () => {
  assert.equal(hasSuccessfulQualification(run, matrix().slice(0, 1), tag, commit), false);
  assert.equal(hasSuccessfulQualification(run, matrix().slice(0, 2), tag, commit), false);
});

test('exact tag qualification can be used before publisher jobs finish', () => {
  assert.equal(hasSuccessfulQualification({ ...run, status: 'in_progress' }, matrix(), tag, commit), true);
});

for (const conclusion of ['failure', 'skipped', 'cancelled']) {
  test(`any failed or skipped OS blocks qualification: ${conclusion}`, () => {
    const jobs = matrix();
    jobs[1].conclusion = conclusion;
    assert.equal(hasSuccessfulQualification(run, jobs, tag, commit), false);
  });
}

for (const required of checkNames) {
  test(`publication is blocked when the ${required} step did not pass`, () => {
    const jobs = matrix();
    for (const job of jobs) {
      const step = job.steps.find((step) => step.name === required);
      if (step) step.conclusion = 'skipped';
    }
    assert.equal(hasSuccessfulQualification(run, jobs, tag, commit), false);
  });
}

test('a skipped host check on one OS is rejected even when Linux passed', () => {
  const jobs = matrix();
  jobs[1].steps.find((step) => step.name === 'VS Code host integration tests').conclusion = 'skipped';
  assert.equal(hasSuccessfulQualification(run, jobs, tag, commit), false);
});

test('wrong commit, branch or producing workflow never qualifies', () => {
  for (const replacement of [
    { head_sha: 'untested-commit' },
    { head_branch: 'main' },
    { path: '.github/workflows/marketplace.yml' },
  ]) {
    assert.equal(hasSuccessfulQualification({ ...run, ...replacement }, matrix(), tag, commit), false);
  }
  assert.equal(hasSuccessfulQualification(run, [], tag, commit), false);
});

test('historical Release must still contain every code, UI and editor check', () => {
  const historical = job('verify-and-package', [
    'Run dotnet test NuGetPackageManager.slnx --configuration Release --no-restore',
    'Run npm run test:release',
    'Run npm test',
    'Rendered responsive UI regressions',
    'VS Code host integration tests',
  ]);
  const oldCommit = '77693ebf145ad22f3257d654e17b8d2b7d7538d6';
  const oldRun = { ...run, head_sha: oldCommit };
  assert.equal(hasSuccessfulQualification(oldRun, [historical], tag, oldCommit), true);
  assert.equal(hasSuccessfulQualification(run, [historical], tag, commit), false);
  assert.equal(
    hasSuccessfulQualification({ ...oldRun, head_branch: 'v0.1.7' }, [historical], 'v0.1.7', oldCommit),
    false,
  );
  historical.steps.pop();
  assert.equal(hasSuccessfulQualification(oldRun, [historical], tag, oldCommit), false);
});

test('Marketplace accepts only the exact bytes from the qualified artifact', () => {
  assert.doesNotThrow(() => assertMatchingVsix(Buffer.from('tested vsix'), Buffer.from('tested vsix')));
  assert.throws(() => assertMatchingVsix(Buffer.from('changed vsix'), Buffer.from('tested vsix')), /differs/);
});
