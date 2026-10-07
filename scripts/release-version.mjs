import { chmod, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseStableVersion(value, label) {
  if (typeof value !== 'string' || !versionPattern.test(value)) {
    throw new Error(`${label} must be a stable major.minor.patch version; received ${JSON.stringify(value)}.`);
  }
  const parts = value.split('.').map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`${label} contains a version component larger than JavaScript can safely represent.`);
  }
  return parts;
}

function compareVersions(left, right) {
  const a = parseStableVersion(left, 'Version');
  const b = parseStableVersion(right, 'Version');
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function skipWhitespace(text, position) {
  while (position.index < text.length && /\s/.test(text[position.index])) position.index++;
}

function parseJsonString(text, position) {
  const start = position.index;
  position.index++;
  while (position.index < text.length) {
    const character = text[position.index++];
    if (character === '\\') position.index++;
    else if (character === '"') break;
  }
  const end = position.index;
  return { value: JSON.parse(text.slice(start, end)), start, end };
}

function findJsonStringToken(text, targetPath) {
  const position = { index: 0 };
  let result;

  function parseValue(currentPath) {
    skipWhitespace(text, position);
    const character = text[position.index];
    if (character === '"') {
      const token = parseJsonString(text, position);
      if (currentPath.length === targetPath.length && currentPath.every((part, index) => part === targetPath[index])) {
        result = token;
      }
      return;
    }
    if (character === '{') {
      position.index++;
      skipWhitespace(text, position);
      while (text[position.index] !== '}') {
        const key = parseJsonString(text, position).value;
        skipWhitespace(text, position);
        position.index++;
        parseValue([...currentPath, key]);
        skipWhitespace(text, position);
        if (text[position.index] === ',') {
          position.index++;
          skipWhitespace(text, position);
        } else break;
      }
      position.index++;
      return;
    }
    if (character === '[') {
      position.index++;
      skipWhitespace(text, position);
      let index = 0;
      while (text[position.index] !== ']') {
        parseValue([...currentPath, index++]);
        skipWhitespace(text, position);
        if (text[position.index] === ',') {
          position.index++;
          skipWhitespace(text, position);
        } else break;
      }
      position.index++;
      return;
    }
    while (position.index < text.length && !/[\s,}\]]/.test(text[position.index])) position.index++;
  }

  parseValue([]);
  return result;
}

function replaceJsonString(text, targetPath, current, next, label) {
  const token = findJsonStringToken(text, targetPath);
  if (!token || token.value !== current) throw new Error(`${label} version metadata is missing or malformed.`);
  return text.slice(0, token.start) + JSON.stringify(next) + text.slice(token.end);
}

function readToolVersion(text) {
  const matches = [...text.matchAll(/(<Version\b[^>]*>)([^<]*)(<\/Version\s*>)/g)];
  if (matches.length !== 1) throw new Error('The .NET tool project must contain exactly one literal <Version> value.');
  const match = matches[0];
  const current = match[2].trim();
  parseStableVersion(current, 'The .NET tool version');
  const leadingWhitespace = match[2].match(/^\s*/)?.[0] ?? '';
  const trailingWhitespace = match[2].match(/\s*$/)?.[0] ?? '';
  return {
    current,
    update(next) {
      const start = match.index + match[1].length;
      const end = start + match[2].length;
      return text.slice(0, start) + leadingWhitespace + next + trailingWhitespace + text.slice(end);
    },
  };
}

async function readVersionFiles(root) {
  const names = ['package.json', 'package-lock.json', 'dotnet/ManagedCode.NuGet.Tool/ManagedCode.NuGet.Tool.csproj'];
  const files = await Promise.all(
    names.map(async (name) => {
      const filePath = path.join(root, name);
      return { name, filePath, text: await readFile(filePath, 'utf8') };
    }),
  );
  const byName = new Map(files.map((file) => [file.name, file]));
  let manifest;
  let lockfile;
  try {
    manifest = JSON.parse(byName.get('package.json').text);
  } catch (error) {
    throw new Error(`package.json is malformed: ${error.message}`);
  }
  try {
    lockfile = JSON.parse(byName.get('package-lock.json').text);
  } catch (error) {
    throw new Error(`package-lock.json is malformed: ${error.message}`);
  }

  const manifestVersion = parseStableVersion(manifest.version, 'package.json version');
  const lockVersion = parseStableVersion(lockfile.version, 'package-lock.json version');
  const lockRootVersion = parseStableVersion(
    lockfile.packages?.['']?.version,
    'package-lock.json packages[""] version',
  );
  const tool = readToolVersion(byName.get('dotnet/ManagedCode.NuGet.Tool/ManagedCode.NuGet.Tool.csproj').text);
  const canonical = manifestVersion.join('.');
  const versions = [canonical, lockVersion.join('.'), lockRootVersion.join('.'), tool.current];
  if (versions.some((version) => version !== canonical)) {
    throw new Error(
      `Version drift detected: package.json=${versions[0]}, package-lock.json=${versions[1]}, ` +
        `package-lock.json packages[""]=${versions[2]}, .NET tool=${versions[3]}.`,
    );
  }
  return { root, files, byName, version: canonical, tool };
}

