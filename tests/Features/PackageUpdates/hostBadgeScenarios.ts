import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import * as vscode from 'vscode';
import type { WorkbenchViews } from '../../../src/Features/PackageUpdates/Host/WorkbenchViews';
import type { Scenario } from './hostScenarios';
import { isChecked, updatedIds, waitUntilStable } from './hostSupport';

type BadgeWorkbench = Scenario['workbench'] & { views: WorkbenchViews; ready(): Promise<void> };
type OriginalDocument = { document: vscode.TextDocument; text: string; dirty: boolean };
const activityItem = '.activitybar .action-item[aria-label^="NuGet"]';

/** REQ-019 / AC-023: inspect native chrome after real engine checks, rather than trusting the extension-host getter. */
export async function verifyNativeBadgeClearing(scenario: Scenario): Promise<void> {
  const workbench = scenario.workbench as BadgeWorkbench;
  const checked = workbench.getState();
  assert.ok(isChecked(checked), 'native badge regression starts after the first automatic check');
  const originalCount = updatedIds(checked).length;
  assert.ok(originalCount > 0, 'the fixture must start with available updates');
  const browser = await connectToHost();
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().includes('/workbench') && candidate.url().endsWith('.html'));
  assert.ok(page, 'CDP must expose the actual VS Code workbench renderer');
  const originals: OriginalDocument[] = [];
  try {
    await assertNativeBadge(page, originalCount, 'positive');
    workbench.views.status(0, true);
    await assertNativeBadge(page, originalCount, 'busy-retained');
    workbench.views.status(originalCount, false);
    await updateEveryAvailableDeclaration(workbench, originals);
    const zero = await waitUntilStable(
      workbench,
      'all available fixture updates to become current',
      (state) => isChecked(state) && updatedIds(state).length === 0,
    );
    assert.ok(
      zero.rows.every((row) => row.status === 'current' || row.status === 'error'),
      'zero updates must be settled; feed failures remain explicit errors',
    );
    await assertNativeBadge(page, 0, 'zero');
    await workbench.ready();
    await workbench.ready();
    await assertNativeBadge(page, 0, 'repeated-zero');
    for (const { document } of originals) {
      const current = await vscode.workspace.openTextDocument(document.uri);
      assert.equal(current.isDirty, true, 'fixture edits stay unsaved');
    }
  } finally {
    try {
      workbench.views.status(updatedIds(workbench.getState()).length, false);
      if (originals.length) {
        await restoreDocuments(originals);
        const restored = await waitUntilStable(
          workbench,
          'restored fixture updates to recover',
          (state) => isChecked(state) && updatedIds(state).length === originalCount,
        );
        assert.deepEqual(updatedIds(restored), updatedIds(checked), 'the fixture must recover its original updates');
        await assertNativeBadge(page, originalCount, 'restored-positive');
      }
    } finally {
      // Closing a CDP connection detaches Playwright; the test runner still owns the editor lifetime.
      await browser.close();
    }
  }
}

async function connectToHost(): Promise<Browser> {
  const endpoint = process.env.NUGET_WORKBENCH_CDP_ENDPOINT;
  const modulePath = process.env.NUGET_WORKBENCH_PLAYWRIGHT_MODULE;
  assert.ok(endpoint && modulePath, 'the host runner must supply its loopback CDP endpoint and Playwright path');
  const { chromium } = createRequire(__filename)(modulePath) as typeof import('playwright');
  return chromium.connectOverCDP(endpoint, { timeout: 30_000 });
}

async function assertNativeBadge(page: Page, count: number, name: string): Promise<void> {
  const item = page.locator(activityItem);
  await item.waitFor({ state: 'visible', timeout: 10_000 });
  const badge = item.locator('.badge');
  const content = badge.locator('.badge-content');
  if (count === 0) {
    await badge.waitFor({ state: 'hidden', timeout: 10_000 });
    assert.equal(await content.isVisible(), false, 'zero must remove the native visible numeral');
    assert.notEqual(await content.textContent(), '0', 'native chrome must never display a zero numeral');
  } else {
    await badge.waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForFunction(
      ({ selector, expected }) =>
        document.querySelector(`${selector} .badge-content`)?.textContent === String(expected),
      { selector: activityItem, expected: count },
      { timeout: 10_000 },
    );
    assert.equal(await content.textContent(), String(count), 'native chrome must reflect the settled update count');
  }
  const artifacts = process.env.NUGET_WORKBENCH_BADGE_ARTIFACTS;
  assert.ok(artifacts, 'the host runner must supply a persistent native screenshot directory');
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, `${name}.png`) });
}

async function updateEveryAvailableDeclaration(
  workbench: BadgeWorkbench,
  originals: OriginalDocument[],
): Promise<void> {
  const updates = workbench.getState().rows.filter((row) => row.status === 'update');
  const edit = new vscode.WorkspaceEdit();
  for (const file of new Set(updates.map((row) => row.file))) {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(file));
    originals.push({ document, text: document.getText(), dirty: document.isDirty });
    for (const row of updates.filter((candidate) => candidate.file === file)) {
      assert.ok(row.target, 'the real engine must provide the version to apply');
      edit.replace(
        document.uri,
        new vscode.Range(document.positionAt(row.start), document.positionAt(row.end)),
        row.target,
      );
    }
  }
  assert.equal(await vscode.workspace.applyEdit(edit), true, 'actual editor edits must apply every available update');
}

async function restoreDocuments(originals: OriginalDocument[]): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  for (const { document, text } of originals) {
    const current = await vscode.workspace.openTextDocument(document.uri);
    edit.replace(
      current.uri,
      new vscode.Range(current.positionAt(0), current.positionAt(current.getText().length)),
      text,
    );
  }
  assert.equal(await vscode.workspace.applyEdit(edit), true, 'restore the original fixture buffers');
  for (const { document, text, dirty } of originals) {
    let restored = await vscode.workspace.openTextDocument(document.uri);
    if (!dirty) {
      await vscode.window.showTextDocument(restored);
      await vscode.commands.executeCommand('workbench.action.files.revert');
      restored = await vscode.workspace.openTextDocument(document.uri);
    }
    assert.equal(restored.getText(), text, 'fixture restoration must preserve the exact original text');
    assert.equal(restored.isDirty, dirty, 'fixture restoration must preserve the original dirty state');
  }
}
