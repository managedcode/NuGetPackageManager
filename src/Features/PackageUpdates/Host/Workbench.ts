import * as vscode from 'vscode';
import type { Activity, Feed, PlannedChange, Policy, ViewState } from '../Contracts/types';
import { mapConcurrent } from './nuget';
import { EngineClient } from './engine';
import { scanWorkspace } from './workspace';
import { WorkbenchViews } from './WorkbenchViews';
import { routeMessage, type MessageTarget } from './messages';
import { readAutoCheck, readFeeds } from './settings';
import { VersionCache } from './versionCache';
import { watchWorkspace } from './events';
import { openPackagePage, revealDeclaration } from './navigation';

/** Automatic checks may reuse cached listed versions; explicit checks always query the feeds. */
type CheckMode = 'cached' | 'fresh';
const recheckDelayMs = 800;

export class Workbench implements MessageTarget, vscode.Disposable {
  private readonly views: WorkbenchViews;
  private readonly client: EngineClient;
  private readonly allVersions = new Map<string, string[]>();
  private readonly cache = new VersionCache();
  private abort?: AbortController;
  private generation = 0;
  private scanning = false;
  private checkAfterScan?: CheckMode;
  private needsScan = true;
  private applying = false;
  private recheckTimer?: ReturnType<typeof setTimeout>;
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
    autoCheck: readAutoCheck(),
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
      () => this.cancel(),
    );
    context.subscriptions.push(
      this.output,
      ...watchWorkspace({
        invalidate: () => this.invalidate(),
        tracks: (uri) => this.state.files.some((file) => file.uri === uri),
        trustGranted: () => {
          this.state.trusted = true;
          this.emit();
        },
        autoCheckChanged: () => {
          this.state.autoCheck = readAutoCheck();
          this.emit();
        },
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

  async ready(): Promise<void> {
    if (this.needsScan) await this.rescan();
    else this.emit();
  }

  /** Rediscover declarations; with automatic checks enabled, recheck from cached listed versions. */
  rescan(): Promise<void> {
    return this.refresh(this.state.autoCheck ? 'cached' : false);
  }

  async refresh(check: boolean | CheckMode = false, retry = true): Promise<void> {
    if (this.applying) return;
    const mode: CheckMode | undefined = check === true ? 'fresh' : check || undefined;
    if (mode && this.checkAfterScan !== 'fresh') this.checkAfterScan = mode;
    if (this.scanning) {
      // A debounce may just have ended after invalidation: publish its settled badge before returning.
      this.emit();
      return;
    }
    this.cancelRecheck();
    this.scanning = true;
    this.abort?.abort();
    const generation = ++this.generation;
    this.begin('scan');
    this.state.progress = 0;
    this.state.plan = undefined;
    this.state.checkedAt = undefined;
    this.snapshots.clear();
    this.emit();
    let changedDuringScan = false;
    let continued = false;
    try {
      const scan = await scanWorkspace(this.client);
      if (generation !== this.generation) changedDuringScan = true;
      else {
        const { snapshots, ...view } = scan;
        this.sourceSnapshots = snapshots;
        Object.assign(this.state, view);
        this.needsScan = false;
        this.state.feeds = readFeeds();
        // An automatic check is dropped if automatic checks were turned off during the scan.
        if (this.checkAfterScan === 'cached' && !this.state.autoCheck) this.checkAfterScan = undefined;
        continued = !!this.checkAfterScan && this.state.rows.length > 0;
      }
    } finally {
      this.scanning = false;
      // A requested check continues at once, so no idle all-unchecked state is published in between.
      if (!continued) {
        this.end();
        this.emit();
      }
    }
    const requested = this.checkAfterScan;
    this.checkAfterScan = undefined;
    if (changedDuringScan) {
      if (requested && retry) await this.refresh(requested, false);
      else {
        this.state.notices.push('Package files changed while scanning. Run Check for updates again.');
        this.emit();
      }
      return;
    }
    if (continued) await this.runCheck(requested === 'fresh');
  }

  async check(fresh = true): Promise<void> {
    if (this.state.busy || this.scanning || this.applying) return;
    if (this.needsScan) {
      await this.refresh(fresh ? 'fresh' : 'cached');
      return;
    }
    if (!this.state.rows.length) return;
    await this.runCheck(fresh);
  }

  private async runCheck(fresh: boolean): Promise<void> {
    this.cancelRecheck();
    let feeds: Feed[];
    try {
      feeds = this.state.feeds = readFeeds();
    } catch (error) {
      this.end();
      this.emit();
      throw error;
    }
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const generation = ++this.generation;
    this.allVersions.clear();
    this.begin('check');
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
    let oldest = Date.now();
    this.emit();
    try {
      await mapConcurrent(
        ids,
        6,
        async (id) => {
          let versions: string[] = [];
          let error: string | undefined;
          try {
            const found = await this.cache.lookup(id, feeds, fresh, () =>
              this.client.getVersions(id, feeds, abort.signal),
            );
            versions = found.versions;
            oldest = Math.min(oldest, found.at);
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
      if (!abort.signal.aborted && generation === this.generation)
        this.state.checkedAt = new Date(oldest).toISOString();
    } catch (error) {
      if (!abort.signal.aborted) throw error;
    } finally {
      if (generation === this.generation) {
        this.end();
        this.state.rows
          .filter((row) => row.status === 'checking')
          .forEach((row) => {
            row.status = 'unchecked';
          });
        this.emit();
      }
    }
  }

  cancel(): void {
    this.checkAfterScan = undefined;
    this.abort?.abort();
    if (this.recheckTimer) {
      this.cancelRecheck();
      this.emit();
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

  async setPolicy(policy: Policy, prerelease: boolean): Promise<void> {
    if (this.state.busy || this.applying) return;
    this.state.policy = policy;
    this.state.prerelease = prerelease;
    this.state.plan = undefined;
    const abort = new AbortController();
    this.abort = abort;
    const generation = ++this.generation;
    this.begin('resolve');
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
        this.end();
        this.emit();
      }
    }
  }

  async setTarget(key: string, version: string): Promise<void> {
    if (this.state.busy || this.applying) return;
    const row = this.state.rows.find((row) => row.key === key);
    if (!row || !['current', 'update'].includes(row.status) || !row.versions.includes(version)) return;
    const generation = this.generation;
    this.begin('resolve');
    this.emit();
    try {
      const resolution = await this.client.resolve(row.version, [version], this.state.policy, this.state.prerelease);
      if (
        generation !== this.generation ||
        resolution.target !== version ||
        !['current', 'update'].includes(row.status)
      )
        return;
      row.target = version;
      row.updateKind = resolution.updateKind;
      row.status = 'update';
      this.state.plan = undefined;
    } finally {
      if (generation === this.generation) {
        this.end();
        this.emit();
      }
    }
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
    this.begin('review');
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
        this.end();
        this.emit();
      }
    }
  }

  back(): void {
    if (this.applying) return;
    this.state.plan = undefined;
    this.emit();
  }

  async preview(file: string): Promise<void> {
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
    this.begin('apply');
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
      this.end();
      this.emit();
    }
    await this.rescan();
  }

  async openDeclaration(key: string): Promise<void> {
    const row = this.state.rows.find((row) => row.key === key);
    if (row) await revealDeclaration(row);
  }

  async openPackagePage(key: string): Promise<void> {
    const row = this.state.rows.find((row) => row.key === key);
    if (row) await openPackagePage(row.packageId);
  }

  private message(raw: unknown): Promise<void> {
    return routeMessage(this, raw);
  }

  private invalidate(): void {
    if (this.applying) return;
    this.abort?.abort();
    this.generation++;
    this.needsScan = true;
    this.end();
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
    this.scheduleRecheck();
    this.emit();
  }

  /** Package files changed: a visible surface rescans and rechecks from cached versions once edits settle. */
  private scheduleRecheck(): void {
    clearTimeout(this.recheckTimer);
    this.state.recheckPending = this.state.autoCheck && this.views.visible();
    if (!this.state.recheckPending) {
      this.recheckTimer = undefined;
      return;
    }
    this.recheckTimer = setTimeout(() => {
      this.recheckTimer = undefined;
      this.state.recheckPending = false;
      if (this.applying || this.state.plan || !this.needsScan || !this.state.autoCheck || !this.views.visible())
        this.emit();
      else void this.refresh('cached').catch((error) => this.report(error));
    }, recheckDelayMs);
  }

  private cancelRecheck(): void {
    clearTimeout(this.recheckTimer);
    this.recheckTimer = undefined;
    this.state.recheckPending = false;
  }

  private begin(activity: Activity): void {
    this.state.busy = true;
    this.state.activity = activity;
  }

  private end(): void {
    this.state.busy = false;
    this.state.activity = undefined;
  }

  private emit(): void {
    this.views.post({ type: 'state', state: this.getState() });
    const updates = new Set(
      this.state.rows.filter((row) => row.status === 'update').map((row) => row.packageId.toLowerCase()),
    );
    this.views.status(updates.size, this.state.busy || !!this.state.recheckPending);
  }

  private report(error: unknown): void {
    const message = error instanceof Error ? error.message : 'NuGet operation failed';
    this.output.appendLine(message);
    this.views.post({ type: 'error', message });
    void vscode.window.showErrorMessage(message);
  }

  dispose(): void {
    this.cancelRecheck();
    this.abort?.abort();
    this.views.dispose();
  }
}
