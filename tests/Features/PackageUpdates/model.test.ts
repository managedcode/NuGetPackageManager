import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import type { PackageRow } from '../../../src/Features/PackageUpdates/Contracts/types';

// REQ-009 / AC-013: family tree, tri-state selection, filtering and counts of the shipped renderer view-model.
// model.js is a classic script; under node it exports the API the webview reads from globalThis.NuGetModel.

type Filters = { query?: string; file?: string; kinds?: string[]; family?: string };
type Base = { id: string; name: string; parent: string; count: number };
type PackageNode = Base & { type: 'package'; rows: PackageRow[] };
type GroupNode = Base & { type: 'group'; rows: PackageRow[]; children: TreeNode[] };
type TreeNode = PackageNode | GroupNode;
type NavNode = Base & { type: 'group'; children: NavNode[] };
type AnyNode = TreeNode | NavNode;
type Status = PackageRow['status'];
type Counts = Record<'packages' | 'declarations' | 'updates' | 'current' | 'failed' | 'checking' | 'unchecked', number>;

interface ModelApi {
  summarize(rows: PackageRow[]): Counts;
  filterRows(rows: PackageRow[], filters?: Filters): PackageRow[];
  buildTree(rows: PackageRow[]): TreeNode[];
  familyNav(rows: PackageRow[]): NavNode[];
  walk(
    nodes: AnyNode[],
    visit: (node: AnyNode, depth: number, parentId: string) => void,
    open?: (node: AnyNode) => boolean,
  ): void;
  collectKeys(node: { rows?: PackageRow[] }, updatesOnly?: boolean): string[];
  selectionState(keys: string[], selected: ReadonlySet<string>): 'none' | 'some' | 'all';
  versionDiff(from: string, to: string): { same: string; changed: string };
}

const modelPath = '../../../media/Features/PackageUpdates/model.js';
const model = require(modelPath) as ModelApi;

const workspace = 'file:///workspace';
const defaultPath = 'src/App/App.csproj';

/** Dotted-prefix chain ending in the package ID, built the way the engine's PackageVersions.Families builds it. */
function familiesOf(packageId: string): string[] {
  const parts = packageId.split('.');
  return parts.map((_, index) => parts.slice(0, index + 1).join('.'));
}

/** Declaration row shaped like the host's scan result (key = `<file uri>#<engine key>`); defaults to a major update. */
function row(packageId: string, overrides: Partial<PackageRow> = {}): PackageRow {
  const file = overrides.file ?? `${workspace}/${defaultPath}`;
  const start = overrides.start ?? 100;
  return {
    key: `${file}#${start - 20}:${start}:${packageId}`,
    packageId,
    version: '1.0.0',
    start,
    end: start + 5,
    kind: 'PackageReference',
    group: packageId.split('.')[0],
    families: familiesOf(packageId),
    file,
    fileLabel: defaultPath,
    versions: [],
    status: 'update',
    target: '2.0.0',
    updateKind: 'major',
    ...overrides,
  };
}

const inFile = (path: string): Partial<PackageRow> => ({ file: `${workspace}/${path}`, fileLabel: path });
const asStatus = (status: Status): Partial<PackageRow> => ({ status, target: undefined, updateKind: undefined });
const rowsOf = (...ids: string[]): PackageRow[] => ids.map((id) => row(id));
const keysOf = (rows: PackageRow[]): string[] => rows.map((item) => item.key);
const idsOf = (rows: PackageRow[]): string[] => rows.map((item) => item.packageId);
const nodeIds = (nodes: AnyNode[]): string[] => nodes.map((node) => node.id);

/** Tree as text: `+ name (packages)` for a family, `- name` for a package, two spaces per level. */
function outline(nodes: AnyNode[], depth = 0): string[] {
  return nodes.flatMap((node) => {
    const indent = '  '.repeat(depth);
    if (node.type === 'package') return [`${indent}- ${node.name}`];
    return [`${indent}+ ${node.name} (${node.count})`, ...outline(node.children, depth + 1)];
  });
}

/** Node IDs in the order `walk` visits them. */
function visitedIds(nodes: AnyNode[], open?: (node: AnyNode) => boolean): string[] {
  const ids: string[] = [];
  model.walk(nodes, (node) => ids.push(node.id), open);
  return ids;
}

