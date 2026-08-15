/** Item 6: the keyboard model, and the guard that keeps it out of typed text. */
import { expect, test } from './fixtures';

/** Draws a rectangle from (100,100) to (400,300) and leaves it selected. */
async function selectedRect(editor: import('./fixtures').Editor) {
  await editor.tool('rect');
  await editor.drag([100, 100], [400, 300]);
  await editor.tool('select');
  await editor.click(100, 200);
  expect((await editor.state()).selection).toEqual([0]);
}

test('an arrow key moves the selection by one image pixel', async ({ editor, page }) => {
  await selectedRect(editor);
  const before = (await editor.annos())[0]!.x!;

  await page.keyboard.press('ArrowRight');
  expect((await editor.annos())[0]!.x!).toBeCloseTo(before + 1, 5);
});

test('Shift makes the nudge coarse', async ({ editor, page }) => {
  await selectedRect(editor);
  const before = (await editor.annos())[0]!.x!;

  await page.keyboard.press('Shift+ArrowRight');
  expect((await editor.annos())[0]!.x!).toBeCloseTo(before + 10, 5);
});

test('Alt with an arrow resizes instead of moving', async ({ editor, page }) => {
  await selectedRect(editor);
  const before = (await editor.annos())[0]!;

  await page.keyboard.press('Alt+ArrowRight');
  const after = (await editor.annos())[0]!;
  expect(after.w!).toBeCloseTo(before.w! + 1, 5);
  expect(after.x!).toBeCloseTo(before.x!, 5);
  expect(after.h!).toBeCloseTo(before.h!, 5);
});

test('a burst of nudges is a single undo entry', async ({ editor, page }) => {
  await selectedRect(editor);
  const start = await editor.state();
  const x0 = start.annos[0]!.x!;

  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');

  const moved = await editor.state();
  expect(moved.annos[0]!.x!).toBeCloseTo(x0 + 10, 5);
  expect(moved.undoDepth).toBe(start.undoDepth + 1);

  await page.click('#btnUndo');
  expect((await editor.annos())[0]!.x!).toBeCloseTo(x0, 5);
});

test('Delete removes the selection and undo restores its geometry', async ({ editor, page }) => {
  await selectedRect(editor);
  const before = (await editor.annos())[0]!;

  await page.keyboard.press('Delete');
  expect(await editor.annos()).toEqual([]);

  await page.click('#btnUndo');
  expect((await editor.annos())[0]).toEqual(before);
});

test('Tab cycles the selection in z-order and wraps', async ({ editor, page }) => {
  await editor.tool('rect');
  await editor.drag([60, 60], [200, 160]);
  await editor.drag([300, 60], [440, 160]);
  await editor.drag([560, 60], [700, 160]);
  await editor.tool('select');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Tab');
  expect((await editor.state()).selection).toEqual([0]);
  await page.keyboard.press('Tab');
  expect((await editor.state()).selection).toEqual([1]);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect((await editor.state()).selection).toEqual([0]);

  await page.keyboard.press('Shift+Tab');
  expect((await editor.state()).selection).toEqual([2]);
});

test('Cmd+D duplicates the selection and selects the copy', async ({ editor, page }) => {
  await selectedRect(editor);
  const before = (await editor.annos())[0]!;

  await page.keyboard.press('ControlOrMeta+d');

  const state = await editor.state();
  expect(state.annos).toHaveLength(2);
  expect(state.selection).toEqual([1]);
  expect(state.annos[1]!.x!).toBeCloseTo(before.x! + 16, 5);
  expect(state.annos[1]!.y!).toBeCloseTo(before.y! + 16, 5);
  expect(state.annos[1]!.w!).toBeCloseTo(before.w!, 5);
});

test('the document handler keeps out of typed text', async ({ editor, page }) => {
  await editor.tool('text');
  await editor.click(200, 200);
  await page.keyboard.type('rvb');

  const state = await editor.state();
  expect(state.tool).toBe('text');
  expect(state.editing?.draft).toBe('rvb');
});

test('undo while typing does not reach the editor history', async ({ editor, page }) => {
  await editor.writeText(120, 120, 'kept');
  await editor.tool('text');
  await editor.click(400, 300);
  await page.keyboard.type('typing');

  const before = await editor.state();
  await page.keyboard.press('ControlOrMeta+z');

  const after = await editor.state();
  expect(after.undoDepth).toBe(before.undoDepth);
  expect(after.annos).toHaveLength(1);
  expect(after.editing).not.toBeNull();
});

test('a tool hotkey switches tools and says so', async ({ editor, page }) => {
  await page.keyboard.press('r');
  expect((await editor.state()).tool).toBe('rect');
  await expect(page.locator('[data-tool="rect"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute('aria-pressed', 'false');
});
