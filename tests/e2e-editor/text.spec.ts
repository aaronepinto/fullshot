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
