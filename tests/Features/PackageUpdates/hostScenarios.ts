import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import type { ViewState } from '../../../src/Features/PackageUpdates/Contracts/types';
import { TestFeed, waitForSidebarVisibility } from './hostFeed';
import {
  WorkbenchApi,
  updatablePackageIds,
  failingPackageIds,
  observedPackageIds,
  knownActivities,
  recheckDebounceMs,
  lowerSorted,
  summarize,
  updatedIds,
  isChecked,
  isIdle,
  rowsOf,
  rowOf,
  readBadge,
  assertBadge,
  poll,
  waitForState,
  waitUntilStable,
  watchFileChange,
  assertBadgeHeldDuring,
  assertStaysIdle,
  Counts,
  requestCounts,
  assertRequests,
  assertServedFromCache,
  StateRecorder,
} from './hostSupport';

// =====================================================================================================================
// Scenarios: automatic checks, listed-version cache and Activity Bar badge (REQ-010/AC-014, REQ-012/AC-016).
// Each verifies the real host with the request-counting HTTP feed and returns the settled state for the next one.
// =====================================================================================================================

export interface Scenario {
  workbench: WorkbenchApi;
  feed: TestFeed;
  recorder: StateRecorder;
  prefix: string;
  projectUri: vscode.Uri;
  startedAt: number;
}

/** Edits App.csproj in its editor without saving; the buffer stays dirty until `revertProject`. */
export async function editProject(uri: vscode.Uri): Promise<{ document: vscode.TextDocument; original: string }> {
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  const original = document.getText();
  assert.equal(
    await editor.edit((edit) => edit.insert(new vscode.Position(1, 0), '  <!-- recheck edit -->\r\n')),
    true,
  );
  return { document, original };
}

export async function revertProject(document: vscode.TextDocument, original: string): Promise<void> {
  await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await poll(
    'the edit to be reverted',
    () => (!document.isDirty && document.getText() === original ? true : undefined),
    10_000,
  );
}

/** AC-016 manifest evidence: the setting and the title actions, as loaded by the real host. */
export function verifyManifestContract(extension: vscode.Extension<unknown>, prefix: string): void {
  const contributes = extension.packageJSON.contributes;
  const setting = contributes.configuration.properties[`${prefix}.autoCheck`];
  assert.deepEqual(
    [setting?.type, setting?.default],
    ['boolean', true],
    'autoCheck must be a boolean enabled by default',
  );
  const actions: { command: string; group: string; when?: string }[] = contributes.menus['view/title'].filter(
    (item: { when?: string }) => item.when?.includes(`view == ${prefix}.sidebar`),
  );
  const visible = actions.filter((item) => item.group.startsWith('navigation')).map((item) => item.command);
  const overflow = actions.filter((item) => !item.group.startsWith('navigation')).map((item) => item.command);
  assert.deepEqual(
    visible.sort(),
    [`${prefix}.checkUpdates`, `${prefix}.openEditor`],
    'check and open editor are visible',
  );
  assert.deepEqual(
    overflow.sort(),
    [`${prefix}.configureFeeds`, `${prefix}.refresh`],
    'rescan and feeds are in overflow',
  );
}

