import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

// REQ-016 / AC-020: exercise the production renderer; preview host never edits files.
const themes = ['dark-modern', 'light-modern'] as const;
const sizes = [
  { width: 1366, height: 768 },
  { width: 1024, height: 600 },
  { width: 780, height: 480 },
  { width: 779, height: 480 },
  { width: 390, height: 600 },
  { width: 320, height: 600 },
  { width: 260, height: 480 },
];
const longPackage = 'Aspire.Microsoft.EntityFrameworkCore.Cosmos.Abstractions';
const currentVersion = '13.6.0-preview.1.123456789';
const longPackageName = `Select ${longPackage} ${longPackage} ${currentVersion} to 13.6.1`;
type Bounds = { x: number; y: number; width: number; height: number };

async function bounds(locator: Locator): Promise<Bounds> {
  const box = await locator.boundingBox();
  expect(box, 'the rendered element must have bounds').not.toBeNull();
  return box!;
}

function inside(child: Bounds, parent: Bounds, label: string) {
  expect(child.x, `${label} left edge`).toBeGreaterThanOrEqual(parent.x - 1);
  expect(child.x + child.width, `${label} right edge`).toBeLessThanOrEqual(parent.x + parent.width + 1);
  expect(child.y, `${label} top edge`).toBeGreaterThanOrEqual(parent.y - 1);
  expect(child.y + child.height, `${label} bottom edge`).toBeLessThanOrEqual(parent.y + parent.height + 1);
}

async function noHorizontalOverflow(page: Page) {
  const width = page.viewportSize()!.width;
  const scrollWidth = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  );
  expect(scrollWidth, 'the workbench must not scroll horizontally').toBeLessThanOrEqual(width);
}

async function pinnedFooter(page: Page, review = false) {
  const viewport = page.viewportSize()!;
  const footer = page.locator(review ? '.review-foot' : '.footer');
  await expect(footer).toBeVisible();
  const box = await bounds(footer);
  inside(box, { x: 0, y: 0, ...viewport }, 'action footer');
  await expect(footer.getByRole('button').last()).toBeVisible();
  return box;
}

async function openPreview(page: Page, theme: string, untrusted = false) {
  const surface = page.viewportSize()!.width < 780 ? 'sidebar' : 'editor';
  const params = new URLSearchParams({ theme, surface, instant: '1', stress: '1', clean: '1' });
  if (untrusted) params.set('scenario', 'untrusted');
  await page.goto(`/?${params}`);
  await expect(page.getByRole('status', { name: /Checked/ })).toBeVisible();
  if (surface === 'sidebar') await expect(page.getByRole('button', { name: 'Open manager' })).toBeVisible();
  await pinnedFooter(page);
  await noHorizontalOverflow(page);
}

async function searchControls(page: Page) {
  await page.getByRole('button', { name: 'Filters and version policy', exact: true }).click();
  const group = page.getByRole('radiogroup', { name: 'Update search', exact: true });
  const radios = group.getByRole('radio');
  await expect(radios).toHaveCount(4);
  await expect(group.getByRole('radio', { name: 'Stable', exact: true })).toHaveAttribute('aria-checked', 'true');
  const outer = await bounds(group);
  const segments = await radios.all();
  for (const segment of segments) {
    const box = await bounds(segment);
    expect(box.height, 'segments fill the complete control interior').toBeCloseTo(outer.height - 2, 1);
    expect(box.y - outer.y, 'no gap above a segment').toBe(1);
    expect(outer.y + outer.height - box.y - box.height, 'no gap below a segment').toBe(1);
  }
  await group.getByRole('radio', { name: 'Stable', exact: true }).hover();
  await group.getByRole('radio', { name: 'All', exact: true }).click();
  await expect(group.getByRole('radio', { name: 'All', exact: true })).toHaveAttribute('aria-checked', 'true');
  if (page.viewportSize()!.height === 480 && page.viewportSize()!.width < 780) {
    expect((await bounds(page.getByRole('tree', { name: 'Packages', exact: true }))).height).toBeGreaterThanOrEqual(80);
  }
  await group.getByRole('radio', { name: 'Stable', exact: true }).click();
  await expect(group.getByRole('radio', { name: 'Stable', exact: true })).toHaveAttribute('aria-checked', 'true');
  await pinnedFooter(page);
  await noHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(group).not.toBeVisible();
}

