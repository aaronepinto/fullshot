/**
 * Item 4: annotations turn as well as move and resize.
 *
 * A selected shape grows a lollipop handle above its top edge. Dragging it turns
 * the annotation about its own centre; Shift lands it on fifteen degree steps. The
 * angle has to survive everything the rest of the editor does to an annotation:
 * hit testing, undo, duplication, the panel, reload from storage, and export.
 */
import { expect, test } from './fixtures';

const DEG = Math.PI / 180;

/** A filled 300 x 200 rectangle at (200,200), left selected. */
async function selectedRect(editor: import('./fixtures').Editor) {
  await editor.tool('rect');
  await editor.page.check('#fillShape');
  await editor.drag([200, 200], [500, 400]);
  await editor.tool('select');
  await editor.click(350, 300);
  expect((await editor.state()).selection).toEqual([0]);
}

test.describe('the rotation handle', () => {
  test('a selected shape grows one, above its top edge', async ({ editor }) => {
    await selectedRect(editor);
    const hs = await editor.handles(0);
    const knob = hs.find((h) => h.id === 'rot')!;
    const n = hs.find((h) => h.id === 'n')!;
    expect(knob).toBeTruthy();
    expect(knob.x).toBeCloseTo(n.x, 0);
    expect(knob.y).toBeLessThan(n.y);
  });

  test('a line and a pen stroke get none, since their ends carry the angle', async ({ editor }) => {
    await editor.tool('line');
    await editor.drag([100, 100], [400, 300]);
    await editor.tool('select');
    await editor.click(250, 200);
    expect((await editor.handles(0)).map((h) => h.id)).toEqual(['p1', 'p2']);

    await editor.tool('pen');
    await editor.drag([500, 100], [700, 300]);
    await editor.tool('select');
    expect(await editor.handles(1)).toEqual([]);
  });

  test('it reports a grab cursor rather than a resize one', async ({ editor, page }) => {
    await selectedRect(editor);
    const knob = (await editor.handles(0)).find((h) => h.id === 'rot')!;
    await editor.move(knob.x, knob.y);
    expect(await page.evaluate(() => document.querySelector('canvas')!.style.cursor)).toBe('grab');
  });

  test('the arm keeps its length on screen as the zoom changes', async ({ editor, page }) => {
    await selectedRect(editor);
    /** Screen distance from the top edge midpoint out to the knob. */
    const armAt = async () => {
      const hs = await editor.handles(0);
      const knob = hs.find((h) => h.id === 'rot')!;
      const n = hs.find((h) => h.id === 'n')!;
      const a = await editor.at(knob.x, knob.y);
      const b = await editor.at(n.x, n.y);
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    await page.click('#zoom100');
    const near = await armAt();
    expect(near).toBeGreaterThan(20);

    await page.click('#zoomIn');
    await page.click('#zoomIn');
    // The knob sits closer to the shape in image px, so it lands in the same place
    // on screen rather than drifting away from the shape as the zoom climbs.
    expect(await armAt()).toBeCloseTo(near, 0);
  });
});

test.describe('the rotation gesture', () => {
  test('dragging the handle turns the shape about its own centre', async ({ editor }) => {
    await selectedRect(editor);
    const before = (await editor.center(0))!;

    await editor.rotateTo(0, 40);

    const a = (await editor.annos())[0]!;
    expect(a.rotation! / DEG).toBeGreaterThan(30);
    expect(a.rotation! / DEG).toBeLessThan(50);
    const after = (await editor.center(0))!;
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
    // Turning is not resizing: the shape's own box is untouched.
    expect(a.w).toBeCloseTo(300, 0);
    expect(a.h).toBeCloseTo(200, 0);
  });

  test('Shift lands it on the nearest fifteen degree step', async ({ editor }) => {
    await selectedRect(editor);
    await editor.rotateTo(0, 41, { shift: true });
    const deg = (await editor.annos())[0]!.rotation! / DEG;
    expect(Math.abs(deg - 45)).toBeLessThan(0.01);
  });

  test('it is one undo entry, and undo puts the shape back upright', async ({ editor, page }) => {
    await selectedRect(editor);
    const before = (await editor.state()).undoDepth;

    await editor.rotateTo(0, 35);
    expect((await editor.state()).undoDepth).toBe(before + 1);

    await page.click('#btnUndo');
    expect((await editor.annos())[0]!.rotation ?? 0).toBeCloseTo(0, 6);

    await page.click('#btnRedo');
    expect((await editor.annos())[0]!.rotation! / DEG).toBeGreaterThan(25);
  });

  test('a press on the handle that never travels leaves history alone', async ({ editor }) => {
    await selectedRect(editor);
    const before = (await editor.state()).undoDepth;
    const knob = (await editor.handles(0)).find((h) => h.id === 'rot')!;
    await editor.click(knob.x, knob.y);
    expect((await editor.state()).undoDepth).toBe(before);
    expect((await editor.annos())[0]!.rotation ?? 0).toBe(0);
  });

  test('Escape mid-gesture abandons the turn', async ({ editor, page }) => {
    await selectedRect(editor);
    const knob = (await editor.handles(0)).find((h) => h.id === 'rot')!;
    const c = (await editor.center(0))!;
    const start = await editor.at(knob.x, knob.y);
    const end = await editor.at(c.x + 200, c.y);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.keyboard.press('Escape');
    await page.mouse.up();

    expect((await editor.annos())[0]!.rotation ?? 0).toBeCloseTo(0, 6);
  });

  test('text and emoji turn too', async ({ editor }) => {
    await editor.writeText(200, 250, 'turn me');
    await editor.tool('select');
    await editor.page.keyboard.press('Escape');
    const b = (await editor.localBounds(0))!;
    await editor.click(b.x + b.w / 2, b.y + b.h / 2);
    await editor.rotateTo(0, 30);
    expect((await editor.annos())[0]!.rotation! / DEG).toBeGreaterThan(20);

    await editor.tool('emoji');
    await editor.click(600, 400);
    await editor.tool('select');
    await editor.rotateTo(1, -30);
    expect((await editor.annos())[1]!.rotation! / DEG).toBeLessThan(-20);
  });
});

test.describe('a turned shape behaves like any other', () => {
  test('hit testing follows it round', async ({ editor }) => {
    await selectedRect(editor);
    // Off the short end of the upright rectangle, well inside it.
    expect(await editor.state().then((s) => s.selection)).toEqual([0]);
    await editor.rotateTo(0, 90);
    await editor.page.keyboard.press('Escape');

    // Turned a quarter, that same spot is now outside the shape.
    await editor.click(480, 300);
    expect((await editor.state()).selection).toEqual([]);
    // And a spot off the long side is now inside it.
    await editor.click(350, 420);
    expect((await editor.state()).selection).toEqual([0]);
  });

  test('it still drags from its middle without losing the angle', async ({ editor }) => {
    await selectedRect(editor);
    await editor.rotateTo(0, 45);
    const rot = (await editor.annos())[0]!.rotation!;
    const c = (await editor.center(0))!;

    await editor.drag([c.x, c.y], [c.x + 90, c.y + 60]);

    const a = (await editor.annos())[0]!;
    expect(a.rotation).toBeCloseTo(rot, 6);
    const moved = (await editor.center(0))!;
    expect(moved.x).toBeCloseTo(c.x + 90, 0);
    expect(moved.y).toBeCloseTo(c.y + 60, 0);
  });

  test('resizing it keeps the angle and the anchored corner', async ({ editor }) => {
    await selectedRect(editor);
    await editor.rotateTo(0, 30);
    const rot = (await editor.annos())[0]!.rotation!;
    const nwBefore = (await editor.handles(0)).find((h) => h.id === 'nw')!;
    const se = (await editor.handles(0)).find((h) => h.id === 'se')!;

    await editor.dragBy([se.x, se.y], 60, 40);

    const a = (await editor.annos())[0]!;
    expect(a.rotation).toBeCloseTo(rot, 3);
    expect(a.w!).toBeGreaterThan(300);
    const nwAfter = (await editor.handles(0)).find((h) => h.id === 'nw')!;
    expect(nwAfter.x).toBeCloseTo(nwBefore.x, 0);
    expect(nwAfter.y).toBeCloseTo(nwBefore.y, 0);
  });

  test('duplicating it carries the angle across', async ({ editor, page }) => {
    await selectedRect(editor);
    await editor.rotateTo(0, 50);
    const rot = (await editor.annos())[0]!.rotation!;
    await page.keyboard.press('ControlOrMeta+d');
    const annos = await editor.annos();
    expect(annos).toHaveLength(2);
    expect(annos[1]!.rotation).toBeCloseTo(rot, 6);
  });

  test('the panel reports the shape s own size, not the box it now occupies', async ({ editor, page }) => {
    await selectedRect(editor);
    await editor.rotateTo(0, 45);
    await page.click('#btnAnnos');
    await expect(page.locator('[data-testid="anno-row"]').first()).toContainText('300 × 200');
  });

  test('it survives a reload, so the angle really is stored', async ({ editor, page }) => {
    await selectedRect(editor);
    await editor.rotateTo(0, 60);
    const rot = (await editor.annos())[0]!.rotation!;
    // The write to storage is debounced, so let it land before navigating away.
    await page.waitForTimeout(700);

    await page.reload();
    await expect(page.locator('#loading')).toBeHidden();
    expect((await editor.annos())[0]!.rotation).toBeCloseTo(rot, 6);
  });

  test('export bakes the angle into the pixels', async ({ editor, page }) => {
    await editor.tool('rect');
    await page.check('#fillShape');
    await editor.drag([300, 100], [500, 160]);
    await editor.tool('select');
    await editor.click(400, 130);

    const flat = await exportedColumn(page, 400);
    await editor.rotateTo(0, 90);
    const turned = await exportedColumn(page, 400);

    // The bar is 200 wide and 60 tall, so a quarter turn trades those over.
    expect(flat).toBeGreaterThan(50);
    expect(flat).toBeLessThan(90);
    expect(turned).toBeGreaterThan(180);
    expect(turned).toBeLessThan(230);
  });
});

/**
 * How tall the painted run is in one column of the downloaded PNG. This decodes what
 * the export pipeline actually produced, so a rotation that only ever reached the
 * screen would leave the column exactly as it was and fail here.
 */
async function exportedColumn(page: import('@playwright/test').Page, x: number): Promise<number> {
  await page.evaluate(() => ((window as unknown as { __downloads: unknown[] }).__downloads.length = 0));
  await page.click('#btnDownload');
  await page.waitForFunction(() => (window as unknown as { __downloads: unknown[] }).__downloads.length > 0);
  return page.evaluate(async (col) => {
    const [saved] = (window as unknown as { __downloads: { url: string }[] }).__downloads;
    const bmp = await createImageBitmap(await (await fetch(saved!.url)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(col, 0, 1, bmp.height).data;
    // The fixture is white apart from two landmarks, neither in this column, so
    // anything off-white here is the annotation. A translucent fill counts as much
    // as the stroke around it, which a colour match would have missed.
    let first = -1;
    let last = -1;
    for (let i = 0; i < d.length; i += 4) {
      const painted = d[i]! < 240 || d[i + 1]! < 240 || d[i + 2]! < 240;
      if (!painted) continue;
      if (first < 0) first = i / 4;
      last = i / 4;
    }
    return first < 0 ? 0 : last - first + 1;
  }, x);
}
