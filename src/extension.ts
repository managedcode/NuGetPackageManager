import * as vscode from 'vscode';
import { Workbench } from './Features/PackageUpdates/Host/Workbench';
import { openFeedSettings } from './Features/PackageUpdates/Host/navigation';

export function activate(context: vscode.ExtensionContext): Workbench {
  const workbench = new Workbench(context);
  context.subscriptions.push(
    workbench,
    vscode.commands.registerCommand('nugetPackageManager.open', () => workbench.open()),
    vscode.commands.registerCommand('nugetPackageManager.openEditor', () => workbench.openEditor()),
    vscode.commands.registerCommand('nugetPackageManager.refresh', async () => {
      await workbench.open();
      await workbench.rescan();
    }),
    vscode.commands.registerCommand('nugetPackageManager.checkUpdates', async () => {
      await workbench.open();
      await workbench.refresh(true);
    }),
    vscode.commands.registerCommand('nugetPackageManager.configureFeeds', () => openFeedSettings()),
  );
  return workbench;
}
