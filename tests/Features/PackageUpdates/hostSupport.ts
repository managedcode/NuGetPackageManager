import assert from 'node:assert/strict';
import { once } from 'node:events';
import * as vscode from 'vscode';
import type { ViewState } from '../../../src/Features/PackageUpdates/Contracts/types';
import { registration, TestFeed } from './hostFeed';

// =====================================================================================================================
// Host test support: typed workbench access, bounded polling, request counting and continuous state recording.
// Used by the automatic-check scenarios below (TST-UI-014 / TST-UI-016); the explicit-flow assertions stay in run().
// =====================================================================================================================

export type Row = ViewState['rows'][number];

/** The public Workbench API driven by the tests; `views` is reached the same way as in the explicit-flow assertions. */
export interface WorkbenchApi {
  views: { sidebar?: vscode.WebviewView; panel?: vscode.WebviewPanel };
  getState(): ViewState;
  /** `true` and 'fresh' query the feeds; 'cached' queues the automatic check that reuses cached versions. */
  refresh(check?: boolean | 'cached' | 'fresh'): Promise<void>;
  check(): Promise<void>;
  review(keys: string[]): Promise<void>;
  apply(): Promise<void>;
  /** Webview message router; the explicit-flow assertions already drive it for policy and target messages. */
  message(value: unknown): Promise<void>;
}

/** Packages that succeed and have a newer listed version when the fixture is first checked. */
export const updatablePackageIds = [
  'Automatic.Package',
  'Buffered.Package',
  'Central.Package',
  'Child.Version.Package',
  'Manual.Package',
  'Microsoft.Orleans.Core',
  'Microsoft.Orleans.Hosting',
  'Policy.Package',
  'Regular.Package',
];
/** Packages whose lookup fails on every attempt: HTTP 500 metadata, and a registration without listed versions. */
export const failingPackageIds = ['Conditional.Package', 'Failing.Package'];
export const observedPackageIds = [...updatablePackageIds, ...failingPackageIds];
export const knownActivities = ['scan', 'check', 'resolve', 'review', 'apply'];
export const pollMs = 25;
/** Host contract: package-file edits schedule the automatic recheck this long after the last change. */
export const recheckDebounceMs = 800;
/** A settled state must hold this long, so a late file-watcher event cannot hide one more recheck cycle. */
export const settleMs = 2000;

export const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
export const lowerSorted = (ids: readonly string[]) => ids.map((id) => id.toLowerCase()).sort();

export function summarize(state: ViewState): string {
  const rows = state.rows.map((row) => `${row.packageId}=${row.status}`).join(',');
  return `busy=${state.busy} activity=${state.activity} recheckPending=${state.recheckPending} autoCheck=${state.autoCheck} checkedAt=${state.checkedAt} rows=[${rows}]`;
}

/** Distinct lowercase package IDs with an available update: what the Activity Bar badge must count. */
export function updatedIds(state: ViewState): string[] {
  return [
    ...new Set(state.rows.filter((row) => row.status === 'update').map((row) => row.packageId.toLowerCase())),
  ].sort();
}

/** Every row finished a check, successfully or with a visible error; nothing is pending or running. */
export const isChecked = (state: ViewState): boolean =>
  !state.busy &&
  !state.recheckPending &&
  state.checkedAt !== undefined &&
  state.rows.length > 0 &&
  state.rows.every((row) => ['current', 'update', 'error'].includes(row.status));

export const isIdle = (state: ViewState): boolean => !state.busy && !state.recheckPending;

export function rowsOf(state: ViewState, packageId: string): Row[] {
  return state.rows.filter((row) => row.packageId === packageId);
}

export function rowOf(state: ViewState, packageId: string): Row {
  const [row] = rowsOf(state, packageId);
  assert.ok(row, `${packageId} must be discovered: ${summarize(state)}`);
  return row;
}

export function readBadge(workbench: WorkbenchApi): vscode.ViewBadge | undefined {
  return workbench.views.sidebar?.badge;
}

