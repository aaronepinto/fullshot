/** Item 7: multi-select, marquee and z-order. */
import { expect, test } from './fixtures';

/** Three filled rectangles, side by side, so their interiors are all selectable. */
async function threeShapes(editor: import('./fixtures').Editor) {
  await editor.tool('rect');
  await editor.page.check('#fillShape');
  await editor.drag([60, 60], [200, 200]);
  await editor.drag([300, 60], [440, 200]);
  await editor.drag([540, 60], [680, 200]);
  await editor.tool('select');
  await editor.page.keyboard.press('Escape');
}

test('Shift+click adds to the selection', async ({ editor }) => {
  await threeShapes(editor);

  await editor.click(130, 130);
  await editor.click(370, 130, { shift: true });
  expect((await editor.state()).selection).toEqual([0, 1]);

  // Shift on a selected one takes it back out again.
  await editor.click(370, 130, { shift: true });
  expect((await editor.state()).selection).toEqual([0]);
});

test('dragging one of a multi-selection moves them all', async ({ editor }) => {
  await threeShapes(editor);
  await editor.click(130, 130);
  await editor.click(370, 130, { shift: true });

  const before = await editor.annos();
  await editor.drag([130, 130], [190, 170]);

  const after = await editor.annos();
  expect(after[0]!.x! - before[0]!.x!).toBeCloseTo(60, 0);
  expect(after[1]!.x! - before[1]!.x!).toBeCloseTo(60, 0);
  expect(after[0]!.y! - before[0]!.y!).toBeCloseTo(40, 0);
  expect(after[1]!.y! - before[1]!.y!).toBeCloseTo(40, 0);
  expect(after[2]).toEqual(before[2]);
});

test('deleting a multi-selection is one undo entry', async ({ editor, page }) => {
  await threeShapes(editor);
  await editor.click(130, 130);
  await editor.click(370, 130, { shift: true });

  const before = await editor.state();
  await page.keyboard.press('Delete');

  const after = await editor.state();
  expect(after.annos).toHaveLength(1);
  expect(after.undoDepth).toBe(before.undoDepth + 1);

  await page.click('#btnUndo');
  expect(await editor.annos()).toHaveLength(3);
});

test('dragging empty canvas sweeps a marquee instead of panning', async ({ editor }) => {
  await threeShapes(editor);
  const panBefore = (await editor.state()).pan;

  await editor.drag([30, 30], [760, 260]);

  const after = await editor.state();
  expect(after.selection).toEqual([0, 1, 2]);
  expect(after.pan.x).toBeCloseTo(panBefore.x, 5);
  expect(after.pan.y).toBeCloseTo(panBefore.y, 5);
});

test('space-drag pans and leaves the selection alone', async ({ editor, page }) => {
  await threeShapes(editor);
  await editor.click(130, 130);
  // Zoomed in, so the image is larger than the viewport and panning has somewhere
  // to go: at fit zoom the clamp pins it.
  await editor.zoomAt(450, 350, 400);
  const before = await editor.state();

  await page.keyboard.down('Space');
  await editor.drag([450, 350], [420, 330]);
  await page.keyboard.up('Space');

  const after = await editor.state();
  expect(after.selection).toEqual(before.selection);
  expect(after.pan.x).not.toBeCloseTo(before.pan.x, 1);
});

test('z-order keys reach a buried annotation', async ({ editor, page }) => {
  await editor.tool('rect');
  await page.check('#fillShape');
  await editor.drag([100, 100], [600, 500]);
  await editor.drag([250, 250], [400, 380]);
  await editor.tool('select');

  await editor.click(320, 300);
  expect((await editor.state()).selection).toEqual([1]);

  await page.keyboard.press('BracketLeft');
  const state = await editor.state();
  expect(state.selection).toEqual([0]);
  // The small one is now painted first, so the big one is on top at that point.
  expect(state.annos[1]!.w).toBeCloseTo(500, 0);

  await editor.click(320, 300);
  expect((await editor.state()).selection).toEqual([1]);
});

test('Shift with a bracket sends the selection all the way', async ({ editor, page }) => {
  await threeShapes(editor);
  await editor.click(130, 130);
  expect((await editor.state()).selection).toEqual([0]);

  await page.keyboard.press('Shift+BracketRight');
  const state = await editor.state();
  expect(state.selection).toEqual([2]);
  expect(state.annos[2]!.x).toBeCloseTo(60, 0);

  await page.keyboard.press('Shift+BracketLeft');
  expect((await editor.state()).selection).toEqual([0]);
});

test('a style change spans the whole selection in one entry', async ({ editor, page }) => {
  await threeShapes(editor);
  await editor.click(130, 130);
  await editor.click(370, 130, { shift: true });

  const before = await editor.state();
  await page.click('.swatch[data-color="#3b82f6"]');

  const after = await editor.state();
  expect(after.annos[0]!.color).toBe('#3b82f6');
  expect(after.annos[1]!.color).toBe('#3b82f6');
  expect(after.annos[2]!.color).not.toBe('#3b82f6');
  expect(after.undoDepth).toBe(before.undoDepth + 1);
});
