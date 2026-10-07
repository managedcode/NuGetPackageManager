import { build, context } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

await mkdir('dist', { recursive: true });
await mkdir('artifacts', { recursive: true });
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
  { stdio: 'inherit' },
);
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
};
if (process.argv.includes('--watch')) {
  const watcher = await context(options);
  await watcher.watch();
} else {
  await build(options);
}
