import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsRoot = path.join(root, 'tests');
const coverage = process.argv.slice(2).includes('--coverage');
const engineDll = path.join(root, 'dist/engine/ManagedCode.NuGet.Tool.dll');

if (!process.env.NUGET_MANAGER_ENGINE) {
  execFileSync(
    'dotnet',
    [
      'publish',
      'dotnet/ManagedCode.NuGet.Tool/ManagedCode.NuGet.Tool.csproj',
      '-c',
      'Release',
      '--no-self-contained',
      '-o',
      'dist/engine',
    ],
    { cwd: root, stdio: 'inherit' },
  );
}

async function findTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return findTests(file);
      if (entry.isFile() && entry.name.endsWith('.test.ts') && entry.name !== 'host.test.ts') return [file];
      return [];
    }),
  );
  return nested.flat();
}

const files = (await findTests(testsRoot)).sort();
if (!files.length) {
  console.error('No Node test files were found under tests/.');
  process.exitCode = 1;
} else {
  const args = ['--import', 'tsx', '--test'];
  if (coverage)
    args.push('--experimental-test-coverage', '--test-coverage-include=src/Features/PackageUpdates/Host/engine.ts');
  args.push(...files);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}