function find(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const node of nodes) {
    const found = node.id === id ? node : node.type === 'group' ? find(node.children, id) : undefined;
    if (found) return found;
  }
  return undefined;
}

function nodeOf(nodes: TreeNode[], id: string): TreeNode {
  const found = find(nodes, id);
  assert.ok(found, `the tree must contain ${id}`);
  return found;
}

function groupOf(nodes: TreeNode[], id: string): GroupNode {
  const found = find(nodes, id);
  assert.ok(found?.type === 'group', `the tree must contain family ${id}`);
  return found;
}

/** Asserts the AC-013 tree invariants and returns every declaration key the tree holds. */
function verifyTree(nodes: TreeNode[], parent = ''): string[] {
  return nodes.flatMap((node) => {
    assert.equal(node.parent, parent, `${node.id} must name its nearest family as parent`);
    if (node.type === 'package') {
      assert.equal(node.count, 1);
      return keysOf(node.rows);
    }
    const members = new Set(node.rows.map((member) => member.packageId.toLowerCase()));
    assert.equal(node.count, members.size, `${node.id} counts distinct packages`);
    assert.ok(node.children.length >= 2, `${node.id} must group at least two packages`);
    const inner = node.children.flatMap((child) => child.rows);
    assert.deepEqual(node.rows, inner, `${node.id} rows come from its children`);
    const prefix = node.name.toLowerCase();
    for (const id of members) assert.ok(id === prefix || id.startsWith(`${prefix}.`), `${id} is outside ${node.name}`);
    return verifyTree(node.children, node.name);
  });
}

const aspireIds = [
  'Aspire.Azure.Data.Tables',
  'Aspire.Hosting.Azure.CosmosDB',
  'Aspire.Hosting.Azure.Storage',
  'Aspire.Hosting.JavaScript',
  'Aspire.Hosting.Orleans',
  'Aspire.Microsoft.EntityFrameworkCore.Cosmos',
];
const orleansIds = ['Microsoft.Orleans', 'Microsoft.Orleans.Hosting', 'Microsoft.OrleansExtra'];
const orleansFamily = orleansIds.slice(0, 2);

test('single-package families stay plain rows with full IDs and never become family nodes', () => {
  const tree = model.buildTree(rowsOf('xunit', 'Newtonsoft.Json', 'Serilog.Sinks.File', 'Humanizer.Core'));
  assert.deepEqual(outline(tree), ['- Humanizer.Core', '- Newtonsoft.Json', '- Serilog.Sinks.File', '- xunit']);
  assert.deepEqual(nodeIds(tree), ['p:humanizer.core', 'p:newtonsoft.json', 'p:serilog.sinks.file', 'p:xunit']);
  assert.ok(tree.every((node) => node.type === 'package' && node.parent === '' && node.count === 1));
});

test('a prefix holding the same packages as its only child folds into the deeper family', () => {
  const folded = model.buildTree(rowsOf('Microsoft.Extensions.Http', 'Microsoft.Extensions.Logging'));
  assert.deepEqual(outline(folded), [
    '+ Microsoft.Extensions (2)',
    '  - Microsoft.Extensions.Http',
    '  - Microsoft.Extensions.Logging',
  ]);
  const family = groupOf(folded, 'g:microsoft.extensions');
  assert.equal(family.parent, '');
  assert.ok(family.children.every((child) => child.parent === 'Microsoft.Extensions'));
  assert.equal(find(folded, 'g:microsoft'), undefined, 'the Microsoft prefix adds no choice and must not appear');

  const nested = model.buildTree(rowsOf('Azure.Core', 'Azure.Storage.Blobs.Batch', 'Azure.Storage.Blobs.ChangeFeed'));
  assert.deepEqual(outline(nested), [
    '+ Azure (3)',
    '  - Azure.Core',
    '  + Azure.Storage.Blobs (2)',
    '    - Azure.Storage.Blobs.Batch',
    '    - Azure.Storage.Blobs.ChangeFeed',
  ]);
  assert.equal(groupOf(nested, 'g:azure.storage.blobs').parent, 'Azure');
  assert.equal(find(nested, 'g:azure.storage'), undefined, 'Azure.Storage holds only Azure.Storage.Blobs and folds');
});

