import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PackageRow } from '../../../src/Features/PackageUpdates/Contracts/types';

// REQ-009 / AC-013: the groups-first view of the shipped renderer view-model (media/Features/PackageUpdates/model.js).

type PackageNode = { type: 'package'; id: string; name: string; rows: PackageRow[] };
type Subgroup = { id: string; name: string; count: number; rows: PackageRow[] };
type Group = {
  id: string;
  name: string;
  other?: boolean;
  count: number;
  rows: PackageRow[];
  subgroups: Subgroup[];
  packages: PackageNode[];
};

interface GroupsApi {
  groupView(rows: PackageRow[], shown?: PackageRow[]): Group[];
  packageList(rows: PackageRow[]): PackageNode[];
  collectKeys(node: { rows?: PackageRow[] }, updatesOnly?: boolean): string[];
  filterRows(rows: PackageRow[], filters?: { query?: string; kinds?: string[] }): PackageRow[];
}

const modelPath = '../../../media/Features/PackageUpdates/model.js';
const model = require(modelPath) as GroupsApi;
const props = 'file:///workspace/Directory.Packages.props';

/** Declaration row shaped like the host scan result, with the engine's dotted-prefix family chain. */
function row(packageId: string, overrides: Partial<PackageRow> = {}): PackageRow {
  const parts = packageId.split('.');
  return {
    key: `${overrides.file ?? props}#${packageId}`,
    packageId,
    version: '1.0.0',
    start: 0,
    end: 5,
    kind: 'PackageVersion',
    group: parts[0],
    families: parts.map((_, index) => parts.slice(0, index + 1).join('.')),
    file: props,
    fileLabel: 'Directory.Packages.props',
    versions: ['1.0.1'],
    target: '1.0.1',
    updateKind: 'patch',
    status: 'update',
    ...overrides,
  };
}

const workspace = [
  'AngleSharp',
  'Aspire.Azure.Data.Tables',
  'Aspire.Hosting.Azure.CosmosDB',
  'Aspire.Hosting.Azure.Storage',
  'Aspire.Hosting.JavaScript',
  'Aspire.Hosting.Orleans',
  'Aspire.Microsoft.EntityFrameworkCore.Cosmos',
  'Microsoft.Extensions.Http',
  'Microsoft.Extensions.Logging',
  'Microsoft.Orleans',
  'Microsoft.Orleans.Core',
  'Microsoft.Orleans.Server',
  'Microsoft.OrleansExtra',
  'Polly',
].map((id) => row(id));

test('top-level families become groups and packages outside any family share the other group', () => {
  const groups = model.groupView(workspace);
  assert.deepEqual(
    groups.map((group) => [group.id, group.name, group.count]),
    [
      ['g:aspire', 'Aspire', 6],
      ['g:microsoft', 'Microsoft', 6],
      ['g:*', '', 2],
    ],
  );
  const other = groups.at(-1)!;
  assert.equal(other.other, true);
  assert.deepEqual(
    other.packages.map((node) => node.name),
    ['AngleSharp', 'Polly'],
  );
});

test('nested families flatten into subgroups and packages list in name order inside the group', () => {
  const aspire = model.groupView(workspace).find((group) => group.id === 'g:aspire')!;
  assert.deepEqual(
    aspire.subgroups.map((sub) => [sub.name, sub.count]),
    [
      ['Aspire.Hosting', 4],
      ['Aspire.Hosting.Azure', 2],
    ],
  );
  assert.deepEqual(
    aspire.packages.map((node) => node.name),
    [
      'Aspire.Azure.Data.Tables',
      'Aspire.Hosting.Azure.CosmosDB',
      'Aspire.Hosting.Azure.Storage',
      'Aspire.Hosting.JavaScript',
      'Aspire.Hosting.Orleans',
      'Aspire.Microsoft.EntityFrameworkCore.Cosmos',
    ],
  );
  assert.equal(model.collectKeys(aspire).length, 6);
});

test('the Microsoft.Orleans subgroup keeps its root package and never includes Microsoft.OrleansExtra', () => {
  const microsoft = model.groupView(workspace).find((group) => group.id === 'g:microsoft')!;
  const orleans = microsoft.subgroups.find((sub) => sub.id === 'g:microsoft.orleans')!;
  assert.deepEqual(orleans.rows.map((item) => item.packageId).sort(), [
    'Microsoft.Orleans',
    'Microsoft.Orleans.Core',
    'Microsoft.Orleans.Server',
  ]);
  assert.ok(microsoft.packages.some((node) => node.name === 'Microsoft.OrleansExtra'));
  assert.ok(!model.collectKeys(orleans).some((key) => key.endsWith('Microsoft.OrleansExtra')));
});

