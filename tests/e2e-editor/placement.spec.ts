/**
 * Item 2: the cursor and the preview say what the next click will do.
 *
 * The emoji tool used to claim a text caret, so clicking anywhere with it looked
 * like the start of typing that never happened. It stamps a glyph, so it gets a
 * crosshair and a live ghost of that glyph under the pointer instead, and the caret
 * is kept for the two places a caret really appears: the text tool, and an existing
 * label under the select tool, where it is the only hint the label can be reopened.
 */
import { expect, test } from './fixtures';

const cursor = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.querySelector('canvas')!.style.cursor);

const ghost = (editor: import('./fixtures').Editor) => editor.page.locator('[data-testid="tool-ghost"]');

test.describe('cursors', () => {
  test('the emoji tool never shows a text caret', async ({ editor, page }) => {
    await editor.tool('emoji');
    await editor.move(400, 300);
    expect(await cursor(page)).toBe('crosshair');
  });

  test('the text tool shows a caret over the artwork', async ({ editor, page }) => {
    await editor.tool('text');
    await editor.move(400, 300);
    expect(await cursor(page)).toBe('text');
  });

  test('neither placing tool invites a click off the artwork', async ({ editor, page }) => {
    for (const tool of ['text', 'emoji']) {
      await editor.tool(tool);
      await editor.move(-60, -60);
      expect(await cursor(page), tool).toBe('not-allowed');
    }
  });

  test('the select tool hints that a label is editable', async ({ editor, page }) => {
    await editor.writeText(200, 240, 'edit me');
    await editor.tool('select');
    await page.keyboard.press('Escape');

    const b = (await editor.localBounds(0))!;
    await editor.move(b.x + b.w / 2, b.y + b.h / 2);
    expect(await cursor(page)).toBe('text');
  });

  test('the select tool still offers to move a shape, and to sweep empty canvas', async ({ editor, page }) => {
    await editor.tool('rect');
    await editor.page.check('#fillShape');
    await editor.drag([100, 100], [300, 300]);
    await editor.tool('select');
    await page.keyboard.press('Escape');

    await editor.move(200, 200);
    expect(await cursor(page)).toBe('move');
    await editor.move(700, 600);
    expect(await cursor(page)).toBe('grab');
  });
});

test.describe('placement preview', () => {
  test('the emoji ghost follows the pointer and shows the chosen glyph', async ({ editor, page }) => {
    await editor.tool('emoji');
    await page.click('#emojiCurrent');
    await page.locator('#emojiPicker button', { hasText: '🔥' }).click();

    await editor.move(300, 300);
    await expect(ghost(editor)).toBeVisible();
    await expect(ghost(editor)).toHaveText('🔥');
    const first = (await ghost(editor).boundingBox())!;

    await editor.move(500, 420);
    const second = (await ghost(editor).boundingBox())!;
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  test('the ghost grows with the zoom, so it previews the real size', async ({ editor, page }) => {
    await editor.tool('emoji');
    await page.click('#zoom100');
    await editor.move(300, 300);
    const small = (await ghost(editor).boundingBox())!;

    await page.click('#zoomIn');
    await page.click('#zoomIn');
    await editor.move(300, 300);
    const large = (await ghost(editor).boundingBox())!;
    expect(large.height).toBeGreaterThan(small.height * 1.3);
  });

  test('the ghost is not a click target, so it never blocks the stamp', async ({ editor, page }) => {
    await editor.tool('emoji');
    await editor.move(300, 300);
    await expect(ghost(editor)).toBeVisible();
    await editor.click(300, 300);
    const annos = await editor.annos();
    expect(annos).toHaveLength(1);
    expect(annos[0]!.kind).toBe('emoji');
    expect(annos[0]!.x).toBeCloseTo(300, 0);
  });

  test('the text tool previews a caret at the size about to be typed', async ({ editor, page }) => {
    await editor.tool('text');
    await page.selectOption('#fontSize', '24');
    await editor.move(300, 300);
    const small = (await ghost(editor).boundingBox())!;

    await page.selectOption('#fontSize', '84');
    await editor.move(300, 300);
    const large = (await ghost(editor).boundingBox())!;
    expect(large.height).toBeGreaterThan(small.height * 2);
  });

  test('the preview clears when the tool changes and off the artwork', async ({ editor, page }) => {
    await editor.tool('emoji');
    await editor.move(300, 300);
    await expect(ghost(editor)).toBeVisible();

    await editor.move(-80, -80);
    await expect(ghost(editor)).toBeHidden();

    await editor.move(300, 300);
    await expect(ghost(editor)).toBeVisible();
    await editor.tool('rect');
    await expect(ghost(editor)).toBeHidden();
  });
});

test.describe('refusals', () => {
  test('a stamp aimed off the artwork is refused with a reason', async ({ editor }) => {
    await editor.tool('emoji');
    await editor.click(-80, -80);
    expect(await editor.annos()).toHaveLength(0);
    await expect(editor.toast).toBeVisible();
    await expect(editor.toast).toContainText('outside the image');
  });

  test('a label aimed off the artwork is refused too, and opens no editor', async ({ editor }) => {
    await editor.tool('text');
    await editor.click(-80, -80);
    await expect(editor.textEditor).toBeHidden();
    expect((await editor.state()).editing).toBeNull();
    await expect(editor.toast).toContainText('outside the image');
  });

  test('a crop narrows where a stamp may land', async ({ editor, page }) => {
    await editor.tool('crop');
    await editor.drag([100, 100], [400, 400]);
    await page.click('#cropApply');

    await editor.tool('emoji');
    // Just outside the right edge of the crop, and still on screen after the fit.
    await editor.move(420, 250);
    expect(await cursor(page)).toBe('not-allowed');
    await editor.click(420, 250);
    expect(await editor.annos()).toHaveLength(0);

    await editor.click(250, 250);
    expect(await editor.annos()).toHaveLength(1);
  });
});
