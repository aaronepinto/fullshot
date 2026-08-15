/** Item 8: interrupted gestures, and saying so when a gesture produced nothing. */
import { expect, test } from './fixtures';

/** One filled rectangle, selected, so its interior can be grabbed. */
async function selectedRect(editor: import('./fixtures').Editor) {
  await editor.tool('rect');
  await editor.page.check('#fillShape');
  await editor.drag([100, 100], [400, 300]);
  await editor.tool('select');
  await editor.click(250, 200);
  expect((await editor.state()).selection).toEqual([0]);
}

test('Escape mid-draw abandons the shape', async ({ editor, page }) => {
  await editor.tool('rect');
  const a = await editor.at(100, 100);
  const b = await editor.at(400, 300);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();

  const state = await editor.state();
  expect(state.annos).toEqual([]);
  expect(state.undoDepth).toBe(0);
});

test('Escape mid-move puts the annotation back', async ({ editor, page }) => {
  await selectedRect(editor);
  const before = await editor.state();

  const from = await editor.at(250, 200);
  const to = await editor.at(500, 450);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();

  const after = await editor.state();
  expect(after.annos[0]).toEqual(before.annos[0]);
  expect(after.undoDepth).toBe(before.undoDepth);
});

test('a cancelled pointer leaves no stuck gesture behind', async ({ editor, page }) => {
  await selectedRect(editor);
  const before = await editor.state();

  const from = await editor.at(250, 200);
  const to = await editor.at(500, 450);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.dispatchEvent('#canvas', 'pointercancel');
  await page.mouse.up();

  const after = await editor.state();
  expect(after.annos[0]).toEqual(before.annos[0]);
  expect(after.undoDepth).toBe(before.undoDepth);

  // The next gesture starts fresh rather than continuing the cancelled one.
  await editor.drag([250, 200], [300, 240]);
  const moved = await editor.state();
  expect(moved.annos[0]!.x!).toBeCloseTo(before.annos[0]!.x! + 50, 0);
  expect(moved.annos[0]!.y!).toBeCloseTo(before.annos[0]!.y! + 40, 0);
});

test('a drag too small to draw says so', async ({ editor }) => {
  await editor.tool('rect');
  await editor.drag([200, 200], [202, 201]);

  expect(await editor.annos()).toEqual([]);
  await expect(editor.toast).toBeVisible();
  expect((await editor.toast.textContent())?.trim().length).toBeGreaterThan(0);
});

test('Escape dismisses one thing at a time', async ({ editor, page }) => {
  await editor.writeText(200, 200, 'kept');
  await editor.tool('text');
  await editor.click(500, 400);
  await page.keyboard.type('discarded');

  // First: the open editor closes without committing.
  await page.keyboard.press('Escape');
  let state = await editor.state();
  expect(state.editing).toBeNull();
  expect(state.annos).toHaveLength(1);

  // The label committed earlier is still selected; second Escape clears it.
  await editor.tool('select');
  await editor.click(210, 210);
  expect((await editor.state()).selection).toEqual([0]);
  await page.keyboard.press('Escape');
  expect((await editor.state()).selection).toEqual([]);

  // Third: nothing left to dismiss, and nothing else disturbed.
  await page.keyboard.press('Escape');
  state = await editor.state();
  expect(state.annos).toHaveLength(1);
  expect(state.selection).toEqual([]);
});

test('the selection survives undo and redo', async ({ editor, page }) => {
  await selectedRect(editor);
  await editor.drag([250, 200], [320, 260]);
  expect((await editor.state()).selection).toEqual([0]);

  await page.click('#btnUndo');
  expect((await editor.state()).selection).toEqual([0]);

  await page.click('#btnRedo');
  const after = await editor.state();
  expect(after.selection).toEqual([0]);
  expect(after.annos[0]!.x!).toBeCloseTo(170, 0);
});