/** AC-014 / AC-016: opening the view checks the feeds without any command and counts distinct updates in the badge. */
export async function verifyCheckOnOpen(scenario: Scenario): Promise<ViewState> {
  const { workbench, feed, recorder } = scenario;
  const configuration = vscode.workspace.getConfiguration(scenario.prefix);
  assert.equal(configuration.inspect<boolean>('autoCheck')?.defaultValue, true, 'autoCheck must default to true');
  // Nothing has called refresh, check or a command: the opened view must discover and check on its own.
  const state = await waitUntilStable(workbench, 'the automatic scan and check after opening the view', isChecked);
  assert.equal(state.autoCheck, true, 'the state must mirror the enabled autoCheck setting');
  assert.equal(rowOf(state, 'Central.Package').target, '2.0.0', 'the unlisted 3.0.0 must not be recommended');
  assert.equal(rowsOf(state, 'Child.Version.Package').length, 2, 'both child Version declarations stay separate');
  assert.deepEqual(updatedIds(state), lowerSorted(updatablePackageIds), 'every package with a listed newer version');
  for (const id of failingPackageIds) {
    const failed = rowOf(state, id);
    assert.equal(failed.status, 'error', `${id} failed its feed lookup and must never look current`);
    assert.deepEqual([failed.target, failed.versions], [undefined, []]);
  }
  assert.match(rowOf(state, 'Failing.Package').error ?? '', /HTTP 500/, 'the feed failure must be visible on the row');
  for (const id of observedPackageIds) assert.ok(feed.requestsFor(id) >= 2, `the automatic check must query ${id}`);
  const checkedAt = Date.parse(state.checkedAt ?? '');
  assert.ok(checkedAt >= scenario.startedAt && checkedAt <= Date.now(), `checkedAt must be fresh: ${state.checkedAt}`);
  assertBadge(workbench, state, 'after the automatic check');
  assert.ok(
    state.rows.filter((row) => row.status === 'update').length > updatedIds(state).length,
    'the badge counts distinct packages, not declarations: Child.Version.Package has two',
  );
  const busy = recorder.busy();
  assert.ok(
    busy.activities.has('scan') && busy.activities.has('check'),
    `scan and check are reported: ${[...busy.activities]}`,
  );
  assert.deepEqual([...busy.badges], [undefined], 'the badge must not show partial counts during the first check');
  return state;
}

/** AC-014: Apply leads to a checked list by itself, from cached listed versions; failed lookups are asked again. */
export async function verifyApplyRechecksFromCache(scenario: Scenario, checked: ViewState): Promise<ViewState> {
  const { workbench, feed } = scenario;
  const before = requestCounts(feed);
  const saved = watchFileChange(scenario.projectUri);
  await workbench.review([rowOf(checked, 'Automatic.Package').key]);
  assert.equal(workbench.getState().plan?.length, 1, 'one reviewed declaration must be ready to apply');
  await workbench.apply();
  // The save is reported to the file watcher after Apply, which can add one more debounced recheck.
  await saved();
  const rechecked = await waitUntilStable(workbench, 'the automatic recheck after Apply', isChecked);
  assert.match(await readFile(scenario.projectUri.fsPath, 'utf8'), /Include="Automatic\.Package" Version="2\.0\.0"/);
  const automatic = rowOf(rechecked, 'Automatic.Package');
  assert.deepEqual([automatic.version, automatic.status], ['2.0.0', 'current'], 'Apply must lead to a checked list');
  assert.equal(rechecked.plan, undefined, 'a completed Apply clears the reviewed plan');
  assertServedFromCache(feed, before, 'a recheck after Apply');
  for (const id of failingPackageIds)
    assert.equal(rowOf(rechecked, id).status, 'error', `${id} must not become current`);
  assertCachedAge(rechecked, checked, 'a recheck after Apply');
  assertBadge(workbench, rechecked, 'after the automatic recheck');
  assert.equal(updatedIds(rechecked).length, updatablePackageIds.length - 1, 'the applied package leaves the badge');
  return rechecked;
}

export function assertRefetched(
  feed: TestFeed,
  before: Counts,
  previous: ViewState,
  current: ViewState,
  name: string,
): void {
  assertRequests(feed, before, observedPackageIds, 'increased', `${name} must query the feeds despite cached versions`);
  const newer = Date.parse(current.checkedAt ?? '') > Date.parse(previous.checkedAt ?? '');
  assert.ok(
    newer,
    `${name} must report newer feed data than the cached check: ${previous.checkedAt} -> ${current.checkedAt}`,
  );
}

/**
 * A cached check reports the age of its oldest data. The time is the check start on a cold cache and the first fetch
 * start afterwards, so a cached recheck differs from the check that fetched it only by scheduling skew.
 */
