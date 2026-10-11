import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as vscode from 'vscode';
import { poll, type WorkbenchApi } from './hostSupport';

function projectText(packageId: string): string {
  return [
    '<Project Sdk="Microsoft.NET.Sdk">',
    '  <!-- preserve this comment -->',
    '  <ItemGroup>',
    `    <PackageReference Include="${packageId}" Version="1.0.0" />`,
    '  </ItemGroup>',
    '</Project>',
    '',
  ].join('\r\n');
}

function textTabs(uris: vscode.Uri[]): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => {
      const input = tab.input;
      return input instanceof vscode.TabInputText && uris.some((uri) => uri.toString() === input.uri.toString());
    });
}

/** AC-022: close an actual clean document after snapshot validation, before the real WorkspaceEdit. */
export async function runDocumentLifetimeScenario(workbench: WorkbenchApi, extensionPath: string): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  const fixture = vscode.Uri.joinPath(folder.uri, '.host-document-lifecycle');
  const uris = ['CleanA.csproj', 'CleanB.csproj', 'Dirty.csproj'].map((name) => vscode.Uri.joinPath(fixture, name));
  const originals = [projectText('Central.Package'), projectText('Regular.Package'), projectText('Regular.Package')];
  // VS Code creates API objects per extension. The temporary host-test bundle otherwise gets the fallback API.
  const extensionApi = createRequire(path.join(extensionPath, 'dist', 'extension.js'))('vscode') as typeof vscode;
  const originalApply = extensionApi.workspace.applyEdit;
  let dirtyDocument: vscode.TextDocument | undefined;
  let intercepted = false;
  try {
    await mkdir(fixture.fsPath, { recursive: true });
    await Promise.all(uris.map((uri, index) => writeFile(uri.fsPath, originals[index], 'utf8')));
    assert.equal(
      workbench.getState().autoCheck,
      false,
      'the explicit lifecycle scenario requires automatic checks off',
    );
    const oldCleanDocument = await vscode.workspace.openTextDocument(uris[0]);
    assert.equal(oldCleanDocument.isDirty, false);
    await vscode.window.showTextDocument(oldCleanDocument, { preview: false });
    dirtyDocument = await vscode.workspace.openTextDocument(uris[2]);
    const editor = await vscode.window.showTextDocument(dirtyDocument, { preview: false });
    const marker = '  <!-- existing unsaved change -->\r\n';
    assert.equal(await editor.edit((edit) => edit.insert(new vscode.Position(1, 0), marker)), true);
    const dirtyBefore = dirtyDocument.getText();
    await workbench.refresh(true);
    const selected = workbench.getState().rows.filter((row) => uris.some((uri) => uri.toString() === row.file));
    assert.equal(selected.length, 3);
    assert.ok(selected.every((row) => row.status === 'update' && row.target === '2.0.0'));
    await workbench.review(selected.map((row) => row.key));
    assert.equal(workbench.getState().plan?.length, 3);
    assert.equal(Object.isFrozen(extensionApi.workspace), false, 'the extension workspace API supports a scoped hook');
    extensionApi.workspace.applyEdit = async (edit, metadata) => {
      assert.equal(intercepted, false, 'the reviewed version edit must be intercepted exactly once');
      intercepted = true;
      assert.equal(edit.get(uris[0]).length, 1, 'the selected clean file must be in the real edit');
      assert.equal(oldCleanDocument.isDirty, false, 'the pre-edit model remains clean before closing it');
      assert.equal(await vscode.window.tabGroups.close(textTabs([uris[0]])), true);
      // Tab closure leaves API model references cached for three minutes. A native file delete releases them.
      // Replace only this isolated clean fixture, restoring its exact bytes before the reviewed version edit.
      const deletion = new vscode.WorkspaceEdit();
      deletion.deleteFile(uris[0]);
      assert.equal(await originalApply.call(extensionApi.workspace, deletion), true);
      await poll('the original clean document to close', () => (oldCleanDocument.isClosed ? true : undefined), 10_000);
      // TextDocument is frozen: use the native save rejection, never replace save() or its result.
      await assert.rejects(Promise.resolve(oldCleanDocument.save()), /Document has been closed/);
      await vscode.workspace.fs.writeFile(uris[0], Buffer.from(originals[0], 'utf8'));
      return originalApply.call(extensionApi.workspace, edit, metadata);
    };
    await workbench.apply();
    assert.equal(intercepted, true, 'the hook must intercept the extension-owned API used by Workbench');
    assert.equal(oldCleanDocument.isClosed, true, 'Apply must not resurrect the pre-edit handle');
    for (let index = 0; index < 2; index++) {
      const current = await vscode.workspace.openTextDocument(uris[index]);
      const expected = originals[index].replace('Version="1.0.0"', 'Version="2.0.0"');
      assert.equal(current.getText(), expected, 'clean editor content must preserve comments and CRLF');
      assert.equal(current.isDirty, false, 'previously clean files must be saved after acquiring current documents');
      assert.equal(await readFile(uris[index].fsPath, 'utf8'), expected, 'every changed clean file must reach disk');
      if (!index) assert.notEqual(current, oldCleanDocument, 'the save must use the new live model');
    }
    assert.equal(dirtyDocument.getText(), dirtyBefore.replace('Version="1.0.0"', 'Version="2.0.0"'));
    assert.equal(dirtyDocument.isDirty, true, 'the existing unsaved change must stay unsaved with its package update');
    assert.equal(await readFile(uris[2].fsPath, 'utf8'), originals[2], 'Apply must not save a previously dirty buffer');
    assert.equal(workbench.getState().plan, undefined, 'the applied review must be discarded');
  } finally {
    extensionApi.workspace.applyEdit = originalApply;
    // These buffers belong only to the isolated scenario, and their dirty-state assertions have finished.
    if (dirtyDocument && !dirtyDocument.isClosed) await dirtyDocument.save();
    await vscode.window.tabGroups.close(textTabs(uris));
    await rm(fixture.fsPath, { recursive: true, force: true });
  }
}
