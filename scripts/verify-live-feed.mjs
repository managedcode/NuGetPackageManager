import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [command, ...prefix] = process.argv.slice(2);
assert.ok(command, 'Provide the installed tool executable or dotnet and its DLL.');
const workspace = await mkdtemp(join(tmpdir(), 'nuget-manager-live-'));
const project = join(workspace, 'App.csproj');
const original =
  '<Project><ItemGroup><PackageReference Include="Microsoft.Orleans.Core" Version="8.0.0" /></ItemGroup></Project>\n';
try {
  await writeFile(project, original);
  const output = execFileSync(
    command,
    [...prefix, 'check', '--family', 'Microsoft.Orleans', '--path', workspace, '--json'],
    { encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
  );
  const result = JSON.parse(output);
  assert.deepEqual(result.failures, [], 'Live NuGet checks must have no feed failures.');
  assert.equal(result.updateCount, 1, 'The real feed must resolve the Orleans update.');
  assert.equal(await readFile(project, 'utf8'), original, 'Check must preserve the project.');
  console.log('Live NuGet family check passed; the project remains unchanged.');
} finally {
  await rm(workspace, { recursive: true, force: true });
}
