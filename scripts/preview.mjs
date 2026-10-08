import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const media = path.join(root, 'media/Features/PackageUpdates');
const output = path.join(root, '.preview');
const assets = ['dom.js', 'model.js', 'view.js', 'app.js', 'style.css'];
await mkdir(output, { recursive: true });

// Same defaults VS Code injects into every webview, so layout problems show up here too.
const webviewDefaults = `html{scrollbar-color:var(--vscode-scrollbarSlider-background) var(--vscode-editor-background)}body{overscroll-behavior-x:none;background-color:transparent;color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family);font-weight:var(--vscode-font-weight);font-size:var(--vscode-font-size);margin:0;padding:0 20px}code{font-family:var(--monaco-monospace-font);color:var(--vscode-textPreformat-foreground);background-color:var(--vscode-textPreformat-background);padding:1px 3px;border-radius:4px}a:focus,input:focus,select:focus,textarea:focus{outline:1px solid -webkit-focus-ring-color;outline-offset:-1px}::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background-color:var(--vscode-scrollbarSlider-background)}`;

const common = {
  'font-family': '-apple-system, BlinkMacSystemFont, sans-serif',
  'font-size': '13px',
  'font-weight': 'normal',
  'editor-font-family': 'Menlo, Monaco, "Courier New", monospace',
};
const themes = {
  'light-plus': {
    kind: 'vscode-light',
    foreground: '#616161',
    descriptionForeground: '#717171',
    focusBorder: '#0090f1',
    'sideBar-background': '#f3f3f3',
    'editor-background': '#ffffff',
    'editor-foreground': '#000000',
    'input-background': '#ffffff',
    'input-foreground': '#616161',
    'input-placeholderForeground': '#767676',
    'button-background': '#007acc',
    'button-foreground': '#ffffff',
    'button-secondaryBackground': '#5f6a79',
    'button-secondaryForeground': '#ffffff',
    'button-secondaryHoverBackground': '#4c5561',
    'badge-background': '#c4c4c4',
    'badge-foreground': '#333333',
    'checkbox-background': '#ffffff',
    'checkbox-border': '#919191',
    'checkbox-foreground': '#616161',
    'widget-border': '#d4d4d4',
    'panel-border': '#80808059',
    'list-hoverBackground': '#e8e8e8',
    'list-activeSelectionBackground': '#0060c0',
    'list-activeSelectionForeground': '#ffffff',
    'list-inactiveSelectionBackground': '#e4e6f1',
    'list-focusOutline': '#0090f1',
    'textPreformat-foreground': '#a31515',
    'textPreformat-background': '#0000001a',
    'textLink-foreground': '#006ab1',
    'progressBar-background': '#0e70c0',
    'toolbar-hoverBackground': '#b8b8b850',
    errorForeground: '#a1260d',
    'editorWarning-foreground': '#bf8803',
    'tree-indentGuidesStroke': '#a9a9a9',
    'editorWidget-background': '#f3f3f3',
    'dropdown-background': '#ffffff',
    'dropdown-border': '#cecece',
    'icon-foreground': '#424242',
    'widget-shadow': '#00000029',
    'inputValidation-infoBackground': '#d6ecf2',
    'inputValidation-infoBorder': '#007acc',
    'inputValidation-warningBackground': '#f6f5d2',
    'inputValidation-warningBorder': '#b89500',
    'inputValidation-errorBackground': '#f2dede',
    'inputValidation-errorBorder': '#be1100',
    'editor-findMatchHighlightBackground': '#ea5c0055',
    'scrollbarSlider-background': '#64646466',
  },
  'light-modern': {
    kind: 'vscode-light',
    foreground: '#3b3b3b',
    descriptionForeground: '#3b3b3b',
    focusBorder: '#005fb8',
    'sideBar-background': '#f8f8f8',
    'editor-background': '#ffffff',
    'editor-foreground': '#3b3b3b',
    'input-background': '#ffffff',
    'input-border': '#cecece',
    'input-foreground': '#3b3b3b',
    'input-placeholderForeground': '#767676',
    'button-background': '#005fb8',
    'button-foreground': '#ffffff',
    'button-secondaryBackground': '#e5e5e5',
    'button-secondaryForeground': '#3b3b3b',
    'button-secondaryHoverBackground': '#cccccc',
    'button-border': '#0000001a',
    'badge-background': '#cccccc',
    'badge-foreground': '#3b3b3b',
    'checkbox-background': '#f8f8f8',
    'checkbox-border': '#cecece',
    'checkbox-foreground': '#3b3b3b',
    'widget-border': '#e5e5e5',
    'panel-border': '#e5e5e5',
    'list-hoverBackground': '#f2f2f2',
    'list-activeSelectionBackground': '#e8e8e8',
    'list-activeSelectionForeground': '#000000',
    'list-inactiveSelectionBackground': '#e4e6f1',
    'list-focusOutline': '#005fb8',
    'textPreformat-foreground': '#3b3b3b',
    'textPreformat-background': '#0000001f',
    'textLink-foreground': '#005fb8',
    'progressBar-background': '#005fb8',
    'toolbar-hoverBackground': '#b8b8b850',
    errorForeground: '#f85149',
    'editorWarning-foreground': '#bf8803',
    'tree-indentGuidesStroke': '#a9a9a9',
    'editorWidget-background': '#f8f8f8',
    'dropdown-background': '#ffffff',
    'dropdown-border': '#cecece',
    'icon-foreground': '#3b3b3b',
    'widget-shadow': '#00000029',
    'inputValidation-infoBackground': '#d6ecf2',
    'inputValidation-infoBorder': '#007acc',
    'inputValidation-warningBackground': '#f6f5d2',
    'inputValidation-warningBorder': '#b89500',
    'inputValidation-errorBackground': '#f2dede',
    'inputValidation-errorBorder': '#be1100',
    'editor-findMatchHighlightBackground': '#ea5c0055',
    'scrollbarSlider-background': '#64646466',
  },
  'dark-modern': {
    kind: 'vscode-dark',
    foreground: '#cccccc',
    descriptionForeground: '#9d9d9d',
    focusBorder: '#0078d4',
    'sideBar-background': '#181818',
    'editor-background': '#1f1f1f',
    'editor-foreground': '#cccccc',
    'input-background': '#313131',
    'input-border': '#3c3c3c',
    'input-foreground': '#cccccc',
    'input-placeholderForeground': '#989898',
    'button-background': '#0078d4',
    'button-foreground': '#ffffff',
    'button-secondaryBackground': '#313131',
    'button-secondaryForeground': '#cccccc',
    'button-secondaryHoverBackground': '#3c3c3c',
    'button-border': '#ffffff12',
    'badge-background': '#616161',
    'badge-foreground': '#f8f8f8',
    'checkbox-background': '#313131',
    'checkbox-border': '#3c3c3c',
    'checkbox-foreground': '#cccccc',
    'widget-border': '#313131',
    'panel-border': '#2b2b2b',
    'list-hoverBackground': '#2a2d2e',
    'list-activeSelectionBackground': '#04395e',
    'list-activeSelectionForeground': '#ffffff',
    'list-inactiveSelectionBackground': '#37373d',
    'list-focusOutline': '#0078d4',
    'textPreformat-foreground': '#d0d0d0',
    'textPreformat-background': '#3c3c3c',
    'textLink-foreground': '#4daafc',
    'progressBar-background': '#0078d4',
    'toolbar-hoverBackground': '#5a5d5e50',
    errorForeground: '#f85149',
    'editorWarning-foreground': '#cca700',
    'tree-indentGuidesStroke': '#585858',
    'editorWidget-background': '#202020',
    'dropdown-background': '#313131',
    'dropdown-border': '#3c3c3c',
    'icon-foreground': '#cccccc',
    'widget-shadow': '#0000005c',
    'inputValidation-infoBackground': '#063b49',
    'inputValidation-infoBorder': '#007acc',
    'inputValidation-warningBackground': '#352a05',
    'inputValidation-warningBorder': '#b89500',
    'inputValidation-errorBackground': '#5a1d1d',
    'inputValidation-errorBorder': '#be1100',
    'editor-findMatchHighlightBackground': '#ea5c0055',
    'scrollbarSlider-background': '#79797966',
  },
  'hc-black': {
    kind: 'vscode-high-contrast',
    foreground: '#ffffff',
    descriptionForeground: '#ffffffb3',
    focusBorder: '#f38518',
    contrastBorder: '#6fc3df',
    contrastActiveBorder: '#f38518',
    'sideBar-background': '#000000',
    'editor-background': '#000000',
    'editor-foreground': '#ffffff',
    'input-background': '#000000',
    'input-border': '#6fc3df',
    'input-foreground': '#ffffff',
    'input-placeholderForeground': '#ffffffb3',
    'button-background': '#000000',
    'button-foreground': '#ffffff',
    'button-border': '#6fc3df',
    'button-secondaryForeground': '#ffffff',
    'badge-background': '#000000',
    'badge-foreground': '#ffffff',
    'checkbox-background': '#000000',
    'checkbox-border': '#6fc3df',
    'checkbox-foreground': '#ffffff',
    'widget-border': '#6fc3df',
    'panel-border': '#6fc3df',
    'list-focusOutline': '#f38518',
    'textPreformat-foreground': '#ffffff',
    'textLink-foreground': '#21a6ff',
    'progressBar-background': '#6fc3df',
    errorForeground: '#f48771',
    'editorWarning-foreground': '#ffd370',
    'tree-indentGuidesStroke': '#a9a9a9',
    'editorWidget-background': '#0c141f',
    'dropdown-background': '#000000',
    'dropdown-border': '#6fc3df',
    'icon-foreground': '#ffffff',
    'inputValidation-infoBackground': '#000000',
    'inputValidation-infoBorder': '#6fc3df',
    'inputValidation-warningBackground': '#000000',
    'inputValidation-warningBorder': '#6fc3df',
    'inputValidation-errorBackground': '#000000',
    'inputValidation-errorBorder': '#6fc3df',
    'editor-findMatchHighlightBackground': '#00000000',
  },
};
const themeCss = Object.entries(themes)
  .map(([name, { kind, ...colors }]) => {
    const vars = { ...common, ...colors };
    return `html[data-theme="${name}"]{${Object.entries(vars)
      .map(([key, value]) => `--vscode-${key}:${value}`)
      .join(';')}}`;
  })
  .join('\n');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NuGet Package Manager UI preview</title><link rel="icon" href="data:,">
