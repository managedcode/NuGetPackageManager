import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import * as vscode from 'vscode';

export const registration = {
  items: [
    {
      items: [
        { catalogEntry: { id: 'Central.Package', version: '1.0.0', listed: true } },
        { catalogEntry: { id: 'Central.Package', version: '2.0.0', listed: true } },
        { catalogEntry: { id: 'Central.Package', version: '3.0.0', listed: false } },
        { catalogEntry: { id: 'Regular.Package', version: '1.0.0', listed: true } },
        { catalogEntry: { id: 'Regular.Package', version: '2.0.0', listed: true } },
        { catalogEntry: { id: 'Child.Version.Package', version: '1.0.0', listed: true } },
        { catalogEntry: { id: 'Child.Version.Package', version: '2.0.0', listed: true } },
        { catalogEntry: { id: 'Policy.Package', version: '1.0.0', listed: true } },
        { catalogEntry: { id: 'Policy.Package', version: '1.0.1', listed: true } },
        { catalogEntry: { id: 'Policy.Package', version: '1.1.0', listed: true } },
        { catalogEntry: { id: 'Policy.Package', version: '2.0.0', listed: true } },
        { catalogEntry: { id: 'Microsoft.Orleans.Core', version: '1.0.0', listed: true } },
        { catalogEntry: { id: 'Microsoft.Orleans.Core', version: '2.0.0', listed: true } },
        { catalogEntry: { id: 'Microsoft.Orleans.Hosting', version: '1.0.0', listed: true } },
        { catalogEntry: { id: 'Microsoft.Orleans.Hosting', version: '2.0.0', listed: true } },
        { catalogEntry: { id: 'Automatic.Package', version: '1.0.0', listed: true } },
        { catalogEntry: { id: 'Automatic.Package', version: '2.0.0', listed: true } },
        { catalogEntry: { id: 'Buffered.Package', version: '1.0.0', listed: true } },
        { catalogEntry: { id: 'Buffered.Package', version: '2.0.0', listed: true } },
        { catalogEntry: { id: 'Manual.Package', version: '1.0.0', listed: true } },
        { catalogEntry: { id: 'Manual.Package', version: '2.0.0', listed: true } },
      ],
    },
  ],
};

/** The feed answers HTTP 500 for this package's registration metadata, so every lookup of it fails. */
export const failingPackageId = 'failing.package';

export interface TestFeed {
  url: string;
  /** Flat-container plus registration requests received for a package ID; a cached check must not increase it. */
  requestsFor(packageId: string): number;
  close(): Promise<void>;
}

export async function startFeed(): Promise<TestFeed> {
  let origin = '';
  const requests = new Map<string, number>();
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const [, area, packageId] = path.split('/');
    if ((area === 'flat' || area === 'registration') && path.endsWith('/index.json')) {
      requests.set(packageId.toLowerCase(), (requests.get(packageId.toLowerCase()) ?? 0) + 1);
      if (area === 'registration' && packageId.toLowerCase() === failingPackageId) {
        response.writeHead(500).end();
        return;
      }
    }
    const body =
      path === '/v3/index.json'
        ? {
            resources: [
              { '@type': 'PackageBaseAddress/3.0.0', '@id': new URL('/flat/', origin).toString() },
              { '@type': 'RegistrationsBaseUrl/3.6.0', '@id': new URL('/registration/', origin).toString() },
            ],
          }
        : path.endsWith('/index.json') && path.startsWith('/flat/')
          ? { versions: ['1.0.0', '1.0.1', '1.1.0', '2.0.0', '3.0.0'] }
          : path.startsWith('/registration/') && path.endsWith('/index.json')
            ? {
                items: [
                  {
                    items: registration.items[0].items.filter(
                      (leaf) => leaf.catalogEntry.id.toLowerCase() === path.split('/')[2],
                    ),
                  },
                ],
              }
            : undefined;
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: `${origin}/v3/index.json`,
    requestsFor: (packageId) => requests.get(packageId.toLowerCase()) ?? 0,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

export function versionLine(text: string, packageId: string): string | undefined {
  return text.split(/\r?\n/).find((line) => line.includes(packageId));
}

export function waitForDocumentText(uri: vscode.Uri, expected: string, timeoutMs = 5000): Promise<vscode.TextDocument> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const listener = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== uri.toString() || event.document.getText() !== expected) return;
      clearTimeout(timer);
      listener.dispose();
      resolve(event.document);
    });
    timer = setTimeout(() => {
      listener.dispose();
      reject(new Error(`Timed out waiting for the editor undo event for ${uri.toString()}.`));
    }, timeoutMs);
  });
}

export function waitForSidebarVisibility(view: vscode.WebviewView, expected: boolean, timeoutMs = 5000): Promise<void> {
  if (view.visible === expected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      listener.dispose();
      reject(new Error(`Timed out waiting for the sidebar to become ${expected ? 'visible' : 'hidden'}.`));
    }, timeoutMs);
    const listener = view.onDidChangeVisibility(() => {
      if (view.visible !== expected) return;
      clearTimeout(timer);
      listener.dispose();
      resolve();
    });
  });
}

export function waitForPanelDisposal(panel: vscode.WebviewPanel, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      listener.dispose();
      reject(new Error('Timed out waiting for the editor workbench panel to close.'));
    }, timeoutMs);
    const listener = panel.onDidDispose(() => {
      clearTimeout(timer);
      listener.dispose();
      resolve();
    });
  });
}

export function waitForExtensionActivation<T>(extension: vscode.Extension<T>, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    let pollTimer: NodeJS.Timeout;
    const deadline = setTimeout(() => {
      clearTimeout(pollTimer);
      reject(new Error('The native NuGet view did not activate the extension.'));
    }, timeoutMs);
    const checkActivation = () => {
      if (extension.isActive) {
        clearTimeout(deadline);
        resolve(extension.exports);
        return;
      }
      pollTimer = setTimeout(checkActivation, 25);
    };
    checkActivation();
  });
}

export function waitForSidebarResolution(
  views: { sidebar?: vscode.WebviewView },
  timeoutMs = 10_000,
): Promise<vscode.WebviewView> {
  return new Promise((resolve, reject) => {
    let pollTimer: NodeJS.Timeout;
    const deadline = setTimeout(() => {
      clearTimeout(pollTimer);
      reject(new Error('The native NuGet container did not resolve its Packages webview.'));
    }, timeoutMs);
    const checkResolution = () => {
      if (views.sidebar) {
        clearTimeout(deadline);
        resolve(views.sidebar);
        return;
      }
      pollTimer = setTimeout(checkResolution, 25);
    };
    checkResolution();
  });
}
