/**
 * Items 1 to 3: the text editor state machine, style capture, and re-edit.
 *
 * The headline case is "alternating clicks": placing a second label while the
 * first is still being typed used to destroy the first draft and swallow the
 * second editor, so the tool worked on every other click.
 */
import { expect, test } from './fixtures';

/** Screen-space offset between the overlay's box and its image-space anchor. */
async function anchorDelta(editor: import('./fixtures').Editor, x: number, y: number) {
  const box = await editor.textEditor.boundingBox();
  const at = await editor.at(x, y);
  if (!box) throw new Error('the text editor overlay has no box');
  return { dx: box.x - at.x, dy: box.y - at.y };
}

test.describe('Item 1: text editor state machine', () => {
  test('placing a second label keeps the first', async ({ editor, page }) => {
    await editor.tool('text');
    await editor.click(100, 100);
    await page.keyboard.type('first');
    await editor.click(400, 300);
    await page.keyboard.type('second');
    await page.keyboard.press('Escape');

    const annos = await editor.annos();
    const texts = annos.filter((a) => a.kind === 'text');
    expect(texts).toHaveLength(1);
    expect(texts[0]?.text).toBe('first');
    expect(texts[0]?.x).toBeCloseTo(100, 0);
    expect(texts[0]?.y).toBeCloseTo(100, 0);
  });

  test('ten labels in a row all survive, with no alternation', async ({ editor, page }) => {
    await editor.tool('text');
    for (let i = 0; i < 10; i++) {
      // Far enough apart that a click never lands inside the previous textarea.
      await editor.click(60 + Math.floor(i / 5) * 460, 60 + (i % 5) * 130);
      await page.keyboard.type(`label${i}`);
    }
    await page.keyboard.press('Enter');

    const annos = await editor.annos();
    expect(annos).toHaveLength(10);
    expect(annos.map((a) => a.text)).toEqual(
      Array.from({ length: 10 }, (_, i) => `label${i}`)
    );
  });

  test('the second click leaves a visible, focused editor', async ({ editor, page }) => {
    await editor.tool('text');
    await editor.click(120, 120);
    await page.keyboard.type('first');
    await editor.click(420, 320);

    await expect(editor.textEditor).toBeVisible();
    expect(await editor.activeTestId()).toBe('text-input');
  });

  test('Escape discards the draft without touching history', async ({ editor, page }) => {
    await editor.tool('text');
    await editor.click(150, 150);
    await page.keyboard.type('hello');
    await page.keyboard.press('Escape');

    const state = await editor.state();
    expect(state.annos).toEqual([]);
    expect(state.undoDepth).toBe(0);
    await expect(editor.textEditor).toBeHidden();
  });

  test('clicking away with the select tool commits the draft', async ({ editor, page }) => {
    await editor.tool('text');
    await editor.click(150, 150);
    await page.keyboard.type('hello');
    await editor.tool('select');
    await editor.click(700, 600);

    const annos = await editor.annos();
    expect(annos).toHaveLength(1);
    expect(annos[0]?.text).toBe('hello');
  });

  test('Enter commits and closes the editor', async ({ editor, page }) => {
    await editor.tool('text');
    await editor.click(150, 150);
    await page.keyboard.type('hello');
    await page.keyboard.press('Enter');

    await expect(editor.textEditor).toBeHidden();
    expect((await editor.annos())[0]?.text).toBe('hello');
  });

  test('Shift+Enter inserts a newline instead of committing', async ({ editor, page }) => {
    await editor.tool('text');
    await editor.click(150, 150);
    await page.keyboard.type('a');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('b');
    await page.keyboard.press('Enter');

    const annos = await editor.annos();
    expect(annos).toHaveLength(1);
    expect(annos[0]?.text).toBe('a\nb');
  });

  test('an empty draft is reported rather than silently dropped', async ({ editor, page }) => {
    await editor.tool('text');
    await editor.click(150, 150);
    await page.keyboard.type('   ');
    await page.keyboard.press('Enter');

    expect(await editor.annos()).toEqual([]);
    await expect(editor.toast).toBeVisible();
    expect((await editor.toast.textContent())?.trim().length).toBeGreaterThan(0);
  });

  test('the overlay tracks its anchor through zoom, and commits there', async ({ editor, page }) => {
    await editor.tool('text');
    await editor.click(200, 200);
    await page.keyboard.type('zoomed');

    const start = await anchorDelta(editor, 200, 200);
    for (let i = 0; i < 2; i++) {
      await page.click('#zoomIn');
      const now = await anchorDelta(editor, 200, 200);
      expect(Math.abs(now.dx - start.dx)).toBeLessThanOrEqual(2);
      expect(Math.abs(now.dy - start.dy)).toBeLessThanOrEqual(2);
    }

    await page.keyboard.press('Enter');
    const annos = await editor.annos();
    expect(annos[0]?.text).toBe('zoomed');
    expect(Math.abs((annos[0]?.x ?? 0) - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs((annos[0]?.y ?? 0) - 200)).toBeLessThanOrEqual(1);
  });

  test('the overlay tracks its anchor through a wheel pan', async ({ editor, page }) => {
    await editor.tool('text');
    await editor.click(200, 200);
    await page.keyboard.type('panned');

    const start = await anchorDelta(editor, 200, 200);
    const over = await editor.at(200, 200);
    await page.mouse.move(over.x + 10, over.y + 10);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(100);

    const now = await anchorDelta(editor, 200, 200);
    expect(Math.abs(now.dx - start.dx)).toBeLessThanOrEqual(2);
    expect(Math.abs(now.dy - start.dy)).toBeLessThanOrEqual(2);

    await page.keyboard.press('Enter');
    const annos = await editor.annos();
    expect(annos[0]?.text).toBe('panned');
    expect(Math.abs((annos[0]?.x ?? 0) - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs((annos[0]?.y ?? 0) - 200)).toBeLessThanOrEqual(1);
  });
});

test.describe('Item 2: style capture and toolbar focus safety', () => {
  test('changing the size mid-entry commits at the new size', async ({ editor, page }) => {
    await editor.tool('text');
    await editor.click(200, 200);
    await page.keyboard.type('sized');
    await page.selectOption('#fontSize', '56');
    await page.keyboard.press('Enter');

    const annos = await editor.annos();
    expect(annos).toHaveLength(1);
    expect(annos[0]?.size).toBe(56);
  });

  test('changing the colour mid-entry commits once, in the new colour', async ({ editor, page }) => {
    await editor.tool('text');
    await editor.click(200, 200);
    await page.keyboard.type('coloured');
    await page.click('.swatch[data-color="#22c55e"]');
    await page.keyboard.press('Enter');

    const state = await editor.state();
    expect(state.annos).toHaveLength(1);
    expect(state.annos[0]?.color).toBe('#22c55e');
    expect(state.undoDepth).toBe(1);
  });

  test('style controls never take focus from the open editor', async ({ editor, page }) => {
    await editor.tool('text');
    await editor.click(200, 200);
    await page.keyboard.type('focus');

    await page.click('.swatch[data-color="#3b82f6"]');
    expect(await editor.activeTestId()).toBe('text-input');
    await page.selectOption('#fontSize', '24');
    expect(await editor.activeTestId()).toBe('text-input');
    await page.click('#zoomIn');
    expect(await editor.activeTestId()).toBe('text-input');
    expect((await editor.state()).editing?.draft).toBe('focus');
  });

  test('switching tools commits the open editor', async ({ editor, page }) => {
    await editor.tool('text');
    await editor.click(200, 200);
    await page.keyboard.type('committed');
    await editor.tool('rect');

    const state = await editor.state();
    expect(state.annos).toHaveLength(1);
    expect(state.annos[0]?.text).toBe('committed');
    expect(state.tool).toBe('rect');
    expect(state.editing).toBeNull();
  });

  test('the open editor owns the style bar, whatever is selected behind it', async ({
    editor,
    page,
  }) => {
    await editor.tool('rect');
    await editor.drag([100, 100], [300, 250]);
    expect((await editor.state()).selection).toEqual([0]);

    await editor.tool('text');
    await editor.click(500, 400);
    await page.keyboard.type('over a rect');

    await expect(page.locator('#ctlFont')).toBeVisible();
    await expect(page.locator('#ctlWidth')).toBeHidden();
    await page.selectOption('#fontSize', '56');
    await page.keyboard.press('Enter');

    const annos = await editor.annos();
    expect(annos[1]?.size).toBe(56);
    expect(annos[0]?.width).toBe(6);
  });

  test('the style bar reflects the selected annotation', async ({ editor, page }) => {
    await editor.tool('rect');
    await editor.drag([100, 100], [300, 250]);
    await page.keyboard.press('Escape');
    await page.selectOption('#strokeWidth', '16');
    await editor.drag([400, 100], [600, 250]);

    await editor.tool('select');
    await editor.click(100, 100);
    await expect(page.locator('#strokeWidth')).toHaveValue('6');
    await editor.click(400, 100);
    await expect(page.locator('#strokeWidth')).toHaveValue('16');
  });

  test('a style control applies to the selection in one undo entry', async ({ editor, page }) => {
    await editor.tool('rect');
    await editor.drag([100, 100], [300, 250]);
    await editor.tool('select');
    await editor.click(100, 100);

    const before = (await editor.state()).undoDepth;
    await page.selectOption('#strokeWidth', '10');

    const state = await editor.state();
    expect(state.annos[0]?.width).toBe(10);
    expect(state.undoDepth).toBe(before + 1);
  });
});

test.describe('Item 3: text re-edit', () => {
  test('double-click replaces the text in place', async ({ editor, page }) => {
    await editor.writeText(200, 200, 'before');
    await editor.tool('select');
    await editor.dblclick(210, 210);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('after');
    await page.keyboard.press('Enter');

    const annos = await editor.annos();
    expect(annos).toHaveLength(1);
    expect(annos[0]?.text).toBe('after');
    expect(annos[0]?.x).toBeCloseTo(200, 0);
    expect(annos[0]?.y).toBeCloseTo(200, 0);
  });

  test('a re-edit is one undo entry that restores the old text', async ({ editor, page }) => {
    await editor.writeText(200, 200, 'before');
    const afterCreate = (await editor.state()).undoDepth;

    await editor.tool('select');
    await editor.dblclick(210, 210);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('after');
    await page.keyboard.press('Enter');
    expect((await editor.state()).undoDepth).toBe(afterCreate + 1);

    await page.click('#btnUndo');
    const annos = await editor.annos();
    expect(annos).toHaveLength(1);
    expect(annos[0]?.text).toBe('before');
  });

  test('re-editing to the same string is not a change', async ({ editor, page }) => {
    await editor.writeText(200, 200, 'same');
    const before = (await editor.state()).undoDepth;

    await editor.tool('select');
    await editor.dblclick(210, 210);
    await page.keyboard.press('Enter');

    const state = await editor.state();
    expect(state.undoDepth).toBe(before);
    expect(state.annos[0]?.text).toBe('same');
  });

  test('emptying a label deletes it, and undo brings it back', async ({ editor, page }) => {
    await editor.writeText(200, 200, 'doomed');
    await editor.tool('select');
    await editor.dblclick(210, 210);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Enter');

    expect(await editor.annos()).toEqual([]);
    await page.click('#btnUndo');
    const annos = await editor.annos();
    expect(annos).toHaveLength(1);
    expect(annos[0]?.text).toBe('doomed');
  });

  test('the canvas stops painting the text being re-edited', async ({ editor, page }) => {
    await editor.tool('text');
    await page.selectOption('#fontSize', '84');
    await editor.click(200, 200);
    await page.keyboard.type('MMMM');
    await page.keyboard.press('Enter');

    // Polled: the canvas repaints on the next frame, not on the interaction.
    const box = { x: 200, y: 200, w: 240, h: 100 };
    await expect.poll(() => editor.paints(box, '#ef4444')).toBe(true);

    await editor.tool('select');
    await editor.dblclick(210, 230);
    expect((await editor.state()).editing?.mode).toBe('edit');
    await expect.poll(() => editor.paints(box, '#ef4444')).toBe(false);
  });

  test('Enter on a selected label opens it for editing', async ({ editor, page }) => {
    await editor.writeText(200, 200, 'selected');
    await editor.tool('select');
    await editor.click(210, 210);
    expect((await editor.state()).selection).toEqual([0]);

    await page.keyboard.press('Enter');
    const editing = (await editor.state()).editing;
    expect(editing?.mode).toBe('edit');
    expect(editing?.index).toBe(0);
    expect(editing?.draft).toBe('selected');
  });

  test('the text tool reopens an existing label rather than stacking a new one', async ({
    editor,
    page,
  }) => {
    await editor.writeText(200, 200, 'existing');
    await editor.click(210, 210);
    expect((await editor.state()).editing?.mode).toBe('edit');

    await page.keyboard.press('Escape');
    expect(await editor.annos()).toHaveLength(1);
  });
});

