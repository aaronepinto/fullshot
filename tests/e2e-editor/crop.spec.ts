/**
 * Item 6: the crop is visible in the inventory panel.
 *
 * Cropping already pushed an undo entry, but the panel only ever listed drawn
 * annotations, so the biggest edit available changed the picture and left the list
 * looking untouched, and undoing it looked like undoing nothing at all.
 */
import { expect, test } from './fixtures';

const row = (page: import('@playwright/test').Page) => page.locator('[data-testid="crop-row"]');

async function cropTo(editor: import('./fixtures').Editor, from: [number, number], to: [number, number]) {
  await editor.tool('crop');
  await editor.drag(from, to);
  await editor.page.click('#cropApply');
}

test('a crop takes a row of its own, with its size', async ({ editor, page }) => {
  await page.click('#btnAnnos');
  await expect(row(page)).toHaveCount(0);

  await cropTo(editor, [100, 100], [500, 400]);

  await expect(row(page)).toHaveCount(1);
  await expect(row(page)).toContainText('Crop');
  await expect(row(page)).toContainText('400 × 300');
});

test('the row appears even when nothing has been drawn', async ({ editor, page }) => {
  await cropTo(editor, [60, 60], [360, 260]);
  await page.click('#btnAnnos');
  await expect(row(page)).toHaveCount(1);
  await expect(page.locator('[data-testid="anno-row"]')).toHaveCount(0);
});

test('the crop sits above the annotations it applies to', async ({ editor, page }) => {
  await editor.tool('rect');
  await editor.drag([120, 120], [300, 300]);
  await cropTo(editor, [100, 100], [500, 400]);
  await page.click('#btnAnnos');

  const first = await page.locator('#annoList li').first().getAttribute('data-testid');
  expect(first).toBe('crop-row');
});

test('undo removes the row, redo brings it back', async ({ editor, page }) => {
  await page.click('#btnAnnos');
  await cropTo(editor, [100, 100], [500, 400]);
  await expect(row(page)).toHaveCount(1);

  await page.click('#btnUndo');
  await expect(row(page)).toHaveCount(0);
  expect((await editor.state()).crop).toBeNull();

  await page.click('#btnRedo');
  await expect(row(page)).toHaveCount(1);
  expect((await editor.state()).crop).not.toBeNull();
});

test('the row resets the crop, and that reset is itself undoable', async ({ editor, page }) => {
  await page.click('#btnAnnos');
  await cropTo(editor, [100, 100], [500, 400]);

  await page.locator('[data-testid="crop-reset"]').click();
  await expect(row(page)).toHaveCount(0);
  expect((await editor.state()).crop).toBeNull();

  await page.click('#btnUndo');
  await expect(row(page)).toHaveCount(1);
  expect((await editor.state()).crop).not.toBeNull();
});

test('the row follows a second crop rather than going stale', async ({ editor, page }) => {
  await page.click('#btnAnnos');
  await cropTo(editor, [100, 100], [500, 400]);
  await expect(row(page)).toContainText('400 × 300');

  await cropTo(editor, [150, 150], [350, 250]);
  await expect(row(page)).toContainText('200 × 100');
  await expect(row(page)).toHaveCount(1);
});

test('the status bar and the panel agree about the crop', async ({ editor, page }) => {
  await page.click('#btnAnnos');
  await cropTo(editor, [100, 100], [500, 400]);
  await expect(page.locator('#statDims')).toContainText('400 × 300');
  await expect(page.locator('#btnCropReset')).toBeVisible();

  await page.click('#btnCropReset');
  await expect(row(page)).toHaveCount(0);
  await expect(page.locator('#statDims')).toHaveText(`${editor.width} × ${editor.height}`);
});