<style id="_defaultStyles">${webviewDefaults}</style>
<style>${themeCss}
.preview-note{position:fixed;left:8px;bottom:8px;z-index:99;font:11px system-ui;padding:3px 8px;border-radius:10px;background:#ffe7b3;color:#3a2a00;pointer-events:none;opacity:.9}</style>
<link rel="stylesheet" href="/style.css"></head>
<body><div id="app"></div>
<script src="/preview-host.js"></script>
<script src="/dom.js"></script><script src="/model.js"></script><script src="/view.js"></script><script src="/app.js"></script></body></html>`;

// Simulated host: illustrative data and timing only. It never reads or writes workspace files.
const host = String.raw`(() => {
const params = new URLSearchParams(location.search);
const theme = params.get('theme') in ${JSON.stringify(Object.fromEntries(Object.entries(themes).map(([name, value]) => [name, value.kind])))} ? params.get('theme') : 'dark-modern';
const kinds = ${JSON.stringify(Object.fromEntries(Object.entries(themes).map(([name, value]) => [name, value.kind])))};
document.documentElement.dataset.theme = theme;
document.body.className = kinds[theme] + ' surface-' + (params.get('surface') === 'editor' ? 'editor' : 'sidebar');
if (!params.has('clean')) document.body.insertAdjacentHTML('beforeend', '<div class="preview-note">Preview · simulated host</div>');
const props = 'file:///repo/Directory.Packages.props', api = 'file:///repo/tests/Api.Tests/Api.Tests.csproj', core = 'file:///repo/tests/Core.Tests/Core.Tests.csproj', tools = 'file:///repo/build/Tools.csproj';
const labels = { [props]: 'Directory.Packages.props', [api]: 'tests/Api.Tests/Api.Tests.csproj', [core]: 'tests/Core.Tests/Core.Tests.csproj', [tools]: 'build/Tools.csproj' };
const feed = {
  'A2A': ['0.3.1'], 'Acornima': ['1.1.0'], 'AngleSharp': ['1.8.3', '1.8.4'], 'AnyAscii': ['0.3.2'],
  'Aspire.Azure.Data.Tables': ['13.6.0', '13.6.1'], 'Aspire.Hosting.Azure.CosmosDB': ['13.6.0', '13.6.1'], 'Aspire.Hosting.Azure.Storage': ['13.6.0', '13.6.1'],
  'Aspire.Hosting.JavaScript': ['13.6.0', '13.6.1'], 'Aspire.Hosting.Orleans': ['13.6.0', '13.6.1'], 'Aspire.Microsoft.EntityFrameworkCore.Cosmos': ['13.6.0', '13.6.1'],
  'Azure.AI.OpenAI': ['2.1.0'], 'Azure.Data.Tables': ['12.12.0', '12.13.0'], 'Azure.Extensions.AspNetCore.DataProtection.Blobs': ['1.5.0'],
  'Azure.Monitor.OpenTelemetry.AspNetCore': ['1.3.0'], 'Azure.Storage.Blobs': ['12.30.0', '12.30.1'], 'GitHub.Copilot.SDK': ['1.0.16', '1.0.17'],
  'Google.Apis.HangoutsChat.v1': ['1.70.0.3789', '1.71.0.3801'], 'Microsoft.CodeAnalysis.NetAnalyzers': ['9.0.0', '10.0.0'],
  'Microsoft.EntityFrameworkCore': ['9.0.9', '10.0.0'], 'Microsoft.EntityFrameworkCore.Cosmos': ['9.0.9', '10.0.0'],
  'Microsoft.Extensions.AI': ['8.0.1', '10.0.0-rc.2.25502.107'],
  'Microsoft.Extensions.Configuration': ['9.0.9'], 'Microsoft.Extensions.Http': ['9.0.0', '9.0.9'], 'Microsoft.Extensions.Logging': ['9.0.0', '9.0.9'],
  'Microsoft.NET.Test.Sdk': ['17.14.1', '18.0.0'], 'Microsoft.Orleans.Core': ['9.1.2', '9.2.1'], 'Microsoft.Orleans.Persistence.AzureStorage': ['9.1.2', '9.2.1'],
  'Microsoft.Orleans.Sdk': ['9.1.2', '9.2.1'], 'Microsoft.Orleans.Server': ['9.1.2', '9.2.1'], 'Microsoft.OrleansExtra': ['1.0.0', '1.1.0'],
  'OpenTelemetry': ['1.12.0', '1.13.0'], 'OpenTelemetry.Exporter.OpenTelemetryProtocol': ['1.12.0', '1.13.0'], 'OpenTelemetry.Extensions.Hosting': ['1.12.0', '1.13.0'],
  'Polly': ['8.6.3', '8.6.4'], 'Serilog': ['4.3.0', '5.0.0-dev.1'], 'Spectre.Console': ['0.50.0', '0.51.1'], 'System.Text.Json': ['9.0.9'],
  'xunit.runner.visualstudio': ['3.1.4', '3.1.5'], 'xunit.v3': ['3.0.1', '3.1.0'],
};
const declared = [
  ...Object.keys(feed).filter((id) => !['Microsoft.NET.Test.Sdk', 'xunit.v3', 'xunit.runner.visualstudio'].includes(id)).map((id) => [id, feed[id][0], props]),
  ['Microsoft.NET.Test.Sdk', '17.14.1', api], ['Microsoft.NET.Test.Sdk', '17.14.1', core], ['xunit.v3', '3.0.1', api], ['xunit.v3', '3.0.1', core],
  ['xunit.runner.visualstudio', '3.1.4', api], ['Private.Build.Tools', '3.2.0', tools],
];
if (params.has('stress')) {
  for (const suffix of ['Abstractions', 'Hosting']) {
    const id = 'Aspire.Microsoft.EntityFrameworkCore.Cosmos.' + suffix;
    declared.push([id, '13.6.0-preview.1.123456789', props]);
    feed[id] = ['13.6.1-preview.1.123456789', '13.6.1'];
  }
}
const families = (id) => id.split('.').map((_, index, parts) => parts.slice(0, index + 1).join('.'));
const rows = declared.map(([packageId, version, file], index) => ({
  key: file + '#' + index + ':' + packageId, packageId, version, start: index * 10, end: index * 10 + version.length,
  kind: file === props ? 'PackageVersion' : 'PackageReference', condition: packageId === 'Microsoft.CodeAnalysis.NetAnalyzers' ? "'$(Configuration)' == 'Debug'" : undefined,
  group: packageId.split('.')[0], families: families(packageId), file, fileLabel: labels[file], versions: [], status: 'unchecked',
}));
const numbers = (version) => version.split(/[.-]/).map((part) => (Number.isNaN(Number(part)) ? -1 : Number(part)));
const newer = (a, b) => { const x = numbers(a), y = numbers(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); } return false; };
const kindOf = (from, to) => { const a = numbers(from), b = numbers(to); return a[0] !== b[0] ? 'major' : a[1] !== b[1] ? 'minor' : a[2] !== b[2] ? 'patch' : a[3] !== b[3] ? 'revision' : 'prerelease'; };
let state = { rows, files: Object.entries(labels).map(([uri, label]) => ({ uri, label, count: rows.filter((row) => row.file === uri).length })),
  notices: ['Directory.Packages.props · Shared.Analyzers: Property, range, wildcard or unsupported version; edit its owning declaration.'],
  feeds: [{ name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json' }], busy: false, progress: 0, trusted: params.get('scenario') !== 'untrusted',
  autoCheck: true, policy: 'latest', prerelease: false };
if (params.get('scenario') === 'nofolder') state = { ...state, rows: [], files: [], notices: ['Open a folder or workspace to discover package declarations.'] };
if (params.get('scenario') === 'empty') state = { ...state, rows: [], files: [], notices: [] };
const emit = () => window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state: structuredClone(state) } }));
const resolve = (row) => {
  if (row.packageId === 'Private.Build.Tools') return { ...row, status: 'error', error: 'The source requires authentication.' };
  const all = (feed[row.packageId] ?? [row.version]).filter((version) => state.prerelease || !version.includes('-'));
  const base = numbers(row.version);
  const eligible = all.filter((version) => newer(version, row.version) && (state.policy === 'latest' || numbers(version)[0] === base[0]) && (state.policy !== 'patch' || numbers(version)[1] === base[1]));
  const target = eligible.at(-1);
  return { ...row, versions: eligible, target, updateKind: target ? kindOf(row.version, target) : undefined, status: target ? 'update' : 'current', error: undefined };
};
let timer;
function check(delay = 25) {
  clearTimeout(timer);
  state = { ...state, busy: true, activity: 'check', progress: 0, checkedAt: undefined, plan: undefined, rows: state.rows.map((row) => ({ ...row, status: 'checking', target: undefined, updateKind: undefined, versions: [] })) };
  emit();
  const ids = [...new Set(state.rows.map((row) => row.packageId))];
  let done = 0;
  const step = () => {
    const id = ids[done++];
    state = { ...state, progress: Math.round((done / ids.length) * 100), rows: state.rows.map((row) => (row.packageId === id ? resolve(row) : row)) };
    if (done === ids.length) state = { ...state, busy: false, activity: undefined, checkedAt: new Date().toISOString() };
    emit();
    if (done < ids.length && params.get('scenario') !== 'checking') timer = setTimeout(step, delay);
    else if (params.get('scenario') === 'checking' && done < Math.round(ids.length * 0.6)) timer = setTimeout(step, 0);
  };
  timer = setTimeout(step, delay);
}
window.__previewMessages = [];
window.acquireVsCodeApi = () => ({ getState: () => ({}), setState: () => {}, postMessage: (message) => {
  window.__previewMessages.push(message);
  if (message.type === 'ready') {
    state = { ...state, busy: true, activity: 'scan' }; emit();
    setTimeout(() => { state = { ...state, busy: false, activity: undefined }; emit(); if (state.rows.length && params.get('scenario') !== 'unchecked') check(params.has('instant') ? 0 : 25); }, params.has('instant') ? 0 : 300);
  } else if (message.type === 'refresh' || message.type === 'check') check();
  else if (message.type === 'cancel') { clearTimeout(timer); state = { ...state, busy: false, activity: undefined, rows: state.rows.map((row) => (row.status === 'checking' ? { ...row, status: 'unchecked' } : row)) }; emit(); }
  else if (message.type === 'policy') {
    state = { ...state, policy: message.policy, prerelease: message.prerelease };
    state = { ...state, rows: state.rows.map((row) => (['current', 'update'].includes(row.status) ? resolve(row) : row)) };
    emit();
  }
  else if (message.type === 'target') { state = { ...state, rows: state.rows.map((row) => (row.key === message.key && row.versions.includes(message.version) ? { ...row, target: message.version, updateKind: kindOf(row.version, message.version), status: 'update' } : row)) }; emit(); }
  else if (message.type === 'review') { const keys = new Set(message.keys); state = { ...state, plan: state.rows.filter((row) => keys.has(row.key)).map((row) => ({ key: row.key, packageId: row.packageId, from: row.version, to: row.target, file: row.file, fileLabel: row.fileLabel, start: row.start, end: row.end, condition: row.condition })) }; emit(); }
  else if (message.type === 'back') { state = { ...state, plan: undefined }; emit(); }
  else if (message.type === 'apply') window.dispatchEvent(new MessageEvent('message', { data: { type: 'error', message: 'Preview only: the simulated host does not write workspace files.' } }));
} });
})();`;

await writeFile(path.join(output, 'index.html'), html);
await writeFile(path.join(output, 'preview-host.js'), host);

// Renderer assets are served straight from media/, so edits show up on reload.
const files = new Map([
  ['/', [path.join(output, 'index.html'), 'text/html; charset=utf-8']],
  ['/index.html', [path.join(output, 'index.html'), 'text/html; charset=utf-8']],
  ['/preview-host.js', [path.join(output, 'preview-host.js'), 'text/javascript; charset=utf-8']],
  ...assets.map((name) => [
    `/${name}`,
    [path.join(media, name), name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8'],
  ]),
]);
const server = http.createServer(async (request, response) => {
  const entry = files.get(new URL(request.url ?? '/', 'http://localhost').pathname);
  if (!entry) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.setHeader('content-type', entry[1]);
  response.setHeader('cache-control', 'no-store');
  response.end(await readFile(entry[0]));
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => {
  const address = server.address();
  console.log(`UI preview: http://127.0.0.1:${address.port}/?theme=dark-modern&surface=sidebar`);
  console.log('Themes: light-plus, light-modern, dark-modern, hc-black. Surfaces: sidebar, editor.');
  console.log(
    'Scenarios: checking, unchecked, untrusted, nofolder, empty. The host is simulated and never writes files.',
  );
});