test('nested families follow the real Aspire package set and interleave groups with packages alphabetically', () => {
  const tree = model.buildTree(rowsOf(...aspireIds));
  assert.deepEqual(outline(tree), [
    '+ Aspire (6)',
    '  - Aspire.Azure.Data.Tables',
    '  + Aspire.Hosting (4)',
    '    + Aspire.Hosting.Azure (2)',
    '      - Aspire.Hosting.Azure.CosmosDB',
    '      - Aspire.Hosting.Azure.Storage',
    '    - Aspire.Hosting.JavaScript',
    '    - Aspire.Hosting.Orleans',
    '  - Aspire.Microsoft.EntityFrameworkCore.Cosmos',
  ]);
  const [aspire, hosting, azure] = ['g:aspire', 'g:aspire.hosting', 'g:aspire.hosting.azure'].map((id) =>
    groupOf(tree, id),
  );
  assert.deepEqual([aspire.parent, hosting.parent, azure.parent], ['', 'Aspire', 'Aspire.Hosting']);
  assert.deepEqual([aspire.count, hosting.count, azure.count], [6, 4, 2]);
  assert.deepEqual(
    [aspire, hosting, azure].map((family) => model.collectKeys(family).length),
    [6, 4, 2],
  );
  assert.deepEqual(idsOf(azure.rows), ['Aspire.Hosting.Azure.CosmosDB', 'Aspire.Hosting.Azure.Storage']);
  assert.equal(nodeOf(tree, 'p:aspire.azure.data.tables').parent, 'Aspire');
  assert.equal(nodeOf(tree, 'p:aspire.hosting.azure.cosmosdb').parent, 'Aspire.Hosting.Azure');
  for (const single of ['g:aspire.azure', 'g:aspire.azure.data', 'g:aspire.microsoft'])
    assert.equal(find(tree, single), undefined, `${single} groups one package and must not be a family`);
});

test('a package whose ID equals a family root sits inside that family group', () => {
  const tree = model.buildTree(rowsOf('Microsoft.Orleans', 'Microsoft.Orleans.Hosting'));
  assert.deepEqual(outline(tree), [
    '+ Microsoft.Orleans (2)',
    '  - Microsoft.Orleans',
    '  - Microsoft.Orleans.Hosting',
  ]);
  assert.equal(nodeOf(tree, 'p:microsoft.orleans').parent, 'Microsoft.Orleans');
});

test('dot boundaries keep Microsoft.OrleansExtra out of the Microsoft.Orleans family', () => {
  const rows = rowsOf(...orleansIds);
  const tree = model.buildTree(rows);
  assert.deepEqual(outline(tree), [
    '+ Microsoft (3)',
    '  + Microsoft.Orleans (2)',
    '    - Microsoft.Orleans',
    '    - Microsoft.Orleans.Hosting',
    '  - Microsoft.OrleansExtra',
  ]);
  const orleans = groupOf(tree, 'g:microsoft.orleans');
  assert.deepEqual(idsOf(orleans.rows), ['Microsoft.Orleans', 'Microsoft.Orleans.Hosting']);
  assert.deepEqual(model.collectKeys(orleans), keysOf(rows.slice(0, 2)));
  assert.equal(nodeOf(tree, 'p:microsoft.orleansextra').parent, 'Microsoft');
  assert.deepEqual(outline(model.familyNav(rows)), ['+ Microsoft (3)', '  + Microsoft.Orleans (2)']);
});

test('declarations of one package across files aggregate under one package node in file then position order', () => {
  const web = row('Newtonsoft.Json', { ...inFile('src/Web/Web.csproj'), start: 50 });
  const apiLate = row('Newtonsoft.Json', { ...inFile('src/Api/Api.csproj'), start: 300 });
  const apiEarly = row('Newtonsoft.Json', { ...inFile('src/Api/Api.csproj'), start: 100 });
  const bson = row('Newtonsoft.Json.Bson');
  const tree = model.buildTree([web, apiLate, bson, apiEarly]);
  assert.deepEqual(outline(tree), ['+ Newtonsoft.Json (2)', '  - Newtonsoft.Json', '  - Newtonsoft.Json.Bson']);
  assert.deepEqual(keysOf(nodeOf(tree, 'p:newtonsoft.json').rows), [apiEarly.key, apiLate.key, web.key]);
  const family = groupOf(tree, 'g:newtonsoft.json');
  assert.equal(family.count, 2, 'the family counts distinct packages, not declarations');
  assert.equal(family.rows.length, 4);
});

