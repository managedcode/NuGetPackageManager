import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Declaration, Feed, IgnoredDeclaration, PlannedChange, Policy, UpdateKind } from '../Contracts/types';

interface Resolution {
  target?: string;
  updateKind?: UpdateKind;
  versions: string[];
}

/** Both hosts call this packaged .NET engine; this adapter contains no package algorithms. */
export class EngineClient {
  constructor(
    private readonly enginePath = process.env.NUGET_MANAGER_ENGINE ??
      path.resolve(__dirname, '../../../../dist/engine/ManagedCode.NuGet.Tool.dll'),
  ) {}

  parse(text: string): Promise<{ declarations: Declaration[]; ignored: IgnoredDeclaration[] }> {
    return this.invoke({ command: 'parse', text });
  }
  resolve(
    current: string,
    versions: string[],
    policy: Policy,
    prerelease: boolean,
    signal?: AbortSignal,
  ): Promise<Resolution> {
    return this.invoke({ command: 'resolve', current, versions, policy, prerelease }, signal);
  }
  async apply(
    text: string,
    changes: Pick<PlannedChange, 'packageId' | 'from' | 'to' | 'start' | 'end'>[],
  ): Promise<string> {
    return (await this.invoke<{ text: string }>({ command: 'apply', text, changes })).text;
  }
  async getVersions(packageId: string, feeds: Feed[], signal?: AbortSignal): Promise<string[]> {
    return (await this.invoke<{ versions: string[] }>({ command: 'versions', packageId, feeds }, signal)).versions;
  }

  private invoke<T>(request: unknown, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (!existsSync(this.enginePath))
      return Promise.reject(new Error('The bundled NuGet engine is missing. Reinstall NuGet Package Manager.'));
    const input = JSON.stringify(request);
    if (Buffer.byteLength(input) > 8_000_000)
      return Promise.reject(new Error('NuGet engine request exceeds the size limit.'));
    return new Promise<T>((resolve, reject) => {
      const child = spawn('dotnet', [this.enginePath, '--bridge'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let output = '';
      let diagnostic = '';
      let settled = false;
      const finish = (error?: Error, value?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) {
          child.kill();
          reject(error);
        } else resolve(value!);
      };
      const abort = () => finish(new Error('NuGet check was cancelled.'));
      const timer = setTimeout(
        () => finish(new Error('The NuGet engine timed out. Retry the check or reduce the configured feeds.')),
        180_000,
      );
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (data: string) => {
        output += data;
        if (output.length > 8_000_000) finish(new Error('NuGet engine response exceeds the size limit.'));
      });
      child.stderr.on('data', (data: string) => {
        diagnostic = (diagnostic + data).slice(-4000);
      });
      child.on('error', (error) =>
        finish(new Error(`Install the .NET 10 runtime and ensure dotnet is on PATH. ${error.message}`)),
      );
      child.stdin.on('error', () => {
        /* A failed runtime may close stdin before its diagnostic is read. */
      });
      child.on('close', (code) => {
        if (settled) return;
        let response: T & { error?: string };
        try {
          response = JSON.parse(output);
        } catch {
          finish(
            new Error(
              `NuGet engine could not start. Install the .NET 10 runtime and ensure dotnet is on PATH.${diagnostic ? ` ${diagnostic.trim()}` : ''}`,
            ),
          );
          return;
        }
        if (response.error || code !== 0) finish(new Error(response.error ?? 'NuGet engine failed.'));
        else finish(undefined, response);
      });
      child.stdin.end(input);
      if (signal?.aborted) abort();
    });
  }
}
