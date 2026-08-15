/**
 * Items 4 and 5: honest hit testing against real geometry, and a manipulation
 * model with eight handles, per-corner cursors and modifier-aware resizing.
 */
import { expect, test } from './fixtures';

test.describe('Item 4: shape-aware hit testing', () => {
  test('a large unfilled rectangle does not swallow its own interior', async ({ editor }) => {
    await editor.tool('rect');
    await editor.drag([100, 100], [600, 500]);
    await editor.tool('select');

    await editor.click(350, 300);
    expect((await editor.state()).selection).toEqual([]);
  });

  test('the edge of an unfilled rectangle is selectable', async ({ editor }) => {
    await editor.tool('rect');
    await editor.drag([100, 100], [600, 500]);
    await editor.tool('select');

    await editor.click(350, 100);
    expect((await editor.state()).selection).toEqual([0]);
  });

  test('filling a rectangle makes its interior selectable', async ({ editor, page }) => {
    await editor.tool('rect');
    await page.check('#fillShape');
    await editor.drag([100, 100], [600, 500]);
    await editor.tool('select');

    await editor.click(350, 300);
    expect((await editor.state()).selection).toEqual([0]);
  });

  test('a diagonal line does not claim its bounding box', async ({ editor }) => {
    await editor.tool('line');
    await editor.drag([100, 100], [500, 500]);
    await editor.tool('select');

    await editor.click(100, 500);
    expect((await editor.state()).selection).toEqual([]);
  });

  test('a point on the stroke of a diagonal line selects it', async ({ editor }) => {
    await editor.tool('line');
    await editor.drag([100, 100], [500, 500]);
    await editor.tool('select');

    await editor.click(300, 302);
    expect((await editor.state()).selection).toEqual([0]);
  });

  for (const percent of [25, 400]) {
    test(`hit testing holds at ${percent}% zoom`, async ({ editor }) => {
      await editor.tool('line');
      await editor.drag([100, 100], [500, 500]);
      await editor.tool('select');
      await editor.zoomAt(300, 300, percent);

      await editor.click(300, 300);
      expect((await editor.state()).selection).toEqual([0]);

      // 60 image px to the side of the stroke: a miss at every zoom, because the
      // tolerance is a screen constant rather than an image one.
      await editor.click(360, 300);
      expect((await editor.state()).selection).toEqual([]);
    });
  }

  test('text bounds are measured, not estimated', async ({ editor, page }) => {
    await editor.tool('text');
    await page.selectOption('#fontSize', '84');
    await editor.click(120, 200);
    await page.keyboard.type('WWWWWWWWWW');
    await page.keyboard.press('Enter');

    const box = await editor.bounds(0);
    const measured = await page.evaluate(() => {
      const c = new OffscreenCanvas(8, 8).getContext('2d')!;
      c.font = '600 84px -apple-system, "Segoe UI", system-ui, sans-serif';
      return c.measureText('WWWWWWWWWW').width;
    });
    expect(box).not.toBeNull();
    expect(Math.abs(box!.w - measured) / measured).toBeLessThan(0.05);

    // The old 0.62-per-character estimate was far narrower than ten Ws.
    expect(box!.w).toBeGreaterThan(10 * 84 * 0.62);

    await editor.tool('select');
    await editor.click(box!.x + box!.w - 6, box!.y + box!.h / 2);
    expect((await editor.state()).selection).toEqual([0]);

    await editor.click(box!.x + box!.w + 60, box!.y + box!.h / 2);
    expect((await editor.state()).selection).toEqual([]);
  });
});