test('filters hide packages inside stable groups instead of regrouping them', () => {
  const visible = model.filterRows(workspace, { query: 'orleans' });
  const groups = model.groupView(workspace, visible);
  assert.deepEqual(
    groups.map((group) => [group.name, group.count]),
    [
      ['Aspire', 1],
      ['Microsoft', 4],
    ],
    'Aspire.Hosting.Orleans stays in Aspire and nothing moves to the other group',
  );
  assert.deepEqual(groups[0].subgroups, [], 'a one-package subgroup offers no extra choice');
  assert.deepEqual(
    groups[1].subgroups.map((sub) => [sub.name, sub.count]),
    [['Microsoft.Orleans', 3]],
  );
  assert.deepEqual(
    groups[1].rows.map((item) => item.packageId),
    ['Microsoft.Orleans', 'Microsoft.Orleans.Core', 'Microsoft.Orleans.Server', 'Microsoft.OrleansExtra'],
  );
});

test('without a filter every row is shown and groups match the unnarrowed view', () => {
  assert.deepEqual(model.groupView(workspace, workspace), model.groupView(workspace));
});

test('a family folded to a deeper prefix names the group after the deepest shared family', () => {
  const groups = model.groupView([row('Microsoft.Extensions.Http'), row('Microsoft.Extensions.Logging')]);
  assert.deepEqual(
    groups.map((group) => [group.id, group.name, group.subgroups.length]),
    [['g:microsoft.extensions', 'Microsoft.Extensions', 0]],
  );
});

test('declarations of one package in several files stay one package node with every declaration', () => {
  const api = 'file:///workspace/tests/Api.Tests.csproj';
  const core = 'file:///workspace/tests/Core.Tests.csproj';
  const groups = model.groupView([
    row('xunit.v3', { file: api, fileLabel: 'tests/Api.Tests.csproj', kind: 'PackageReference' }),
    row('xunit.v3', { file: core, fileLabel: 'tests/Core.Tests.csproj', kind: 'PackageReference' }),
    row('xunit.runner.visualstudio'),
  ]);
  const xunit = groups.find((group) => group.id === 'g:xunit')!;
  assert.equal(xunit.count, 2);
  const v3 = xunit.packages.find((node) => node.name === 'xunit.v3')!;
  assert.deepEqual(
    v3.rows.map((item) => item.fileLabel),
    ['tests/Api.Tests.csproj', 'tests/Core.Tests.csproj'],
  );
  assert.equal(model.collectKeys(xunit).length, 3);
});

test('only available updates are collected for a group action, never current or failed rows', () => {
  const rows = [
    row('Contoso.Api'),
    row('Contoso.Data', { status: 'current', target: undefined, updateKind: undefined, versions: [] }),
    row('Contoso.Jobs', { status: 'error', target: undefined, updateKind: undefined, error: 'feed failed' }),
  ];
  const [contoso] = model.groupView(rows);
  assert.equal(contoso.count, 3);
  assert.deepEqual(model.collectKeys(contoso), [rows[0].key]);
});

test('packageList is flat, name ordered and merges a package across files', () => {
  const other = 'file:///workspace/App.csproj';
  const list = model.packageList([...workspace, row('Polly', { file: other, fileLabel: 'App.csproj' })]);
  const names = list.map((node) => node.name);
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b)),
  );
  assert.equal(names.length, workspace.length);
  assert.equal(list.find((node) => node.name === 'Polly')!.rows.length, 2);
});

test('an empty workspace has no groups and no packages', () => {
  assert.deepEqual(model.groupView([]), []);
  assert.deepEqual(model.packageList([]), []);
});

test('TST-SDK-017 explicit SDK rows join their existing package family without creating absent SDKs', () => {
  const libraries = [row('Aspire.Hosting'), row('Aspire.Hosting.Redis')];
  const sdk = row('Aspire.AppHost.Sdk', { kind: 'Sdk', file: api, fileLabel: 'AppHost.csproj' });
  const groups = model.groupView([...libraries, sdk]);
  const aspire = groups.find((group) => group.name === 'Aspire')!;
  assert.deepEqual(
    aspire.packages.map((node) => node.name),
    ['Aspire.AppHost.Sdk', 'Aspire.Hosting', 'Aspire.Hosting.Redis'],
  );
  assert.equal(aspire.count, 3);
  assert.equal(
    model
      .groupView(libraries)
      .flatMap((group) => group.packages)
      .some((node) => node.name === sdk.packageId),
    false,
  );
});