async function familyChips(page: Page) {
  const tree = page.getByRole('tree', { name: 'Packages', exact: true });
  const aspire = tree
    .getByRole('treeitem')
    .filter({ has: page.getByRole('button', { name: 'Update', exact: true }) })
    .filter({ hasText: /^Aspire/ });
  if ((await aspire.getAttribute('aria-expanded')) === 'false') await aspire.click();
  const chip = tree.getByRole('button', { name: /^Microsoft\.EntityFrameworkCore\.Cosmos(?:\s|\d)/ });
  await expect(chip).toBeVisible();
  const outer = await bounds(tree);
  for (const item of await tree.locator('.sub').all()) {
    const box = await bounds(item);
    expect(box.x, 'subgroup chip starts inside the package list').toBeGreaterThanOrEqual(outer.x);
    expect(box.x + box.width, 'subgroup chip ends inside the package list').toBeLessThanOrEqual(outer.x + outer.width);
  }
  await noHorizontalOverflow(page);
}

async function narrowDetails(page: Page, testInfo: TestInfo) {
  const row = page.getByRole('treeitem', { name: longPackageName, exact: true });
  await row.click();
  const inspector = page.getByRole('complementary', { name: 'Package details', exact: true });
  const back = inspector.getByRole('button', { name: 'Back to packages', exact: true });
  await expect(back).toBeFocused();
  // Measure after the real drawer transition, rather than comparing different animation frames.
  await expect.poll(() => inspector.evaluate((element) => getComputedStyle(element).transform)).toBe('none');
  const current = inspector.locator('.decl-grid .mono');
  await expect(current).toHaveText(currentVersion);
  inside(await bounds(current), await bounds(inspector.locator('.decl-card')), 'long current version');
  expect(
    await current.evaluate((element) => element.scrollWidth <= element.clientWidth),
    'current text stays within its track',
  ).toBe(true);
  await noHorizontalOverflow(page);
  await page.keyboard.press('Shift+Tab');
  expect(await inspector.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(back).toBeFocused();
  if (page.viewportSize()!.width === 320) {
    await testInfo.attach('narrow-package-details', { body: await page.screenshot(), contentType: 'image/png' });
  }
  await page.keyboard.press('Escape');
  await expect(inspector).not.toBeVisible();
  await expect(row).toBeFocused();
  await pinnedFooter(page);
}

async function completeReview(page: Page) {
  await page.getByRole('button', { name: 'Update all', exact: true }).click();
  const review = page.getByRole('region', { name: 'Review updates', exact: true });
  await expect(review.getByText('33 changes in 3 files', { exact: true })).toBeVisible();
  await expect(review.locator('.review-file')).toHaveCount(3);
  await expect(review.locator('.review-row')).toHaveCount(33);
  const files = await review.locator('.review-file').evaluateAll((elements) =>
    elements.map((file) => {
      const section = file.getBoundingClientRect();
      return {
        section: { x: section.x, y: section.y, width: section.width, height: section.height },
        rows: Array.from(file.querySelectorAll('.review-row')).map((row) => {
          const box = row.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        }),
      };
    }),
  );
  for (const file of files) for (const row of file.rows) inside(row, file.section, 'review change inside its file');
  const body = review.locator('.review-body');
  const scroll = await body.evaluate((element) => ({ height: element.clientHeight, content: element.scrollHeight }));
  expect(scroll.content, 'all changes occupy scrollable review content').toBeGreaterThan(scroll.height);
  const footer = await pinnedFooter(page, true);
  const last = review.locator('.review-row').last();
  await last.scrollIntoViewIfNeeded();
  inside(await bounds(last), await bounds(body), 'last change reached by scrolling');
  expect((await pinnedFooter(page, true)).y, 'scrolling does not move Apply actions').toBe(footer.y);
  await noHorizontalOverflow(page);
}

for (const theme of themes) {
  for (const viewport of sizes) {
    test(`${theme} at ${viewport.width}x${viewport.height}: controls, details and complete review`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await openPreview(page, theme);
      await searchControls(page);
      await familyChips(page);
      if (viewport.width < 780) await narrowDetails(page, testInfo);
      await completeReview(page);
    });
  }

  test(`${theme} at 260x480: restricted workspace keeps filters and actions reachable`, async ({ page }) => {
    await page.setViewportSize({ width: 260, height: 480 });
    await openPreview(page, theme, true);
    await expect(
      page.getByText('Restricted Mode. Trust this workspace to apply updates.', { exact: true }),
    ).toBeVisible();
    await searchControls(page);
    await expect(page.getByRole('button', { name: 'Update all', exact: true })).toBeDisabled();
    await pinnedFooter(page);
  });
}