export function assertBadge(workbench: WorkbenchApi, state: ViewState, context: string): void {
  const expected = updatedIds(state).length;
  const badge = readBadge(workbench);
  assert.equal(badge?.value, expected || undefined, `${context}: the badge must count distinct packages with updates`);
  if (badge) assert.ok(badge.tooltip.includes(String(expected)), `${context}: the tooltip must state the count`);
}

/** Bounded polling: resolves with the first defined probe result and fails with diagnostics on timeout. */
export async function poll<T>(
  description: string,
  probe: () => T | undefined,
  timeoutMs: number,
  details = () => '',
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    assert.ok(Date.now() < deadline, `Timed out after ${timeoutMs} ms waiting for ${description}. ${details()}`);
    await sleep(pollMs);
  }
}

export function waitForState(
  workbench: WorkbenchApi,
  description: string,
  predicate: (state: ViewState) => boolean,
  timeoutMs = 60_000,
): Promise<ViewState> {
  const probe = () => {
    const state = workbench.getState();
    return predicate(state) ? state : undefined;
  };
  return poll(description, probe, timeoutMs, () => summarize(workbench.getState()));
}

/** Resolves once `predicate` has held continuously for `stableMs`. */
export function waitUntilStable(
  workbench: WorkbenchApi,
  description: string,
  predicate: (state: ViewState) => boolean,
  stableMs = settleMs,
  timeoutMs = 60_000,
): Promise<ViewState> {
  let since: number | undefined;
  const probe = () => {
    const state = workbench.getState();
    if (!predicate(state)) {
      since = undefined;
      return undefined;
    }
    since ??= Date.now();
    return Date.now() - since >= stableMs ? state : undefined;
  };
  return poll(description, probe, timeoutMs, () => summarize(workbench.getState()));
}

/**
 * Apply saves a clean file, and the file system reports that save to the extension's watcher a moment later. Create the
 * returned waiter before Apply: it settles with true once the change was delivered (the extension's own watcher, which
 * was created first, has handled it by then) or false after `timeoutMs`, which never fails a test.
 */
export function watchFileChange(uri: vscode.Uri, timeoutMs = 15_000): () => Promise<boolean> {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  assert.ok(folder, 'the watched file must belong to the fixture workspace');
  const pattern = new vscode.RelativePattern(folder, vscode.workspace.asRelativePath(uri, false));
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  const changed = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const delivered = () => {
      clearTimeout(timer);
      resolve(true);
    };
    watcher.onDidChange(delivered);
    watcher.onDidCreate(delivered);
  });
  return () => changed.finally(() => watcher.dispose());
}

/** Samples `probe` every few milliseconds until `operation` settles, within a deadline; rethrows its failure. */
export async function sampleWhile<T>(
  operation: PromiseLike<unknown>,
  probe: () => T,
  timeoutMs = 60_000,
): Promise<T[]> {
  const outcome: { settled: boolean; error?: unknown } = { settled: false };
  void Promise.resolve(operation).then(
    () => {
      outcome.settled = true;
    },
    (error: unknown) => {
      outcome.settled = true;
      outcome.error = error;
    },
  );
  const samples: T[] = [];
  const deadline = Date.now() + timeoutMs;
  while (!outcome.settled) {
    samples.push(probe());
    assert.ok(Date.now() < deadline, `Timed out after ${timeoutMs} ms waiting for the sampled operation to settle.`);
    await sleep(2);
  }
  if (outcome.error !== undefined) throw outcome.error;
  return samples;
}