function resolveRequestedVersion(current, requested) {
  const parts = parseStableVersion(current, 'Current version');
  let next;
  if (requested === 'patch') next = [parts[0], parts[1], parts[2] + 1];
  else if (requested === 'minor') next = [parts[0], parts[1] + 1, 0];
  else if (requested === 'major') next = [parts[0] + 1, 0, 0];
  else next = parseStableVersion(requested, 'Requested version');
  if (next.some((part) => !Number.isSafeInteger(part))) throw new Error('The requested version exceeds safe limits.');
  const nextVersion = next.join('.');
  const comparison = compareVersions(nextVersion, current);
  if (comparison === 0) throw new Error(`Version ${nextVersion} is already current.`);
  if (comparison < 0) throw new Error(`Cannot downgrade from ${current} to ${nextVersion}.`);
  return nextVersion;
}

function makeUpdates(state, nextVersion) {
  const manifest = state.byName.get('package.json');
  const lockfile = state.byName.get('package-lock.json');
  const toolFile = state.byName.get('dotnet/ManagedCode.NuGet.Tool/ManagedCode.NuGet.Tool.csproj');
  let manifestJson;
  let lockJson;
  try {
    manifestJson = JSON.parse(manifest.text);
    lockJson = JSON.parse(lockfile.text);
  } catch (error) {
    throw new Error(`Version metadata is malformed: ${error.message}`);
  }
  if (!lockJson.packages?.[''] || typeof lockJson.packages[''] !== 'object') {
    throw new Error('package-lock.json is missing its root packages[""] metadata.');
  }
  const tool = readToolVersion(toolFile.text);
  const updated = new Map([
    [manifest, replaceJsonString(manifest.text, ['version'], state.version, nextVersion, 'package.json')],
    [
      lockfile,
      replaceJsonString(
        replaceJsonString(lockfile.text, ['version'], state.version, nextVersion, 'package-lock.json'),
        ['packages', '', 'version'],
        state.version,
        nextVersion,
        'package-lock.json packages[""]',
      ),
    ],
    [toolFile, tool.update(nextVersion)],
  ]);
  return [...updated].map(([file, text]) => ({ ...file, nextText: text }));
}

async function writeAtomic(filePath, text, mode, expectedCurrent) {
  const temporaryPath = `${filePath}.release-version-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(temporaryPath, text, { encoding: 'utf8', flag: 'wx', mode });
    await chmod(temporaryPath, mode & 0o7777);
    if (expectedCurrent !== undefined && (await readFile(filePath, 'utf8')) !== expectedCurrent) {
      throw new Error(`${path.basename(filePath)} changed during the version update; refusing to replace it.`);
    }
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}

async function commitUpdates(root, updates) {
  const lockPath = path.join(root, '.release-version.lock');
  let lockHandle;
  let ownsLock = false;
  const committed = [];
  try {
    lockHandle = await open(lockPath, 'wx');
    ownsLock = true;
    await lockHandle.writeFile(`${process.pid}\n`);
    const snapshots = new Map(updates.map((update) => [update.filePath, update.text]));
    for (const update of updates) {
      const current = await readFile(update.filePath, 'utf8');
      if (current !== snapshots.get(update.filePath)) {
        throw new Error(`${update.name} changed during the version update; no further files were written.`);
      }
      const metadata = await stat(update.filePath);
      await writeAtomic(update.filePath, update.nextText, metadata.mode, update.text);
      committed.push(update);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const update of committed.reverse()) {
      try {
        const current = await readFile(update.filePath, 'utf8');
        if (current !== update.nextText) {
          throw new Error(`${update.name} changed concurrently; refusing to overwrite it during rollback.`);
        }
        const metadata = await stat(update.filePath);
        await writeAtomic(update.filePath, update.text, metadata.mode, update.nextText);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length)
      throw new AggregateError([error, ...rollbackErrors], 'Version update failed and rollback was incomplete.');
    throw error;
  } finally {
    await lockHandle?.close();
    if (ownsLock) await unlink(lockPath).catch(() => {});
  }
}

export async function checkReleaseVersion({ root = defaultRoot } = {}) {
  return (await readVersionFiles(path.resolve(root))).version;
}

export async function bumpReleaseVersion(requested, { root = defaultRoot } = {}) {
  const state = await readVersionFiles(path.resolve(root));
  const nextVersion = resolveRequestedVersion(state.version, requested);
  const updates = makeUpdates(state, nextVersion);
  await commitUpdates(state.root, updates);
  return nextVersion;
}

async function main(args) {
  if (args.length !== 1) throw new Error('Usage: node scripts/release-version.mjs --check|patch|minor|major|X.Y.Z');
  if (args[0] === '--check') {
    process.stdout.write(`${await checkReleaseVersion()}\n`);
    return;
  }
  process.stdout.write(`${await bumpReleaseVersion(args[0])}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