test('the same package ID merges case-insensitively under the first spelling', () => {
  const first = row('Serilog.Sinks.File', inFile('src/Api/Api.csproj'));
  const variant = row('serilog.sinks.file', inFile('src/Web/Web.csproj'));
  const tree = model.buildTree([first, variant, row('Serilog.Sinks.Console')]);
  assert.deepEqual(outline(tree), ['+ Serilog.Sinks (2)', '  - Serilog.Sinks.Console', '  - Serilog.Sinks.File']);
  assert.deepEqual(keysOf(nodeOf(tree, 'p:serilog.sinks.file').rows), [first.key, variant.key]);

  const [only, ...rest] = model.buildTree([first, variant]);
  assert.equal(rest.length, 0, 'two spellings of one package are not a family of two');
  assert.deepEqual([only.type, only.id, only.count, only.rows.length], ['package', 'p:serilog.sinks.file', 1, 2]);
});

test('families come only from engine chains: a row without a chain is a plain package', () => {
  const legacy = row('Contoso.Legacy', { families: [] });
  assert.deepEqual(outline(model.buildTree([legacy, row('Contoso.Core')])), ['- Contoso.Core', '- Contoso.Legacy']);
  assert.deepEqual(model.filterRows([legacy], { family: 'contoso.legacy' }), [legacy]);
  assert.deepEqual(model.filterRows([legacy], { family: 'Contoso' }), []);
});

test('every tree holds each declaration once and shows only real families of two or more packages', () => {
  const files = ['Directory.Packages.props', 'src/Api/Api.csproj', 'src/Web/Web.csproj'];
  const bulk = ['Microsoft.Extensions', 'Microsoft.AspNetCore', 'Azure.Storage.Blobs', 'OpenTelemetry.Instrumentation']
    .flatMap((family) => ['Abstractions', 'Core', 'Http', 'Logging', 'Options'].map((leaf) => `${family}.${leaf}`))
    .flatMap((id) => files.map((file, index) => row(id, { ...inFile(file), start: 100 + index })));
  const mixed = [...bulk, ...rowsOf(...orleansIds, 'MicrosoftExtensions.Core', 'Serilog', 'xunit')];
  for (const rows of [rowsOf(...aspireIds), rowsOf(...orleansIds), mixed]) {
    const tree = model.buildTree(rows);
    assert.deepEqual(verifyTree(tree).sort(), keysOf(rows).sort());
    assert.deepEqual(model.buildTree([...rows].reverse()), tree, 'declaration order must not change the tree');
  }
  assert.deepEqual(model.buildTree([]), []);
  assert.deepEqual(model.familyNav([]), []);
});

test('query matches package IDs and file labels case-insensitively; the file filter is exact', () => {
  const api = inFile('src/Api/Api.csproj');
  const web = inFile('src/Web/Web.csproj');
  const rows = [
    row('Microsoft.Orleans', api),
    row('Microsoft.Orleans.Hosting', api),
    row('Microsoft.OrleansExtra', web),
    row('Newtonsoft.Json', web),
    row('Serilog', api),
  ];
  const idsFor = (filters?: Filters) => idsOf(model.filterRows(rows, filters));
  assert.deepEqual(idsFor(), idsOf(rows));
  assert.deepEqual(idsFor({ query: '   ' }), idsOf(rows));
  assert.deepEqual(idsFor({ query: 'ORLEANS' }), orleansIds);
  assert.deepEqual(idsFor({ query: '  json ' }), ['Newtonsoft.Json']);
  assert.deepEqual(idsFor({ query: 'src/WEB/' }), ['Microsoft.OrleansExtra', 'Newtonsoft.Json']);
  assert.deepEqual(idsFor({ query: 'nothing matches' }), []);
  assert.deepEqual(idsFor({ file: api.file }), [...orleansFamily, 'Serilog']);
  assert.deepEqual(idsFor({ file: web.file }), ['Microsoft.OrleansExtra', 'Newtonsoft.Json']);
  assert.deepEqual(idsFor({ file: `${workspace}/src/Api` }), [], 'a file filter must match the whole file URI');
});

