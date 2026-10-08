import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const matrixNames = ['ubuntu-latest', 'macos-latest', 'windows-latest'].map(
  (os) => `verify-and-package / verify (${os})`,
);

const requiredChecks = [
  ['Engine regressions', 'Run dotnet test NuGetPackageManager.slnx --configuration Release --no-restore'],
  ['Release automation regressions', 'Run npm run test:release'],
  ['Bridge and renderer model regressions', 'Run npm test'],
  ['Rendered responsive UI regressions'],
  ['VS Code host integration tests'],
];

export function hasSuccessfulQualification(run, jobs, tag, commit) {
  if (run.head_sha !== commit || run.head_branch !== tag || run.path?.split('@')[0] !== '.github/workflows/release.yml')
    return false;
  const verification = jobs.filter((job) => /^verify-and-package(?: \/ |$)/.test(job.name));
  if (!verification.length || verification.some((job) => job.status !== 'completed' || job.conclusion !== 'success'))
    return false;
  const historical =
    tag === 'v0.1.6' &&
    commit === '77693ebf145ad22f3257d654e17b8d2b7d7538d6' &&
    verification.length === 1 &&
    verification[0].name === 'verify-and-package';
  if (
    !historical &&
    (verification.length !== 3 || !matrixNames.every((name) => verification.some((job) => job.name === name)))
  )
    return false;
  const passed = (job, names) =>
    job.steps?.some(
      (step) => names.includes(step.name) && step.status === 'completed' && step.conclusion === 'success',
    );
  const perPlatform = requiredChecks.filter((names) => !names.includes('Rendered responsive UI regressions'));
  return (
    verification.every((job) => perPlatform.every((names) => passed(job, names))) &&
    verification.some((job) => passed(job, ['Rendered responsive UI regressions']))
  );
}

export function assertMatchingVsix(released, qualified) {
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  if (hash(released) !== hash(qualified)) throw new Error('Public VSIX differs from the tested Release artifact');
}

function api(endpoint) {
  return JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
}

function tagCommit(repo, tag) {
  let object = api(`repos/${repo}/git/ref/tags/${tag}`).object;
  for (let depth = 0; object.type === 'tag' && depth < 5; depth++) {
    object = api(`repos/${repo}/git/tags/${object.sha}`).object;
  }
  if (object.type !== 'commit') throw new Error('Release tag must resolve to an immutable commit');
  return object.sha;
}

async function verifyReleasedArtifact() {
  const {
    GITHUB_REPOSITORY: repo,
    RELEASE_TAG: tag,
    QUALIFICATION_RUN_ID: runId,
    RUNNER_TEMP: temporary,
  } = process.env;
  if (!repo || !temporary || !/^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(tag ?? ''))
    throw new Error('Repository, temporary directory and stable release tag are required');
  if (runId && !/^\d+$/.test(runId)) throw new Error('Qualification run ID must be numeric');
  const commit = tagCommit(repo, tag);
  const runs = runId
    ? [api(`repos/${repo}/actions/runs/${runId}`)]
    : api(`repos/${repo}/actions/workflows/release.yml/runs?head_sha=${commit}&per_page=100`).workflow_runs;
  for (const run of runs) {
    const jobs = api(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`).jobs;
    if (!hasSuccessfulQualification(run, jobs, tag, commit)) continue;
    const artifacts = api(`repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`).artifacts;
    if (!artifacts.some((artifact) => artifact.name === 'release-packages' && !artifact.expired)) continue;
    const destination = path.join(temporary, `qualified-release-${run.id}`);
    execFileSync(
      'gh',
      ['run', 'download', String(run.id), '--repo', repo, '--name', 'release-packages', '--dir', destination],
      {
        stdio: 'inherit',
      },
    );
    const name = `managedcode-nuget-package-manager-${tag.slice(1)}.vsix`;
    try {
      assertMatchingVsix(await readFile(path.join('artifacts', name)), await readFile(path.join(destination, name)));
    } catch (error) {
      if (runId) throw error;
      console.warn(`Release run ${run.id} does not contain the public VSIX; checking other qualified runs.`);
      continue;
    }
    console.log(`Verified ${tag} at ${commit} against successful Release tests and artifact from run ${run.id}.`);
    return;
  }
  throw new Error(
    `No successful code/UI/editor qualification with a retained matching artifact for ${tag} at ${commit}; publication is blocked`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await verifyReleasedArtifact();
}
