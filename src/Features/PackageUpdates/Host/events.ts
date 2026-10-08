import * as vscode from 'vscode';

export interface WorkspaceEvents {
  /** Package files or feed settings changed, so discovery, checks and reviews are stale. */
  invalidate(): void;
  tracks(uri: string): boolean;
  trustGranted(): void;
  autoCheckChanged(): void;
}

/** File, document, trust and configuration events that affect package state. */
export function watchWorkspace(events: WorkspaceEvents): vscode.Disposable[] {
  const watcher = vscode.workspace.createFileSystemWatcher('**/{Directory.Packages.props,*.csproj,*.fsproj,*.vbproj}');
  const invalidate = () => events.invalidate();
  return [
    watcher,
    watcher.onDidChange(invalidate),
    watcher.onDidCreate(invalidate),
    watcher.onDidDelete(invalidate),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (events.tracks(event.document.uri.toString())) invalidate();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => events.trustGranted()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('nugetPackageManager.autoCheck')) events.autoCheckChanged();
      if (event.affectsConfiguration('nugetPackageManager.feeds')) invalidate();
    }),
  ];
}
