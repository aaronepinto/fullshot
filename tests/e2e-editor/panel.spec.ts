/** Item 9: the annotation inventory panel. */
import { expect, test } from './fixtures';

async function threeShapes(editor: import('./fixtures').Editor) {
  await editor.tool('rect');
  await editor.page.check('#fillShape');
  await editor.drag([60, 60], [200, 200]);
  await editor.drag([300, 60], [440, 200]);
  await editor.writeText(560, 400, 'a label');
  await editor.tool('select');
  await editor.page.keyboard.press('Escape');
  await editor.page.click('#btnAnnos');
}

test('the panel lists every annotation, topmost first', async ({ editor, page }) => {
  await threeShapes(editor);

  const rows = page.locator('[data-testid="anno-row"]');
  await expect(rows).toHaveCount(3);
  expect(await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.index))).toEqual([
    '2',
    '1',
    '0',
  ]);
  await expect(rows.first()).toContainText('text');
  await expect(rows.first()).toContainText('a label');
});

test('clicking a row selects it and brings it into view', async ({ editor, page }) => {
  await threeShapes(editor);
  await editor.zoomAt(100, 100, 400);

  // The label is well off screen at this magnification.
  const before = await editor.at(560, 400);
  expect(before.x).toBeGreaterThan(1440);

  await page.locator('[data-testid="anno-row"]').first().click();

  expect((await editor.state()).selection).toEqual([2]);
  const box = (await editor.bounds(2))!;
  const topLeft = await editor.at(box.x, box.y);
  expect(topLeft.x).toBeGreaterThan(0);
  expect(topLeft.x).toBeLessThan(1440);
  expect(topLeft.y).toBeGreaterThan(0);
  expect(topLeft.y).toBeLessThan(1000);
});

test('a jump flashes the annotation for a moment', async ({ editor, page }) => {
  await threeShapes(editor);
  const flash = page.locator('[data-testid="anno-flash"]');
  await expect(flash).toBeHidden();

  await page.locator('[data-testid="anno-row"]').first().click();
  await expect(flash).toBeVisible();
  await expect(flash).toBeHidden({ timeout: 3000 });
});

test('a row deletes its own annotation and no other', async ({ editor, page }) => {
  await threeShapes(editor);
  const before = await editor.annos();

  await page.locator('[data-testid="anno-row"]').first().locator('[data-testid="anno-delete"]').click();

  const after = await editor.annos();
  expect(after).toHaveLength(2);
  expect(after).toEqual(before.slice(0, 2));
  await expect(page.locator('[data-testid="anno-row"]')).toHaveCount(2);
});

test('the panel follows undo and redo', async ({ editor, page }) => {
  await threeShapes(editor);
  const rows = page.locator('[data-testid="anno-row"]');
  await expect(rows).toHaveCount(3);

  await page.click('#btnUndo');
  await expect(rows).toHaveCount(2);

  await page.click('#btnRedo');
  await expect(rows).toHaveCount(3);
});

test('the first row\'s rings are never cropped by the scroll box', async ({ editor, page }) => {
  await threeShapes(editor);

  // The selection ring and the focus ring draw up to 4px outside a row. Both
  // lists scroll, and a scroll box crops anything outside its padding edge, so
  // the first row must sit at least that far inside on the top and both sides.
  for (const [openBtn, listSel] of [
    ['#btnAnnos', '#annoList'],
    ['#btnHistory', '#historyList'],
  ] as const) {
    if (!(await page.locator(listSel).isVisible())) await page.click(openBtn);
    const gap = await page.evaluate((sel) => {
      const list = document.querySelector(sel)!;
      const row = list.querySelector('li')!;
      const a = list.getBoundingClientRect();
      const b = row.getBoundingClientRect();
      return { top: b.top - a.top, left: b.left - a.left, right: a.right - b.right };
    }, listSel);
    expect(gap.top, `${listSel} top`).toBeGreaterThanOrEqual(4);
    expect(gap.left, `${listSel} left`).toBeGreaterThanOrEqual(4);
    expect(gap.right, `${listSel} right`).toBeGreaterThanOrEqual(4);
  }
});