test('kind filters fold revision and prerelease into other and exclude rows without an update kind', () => {
  const rows = [
    row('Contoso.Major', { updateKind: 'major' }),
    row('Contoso.Minor', { updateKind: 'minor' }),
    row('Contoso.Patch', { updateKind: 'patch' }),
    row('Contoso.Revision', { updateKind: 'revision' }),
    row('Contoso.Prerelease', { updateKind: 'prerelease' }),
    row('Contoso.Current', asStatus('current')),
  ];
  const idsFor = (...kinds: string[]) => idsOf(model.filterRows(rows, { kinds }));
  assert.deepEqual(idsFor(), idsOf(rows), 'no chosen kind keeps every row, including up-to-date ones');
  assert.deepEqual(idsFor('major'), ['Contoso.Major']);
  assert.deepEqual(idsFor('minor', 'patch'), ['Contoso.Minor', 'Contoso.Patch']);
  assert.deepEqual(idsFor('other'), ['Contoso.Revision', 'Contoso.Prerelease']);
  assert.deepEqual(idsFor('major', 'minor', 'patch', 'other'), idsOf(rows).slice(0, 5));
});

test('family filters match exact chain membership, never sibling prefixes, and combine with other filters', () => {
  const api = inFile('src/Api/Api.csproj');
  const rows = [
    row('Microsoft.Orleans', { ...api, updateKind: 'major' }),
    row('Microsoft.Orleans.Hosting', { ...api, updateKind: 'minor' }),
    row('Microsoft.OrleansExtra', { updateKind: 'patch' }),
    row('MicrosoftExtensions.Core', { ...api, updateKind: 'minor' }),
    row('Serilog', api),
  ];
  const idsFor = (filters: Filters) => idsOf(model.filterRows(rows, filters));
  assert.deepEqual(idsFor({ family: 'microsoft.ORLEANS' }), orleansFamily);
  assert.deepEqual(idsFor({ family: 'Microsoft' }), orleansIds);
  assert.deepEqual(idsFor({ family: 'Microsoft.OrleansExtra' }), ['Microsoft.OrleansExtra']);
  assert.deepEqual(idsFor({ family: 'Serilog' }), ['Serilog']);
  for (const partial of ['Orleans', 'Microsoft.Orlean', 'Micro', 'Microsoft.'])
    assert.deepEqual(idsFor({ family: partial }), [], `${partial} is not a family of any package`);
  const combined = { query: 'orleans', file: api.file, kinds: ['major', 'minor'], family: 'Microsoft' };
  assert.deepEqual(idsFor(combined), orleansFamily);
  assert.deepEqual(idsFor({ ...combined, kinds: ['patch'] }), []);
});

test('a family action collects only declarations that survive the view filters', () => {
  const hosting = row('Microsoft.Orleans.Hosting', { updateKind: 'minor' });
  const clustering = row('Microsoft.Orleans.Clustering', { updateKind: 'patch' });
  const server = row('Microsoft.Orleans.Server', { updateKind: 'major' });
  const all = [hosting, clustering, server];
  const [wholeFamily] = model.buildTree(all);
  assert.deepEqual(model.collectKeys(wholeFamily).sort(), keysOf(all).sort());

  const [visibleFamily] = model.buildTree(model.filterRows(all, { kinds: ['minor', 'patch'] }));
  assert.deepEqual([visibleFamily.type, visibleFamily.id, visibleFamily.count], ['group', 'g:microsoft.orleans', 2]);
  assert.deepEqual(model.collectKeys(visibleFamily).sort(), [clustering.key, hosting.key].sort());

  const [lastVisible] = model.buildTree(model.filterRows(all, { kinds: ['minor'] }));
  assert.equal(lastVisible.type, 'package', 'a family of one visible package dissolves into a plain row');
  assert.deepEqual(model.collectKeys(lastVisible), [hosting.key]);
});