export const feedTimeSkewMs = 500;

export function assertCachedAge(current: ViewState, previous: ViewState, name: string): void {
  const skew = Math.abs(Date.parse(current.checkedAt ?? '') - Date.parse(previous.checkedAt ?? ''));
  assert.ok(
    skew <= feedTimeSkewMs,
    `${name} must report the oldest feed data time: ${previous.checkedAt} -> ${current.checkedAt}`,
  );
}

/** AC-014: an explicit check always queries the feeds; AC-016: the badge keeps its settled value while it runs. */
export async function verifyExplicitChecksRefetch(scenario: Scenario, cached: ViewState): Promise<ViewState> {
  const { workbench, feed, recorder } = scenario;
  const settledBadge = readBadge(workbench)?.value;
  assert.ok(settledBadge, 'precondition: the settled list has updates');
  let before = requestCounts(feed);
  const mark = recorder.mark();
  await workbench.check();
  const checked = await waitForState(workbench, 'the explicit check to finish', isChecked);
  assertRefetched(feed, before, cached, checked, 'Check for updates');
  const busy = recorder.busy(mark);
  assert.ok(busy.activities.has('check'), `the explicit check reports check activity: ${[...busy.activities]}`);
  assert.deepEqual([...busy.badges], [settledBadge], 'the badge keeps the last settled count while a check runs');
  assertBadge(workbench, checked, 'after the explicit check');
  before = requestCounts(feed);
  await assertBadgeHeldDuring(workbench, workbench.refresh(true), settledBadge, 'Refresh with check');
  const refreshed = await waitForState(workbench, 'the explicit refresh with check to finish', isChecked);
  assertRefetched(feed, before, checked, refreshed, 'Refresh with check');
  assert.deepEqual(updatedIds(refreshed), updatedIds(checked), 'refetching must not change the verdicts');
  assertBadge(workbench, refreshed, 'after the explicit refresh');
  before = requestCounts(feed);
  const checkUpdates = vscode.commands.executeCommand(`${scenario.prefix}.checkUpdates`);
  await assertBadgeHeldDuring(workbench, checkUpdates, settledBadge, 'The Check for Updates command');
  const commanded = await waitForState(workbench, 'the Check for Updates command to finish', isChecked);
  assertRefetched(feed, before, refreshed, commanded, 'The Check for Updates command');
  assertBadge(workbench, commanded, 'after the Check for Updates command');
  return commanded;
}

/** AC-014: the Rescan Package Files command rediscovers declarations and rechecks from cached listed versions. */
export async function verifyRescanCommandUsesCache(scenario: Scenario, settled: ViewState): Promise<ViewState> {
  const { workbench, feed } = scenario;
  const before = requestCounts(feed);
  await vscode.commands.executeCommand(`${scenario.prefix}.refresh`);
  const rechecked = await waitForState(workbench, 'the Rescan Package Files command to finish', isChecked);
  assertServedFromCache(feed, before, 'Rescan Package Files');
  assertCachedAge(rechecked, settled, 'Rescan Package Files');
  assertBadge(workbench, rechecked, 'after rescanning');
  return rechecked;
}

/** AC-014: the listed-version cache belongs to one feed set; changing the feeds refetches, and so does restoring them. */
export async function verifyFeedChangeRefetches(scenario: Scenario, settled: ViewState): Promise<ViewState> {
  const { workbench, feed } = scenario;
  const configuration = vscode.workspace.getConfiguration(scenario.prefix);
  let previous = settled;
  for (const url of [`${feed.url}?set=second`, feed.url]) {
    const before = requestCounts(feed);
    await configuration.update('feeds', [{ name: 'Host test feed', url }], vscode.ConfigurationTarget.Workspace);
    const rechecked = await waitUntilStable(workbench, 'the automatic recheck after the feed set changed', isChecked);
    assert.equal(rechecked.feeds[0]?.url, url, 'the check must use the configured feed set');
    assertRefetched(feed, before, previous, rechecked, 'A changed feed set');
    previous = rechecked;
  }
  return previous;
}

