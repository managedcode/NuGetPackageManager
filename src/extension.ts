import * as vscode from 'vscode';
import { Workbench } from './Features/PackageUpdates/Host/Workbench';

export function activate(context: vscode.ExtensionContext): Workbench {
  const workbench = new Workbench(context);
  context.subscriptions.push(
    workbench,
    vscode.commands.registerCommand('nugetPackageManager.open', () => workbench.open()),
    vscode.commands.registerCommand('nugetPackageManager.openEditor', () => workbench.openEditor()),
    vscode.commands.registerCommand('nugetPackageManager.refresh', async () => {
      await workbench.open();
      await workbench.refresh();
    }),
    vscode.commands.registerCommand('nugetPackageManager.checkUpdates', async () => {
      await workbench.open();
      await workbench.refresh(true);
    }),
  );
  return workbench;
}