test('collectKeys returns update declarations by default and every declaration on request', () => {
  const core = row('Contoso.Core', { start: 10 });
  const coreCurrent = row('Contoso.Core', { start: 200, ...asStatus('current') });
  const data = row('Contoso.Data', { ...asStatus('error'), error: 'Feed unavailable' });
  const web = row('Contoso.Web', asStatus('unchecked'));
  const tree = model.buildTree([core, coreCurrent, data, web]);
  const family = nodeOf(tree, 'g:contoso');
  assert.deepEqual(model.collectKeys(family), [core.key]);
  assert.deepEqual(model.collectKeys(family, true), [core.key]);
  assert.deepEqual(model.collectKeys(family, false), [core.key, coreCurrent.key, data.key, web.key]);
  assert.deepEqual(model.collectKeys(nodeOf(tree, 'p:contoso.core')), [core.key]);
  assert.deepEqual(model.collectKeys(nodeOf(tree, 'p:contoso.data')), []);
  assert.deepEqual(model.collectKeys({}), [], 'a node without rows selects nothing');
});

test('group, package and declaration checkboxes are tri-state and conditional declarations stay separate', () => {
  assert.equal(model.selectionState([], new Set(['a'])), 'none', 'nothing selectable is never checked');
  assert.equal(model.selectionState(['a', 'b'], new Set(['c'])), 'none');
  assert.equal(model.selectionState(['a', 'b'], new Set(['a', 'c'])), 'some');
  assert.equal(model.selectionState(['a', 'b'], new Set(['b', 'a', 'c'])), 'all');

  const apiFile = inFile('src/Api/Api.csproj');
  const api = row('Newtonsoft.Json', { ...apiFile, start: 100 });
  const conditional = row('Newtonsoft.Json', { ...apiFile, start: 400, condition: "'$(TFM)' == 'net10.0'" });
  const bson = row('Newtonsoft.Json.Bson');
  const current = row('Newtonsoft.Json.Schema', asStatus('current'));
  const tree = model.buildTree([api, conditional, bson, current]);
  const [family, json, schema] = ['g:newtonsoft.json', 'p:newtonsoft.json', 'p:newtonsoft.json.schema'].map((id) =>
    nodeOf(tree, id),
  );
  assert.notEqual(api.key, conditional.key);
  const selected = new Set(['file:///elsewhere#1:2:Other.Package']);
  const states = () => [family, json, schema].map((node) => model.selectionState(model.collectKeys(node), selected));
  assert.deepEqual(states(), ['none', 'none', 'none']);
  selected.add(api.key);
  assert.deepEqual(states(), ['some', 'some', 'none']);
  assert.equal(model.selectionState([api.key], selected), 'all');
  assert.equal(model.selectionState([conditional.key], selected), 'none');
  selected.add(conditional.key);
  assert.deepEqual(states(), ['some', 'all', 'none']);
  selected.add(bson.key);
  assert.deepEqual(states(), ['all', 'all', 'none'], 'up-to-date declarations are not selectable');
  selected.delete(api.key);
  assert.deepEqual(states(), ['some', 'some', 'none']);
});

test('familyNav lists nested families only, with distinct-package counts', () => {
  const nav = model.familyNav(rowsOf(...aspireIds));
  assert.deepEqual(outline(nav), ['+ Aspire (6)', '  + Aspire.Hosting (4)', '    + Aspire.Hosting.Azure (2)']);
  const [aspire] = nav;
  const [hosting] = aspire.children;
  const [azure] = hosting.children;
  assert.deepEqual(
    [aspire, hosting, azure].map((node) => [node.type, node.id, node.parent, node.count]),
    [
      ['group', 'g:aspire', '', 6],
      ['group', 'g:aspire.hosting', 'Aspire', 4],
      ['group', 'g:aspire.hosting.azure', 'Aspire.Hosting', 2],
    ],
  );
  assert.deepEqual(azure.children, []);
  assert.deepEqual(model.familyNav(rowsOf('xunit', 'Newtonsoft.Json')), [], 'no family of fewer than two packages');
});

