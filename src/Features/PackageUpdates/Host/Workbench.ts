import * as vscode from 'vscode';
import type { Feed, PlannedChange, Policy, ViewState } from '../Contracts/types';
import { mapConcurrent, validateFeedUrl } from './nuget';
import { EngineClient } from './engine';
import { scanWorkspace } from './workspace';
import { WorkbenchViews } from './WorkbenchViews';

export class Workbench implements vscode.Disposable {
  private readonly views: WorkbenchViews;
  private readonly client: EngineClient;
  private readonly allVersions = new Map<string, string[]>();
  private abort?: AbortController;
  private generation = 0;
  private scanning = false;
  private checkAfterScan = false;
  private needsScan = true;
  private applying = false;
  private snapshots = new Map<string, string>();
  private sourceSnapshots = new Map<string, string>();
  private readonly output = vscode.window.createOutputChannel('NuGet Package Manager');
  private state: ViewState = {
    rows: [],
    files: [],
    notices: [],
    feeds: [],
    busy: false,
    progress: 0,
    trusted: vscode.workspace.isTrusted,
    policy: 'latest',
    prerelease: false,
  };

  constructor(context: vscode.ExtensionContext) {
    this.client = new EngineClient(
      vscode.Uri.joinPath(context.extensionUri, 'dist', 'engine', 'ManagedCode.NuGet.Tool.dll').fsPath,
    );
    this.views = new WorkbenchViews(
      context,
      (message) => {
        void this.message(message).catch((error) => this.report(error));
      },
      () => this.abort?.abort(),
    );
    context.subscriptions.push(this.output);
    const watcher = vscode.workspace.createFileSystemWatcher(
      '**/{Directory.Packages.props,*.csproj,*.fsproj,*.vbproj}',
    );
    const invalidate = () => {
      if (this.applying) return;
      this.abort?.abort();
      this.generation++;
      this.needsScan = true;
      this.state.busy = false;
      this.state.plan = undefined;
      this.snapshots.clear();
      this.state.checkedAt = undefined;
      this.allVersions.clear();
      this.state.rows = this.state.rows.map((row) => ({
        ...row,
        status: 'unchecked',
        target: undefined,
        updateKind: undefined,
        versions: [],
        error: undefined,
      }));
      this.emit();
    };
    context.subscriptions.push(
      watcher,
      watcher.onDidChange(invalidate),
      watcher.onDidCreate(invalidate),
      watcher.onDidDelete(invalidate),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (this.state.files.some((f) => f.uri === event.document.uri.toString())) invalidate();
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        this.state.trusted = true;
        this.emit();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('nugetPackageManager')) {
          invalidate();
        }
      }),
    );
  }

  getState(): ViewState {
    return structuredClone(this.state);
  }

  async open(): Promise<void> {
    await this.views.open();
  }

  openEditor(): void {
    this.views.openEditor();
  }

  async refresh(check = false, retry = true): Promise<void> {
    if (this.applying) return;
    this.checkAfterScan ||= check;
    if (this.scanning) return;
    this.scanning = true;
    this.abort?.abort();
    const generation = ++this.generation;
    this.state.busy = true;
    this.state.progress = 0;
    this.state.plan = undefined;
    this.state.checkedAt = undefined;
    this.snapshots.clear();
    this.emit();
    let changedDuringScan = false;
    try {
      const scan = await scanWorkspace(this.client);
      if (generation !== this.generation) changedDuringScan = true;
      else {
        const { snapshots, ...view } = scan;
        this.sourceSnapshots = snapshots;
        Object.assign(this.state, view);
        this.needsScan = false;
        this.state.feeds = this.readFeeds();
      }
    } finally {
      this.scanning = false;
      this.state.busy = false;
      this.emit();
    }
    if (changedDuringScan) {
      const requested = this.checkAfterScan;
      this.checkAfterScan = false;
      if (requested && retry) await this.refresh(true, false);
      else {
        this.state.notices.push('Package files changed while scanning. Run Check for updates again.');
        this.emit();
      }
      return;
    }
    if (this.checkAfterScan) {
      this.checkAfterScan = false;
      await this.check();
    }
  }

  async check(): Promise<void> {
    if (this.state.busy || this.scanning || this.applying) return;
    if (this.needsScan) {
      await this.refresh(true);
      return;
    }
    if (!this.state.rows.length) return;
    this.state.feeds = this.readFeeds();
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const generation = ++this.generation;
    this.allVersions.clear();
    this.state.busy = true;
    this.state.plan = undefined;
    this.state.checkedAt = undefined;
    this.state.progress = 0;
    this.state.rows.forEach((row) => {
      row.status = 'checking';
      row.target = undefined;
      row.error = undefined;
      row.versions = [];
    });
    const ids = [...new Set(this.state.rows.map((row) => row.packageId.toLowerCase()))];
    let complete = 0;
    this.emit();
    try {
      await mapConcurrent(
        ids,
        6,
        async (id) => {
          let versions: string[] = [];
          let error: string | undefined;
          try {
            versions = await this.client.getVersions(id, this.state.feeds, abort.signal);
          } catch (exception) {
            if (abort.signal.aborted) return;
            error = exception instanceof Error ? exception.message : 'Could not check package';
          }
          if (generation !== this.generation || abort.signal.aborted) return;
          for (const row of this.state.rows.filter((row) => row.packageId.toLowerCase() === id)) {
            this.allVersions.set(row.key, versions);
            row.versions = [];
            row.error = error;
            row.status = error ? 'error' : 'current';
            await this.resolveTarget(row, abort.signal);
          }
          this.state.progress = Math.round((++complete / ids.length) * 100);
          this.emit();
        },
        abort.signal,
      );
      if (!abort.signal.aborted && generation === this.generation) this.state.checkedAt = new Date().toISOString();
    } catch (error) {
      if (!abort.signal.aborted) throw error;
    } finally {
      if (generation === this.generation) {
        this.state.busy = false;
        this.state.rows
          .filter((row) => row.status === 'checking')
          .forEach((row) => {
            row.status = 'unchecked';
          });
        this.emit();
      }
    }
  }

  private async resolveTarget(row: ViewState['rows'][number], signal?: AbortSignal): Promise<void> {
    if (row.status === 'error' || row.status === 'unchecked') return;
    const generation = this.generation;
    row.status = 'checking';
    row.target = undefined;
    row.updateKind = undefined;
    row.versions = [];
    const resolution = await this.client.resolve(
      row.version,
      this.allVersions.get(row.key) ?? [],
      this.state.policy,
      this.state.prerelease,
      signal,
    );
    if (generation !== this.generation) return;
    row.versions = resolution.versions;
    row.target = resolution.target;
    row.updateKind = resolution.updateKind;
    row.status = row.target ? 'update' : 'current';
  }

  async review(keys: unknown): Promise<void> {
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string') || this.state.busy || this.applying) return;
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace to update package files.');
    const selected = this.state.rows.filter((row) => keys.includes(row.key));
    if (
      selected.length !== new Set(keys).size ||
      !selected.length ||
      selected.some((row) => row.status !== 'update' || !row.target)
    )
      throw new Error('Refresh the package list and select available updates.');
    this.state.plan = undefined;
    this.snapshots.clear();
    this.views.clearPreviews();
    this.state.busy = true;
    this.emit();
    const generation = this.generation;
    try {
      const plan: PlannedChange[] = selected.map((row) => ({
        key: row.key,
        packageId: row.packageId,
        from: row.version,
        to: row.target!,
        file: row.file,
        fileLabel: row.fileLabel,
        start: row.start,
        end: row.end,
        condition: row.condition,
      }));
      const documents: vscode.TextDocument[] = [];
      for (const [file, expected] of this.sourceSnapshots) {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(file));
        const text = document.getText();
        if (text !== expected) throw new Error('A package file changed after discovery. Refresh and check again.');
        const changes = plan.filter((change) => change.file === file);
        if (changes.length) await this.client.apply(text, changes);
        documents.push(document);
        this.snapshots.set(file, text);
      }
      if (
        generation !== this.generation ||
        documents.some((document) => document.getText() !== this.snapshots.get(document.uri.toString()))
      )
        throw new Error('Package declarations changed during review. Refresh and check again.');
      this.state.plan = plan;
    } finally {
      if (generation === this.generation) {
        this.state.busy = false;
        this.emit();
      }
    }
  }

  private async preview(file: unknown): Promise<void> {
    if (typeof file !== 'string' || !this.state.plan?.some((change) => change.file === file)) return;
    const text = this.snapshots.get(file);
    if (text === undefined) return;
    await this.views.preview(
      file,
      await this.client.apply(
        text,
        this.state.plan.filter((change) => change.file === file),
      ),
    );
  }

  async apply(): Promise<void> {
    if (!vscode.workspace.isTrusted || !this.state.plan?.length || this.applying || this.state.busy) return;
    this.applying = true;
    this.state.busy = true;
    this.emit();
    const plan = this.state.plan;
    try {
      const documents: vscode.TextDocument[] = [];
      const dirty = new Set<string>();
      const edit = new vscode.WorkspaceEdit();
      for (const file of this.snapshots.keys()) {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(file));
        if (document.getText() !== this.snapshots.get(file))
          throw new Error('A package file changed after review. Refresh and review again.');
        documents.push(document);
        if (document.isDirty) dirty.add(file);
      }
      // Recheck every snapshot together after asynchronous document loading.
      for (const document of documents) {
        const file = document.uri.toString();
        if (document.getText() !== this.snapshots.get(file))
          throw new Error('A package file changed after review. Refresh and review again.');
        for (const change of plan.filter((change) => change.file === file)) {
          edit.replace(
            document.uri,
            new vscode.Range(document.positionAt(change.start), document.positionAt(change.end)),
            change.to,
          );
        }
      }
      if (!(await vscode.workspace.applyEdit(edit)))
        throw new Error('VS Code could not apply the update. No success was recorded.');
      const saved = await Promise.all(
        documents
          .filter(
            (document) =>
              plan.some((change) => change.file === document.uri.toString()) && !dirty.has(document.uri.toString()),
          )
          .map((document) => document.save()),
      );
      this.state.plan = undefined;
      this.snapshots.clear();
      if (saved.some((result) => !result))
        throw new Error(
          'Updates were applied to editor buffers, but some files could not be saved. Save those files manually.',
        );
      const unsaved = plan.filter((change) => dirty.has(change.file)).map((change) => change.file);
      const dirtyCount = new Set(unsaved).size;
      void vscode.window.showInformationMessage(
        `Updated ${plan.length} package declarations.${dirtyCount ? ` ${dirtyCount} previously unsaved file(s) remain unsaved.` : ''} Restore and test your solution to verify compatibility.`,
      );
    } finally {
      this.applying = false;
      this.state.busy = false;
      this.emit();
    }
    await this.refresh();
  }

  private async message(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') return;
    const message = raw as Record<string, unknown>;
    switch (message.type) {
      case 'ready':
        if (this.needsScan) await this.refresh();
        else this.emit();
        break;
      case 'refresh':
        await this.refresh(true);
        break;
      case 'check':
        await this.check();
        break;
      case 'cancel':
        this.abort?.abort();
        break;
      case 'policy':
        if (this.state.busy || this.applying) break;
        if (['latest', 'minor', 'patch'].includes(String(message.policy)) && typeof message.prerelease === 'boolean') {
          this.state.policy = message.policy as Policy;
          this.state.prerelease = message.prerelease;
          this.state.plan = undefined;
          const abort = new AbortController();
          this.abort = abort;
          const generation = ++this.generation;
          this.state.busy = true;
          this.emit();
          const pending = this.state.rows.filter((row) => ['current', 'update'].includes(row.status));
          pending.forEach((row) => {
            row.status = 'checking';
            row.target = undefined;
            row.updateKind = undefined;
            row.versions = [];
          });
          try {
            await mapConcurrent(pending, 6, (row) => this.resolveTarget(row, abort.signal), abort.signal);
          } catch (error) {
            if (!abort.signal.aborted) throw error;
          } finally {
            if (generation === this.generation) {
              this.state.rows
                .filter((row) => row.status === 'checking')
                .forEach((row) => {
                  row.status = 'unchecked';
                });
              this.state.busy = false;
              this.emit();
            }
          }
        }
        break;
      case 'target': {
        if (this.state.busy || this.applying) break;
        const row = this.state.rows.find((row) => row.key === message.key);
        if (
          row &&
          ['current', 'update'].includes(row.status) &&
          typeof message.version === 'string' &&
          row.versions.includes(message.version)
        ) {
          const generation = this.generation;
          this.state.busy = true;
          this.emit();
          try {
            const resolution = await this.client.resolve(
              row.version,
              [message.version],
              this.state.policy,
              this.state.prerelease,
            );
            if (
              generation !== this.generation ||
              resolution.target !== message.version ||
              !['current', 'update'].includes(row.status)
            )
              break;
            row.target = message.version;
            row.updateKind = resolution.updateKind;
            row.status = 'update';
            this.state.plan = undefined;
          } finally {
            if (generation === this.generation) {
              this.state.busy = false;
              this.emit();
            }
          }
        }
        break;
      }
      case 'review':
        await this.review(message.keys);
        break;
      case 'back':
        if (!this.applying) {
          this.state.plan = undefined;
          this.emit();
        }
        break;
      case 'preview':
        await this.preview(message.file);
        break;
      case 'apply':
        await this.apply();
        break;
      case 'openFile': {
        const row = this.state.rows.find((row) => row.key === message.key);
        if (row) {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(row.file));
          await vscode.window.showTextDocument(document, {
            selection: new vscode.Range(document.positionAt(row.start), document.positionAt(row.end)),
          });
        }
        break;
      }
      case 'packageLink': {
        const row = this.state.rows.find((row) => row.key === message.key);
        if (row)
          await vscode.env.openExternal(
            vscode.Uri.parse(`https://www.nuget.org/packages/${encodeURIComponent(row.packageId)}`),
          );
        break;
      }
      case 'settings':
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:managedcode.managedcode-nuget-package-manager',
        );
        break;
    }
  }

  private emit(): void {
    this.views.post({ type: 'state', state: this.getState() });
  }
  private readFeeds(): Feed[] {
    const feeds = vscode.workspace
      .getConfiguration('nugetPackageManager')
      .get<Feed[]>('feeds', [{ name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json' }]);
    if (
      !Array.isArray(feeds) ||
      !feeds.length ||
      feeds.some((feed) => typeof feed?.name !== 'string' || !feed.name.trim() || typeof feed.url !== 'string')
    )
      throw new Error('Configure at least one NuGet V3 feed in nugetPackageManager.feeds.');
    feeds.forEach((feed) => validateFeedUrl(feed.url));
    return feeds;
  }
  private report(error: unknown): void {
    const message = error instanceof Error ? error.message : 'NuGet operation failed';
    this.output.appendLine(message);
    this.views.post({ type: 'error', message });
    void vscode.window.showErrorMessage(message);
  }
  dispose(): void {
    this.abort?.abort();
    this.views.dispose();
  }
}