/**
 * AC-014: a cancelled check leaves unfinished rows unchecked and never reports a completed check. Its few finished
 * lookups refresh only part of the cache, so the recovery rescan must report the age of the oldest remaining data.
 */
export async function verifyCancelledCheck(scenario: Scenario): Promise<ViewState> {
  const { workbench } = scenario;
  const cancelledAt = Date.now();
  const running = workbench.check();
  await waitForState(workbench, 'the explicit check to start', (s) => s.busy && s.activity === 'check', 10_000);
  await workbench.message({ type: 'cancel' });
  await running;
  const cancelled = workbench.getState();
  assert.equal(cancelled.busy, false, 'cancelling must end the busy state');
  assert.ok(
    !cancelled.rows.some((row) => row.status === 'checking'),
    `no row may keep checking: ${summarize(cancelled)}`,
  );
  assert.ok(
    cancelled.rows.some((row) => row.status === 'unchecked'),
    'unfinished rows must stay unchecked, not current',
  );
  assert.deepEqual([cancelled.checkedAt, cancelled.plan], [undefined, undefined], 'a cancelled check is not complete');
  assert.ok(!cancelled.recheckPending, 'cancelling must not schedule an automatic recheck');
  assertBadge(workbench, cancelled, 'after cancelling');
  await vscode.commands.executeCommand(`${scenario.prefix}.refresh`);
  const recovered = await waitForState(workbench, 'Rescan Package Files to recover after cancelling', isChecked);
  const oldest = Date.parse(recovered.checkedAt ?? '');
  assert.ok(
    oldest < cancelledAt,
    `a mixed-age cache reports its oldest data: ${recovered.checkedAt} vs ${cancelledAt}`,
  );
  return recovered;
}

/** AC-014: a package-file edit while the sidebar is visible leads to a checked list by itself, from cached versions. */
export async function verifyEditRechecksFromCache(scenario: Scenario, settled: ViewState): Promise<ViewState> {
  const { workbench, feed } = scenario;
  const settledBadge = readBadge(workbench)?.value;
  assert.ok(settledBadge, 'precondition: the settled list has updates');
  const before = requestCounts(feed);
  const { document, original } = await editProject(scenario.projectUri);
  const pending = await waitForState(
    workbench,
    'the debounced recheck to be scheduled',
    (s) => s.recheckPending === true,
    5000,
  );
  assert.equal(pending.busy, false, 'the recheck is debounced, not running yet');
  assert.ok(
    pending.rows.every((row) => row.status === 'unchecked'),
    'an edit must invalidate every row',
  );
  assert.deepEqual([pending.plan, pending.checkedAt], [undefined, undefined], 'an edit drops the plan and check time');
  assert.equal(
    readBadge(workbench)?.value,
    settledBadge,
    'the badge keeps its last settled count while a recheck waits',
  );
  const rechecked = await waitUntilStable(workbench, 'the automatic recheck after the editor change', isChecked);
  assert.equal(document.isDirty, true, 'the extension must never save a user editor change');
  assertServedFromCache(feed, before, 'an edit recheck');
  assertCachedAge(rechecked, settled, 'an edit recheck');
  assertBadge(workbench, rechecked, 'after the edit recheck');
  assert.deepEqual(updatedIds(rechecked), updatedIds(settled));
  await verifyBufferedApplyRechecks(scenario, rechecked, document);
  await revertProject(document, original);
  return waitUntilStable(workbench, 'the automatic recheck after reverting the edit', isChecked);
}

/**
 * AC-014: Apply into an unsaved buffer writes nothing to disk, so no file-watcher event can recheck for it: the
 * automatic recheck must come from Apply itself, which makes this the strict proof of that contract.
 */
