import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import {
  startFeed,
  versionLine,
  waitForDocumentText,
  waitForSidebarVisibility,
  waitForPanelDisposal,
  waitForExtensionActivation,
  waitForSidebarResolution,
} from './hostFeed';
import { StateRecorder } from './hostSupport';
import { runSdkFamilyScenario } from './hostSdkScenarios';
import { Scenario, verifyManifestContract, runAutomaticCheckScenarios, verifyRecordedContract } from './hostScenarios';

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
  verifyManifestContract(extension, commandPrefix);
  const startedAt = Date.now();
  const feed = await startFeed();
  let recorder: StateRecorder | undefined;
  try {
    await vscode.workspace
      .getConfiguration(commandPrefix)
      .update('feeds', [{ name: 'Host test feed', url: feed.url }], vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('workbench.view.extension.nugetPackageManager');
    const workbench = (await waitForExtensionActivation(extension)) as Awaited<ReturnType<typeof extension.activate>>;
    assert.equal(extension.isActive, true, 'opening the native NuGet container must activate the extension');
    assert.ok(workbench, 'the native sidebar activation must expose the shared Workbench');
    for (const method of ['getState', 'refresh', 'check', 'review', 'apply']) {
      assert.equal(
        typeof (workbench as unknown as Record<string, unknown>)[method],
        'function',
        `activation must return the public Workbench API method ${method}`,
      );
    }
    const views = (
      workbench as unknown as {
        views: { sidebar?: vscode.WebviewView; panel?: vscode.WebviewPanel };
      }
    ).views;
    // Record before the webview loads: its first `ready` message starts the automatic scan and check.
    const activeRecorder = new StateRecorder(workbench);
    recorder = activeRecorder;
    const resolvedSidebar = await waitForSidebarResolution(views);
    assert.ok(resolvedSidebar, 'opening the native container must resolve its Packages webview');
    await vscode.commands.executeCommand(openCommand);
    await waitForSidebarVisibility(resolvedSidebar, true);
    assert.equal(resolvedSidebar.visible, true, 'the default open command must focus the native sidebar');

    const scenario: Scenario = {
      workbench,
      feed,
      recorder: activeRecorder,
      prefix: commandPrefix,
      projectUri,
      startedAt,
    };
    await runAutomaticCheckScenarios(scenario);
    await runSdkFamilyScenario(scenario);

    // The explicit-flow assertions below run with nugetPackageManager.autoCheck disabled (legacy behavior), so the
    // debounced automatic recheck cannot interleave with their explicit refresh, check, review and apply calls.
    await workbench.refresh();
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

    const sharedReview = workbench
      .getState()
      .plan?.map((change: { key: string }) => change.key)
      .sort();
    assert.ok(sharedReview?.length, 'the sidebar must create a real reviewed plan before opening the editor');
    await vscode.commands.executeCommand(`${commandPrefix}.openEditor`);
    assert.ok(views.panel, 'the optional editor command must open the second webview surface');
    assert.deepEqual(
      workbench
        .getState()
        .plan?.map((change: { key: string }) => change.key)
        .sort(),
      sharedReview,
      'opening the editor surface must preserve the sidebar review',
    );

    const sidebarView = views.sidebar;
    assert.ok(sidebarView);
    const sidebarHidden = waitForSidebarVisibility(sidebarView, false);
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await sidebarHidden;
    assert.equal(sidebarView.visible, false, 'the native sidebar should be hidden by the host command');
    assert.deepEqual(
      workbench
        .getState()
        .plan?.map((change: { key: string }) => change.key)
        .sort(),
      sharedReview,
      'hiding the sidebar must preserve the shared review',
    );
    const sidebarRevealed = waitForSidebarVisibility(sidebarView, true);
    await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
    await sidebarRevealed;
    assert.equal(sidebarView.visible, true, 'the native sidebar should become visible again');
    assert.deepEqual(
      workbench
        .getState()
        .plan?.map((change: { key: string }) => change.key)
        .sort(),
      sharedReview,
      'revealing the sidebar must preserve the shared review',
    );

    const panel = views.panel;
    assert.ok(panel);
    const panelClosed = waitForPanelDisposal(panel);
    panel.reveal();
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await panelClosed;
    assert.equal(views.panel, undefined, 'closing the editor surface must dispose only that surface');
    assert.ok(views.sidebar, 'the native sidebar must remain available after closing the editor');
    assert.deepEqual(
      workbench
        .getState()
        .plan?.map((change: { key: string }) => change.key)
        .sort(),
      sharedReview,
      'closing the editor surface must preserve the sidebar review',
    );
    await workbench.check();
    state = workbench.getState();
    assert.ok(
      state.rows.some(
        (row: { packageId: string; status: string }) => row.packageId === 'Central.Package' && row.status === 'update',
      ),
      'the remaining sidebar surface must continue to support package checks',
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

    await workbench.apply();
    let centralText = (await vscode.workspace.openTextDocument(centralUri)).getText();
    projectText = (await vscode.workspace.openTextDocument(projectUri)).getText();
    assert.match(versionLine(centralText, 'Central.Package') ?? '', /Version="2\.0\.0"/);
    assert.match(versionLine(projectText, 'Regular.Package') ?? '', /Version="1\.0\.0"/);
    assert.match(centralText, /<!-- preserve this comment -->\r\n/);
    assert.equal(centralText.includes('\n') && !centralText.includes('\r\n'), false, 'central file must retain CRLF');
    assert.match(await readFile(centralUri.fsPath, 'utf8'), /Version="2\.0\.0"/);

    const expectedAfterUndo = centralText.replace('Version="2.0.0"', 'Version="1.0.0"');
    assert.notEqual(expectedAfterUndo, centralText, 'the expected undo must change the selected version');
    await vscode.window.showTextDocument(centralUri, { preview: false });
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), centralUri.toString());
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    const undoEvent = waitForDocumentText(centralUri, expectedAfterUndo);
    await vscode.commands.executeCommand('undo');
    centralText = (await undoEvent).getText();
    assert.equal(centralText, expectedAfterUndo, 'one editor undo must revert the applied package version');
    assert.equal(await readFile(centralUri.fsPath, 'utf8'), centralText.replace('Version="1.0.0"', 'Version="2.0.0"'));
    const centralDocument = await vscode.workspace.openTextDocument(centralUri);
    await centralDocument.save();

    await workbench.refresh(true);
    const policyForDirtyUndo = workbench
      .getState()
      .rows.find((row: { packageId: string }) => row.packageId === 'Policy.Package');
    assert.ok(policyForDirtyUndo && policyForDirtyUndo.status === 'update');
    const projectDocument = await vscode.workspace.openTextDocument(projectUri);
    const cleanProjectOnDisk = await readFile(projectUri.fsPath, 'utf8');
    const projectEditor = await vscode.window.showTextDocument(projectDocument);
    const dirtyMarker = '  <!-- unsaved project edit -->\r\n';
    assert.equal(await projectEditor.edit((edit) => edit.insert(new vscode.Position(1, 0), dirtyMarker)), true);
    await workbench.refresh(true);
    state = workbench.getState();
    const refreshedPolicy = state.rows.find((row: { packageId: string }) => row.packageId === 'Policy.Package');
    assert.ok(refreshedPolicy && refreshedPolicy.status === 'update');
    await workbench.review([refreshedPolicy.key]);
    await workbench.apply();
    projectText = projectDocument.getText();
    assert.match(versionLine(projectText, 'Policy.Package') ?? '', /Version="2\.0\.0"/);
    assert.match(projectText, /<!-- unsaved project edit -->\r\n/);
    assert.equal(projectDocument.isDirty, true);
    assert.equal(await readFile(projectUri.fsPath, 'utf8'), cleanProjectOnDisk);
    const expectedDirtyUndo = projectText.replace(
      'PackageReference Include="Policy.Package" Version="2.0.0"',
      'PackageReference Include="Policy.Package" Version="1.0.0"',
    );
    const focusedProjectEditor = await vscode.window.showTextDocument(projectUri, { preview: false });
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    const dirtyUndoEvent = waitForDocumentText(projectUri, expectedDirtyUndo);
    await vscode.commands.executeCommand('undo');
    projectText = (await dirtyUndoEvent).getText();
    assert.equal(projectText, expectedDirtyUndo, 'one undo must restore the selected version in an unsaved file');
    assert.match(projectText, /<!-- unsaved project edit -->\r\n/);
    assert.equal(projectDocument.isDirty, true, 'undo must retain the unrelated unsaved edit');
    assert.equal(await readFile(projectUri.fsPath, 'utf8'), cleanProjectOnDisk);

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

    const versionOffset = projectDocument.getText().indexOf('Version="1.0.0"') + 'Version="'.length;
    const editor = focusedProjectEditor;
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

    await workbench.refresh(true);
    state = workbench.getState();
    const finalCentral = state.rows.find((row: { packageId: string }) => row.packageId === 'Central.Package');
    assert.ok(finalCentral && finalCentral.status === 'update');
    await workbench.review([finalCentral.key]);
    assert.equal(workbench.getState().plan.length, 1);
    const malformedDocument = await vscode.workspace.openTextDocument(malformedUri);
    const malformedEditor = await vscode.window.showTextDocument(malformedDocument);
    const repeatedReview = workbench.review([finalCentral.key]);
    assert.equal(workbench.getState().plan, undefined, 'starting a second review must clear the earlier plan');
    const editMalformedFile = malformedEditor.edit((edit) => edit.insert(new vscode.Position(0, 0), ' '));
    const [reviewResult, editResult] = await Promise.allSettled([repeatedReview, editMalformedFile]);
    assert.equal(editResult.status, 'fulfilled', 'the nonselected malformed document edit must complete');
    if (reviewResult.status === 'rejected') {
      assert.match(String(reviewResult.reason), /changed after discovery|changed during review/i);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    const invalidatedCentral = workbench.getState().rows.find((row: { key: string }) => row.key === finalCentral.key);
    assert.equal(invalidatedCentral.status, 'unchecked');
    assert.deepEqual(invalidatedCentral.versions, []);
    assert.equal(workbench.getState().plan, undefined, 'the nonselected document event must invalidate every review');
    await workbench.apply();
    centralText = (await vscode.workspace.openTextDocument(centralUri)).getText();
    assert.match(
      versionLine(centralText, 'Central.Package') ?? '',
      /Version="1\.0\.0"/,
      'a changed nonselected malformed project must leave the selected file untouched',
    );
    verifyRecordedContract(activeRecorder);
    console.log(
      'VS Code host integration passed: automatic checks, cache, badge, shared engine, family review, snapshots, edits and undo.',
    );
  } finally {
    recorder?.stop();
    await feed.close();
    // Assertions above verify dirty buffers. Save only the generated test workspace before shutting down the host.
    await vscode.workspace.saveAll(false);
  }
}
