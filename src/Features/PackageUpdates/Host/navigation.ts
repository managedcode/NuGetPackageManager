import * as vscode from 'vscode';
import type { PackageRow } from '../Contracts/types';

export async function revealDeclaration(row: PackageRow): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(row.file));
  await vscode.window.showTextDocument(document, {
    selection: new vscode.Range(document.positionAt(row.start), document.positionAt(row.end)),
  });
}

export async function openPackagePage(packageId: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(`https://www.nuget.org/packages/${encodeURIComponent(packageId)}`));
}

export function openFeedSettings(): Thenable<unknown> {
  return vscode.commands.executeCommand(
    'workbench.action.openSettings',
    '@ext:managedcode.managedcode-nuget-package-manager',
  );
}