export async function verifyBufferedApplyRechecks(
  scenario: Scenario,
  checked: ViewState,
  document: vscode.TextDocument,
): Promise<void> {
  const { workbench, feed } = scenario;
  const onDisk = await readFile(scenario.projectUri.fsPath, 'utf8');
  const before = requestCounts(feed);
  await workbench.review([rowOf(checked, 'Buffered.Package').key]);
  await workbench.apply();
  const rechecked = await waitForState(
    workbench,
    'the automatic recheck after Apply into a buffer',
    (s) => isChecked(s) && rowOf(s, 'Buffered.Package').version === '2.0.0',
  );
  assert.equal(rowOf(rechecked, 'Buffered.Package').status, 'current', 'the rescan shows the applied version');
  assert.match(document.getText(), /Include="Buffered\.Package" Version="2\.0\.0"/);
  assert.equal(document.isDirty, true, 'Apply must not save an unsaved buffer');
  assert.equal(await readFile(scenario.projectUri.fsPath, 'utf8'), onDisk, 'Apply must not write an unsaved buffer');
  assertServedFromCache(feed, before, 'a recheck after Apply into a buffer');
  assertBadge(workbench, rechecked, 'after Apply into a buffer');
}

/** Hides the sidebar, edits the project and proves that nothing is scheduled or fetched while no surface is visible. */
export async function editWhileHidden(
  scenario: Scenario,
): Promise<{ document: vscode.TextDocument; original: string }> {
  const { workbench, feed } = scenario;
  const sidebar = workbench.views.sidebar;
  assert.ok(sidebar?.visible, 'precondition: the sidebar is visible');
  const before = requestCounts(feed);
  const hidden = waitForSidebarVisibility(sidebar, false);
  await vscode.commands.executeCommand('workbench.action.closeSidebar');
  await hidden;
  const edit = await editProject(scenario.projectUri);
  const edited = await waitForState(
    workbench,
    'the edit to invalidate the rows',
    (s) => s.rows.every((r) => r.status === 'unchecked'),
    5000,
  );
  assert.ok(!edited.recheckPending, 'no recheck may be scheduled while no surface is visible');
  assert.equal(readBadge(workbench), undefined, 'unchecked rows with no recheck pending clear the badge');
  await assertStaysIdle(workbench, recheckDebounceMs * 2, 'a hidden surface must not start a recheck');
  assertRequests(feed, before, observedPackageIds, 'unchanged', 'a hidden surface must not query the feeds');
  return edit;
}

export async function showSidebar(workbench: WorkbenchApi): Promise<void> {
  const sidebar = workbench.views.sidebar;
  assert.ok(sidebar, 'the sidebar view must still exist');
  const revealed = waitForSidebarVisibility(sidebar, true);
  await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
  await revealed;
}

/** AC-014: with every surface hidden an edit schedules nothing; showing the sidebar again checks automatically. */
export async function verifyHiddenSurfaceDefersRecheck(scenario: Scenario, settled: ViewState): Promise<ViewState> {
  const { workbench, feed } = scenario;
  const before = requestCounts(feed);
  const { document, original } = await editWhileHidden(scenario);
  await showSidebar(workbench);
  const rechecked = await waitUntilStable(workbench, 'the automatic check after the sidebar became visible', isChecked);
  assertServedFromCache(feed, before, 'showing the surface');
  assertCachedAge(rechecked, settled, 'showing the surface');
  await revertProject(document, original);
  return waitUntilStable(workbench, 'the automatic recheck after reverting the edit', isChecked);
}