test('walk visits nodes depth-first with their depth and parent id', () => {
  const visited: Array<[string, number, string]> = [];
  const tree = model.buildTree(rowsOf(...aspireIds));
  model.walk(tree, (node, depth, parentId) => visited.push([node.id, depth, parentId]));
  assert.deepEqual(visited, [
    ['g:aspire', 0, ''],
    ['p:aspire.azure.data.tables', 1, 'g:aspire'],
    ['g:aspire.hosting', 1, 'g:aspire'],
    ['g:aspire.hosting.azure', 2, 'g:aspire.hosting'],
    ['p:aspire.hosting.azure.cosmosdb', 3, 'g:aspire.hosting.azure'],
    ['p:aspire.hosting.azure.storage', 3, 'g:aspire.hosting.azure'],
    ['p:aspire.hosting.javascript', 2, 'g:aspire.hosting'],
    ['p:aspire.hosting.orleans', 2, 'g:aspire.hosting'],
    ['p:aspire.microsoft.entityframeworkcore.cosmos', 1, 'g:aspire'],
  ]);
  const nav = model.familyNav(rowsOf(...aspireIds));
  assert.deepEqual(visitedIds(nav), ['g:aspire', 'g:aspire.hosting', 'g:aspire.hosting.azure']);
});

test('walk skips the children of groups that the open callback rejects', () => {
  const tree = model.buildTree(rowsOf(...aspireIds));
  assert.deepEqual(
    visitedIds(tree, (node) => node.id !== 'g:aspire.hosting'),
    ['g:aspire', 'p:aspire.azure.data.tables', 'g:aspire.hosting', 'p:aspire.microsoft.entityframeworkcore.cosmos'],
  );
  assert.deepEqual(
    visitedIds(tree, () => false),
    ['g:aspire'],
  );
});

test('summarize counts distinct packages once per status and every declaration', () => {
  const rows = [
    row('Contoso.Core', inFile('a.csproj')),
    row('Contoso.Core', { ...inFile('b.csproj'), start: 500 }),
    row('contoso.core', { ...inFile('c.csproj'), ...asStatus('current') }),
    row('Contoso.Data', asStatus('current')),
    row('Contoso.Web', { ...asStatus('error'), error: 'Feed unavailable' }),
    row('Contoso.Jobs', asStatus('checking')),
    row('Contoso.Mail', asStatus('unchecked')),
  ];
  const counts: Counts = { packages: 5, declarations: 7, updates: 1, current: 2, failed: 1, checking: 1, unchecked: 1 };
  assert.deepEqual(model.summarize(rows), counts);
  assert.deepEqual(model.summarize([]), Object.fromEntries(Object.keys(counts).map((key) => [key, 0])));
});

test('versionDiff separates the shared prefix from the changed tail at dot, dash and plus boundaries', () => {
  const cases: Array<[string, string, string, string]> = [
    ['13.6.0', '13.6.1', '13.6.', '1'],
    ['12.12.0', '12.13.0', '12.', '13.0'],
    ['1.0.0', '2.0.0', '', '2.0.0'],
    ['1.0', '1.0.1', '1.0.', '1'],
    ['1.2.3', '1.2.3.1', '1.2.3.', '1'],
    ['1.0.0-alpha', '1.0.0-beta', '1.0.0-', 'beta'],
    ['1.0.0', '1.0.1-beta.1', '1.0.', '1-beta.1'],
    ['1.0.0+abc', '1.0.0+abd', '1.0.0+', 'abd'],
    ['', '2.0.0', '', '2.0.0'],
    ['1.2.3', '1.2.3', '1.2.3', ''],
  ];
  for (const [from, to, same, changed] of cases) {
    const diff = model.versionDiff(from, to);
    assert.deepEqual(diff, { same, changed }, `${from} -> ${to}`);
    assert.equal(diff.same + diff.changed, to, `${from} -> ${to} must keep the whole target version`);
  }
});

test('loaded as a classic script it publishes the same API as globalThis.NuGetModel', () => {
  const sandbox: { NuGetModel?: ModelApi } = {};
  runInNewContext(readFileSync(require.resolve(modelPath), 'utf8'), sandbox);
  const published = sandbox.NuGetModel;
  assert.ok(published, 'the webview reads the view-model from globalThis.NuGetModel');
  assert.deepEqual(Object.keys(published).sort(), Object.keys(model).sort());
  const rows = rowsOf(...aspireIds);
  assert.equal(JSON.stringify(published.buildTree(rows)), JSON.stringify(model.buildTree(rows)));
  assert.equal(published.versionDiff('13.6.0', '13.6.1').changed, '1');
});
