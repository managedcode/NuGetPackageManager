import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import * as vscode from 'vscode';

const registration = {
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
      ],
    },
  ],
};

async function startFeed(): Promise<{ url: string; close(): Promise<void> }> {
  let origin = '';
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
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
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

function versionLine(text: string, packageId: string): string | undefined {
  return text.split(/\r?\n/).find((line) => line.includes(packageId));
}

export async function run(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'host test runner must open its isolated fixture workspace');
  const centralUri = vscode.Uri.joinPath(folder.uri, 'Directory.Packages.props');
  const projectUri = vscode.Uri.joinPath(folder.uri, 'App.csproj');
  const malformedUri = vscode.Uri.joinPath(folder.uri, 'Malformed.csproj');
  const originalCentral = await readFile(centralUri.fsPath, 'utf8');
  assert.match(originalCentral, /\r\n/, 'fixture must exercise CRLF preservation');

  const extensionId = process.env.NUGET_WORKBENCH_EXTENSION_ID;
  assert.ok(extensionId, 'host runner must identify the extension from its current manifest');
  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, 'the packaged extension must activate in the real VS Code host');
  const openCommand = extension.packageJSON.contributes.commands.find((command: { command?: string }) =>
    command.command?.endsWith('.open'),
  ).command;
  const commandPrefix = openCommand.slice(0, -'.open'.length);
  const feed = await startFeed();
  try {
    await vscode.workspace
      .getConfiguration(commandPrefix)
      .update('feeds', [{ name: 'Host test feed', url: feed.url }], vscode.ConfigurationTarget.Workspace);
    const workbench = await extension.activate();
    for (const method of ['getState', 'refresh', 'check', 'review', 'apply']) {
      assert.equal(
        typeof (workbench as unknown as Record<string, unknown>)[method],
        'function',
        `activation must return the public Workbench API method ${method}`,
      );
    }
    await vscode.commands.executeCommand(openCommand);
    while (workbench.getState().busy) await new Promise((resolve) => setTimeout(resolve, 20));
    await vscode.commands.executeCommand(`${commandPrefix}.checkUpdates`);
    await workbench.check();
    const initialScan = workbench.refresh();
    const queuedCheck = workbench.refresh(true);
    await Promise.all([initialScan, queuedCheck]);
    let state = workbench.getState();
    const central = state.rows.find((row: { packageId: string }) => row.packageId === 'Central.Package');
    const regular = state.rows.find((row: { packageId: string }) => row.packageId === 'Regular.Package');
    const childVersions = state.rows.filter((row: { packageId: string }) => row.packageId === 'Child.Version.Package');
    const policyRow = state.rows.find((row: { packageId: string }) => row.packageId === 'Policy.Package');
    assert.ok(central && regular, 'central and ordinary project declarations must both be discovered');
    assert.equal(childVersions.length, 2, 'child Version elements must remain independently selectable');
    assert.notEqual(childVersions[0].key, childVersions[1].key);
    assert.ok(policyRow);
    assert.equal(
      central.status,
      'update',
      `central declaration should have a listed target: ${JSON.stringify(central)}`,
    );
    assert.equal(
      regular.status,
      'update',
      `project declaration should have a listed target: ${JSON.stringify(regular)}`,
    );
    assert.ok(
      state.notices.some((notice: string) => notice.includes('Ignored.Package')),
      'property declarations must be reported as ignored',
    );
    assert.equal(
      state.rows.some((row: { packageId: string }) => row.packageId === 'Ignored.Package'),
      false,
    );

    const sendHostMessage = (message: unknown) =>
      (workbench as unknown as { message(value: unknown): Promise<void> }).message(message);
    await sendHostMessage({ type: 'policy', policy: 'patch', prerelease: false });
    const patchOnly = workbench
      .getState()
      .rows.find((row: { packageId: string }) => row.packageId === 'Policy.Package');
    assert.deepEqual(patchOnly.versions, ['1.0.1']);
    assert.equal(patchOnly.target, '1.0.1');
    await sendHostMessage({ type: 'policy', policy: 'latest', prerelease: false });

    const orleansFamily = workbench
      .getState()
      .rows.filter((row: { families: string[] }) => row.families.includes('Microsoft.Orleans'));
    assert.deepEqual(orleansFamily.map((row: { packageId: string }) => row.packageId).sort(), [
      'Microsoft.Orleans.Core',
      'Microsoft.Orleans.Hosting',
    ]);
    await workbench.review(orleansFamily.map((row: { key: string }) => row.key));
    assert.deepEqual(
      workbench
        .getState()
        .plan.map((change: { key: string }) => change.key)
        .sort(),
      orleansFamily.map((row: { key: string }) => row.key).sort(),
      'reviewing a dotted family must include every matching declaration',
    );

    await workbench.review([childVersions[0].key]);
    await workbench.apply();
    let projectText = (await vscode.workspace.openTextDocument(projectUri)).getText();
    assert.match(projectText, /<Version Condition="Debug">2\.0\.0<\/Version>/);
    assert.match(projectText, /<Version Condition="Release">1\.0\.0<\/Version>/);

    await workbench.refresh(true);
    const refreshedCentral = workbench
      .getState()
      .rows.find((row: { packageId: string }) => row.packageId === 'Central.Package');
    assert.ok(refreshedCentral);
    await workbench.review([refreshedCentral.key]);
    assert.equal(workbench.getState().plan.length, 1);

    const repeatedReview = workbench.review([refreshedCentral.key]);
    assert.equal(workbench.getState().plan, undefined, 'starting a second review must clear the earlier plan');
    const malformedDocument = await vscode.workspace.openTextDocument(malformedUri);
    const malformedEditor = await vscode.window.showTextDocument(malformedDocument);
    await malformedEditor.edit((edit) => edit.insert(new vscode.Position(0, 0), ' '));
    const invalidatedCentral = workbench
      .getState()
      .rows.find((row: { key: string }) => row.key === refreshedCentral.key);
    assert.equal(invalidatedCentral.status, 'unchecked');
    assert.deepEqual(invalidatedCentral.versions, []);
    await assert.rejects(repeatedReview, /changed after discovery|changed during review/i);
    assert.equal(workbench.getState().plan, undefined, 'a failed second review must not restore the earlier plan');
    let centralText = (await vscode.workspace.openTextDocument(centralUri)).getText();
    assert.match(
      versionLine(centralText, 'Central.Package') ?? '',
      /Version="1\.0\.0"/,
      'a changed nonselected malformed project must reject review without editing the selected file',
    );

    await workbench.refresh(true);
    state = workbench.getState();
    const afterMalformedChange = state.rows.find((row: { packageId: string }) => row.packageId === 'Central.Package');
    assert.ok(afterMalformedChange && afterMalformedChange.status === 'update');
    await workbench.review([afterMalformedChange.key]);
    assert.deepEqual(
      workbench.getState().plan.map((change: { key: string }) => change.key),
      [afterMalformedChange.key],
    );
    await workbench.apply();
    centralText = (await vscode.workspace.openTextDocument(centralUri)).getText();
    projectText = (await vscode.workspace.openTextDocument(projectUri)).getText();
    assert.match(versionLine(centralText, 'Central.Package') ?? '', /Version="2\.0\.0"/);
    assert.match(versionLine(projectText, 'Regular.Package') ?? '', /Version="1\.0\.0"/);
    assert.match(centralText, /<!-- preserve this comment -->\r\n/);
    assert.equal(centralText.includes('\n') && !centralText.includes('\r\n'), false, 'central file must retain CRLF');

    await vscode.window.showTextDocument(centralUri);
    await vscode.commands.executeCommand('undo');
    centralText = (await vscode.workspace.openTextDocument(centralUri)).getText();
    assert.match(
      versionLine(centralText, 'Central.Package') ?? '',
      /Version="1\.0\.0"/,
      'editor undo must revert the applied version edit',
    );

    await workbench.refresh(true);
    state = workbench.getState();
    const staleCentral = state.rows.find((row: { packageId: string }) => row.packageId === 'Central.Package');
    const staleRegular = state.rows.find((row: { packageId: string }) => row.packageId === 'Regular.Package');
    assert.ok(staleCentral && staleRegular);
    assert.equal(
      staleCentral.status,
      'update',
      `central declaration should be selectable again after undo: ${JSON.stringify(staleCentral)}`,
    );
    assert.equal(
      staleRegular.status,
      'update',
      `project declaration should be selectable again after undo: ${JSON.stringify(staleRegular)}`,
    );
    await workbench.review([staleCentral.key, staleRegular.key]);

    const projectDocument = await vscode.workspace.openTextDocument(projectUri);
    const versionOffset = projectDocument.getText().indexOf('Version="1.0.0"') + 'Version="'.length;
    const editor = await vscode.window.showTextDocument(projectDocument);
    await editor.edit((edit) =>
      edit.replace(
        new vscode.Range(projectDocument.positionAt(versionOffset), projectDocument.positionAt(versionOffset + 5)),
        '1.0.1',
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(workbench.getState().plan, undefined, 'an editor change must invalidate the complete reviewed plan');
    const invalidated = workbench.getState().rows.find((row: { key: string }) => row.key === staleCentral.key);
    assert.deepEqual(invalidated.versions, []);
    assert.equal(invalidated.target, undefined);
    await sendHostMessage({ type: 'target', key: staleCentral.key, version: '2.0.0' });
    assert.equal(
      workbench.getState().rows.find((row: { key: string }) => row.key === staleCentral.key).target,
      undefined,
    );
    await workbench.apply();
    await assert.rejects(
      workbench.review([staleCentral.key, staleRegular.key]),
      /select available updates/,
      'stale selections must be reviewed again',
    );

    centralText = (await vscode.workspace.openTextDocument(centralUri)).getText();
    projectText = (await vscode.workspace.openTextDocument(projectUri)).getText();
    assert.match(
      versionLine(centralText, 'Central.Package') ?? '',
      /Version="1\.0\.0"/,
      'the other reviewed file must remain untouched after stale rejection',
    );
    assert.match(
      versionLine(projectText, 'Regular.Package') ?? '',
      /Version="1\.0\.1"/,
      'the concurrent editor change must be retained',
    );
    assert.equal(projectDocument.isDirty, true, 'the extension must not save a concurrent unsaved edit');
    console.log('VS Code host integration passed: shared engine, family review, snapshots, edits and undo.');
  } finally {
    await feed.close();
    // Assertions above verify dirty buffers. Save only the generated test workspace before shutting down the host.
    await vscode.workspace.saveAll(false);
  }
}
