import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import type { Scenario } from './hostScenarios';

/** TST-SDK-017: a real WorkspaceEdit updates existing SDKs and packages together, without inserting SDKs. */
export async function runSdkFamilyScenario({ workbench, feed, projectUri }: Scenario): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  const sdkUri = vscode.Uri.joinPath(folder.uri, 'SdkApp.csproj');
  const before = await readFile(sdkUri.fsPath, 'utf8');
  const otherBefore = (await vscode.workspace.openTextDocument(projectUri)).getText();
  await workbench.refresh(true);
  const family = workbench.getState().rows.filter((row) => row.families.includes('Aspire'));
  assert.deepEqual(family.map((row) => row.packageId).sort(), ['Aspire.AppHost.Sdk', 'Aspire.Hosting']);
  const sdk = family.find((row) => row.packageId === 'Aspire.AppHost.Sdk');
  assert.ok(sdk);
  assert.equal(sdk.kind, 'Sdk');
  assert.equal(sdk.target, '13.6.1');
  assert.equal(family.find((row) => row.packageId === 'Aspire.Hosting')?.target, '13.7.0');
  assert.equal(feed.requestsFor('Microsoft.NET.Sdk'), 0, 'versionless SDKs must never be queried');
  await workbench.review(family.map((row) => row.key));
  assert.equal(workbench.getState().plan?.length, 2);
  await workbench.apply();
  const expected = before
    .replace('Name="Aspire.AppHost.Sdk" Version="13.6.0"', 'Name="Aspire.AppHost.Sdk" Version="13.6.1"')
    .replace('Include="Aspire.Hosting" Version="13.6.0"', 'Include="Aspire.Hosting" Version="13.7.0"');
  assert.equal((await vscode.workspace.openTextDocument(sdkUri)).getText(), expected);
  assert.equal(await readFile(sdkUri.fsPath, 'utf8'), expected, 'clean SDK files must be saved');
  assert.equal(
    (await vscode.workspace.openTextDocument(projectUri)).getText(),
    otherBefore,
    'a project without an explicit SDK must not receive one',
  );
}
