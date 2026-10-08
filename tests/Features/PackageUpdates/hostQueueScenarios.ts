import assert from 'node:assert/strict';
import type { ViewState } from '../../../src/Features/PackageUpdates/Contracts/types';
import type { EngineClient } from '../../../src/Features/PackageUpdates/Host/engine';
import { editProject, revertProject, type Scenario } from './hostScenarios';
import {
  assertBadge,
  assertRequests,
  isChecked,
  observedPackageIds,
  poll,
  readBadge,
  requestCounts,
  waitForState,
  waitUntilStable,
} from './hostSupport';

/** AC-014 / AC-016: an invalidated slow scan must publish the idle badge before its queued check can start. */
export async function verifyQueuedScanInvalidation(scenario: Scenario): Promise<ViewState> {
  const { workbench, feed } = scenario;
  assert.ok(isChecked(workbench.getState()), 'precondition: discovery and checks have settled');
  assert.equal(workbench.getState().autoCheck, true, 'precondition: automatic checks are enabled');
  assert.equal(workbench.views.sidebar?.visible, true, 'precondition: the sidebar is visible');
  const settledBadge = readBadge(workbench)?.value;
  assert.ok(settledBadge, 'precondition: checked packages have updates');
  const before = requestCounts(feed);
  const client = (workbench as unknown as { client: EngineClient }).client;
  const originalParse = client.parse;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted = false;
  let held = false;
  client.parse = async (text) => {
    if (!intercepted) {
      intercepted = true;
      held = true;
      await gate;
      held = false;
    }
    return originalParse.call(client, text);
  };
  const scan = workbench.refresh(true);
  // Observe rejection immediately; the original promise is still awaited and any failure propagates.
  void scan.catch(() => undefined);
  let edit: Awaited<ReturnType<typeof editProject>> | undefined;
  let restored: ViewState | undefined;
  try {
    await poll('one real engine parse to reach its test-owned gate', () => (held ? true : undefined), 10_000);
    edit = await editProject(scenario.projectUri);
    const pending = await waitForState(
      workbench,
      'the edit to queue an automatic recheck',
      (s) => !!s.recheckPending,
      5000,
    );
    assert.equal(pending.busy, false, 'invalidating the obsolete scan ends its published busy state');
    assert.equal(readBadge(workbench)?.value, settledBadge, 'a pending recheck retains the settled badge');
    const expired = await waitForState(
      workbench,
      'the recheck debounce to expire while the old scan is held',
      (s) => !s.recheckPending && !s.busy,
      10_000,
    );
    assert.equal(held, true, 'the obsolete scan is still waiting on its real parse');
    assert.ok(expired.rows.length > 0 && expired.rows.every((row) => row.status === 'unchecked'));
    assert.equal(expired.checkedAt, undefined, 'the invalidated scan has no completed check time');
    assert.equal(
      readBadge(workbench),
      undefined,
      'idle unchecked rows must clear the badge before the queued scan starts',
    );
    assertRequests(feed, before, observedPackageIds, 'unchanged', 'a held obsolete scan cannot start feed lookups');
    release();
    client.parse = originalParse;
    await scan;
    const recovered = await waitUntilStable(workbench, 'the queued scan and automatic check to recover', isChecked);
    assert.equal(edit.document.isDirty, true, 'automatic recovery must preserve the unsaved editor change');
    assertBadge(workbench, recovered, 'after a queued scan recovers');
  } finally {
    release();
    client.parse = originalParse;
    try {
      await scan;
    } finally {
      if (edit) {
        await revertProject(edit.document, edit.original);
        restored = await waitUntilStable(
          workbench,
          'the automatic recheck after restoring the queued-scan fixture',
          isChecked,
        );
      }
    }
  }
  assert.ok(restored, 'the edited fixture must be restored and checked');
  return restored;
}
