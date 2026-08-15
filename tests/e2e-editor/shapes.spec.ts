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

test.describe('Item 5: handles, cursors and resize modifiers', () => {
  /** Draws a rectangle from (100,100) to (500,400) and leaves it selected. */
  async function selectedRect(editor: import('./fixtures').Editor) {
    await editor.tool('rect');
    await editor.drag([100, 100], [500, 400]);
    await editor.tool('select');
    await editor.click(100, 250);
    expect((await editor.state()).selection).toEqual([0]);
  }

  test('a selected box exposes eight resize handles plus a rotation knob', async ({ editor }) => {
    await selectedRect(editor);
    const handles = await editor.handles(0);
    expect(handles.map((h) => h.id).sort()).toEqual([
      'e', 'n', 'ne', 'nw', 'rot', 's', 'se', 'sw', 'w',
    ]);

    const at = (id: string) => handles.find((h) => h.id === id)!;
    expect(at('nw').x).toBeCloseTo(100, 0);
    expect(at('nw').y).toBeCloseTo(100, 0);
    expect(at('se').x).toBeCloseTo(500, 0);
    expect(at('se').y).toBeCloseTo(400, 0);
    expect(at('n').x).toBeCloseTo(300, 0);
    expect(at('e').y).toBeCloseTo(250, 0);
    // The knob floats above the top edge midpoint, on the same vertical.
    expect(at('rot').x).toBeCloseTo(300, 0);
    expect(at('rot').y).toBeLessThan(at('n').y);
  });

  test('an edge handle resizes one axis only', async ({ editor }) => {
    await selectedRect(editor);
    await editor.dragBy([500, 250], 60, 0);

    const a = (await editor.annos())[0]!;
    expect(a.w).toBeGreaterThan(458);
    expect(a.w).toBeLessThan(462);
    expect(a.h).toBeCloseTo(300, 0);
  });

  test('Shift locks the aspect ratio while resizing', async ({ editor }) => {
    await selectedRect(editor);
    const before = 400 / 300;
    await editor.dragBy([500, 400], 120, 20, { shift: true });

    const a = (await editor.annos())[0]!;
    const after = a.w! / a.h!;
    expect(Math.abs(after - before) / before).toBeLessThan(0.02);
  });

  test('Alt resizes about the centre', async ({ editor }) => {
    await selectedRect(editor);
    await editor.dragBy([500, 400], 60, 45, { alt: true });

    const a = (await editor.annos())[0]!;
    expect(a.x! + a.w! / 2).toBeCloseTo(300, 0);
    expect(a.y! + a.h! / 2).toBeCloseTo(250, 0);
    expect(a.w!).toBeGreaterThan(400);
    expect(a.h!).toBeGreaterThan(300);
  });

  test('pressing a handle without moving leaves history alone', async ({ editor, page }) => {
    await selectedRect(editor);
    const before = (await editor.state()).undoDepth;

    const p = await editor.at(500, 400);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x, p.y);
    await page.mouse.up();

    expect((await editor.state()).undoDepth).toBe(before);
  });

  test('dragging a handle past the opposite corner stays normalised', async ({ editor, page }) => {
    await selectedRect(editor);
    const a = await editor.at(500, 400);
    const past = await editor.at(40, 40);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(past.x, past.y, { steps: 6 });
    // Back to the far side again: the handle must still name the corner it started as.
    const back = await editor.at(560, 460);
    await page.mouse.move(back.x, back.y, { steps: 6 });
    await page.mouse.up();

    const rect = (await editor.annos())[0]!;
    expect(rect.w).toBeGreaterThan(0);
    expect(rect.h).toBeGreaterThan(0);
    expect(rect.x).toBeCloseTo(100, 0);
    expect(rect.y).toBeCloseTo(100, 0);
  });

  test('a resize down to nothing is refused, with a reason', async ({ editor }) => {
    await selectedRect(editor);
    const before = (await editor.state()).undoDepth;
    await editor.drag([500, 400], [100, 100]);

    const a = (await editor.annos())[0]!;
    expect(a.w).toBeCloseTo(400, 0);
    expect(a.h).toBeCloseTo(300, 0);
    expect((await editor.state()).undoDepth).toBe(before);
    await expect(editor.toast).toBeVisible();
  });

  test('each handle reports its own cursor', async ({ editor, page }) => {
    await selectedRect(editor);
    const cursor = () => page.evaluate(() => document.querySelector('canvas')!.style.cursor);

    for (const [id, want] of [
      ['nw', 'nwse-resize'],
      ['ne', 'nesw-resize'],
      ['n', 'ns-resize'],
      ['e', 'ew-resize'],
    ] as [string, string][]) {
      const h = (await editor.handles(0)).find((x) => x.id === id)!;
      await editor.move(h.x, h.y);
      expect(await cursor()).toBe(want);
    }

    await editor.move(300, 250);
    expect(await cursor()).toBe('grab');
  });

  test('a text label resizes by scaling, opposite corner pinned', async ({ editor, page }) => {
    await editor.tool('text');
    await page.selectOption('#fontSize', '36');
    await editor.click(150, 200);
    await page.keyboard.type('scale me');
    await page.keyboard.press('Enter');

    await editor.tool('select');
    const box = (await editor.bounds(0))!;
    await editor.click(box.x + 4, box.y + box.h / 2);
    expect((await editor.state()).selection).toEqual([0]);

    const se = (await editor.handles(0)).find((h) => h.id === 'se')!;
    await editor.dragBy([se.x, se.y], 80, 60);

    const a = (await editor.annos())[0]!;
    expect(a.size!).toBeGreaterThan(36);
    // The north-west corner is the anchor, so it must not have moved.
    expect(a.x!).toBeCloseTo(box.x, 0);
    expect(a.y!).toBeCloseTo(box.y, 0);
  });

  test('an emoji stamp resizes from its handles', async ({ editor }) => {
    await editor.tool('emoji');
    await editor.click(300, 300);
    await editor.tool('select');
    const before = (await editor.annos())[0]!.size!;

    const se = (await editor.handles(0)).find((h) => h.id === 'se')!;
    await editor.dragBy([se.x, se.y], 40, 40);

    expect((await editor.annos())[0]!.size!).toBeGreaterThan(before);
  });
});
