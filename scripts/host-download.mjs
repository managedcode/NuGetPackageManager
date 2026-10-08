import { setTimeout } from 'node:timers/promises';

const transientCodes = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EAI_AGAIN']);

function isTransient(error) {
  if (!error || typeof error !== 'object') return false;
  if (transientCodes.has(error.code) || (error instanceof Error && error.constructor.name === 'TimeoutError'))
    return true;
  if (error instanceof AggregateError) return error.errors.length > 0 && error.errors.every(isTransient);
  return error.cause ? isTransient(error.cause) : false;
}

export async function resolveHostExecutable({
  executablePath,
  version,
  download,
  wait = setTimeout,
  warn = console.warn,
}) {
  if (executablePath) return executablePath;
  for (let attempt = 1; ; attempt++) {
    try {
      return await download({ version, timeout: 60_000 });
    } catch (error) {
      if (attempt === 3 || !isTransient(error)) throw error;
      warn(`VS Code ${version} setup transport failure; retry ${attempt + 1}/3.`, error);
      await wait(attempt * 2_000);
    }
  }
}
