/**
 * Item 1: nothing in the editor chrome renders cut off.
 *
 * The history drawer used to be fixed to the window at top 0, so opening it laid a
 * 320px panel over the right end of the toolbar: copy, download, both drawer
 * buttons and settings all vanished under it, and its own header collided with the
 * top bar. These specs pin the drawers inside the viewport and check both that
 * every box starts at or below the top edge and that no toolbar control is buried.
 */
import { expect, test } from './fixtures';

/** Every control a drawer could plausibly cover. */
const TOOLBAR = ['#btnUndo', '#btnRedo', '#btnCopy', '#btnDownload', '#btnAnnos', '#btnHistory', '#btnSettings'];

/** The element the browser would actually deliver a click at this box's centre to. */
async function clickableAt(page: import('@playwright/test').Page, sel: string): Promise<boolean> {
  return page.evaluate((s) => {
    const el = document.querySelector(s)!;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  }, sel);
}

for (const drawer of [
  { name: 'history', open: '#btnHistory', panel: '#history' },
  { name: 'annotations', open: '#btnAnnos', panel: '#annoPanel' },
]) {
  test(`the ${drawer.name} drawer opens below the toolbar, not over it`, async ({ editor, page }) => {
    await page.click(drawer.open);
    await expect(page.locator(drawer.panel)).toBeVisible();

    const topbar = (await page.locator('.topbar').boundingBox())!;
    const panel = (await page.locator(drawer.panel).boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(topbar.y + topbar.height - 1);

    // Its own header and first row are inside it rather than clipped off the top.
    const header = (await page.locator(`${drawer.panel} header`).boundingBox())!;
    expect(header.y).toBeGreaterThanOrEqual(panel.y - 0.5);
    expect(header.height).toBeGreaterThan(0);
  });

  test(`the ${drawer.name} drawer leaves every toolbar control reachable`, async ({ editor, page }) => {
    await page.click(drawer.open);
    await expect(page.locator(drawer.panel)).toBeVisible();

    for (const sel of TOOLBAR) {
      const box = (await page.locator(sel).boundingBox())!;
      expect(box, `${sel} has no box`).toBeTruthy();
      expect(box.y, `${sel} runs off the top`).toBeGreaterThanOrEqual(0);
      expect(box.x, `${sel} runs off the left`).toBeGreaterThanOrEqual(0);
      expect(await clickableAt(page, sel), `${sel} is buried under the drawer`).toBe(true);
    }
  });
}

test('no chrome renders above the top of the window, drawers open or shut', async ({ editor, page }) => {
  await editor.writeText(200, 200, 'label');
  await page.click('#btnAnnos');
  await page.click('#btnHistory');
  await expect(page.locator('#history')).toBeVisible();

  const offenders = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const r = el.getBoundingClientRect();
      // Nothing laid out has nothing to clip.
      if (r.width === 0 || r.height === 0) continue;
      if (r.top < -0.5) out.push(`${el.tagName}#${el.id || el.className} top=${r.top}`);
    }
    return out;
  });
  expect(offenders).toEqual([]);
});

test('the drawers stay inside the viewport when the toolbar wraps', async ({ editor, page }) => {
  // Narrow enough that the actions cluster wraps onto a second toolbar row, which
  // is exactly when a window-fixed drawer swallowed the most.
  await page.setViewportSize({ width: 900, height: 700 });
  await page.click('#btnHistory');
  await expect(page.locator('#history')).toBeVisible();

  const topbar = (await page.locator('.topbar').boundingBox())!;
  const panel = (await page.locator('#history').boundingBox())!;
  expect(topbar.height).toBeGreaterThan(60); // it really did wrap
  expect(panel.y).toBeGreaterThanOrEqual(topbar.y + topbar.height - 1);
  for (const sel of TOOLBAR) {
    expect(await clickableAt(page, sel), `${sel} is buried under the drawer`).toBe(true);
  }
});

test('the history drawer still closes from its own button', async ({ editor, page }) => {
  await page.click('#btnHistory');
  await expect(page.locator('#history')).toBeVisible();
  await page.click('#historyClose');
  await expect(page.locator('#history')).toBeHidden();
});

test('opening one drawer closes the other, so neither stacks', async ({ editor, page }) => {
  await page.click('#btnAnnos');
  await expect(page.locator('#annoPanel')).toBeVisible();
  await page.click('#btnHistory');
  await expect(page.locator('#history')).toBeVisible();
  await expect(page.locator('#annoPanel')).toBeHidden();
});
