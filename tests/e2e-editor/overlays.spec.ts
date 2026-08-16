/**
 * The two in-page overlays: the region selector and the element picker.
 *
 * Both are content scripts that inject a closed shadow root into whatever page the
 * user is on, so nothing inside them can be located by a selector. They are driven
 * here the way the browser drives them, by mouse and key, and judged on the two
 * things that are observable from outside: the message they send back to the
 * background, and how they look mid-gesture.
 */
import { readFileSync } from 'node:fs';
import { type Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { shotPath, watchConsole } from './audit';

/** A plain page for the overlay to be injected over, with something to aim at. */
const HOST = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>host</title><style>
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: #f6f6f4; color: #16161a; }
  header { padding: 24px 32px; background: #fff; border-bottom: 1px solid #e3e3df; }
  main { padding: 32px; display: grid; gap: 20px; grid-template-columns: 1fr 1fr; }
  .card { background: #fff; border: 1px solid #e3e3df; border-radius: 12px; padding: 20px; min-height: 160px; }
</style></head>
<body>
  <header><h1>A page worth capturing</h1></header>
  <main>
    <div class="card" id="one"><h2>First card</h2><p>Something to pick.</p></div>
    <div class="card" id="two"><h2>Second card</h2><p>Something else to pick.</p></div>
  </main>
</body></html>`;

/** Loads one built content script over the host page, with the runtime stubbed. */
async function inject(page: Page, script: 'content-select' | 'content-element'): Promise<void> {
  await page.route('**/overlay-host.html', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: HOST })
  );
  await page.addInitScript(() => {
    (window as unknown as { __msgs: unknown[] }).__msgs = [];
    (window as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage: async (m: unknown) => {
          (window as unknown as { __msgs: unknown[] }).__msgs.push(m);
        },
      },
    };
  });
  await page.goto('/overlay-host.html');
  await page.addScriptTag({ content: readFileSync(`dist/${script}.js`, 'utf8') });
}

const messages = (page: Page): Promise<Record<string, unknown>[]> =>
  page.evaluate(() => (window as unknown as { __msgs: Record<string, unknown>[] }).__msgs);

test.describe('region select overlay', () => {
  test('drags out a rectangle and reports it in page coordinates', async ({ page }) => {
    const watch = watchConsole(page);
    await inject(page, 'content-select');
    await page.screenshot({ path: shotPath('overlay-01-region-hint') });

    await page.mouse.move(200, 180);
    await page.mouse.down();
    await page.mouse.move(560, 420, { steps: 8 });
    // Mid-gesture: the dimmed surround, the dashed box and the live size chip.
    await page.screenshot({ path: shotPath('overlay-02-region-dragging') });
    await page.mouse.up();

    expect(await messages(page)).toEqual([
      { type: 'fs:selection', rect: { x: 200, y: 180, w: 360, h: 240 } },
    ]);
    expect(watch.errors).toEqual([]);
  });

  test('a drag too small to mean anything reports nothing', async ({ page }) => {
    await inject(page, 'content-select');
    await page.mouse.move(200, 180);
    await page.mouse.down();
    await page.mouse.move(203, 182);
    await page.mouse.up();
    expect(await messages(page)).toEqual([]);
  });

  test('the size chip stays on screen when the drag reaches the bottom edge', async ({ page }) => {
    await inject(page, 'content-select');
    const height = page.viewportSize()!.height;
    const top = height - 160;
    await page.mouse.move(200, top);
    await page.mouse.down();
    await page.mouse.move(560, height - 2, { steps: 6 });
    const shot = await page.screenshot({ path: shotPath('overlay-05-region-at-bottom-edge') });
    await page.mouse.up();

    // The chip is the only solid block of the accent on the page, so where its
    // pixels are is where it rendered. Below the selection it would be off screen.
    const chipTop = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      const g = c.getContext('2d')!;
      g.drawImage(bitmap, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const dpr = c.width / window.innerWidth;
      let best = Infinity;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i]! - 56) < 12 && Math.abs(d[i + 1]! - 189) < 12 && Math.abs(d[i + 2]! - 248) < 12) {
          best = Math.min(best, Math.floor(i / 4 / c.width) / dpr);
        }
      }
      return best;
    }, shot.toString('base64'));

    expect(chipTop, 'nothing accent-coloured rendered at all').toBeLessThan(height);
    expect(chipTop, 'the size chip did not flip above the selection').toBeLessThan(top);
  });

  test('Escape cancels and takes the overlay with it', async ({ page }) => {
    await inject(page, 'content-select');
    await page.keyboard.press('Escape');
    expect(await messages(page)).toEqual([{ type: 'fs:selection-cancel' }]);
    expect(await page.evaluate(() => document.documentElement.lastElementChild?.tagName)).not.toBe('DIV');
  });
});

test.describe('element picker overlay', () => {
  test('outlines what is under the pointer and reports it when clicked', async ({ page }) => {
    const watch = watchConsole(page);
    await inject(page, 'content-element');
    await page.screenshot({ path: shotPath('overlay-03-element-hint') });

    const card = (await page.locator('#two').boundingBox())!;
    await page.mouse.move(card.x + card.width / 2, card.y + 20);
    // Mid-hover: the element outline plus its tag and size chip.
    await page.screenshot({ path: shotPath('overlay-04-element-hovering') });

    await page.mouse.click(card.x + card.width / 2, card.y + 20);
    const sent = await messages(page);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe('fs:element');
    expect(sent[0]!.rect).toMatchObject({ w: Math.round(card.width) });
    expect(watch.errors).toEqual([]);
  });

  test('Escape cancels the pick', async ({ page }) => {
    await inject(page, 'content-element');
    await page.keyboard.press('Escape');
    expect(await messages(page)).toEqual([{ type: 'fs:element-cancel' }]);
  });

  test('the overlay never lets a click reach the page under it', async ({ page }) => {
    await inject(page, 'content-element');
    await page.evaluate(() => {
      document.querySelector('#one')!.addEventListener('click', () => {
        (window as unknown as { __leaked: boolean }).__leaked = true;
      });
    });
    const card = (await page.locator('#one').boundingBox())!;
    await page.mouse.click(card.x + 20, card.y + 20);
    expect(await page.evaluate(() => (window as unknown as { __leaked?: boolean }).__leaked)).toBeUndefined();
  });
});
