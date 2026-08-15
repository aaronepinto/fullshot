/**
 * Item 3: every path to the zoom actually zooms.
 *
 * The buttons always worked, but the wheel did not: the handler read `deltaY` as
 * pixels whatever unit the event carried. Chrome on macOS and every trackpad send
 * DOM_DELTA_PIXEL, so it looked fine here, while Firefox and most Windows and Linux
 * mice send DOM_DELTA_LINE, where a notch is three rather than a hundred. That put
 * the zoom step at well under one percent per notch, which is indistinguishable
 * from nothing happening at all.
 */
import { expect, test } from './fixtures';

const zoomOf = (editor: import('./fixtures').Editor) => editor.state().then((s) => s.zoom);

test.describe('status bar controls', () => {
  test('plus and minus step the zoom, and the readout follows', async ({ editor, page }) => {
    await page.click('#zoom100');
    expect(await zoomOf(editor)).toBeCloseTo(1, 3);
    await expect(page.locator('[data-testid="stat-zoom"]')).toHaveText('100%');

    await page.click('#zoomIn');
    expect(await zoomOf(editor)).toBeCloseTo(1.25, 3);
    await expect(page.locator('[data-testid="stat-zoom"]')).toHaveText('125%');

    await page.click('#zoomOut');
    await page.click('#zoomOut');
    expect(await zoomOf(editor)).toBeCloseTo(0.8, 3);
    await expect(page.locator('[data-testid="stat-zoom"]')).toHaveText('80%');
  });

  test('Fit sizes the artwork to the viewport, and 100% returns to actual size', async ({ editor, page }) => {
    await page.click('#zoomFit');
    const fitted = await zoomOf(editor);
    expect(fitted).not.toBeCloseTo(1, 2);
    // Fit means the whole width lands inside the viewport with a little room.
    const left = await editor.at(0, 0);
    const right = await editor.at(editor.width, 0);
    expect(right.x - left.x).toBeLessThanOrEqual(1440);
    expect(right.x - left.x).toBeGreaterThan(1000);

    await page.click('#zoom100');
    expect(await zoomOf(editor)).toBeCloseTo(1, 3);
  });
});

test.describe('wheel and pinch', () => {
  test('ctrl and wheel zooms in and out, in pixel units', async ({ editor, page }) => {
    await page.click('#zoom100');
    await editor.wheel(450, 350, -120, { ctrlKey: true });
    const inward = await zoomOf(editor);
    expect(inward).toBeGreaterThan(1.1);

    await editor.wheel(450, 350, 120, { ctrlKey: true });
    expect(await zoomOf(editor)).toBeLessThan(inward);
  });

  test('a trackpad pinch, which arrives as a ctrlKey wheel, zooms too', async ({ editor, page }) => {
    await page.click('#zoom100');
    // Pinches come in as a stream of small pixel deltas rather than one notch.
    for (let i = 0; i < 12; i++) await editor.wheel(450, 350, -8, { ctrlKey: true });
    expect(await zoomOf(editor)).toBeGreaterThan(1.15);
  });

  test('a line-unit wheel zooms as much as a pixel-unit one', async ({ editor, page }) => {
    await page.click('#zoom100');
    await editor.wheel(450, 350, -100, { ctrlKey: true });
    const byPixels = await zoomOf(editor);

    await page.click('#zoom100');
    // The same notch as Firefox and most Windows mice report it.
    await editor.wheel(450, 350, -100 / 16, { ctrlKey: true, deltaMode: 1 });
    const byLines = await zoomOf(editor);

    expect(byLines).toBeGreaterThan(1.1);
    expect(byLines).toBeCloseTo(byPixels, 2);
  });

  test('a page-unit wheel is not mistaken for a single pixel', async ({ editor, page }) => {
    await page.click('#zoom100');
    await editor.wheel(450, 350, -1, { ctrlKey: true, deltaMode: 2 });
    expect(await zoomOf(editor)).toBeGreaterThan(1.5);
  });

  test('the point under the pointer stays under the pointer', async ({ editor, page }) => {
    // Zoomed in far enough that the artwork overflows the viewport. While the whole
    // image fits on screen the clamp holds it there instead, which is its job: there
    // is no empty margin to scroll the anchor point into.
    await editor.setZoom(300);
    const started = await zoomOf(editor);
    expect(started * editor.width).toBeGreaterThan(1440);

    const box = (await page.locator('#viewport').boundingBox())!;
    const cx = box.x + box.width * 0.35;
    const cy = box.y + box.height * 0.6;
    const before = await editor.imageAt(cx, cy);

    await page.mouse.move(cx, cy);
    await page.keyboard.down('ControlOrMeta');
    await page.mouse.wheel(0, -80);
    await page.keyboard.up('ControlOrMeta');
    await page.waitForFunction(
      (z) =>
        (window as unknown as { __screencappyTest: { getState(): { zoom: number } } }).__screencappyTest.getState()
          .zoom > z,
      started * 1.05
    );

    const after = await editor.imageAt(cx, cy);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  test('ctrl and wheel over the toolbar zooms the artwork rather than the page', async ({ editor, page }) => {
    await page.click('#zoom100');
    const box = (await page.locator('.topbar').boundingBox())!;
    const handled = await page.evaluate((b) => {
      const e = new WheelEvent('wheel', {
        deltaY: -120,
        ctrlKey: true,
        clientX: b.x + b.width / 2,
        clientY: b.y + b.height / 2,
        bubbles: true,
        cancelable: true,
      });
      document.querySelector('.topbar')!.dispatchEvent(e);
      // Claimed by the editor, so the browser will not zoom its own page.
      return e.defaultPrevented;
    }, box);
    expect(handled).toBe(true);
    expect(await zoomOf(editor)).toBeGreaterThan(1.1);
  });

  test('a plain wheel over a drawer scrolls the drawer instead of panning', async ({ editor, page }) => {
    await page.click('#btnAnnos');
    const box = (await page.locator('#annoList').boundingBox())!;
    const prevented = await page.evaluate((b) => {
      const e = new WheelEvent('wheel', {
        deltaY: 120,
        clientX: b.x + b.width / 2,
        clientY: b.y + 20,
        bubbles: true,
        cancelable: true,
      });
      document.querySelector('#annoList')!.dispatchEvent(e);
      return e.defaultPrevented;
    }, box);
    expect(prevented).toBe(false);
  });
});

test.describe('keyboard', () => {
  test('the zoom keys work and are taken from the browser', async ({ editor, page }) => {
    await page.click('#zoom100');
    await page.locator('#canvas').click({ position: { x: 5, y: 5 } });

    await page.keyboard.press('ControlOrMeta+Equal');
    expect(await zoomOf(editor)).toBeCloseTo(1.25, 3);

    await page.keyboard.press('ControlOrMeta+Minus');
    expect(await zoomOf(editor)).toBeCloseTo(1, 3);

    await page.keyboard.press('ControlOrMeta+Equal');
    await page.keyboard.press('ControlOrMeta+Digit0');
    expect(await zoomOf(editor)).toBeCloseTo(1, 3);

    await page.keyboard.press('ControlOrMeta+Digit9');
    expect(await zoomOf(editor)).not.toBeCloseTo(1, 2);
  });

  test('the zoom keys do not leak into a text label being typed', async ({ editor, page }) => {
    await page.click('#zoom100');
    await editor.tool('text');
    await editor.click(200, 200);
    await page.keyboard.type('a-b');
    await page.keyboard.press('Enter');
    expect((await editor.annos())[0]!.text).toBe('a-b');
    expect(await zoomOf(editor)).toBeCloseTo(1, 3);
  });
});
