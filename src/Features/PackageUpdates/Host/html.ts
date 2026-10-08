import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

/** Renderer scripts in load order; each classic script receives the page nonce. */
const scripts = ['dom.js', 'model.js', 'view.js', 'app.js'];

export function getHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  surface: 'editor' | 'sidebar' = 'editor',
): string {
  const nonce = randomBytes(24).toString('base64');
  const media = vscode.Uri.joinPath(extensionUri, 'media', 'Features', 'PackageUpdates');
  const style = webview.asWebviewUri(vscode.Uri.joinPath(media, 'style.css'));
  const sources = scripts
    .map((name) => `<script nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.joinPath(media, name))}"></script>`)
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;"><title>NuGet Package Manager</title><link rel="stylesheet" href="${style}"></head><body class="surface-${surface}"><div id="app"></div>${sources}</body></html>`;
}