/** AC-014: with autoCheck false nothing checks until requested, Apply leaves rows unchecked and the badge clears. */
export async function verifyAutoCheckDisabled(scenario: Scenario, settled: ViewState): Promise<void> {
  const { workbench, feed, recorder } = scenario;
  const configuration = vscode.workspace.getConfiguration(scenario.prefix);
  await configuration.update('autoCheck', false, vscode.ConfigurationTarget.Workspace);
  const disabled = await waitForState(
    workbench,
    'the host to observe autoCheck=false',
    (s) => s.autoCheck === false,
    10_000,
  );
  assert.deepEqual(disabled.rows, settled.rows, 'changing autoCheck must not invalidate the checked rows');
  assert.equal(disabled.checkedAt, settled.checkedAt, 'changing autoCheck must keep the check time');
  assertBadge(workbench, disabled, 'after disabling autoCheck');
  const before = requestCounts(feed);
  const saved = watchFileChange(scenario.projectUri);
  await workbench.review([rowOf(disabled, 'Manual.Package').key]);
  await workbench.apply();
  await saved();
  const idle = await waitUntilStable(workbench, 'the host to stay idle after Apply', isIdle);
  assert.match(await readFile(scenario.projectUri.fsPath, 'utf8'), /Include="Manual\.Package" Version="2\.0\.0"/);
  assert.ok(
    idle.rows.length > 0 && idle.rows.every((row) => row.status === 'unchecked'),
    `Apply with autoCheck disabled must leave every row unchecked: ${summarize(idle)}`,
  );
  assert.deepEqual(
    [idle.checkedAt, idle.plan, readBadge(workbench)],
    [undefined, undefined, undefined],
    'unchecked rows have no check time or plan and clear the badge',
  );
  await workbench.refresh();
  assert.ok(
    workbench.getState().rows.every((row) => row.status === 'unchecked'),
    'a rescan alone never checks',
  );
  // A check queued as automatic is dropped when its scan ends with automatic checks off, as after a setting change.
  await workbench.refresh('cached');
  const dropped = workbench.getState();
  assert.ok(
    isIdle(dropped) && dropped.rows.every((row) => row.status === 'unchecked'),
    `a queued automatic check must be dropped while autoCheck is off: ${summarize(dropped)}`,
  );
  // Showing the surface rediscovers declarations that changed while it was hidden, but never checks the feeds.
  const mark = recorder.mark();
  const { document, original } = await editWhileHidden(scenario);
  await showSidebar(workbench);
  await poll(
    'the rescan after the sidebar became visible',
    () => recorder.busy(mark).activities.has('scan') || undefined,
    10_000,
  );
  await waitUntilStable(workbench, 'the host to stay idle after showing the sidebar', isIdle);
  assert.ok(!recorder.busy(mark).activities.has('check'), 'with autoCheck false showing the surface never checks');
  await revertProject(document, original);
  await waitUntilStable(workbench, 'the host to stay idle after reverting the edit', isIdle);
  assertRequests(feed, before, observedPackageIds, 'unchanged', 'with autoCheck false no feed request occurs');
}

/** Runs the scenarios in order; each one starts from the settled state the previous one returned. */
export async function runAutomaticCheckScenarios(scenario: Scenario): Promise<void> {
  const opened = await verifyCheckOnOpen(scenario);
  const applied = await verifyApplyRechecksFromCache(scenario, opened);
  const refetched = await verifyExplicitChecksRefetch(scenario, applied);
  const rescanned = await verifyRescanCommandUsesCache(scenario, refetched);
  await verifyFeedChangeRefetches(scenario, rescanned);
  const recovered = await verifyCancelledCheck(scenario);
  const edited = await verifyEditRechecksFromCache(scenario, recovered);
  const reopened = await verifyHiddenSurfaceDefersRecheck(scenario, edited);
  await verifyAutoCheckDisabled(scenario, reopened);
}

/** REQ-012: every host state sampled during the whole run satisfied the activity and badge invariants. */
export function verifyRecordedContract(recorder: StateRecorder): void {
  const { activities } = recorder.busy();
  for (const activity of knownActivities)
    assert.ok(activities.has(activity), `${activity} activity: ${[...activities]}`);
  assert.deepEqual(
    [...activities].filter((activity) => !activity || !knownActivities.includes(activity)),
    [],
    'only documented activities are reported while busy',
  );
  assert.deepEqual(recorder.violations, [], 'activity and badge invariants must hold in every sampled state');
}