/** AC-016: through a whole rescan and check the badge keeps its settled count and never disappears midway. */
export async function assertBadgeHeldDuring(
  workbench: WorkbenchApi,
  operation: PromiseLike<unknown>,
  held: number,
  name: string,
): Promise<void> {
  const samples = await sampleWhile(operation, () => ({
    activity: workbench.getState().activity,
    badge: readBadge(workbench)?.value,
  }));
  const activities = new Set(samples.map((sample) => sample.activity));
  assert.ok(activities.has('scan') && activities.has('check'), `${name} scans, then checks: ${[...activities]}`);
  assert.ok(
    samples.every((sample) => sample.badge !== undefined),
    `${name}: the badge must never disappear while it runs`,
  );
  const values = [...new Set(samples.map((sample) => sample.badge))];
  assert.deepEqual(values, [held], `${name}: the badge must keep its settled count while it runs`);
}

/** Negative proof: the host stays idle for `windowMs`, which outlasts the recheck debounce. */
export async function assertStaysIdle(workbench: WorkbenchApi, windowMs: number, message: string): Promise<void> {
  const until = Date.now() + windowMs;
  while (Date.now() < until) {
    assert.ok(isIdle(workbench.getState()), `${message}: ${summarize(workbench.getState())}`);
    await sleep(pollMs);
  }
}

export type Counts = Record<string, number>;

export function requestCounts(feed: TestFeed): Counts {
  return Object.fromEntries(observedPackageIds.map((id) => [id, feed.requestsFor(id)]));
}

export function assertRequests(
  feed: TestFeed,
  before: Counts,
  ids: readonly string[],
  expectation: 'unchanged' | 'increased',
  message: string,
): void {
  for (const id of ids) {
    const now = feed.requestsFor(id);
    if (expectation === 'unchanged') assert.equal(now, before[id], `${message}: ${id} went ${before[id]} -> ${now}`);
    else assert.ok(now > before[id], `${message}: ${id} stayed at ${now} requests`);
  }
}

/** A cached recheck asks the feed only about packages whose earlier lookup failed. */
export function assertServedFromCache(feed: TestFeed, before: Counts, name: string): void {
  assertRequests(feed, before, updatablePackageIds, 'unchanged', `${name} must reuse cached listed versions`);
  assertRequests(feed, before, failingPackageIds, 'increased', `${name} must ask again after a failed lookup`);
}

/**
 * Samples host state every few milliseconds, so short-lived activities and the badge while busy are observable.
 * Invariants checked on every sample: busy exactly when an activity is reported, and the badge of a host that is idle
 * with no recheck pending equals the number of distinct packages with updates (omitted, never 0, when there are none).
 * While busy or while a recheck is pending the badge keeps its last settled value instead.
 */
export class StateRecorder {
  private readonly samples: { busy: boolean; activity?: string; badge?: number }[] = [];
  private readonly timer: NodeJS.Timeout;
  readonly violations: string[] = [];

  constructor(private readonly workbench: WorkbenchApi) {
    this.timer = setInterval(() => this.sample(), 5);
  }

  mark(): number {
    return this.samples.length;
  }

  /** Activities and badge values observed while the host was busy since `mark`. */
  busy(since = 0): { activities: Set<string | undefined>; badges: Set<number | undefined> } {
    const busy = this.samples.slice(since).filter((sample) => sample.busy);
    return {
      activities: new Set(busy.map((sample) => sample.activity)),
      badges: new Set(busy.map((sample) => sample.badge)),
    };
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private sample(): void {
    if (!this.workbench.views.sidebar) return;
    const state = this.workbench.getState();
    const badge = readBadge(this.workbench);
    const issues: string[] = [];
    if (state.busy !== (state.activity !== undefined)) issues.push(`busy=${state.busy} but activity=${state.activity}`);
    if (badge && badge.value <= 0) issues.push(`badge value ${badge.value} must be omitted instead`);
    if (isIdle(state) && (badge?.value ?? 0) !== updatedIds(state).length)
      issues.push(`idle badge ${badge?.value} must equal ${updatedIds(state).length} distinct update packages`);
    if (issues.length && this.violations.length < 20) this.violations.push(`${issues.join('; ')}: ${summarize(state)}`);
    this.samples.push({ busy: state.busy, activity: state.activity, badge: badge?.value });
  }
}
