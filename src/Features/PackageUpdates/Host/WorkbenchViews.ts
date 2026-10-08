import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { getHtml } from './html';

/** Native surfaces share the controller's state and validated message handler. */
export class WorkbenchViews implements vscode.WebviewViewProvider, vscode.Disposable {
  sidebar?: vscode.WebviewView;
  panel?: vscode.WebviewPanel;
  private readonly previews = new Map<string, string>();
  private readonly registrations: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly receive: (message: unknown) => void,
    private readonly onLastSurfaceClosed: () => void,
  ) {
    this.registrations.push(
      vscode.window.registerWebviewViewProvider('nugetPackageManager.sidebar', this, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
      vscode.workspace.registerTextDocumentContentProvider('nuget-package-manager-preview', {
        provideTextDocumentContent: (uri) => this.previews.get(uri.toString()) ?? '',
      }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.sidebar = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    const subscriptions = [
      view.webview.onDidReceiveMessage(this.receive),
      view.onDidChangeVisibility(() => {
        if (view.visible) this.receive({ type: 'ready' });
      }),
    ];
    this.registrations.push(
      ...subscriptions,
      view.onDidDispose(() => {
        subscriptions.forEach((subscription) => subscription.dispose());
        if (this.sidebar === view) this.sidebar = undefined;
        this.closed();
      }),
    );
    view.webview.html = getHtml(view.webview, this.context.extensionUri, 'sidebar');
  }

  async open(): Promise<void> {
    await vscode.commands.executeCommand('nugetPackageManager.sidebar.focus');
  }

  openEditor(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'nugetPackageManager',
      'NuGet Package Manager',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
      },
    );
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'activity.svg');
    const subscriptions = [
      panel.webview.onDidReceiveMessage(this.receive),
      panel.onDidChangeViewState(() => {
        if (panel.visible) this.receive({ type: 'ready' });
      }),
    ];
    this.registrations.push(
      ...subscriptions,
      panel.onDidDispose(() => {
        subscriptions.forEach((subscription) => subscription.dispose());
        if (this.panel === panel) this.panel = undefined;
        this.closed();
      }),
    );
    panel.webview.html = getHtml(panel.webview, this.context.extensionUri, 'editor');
  }

  post(message: unknown): void {
    if (this.sidebar?.visible) void this.sidebar.webview.postMessage(message);
    if (this.panel?.visible) void this.panel.webview.postMessage(message);
  }

  clearPreviews(): void {
    this.previews.clear();
  }

  async preview(file: string, text: string): Promise<void> {
    const uri = vscode.Uri.from({
      scheme: 'nuget-package-manager-preview',
      path: `/${randomUUID()}/${vscode.Uri.parse(file).path.split('/').at(-1)}`,
    });
    this.previews.set(uri.toString(), text);
    await vscode.commands.executeCommand('vscode.diff', vscode.Uri.parse(file), uri, 'NuGet · Proposed changes');
  }

  private closed(): void {
    if (!this.sidebar && !this.panel) this.onLastSurfaceClosed();
  }

  dispose(): void {
    this.registrations.splice(0).forEach((registration) => registration.dispose());
    this.sidebar = undefined;
    this.panel?.dispose();
    this.previews.clear();
  }
}
