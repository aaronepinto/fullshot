/**
 * The look-and-feel pass: one screenshot of every state either page can be in,
 * plus the measurements a human eye is bad at. The images go to a folder for
 * review; the assertions here only cover what is objectively wrong, so a taste
 * question never fails a build.
 *
 * Point it somewhere else with UI_GALLERY_DIR when reviewing a run.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Page } from '@playwright/test';
import {
  aaFloor, contrast, GALLERY_DIR, meanColor, sampleText, settle, shotPath, watchConsole,
} from './audit';
import { expect, test, type Editor } from './fixtures';
import { stubOptionsChrome } from './options-fixtures';

const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 900, height: 720 };

/** A capture with one of everything on it, so a screenshot shows the real thing. */
async function annotate(editor: Editor, page: Page): Promise<void> {
  await editor.tool('rect');
  await editor.drag([80, 90], [320, 240]);
  await editor.tool('arrow');
  await editor.drag([360, 120], [560, 300]);
  await editor.tool('highlight');
  await editor.drag([80, 300], [400, 340]);
  await editor.writeText(420, 420, 'a label');
  await editor.tool('emoji');
  await editor.click(620, 200);
  await editor.tool('select');
  await page.keyboard.press('Escape');
  await settle(page);
}

test.describe('editor gallery', () => {
  test.use({ viewport: WIDE });

  test('every editor state, photographed', async ({ editor, page }) => {
    test.setTimeout(120_000);
    const watch = watchConsole(page);
    await page.click('#zoomFit');
    await settle(page);
    await page.screenshot({ path: shotPath('editor-01-fresh-capture') });

    await annotate(editor, page);
    await page.screenshot({ path: shotPath('editor-02-annotated') });

    await page.click('#btnAnnos');
    await settle(page);
    await page.screenshot({ path: shotPath('editor-03-annotations-drawer') });
    await page.click('#annoClose');

    await page.click('#btnHistory');
    await settle(page);
    await page.screenshot({ path: shotPath('editor-04-history-drawer') });
    await page.click('#historyClose');

    await page.click('#btnFormat');
    await page.screenshot({ path: shotPath('editor-05-format-menu') });
    await page.keyboard.press('Escape');

    await editor.tool('emoji');
    await page.click('#emojiCurrent');
    await page.screenshot({ path: shotPath('editor-06-emoji-picker') });
    await page.keyboard.press('Escape');

    await page.click('#colorCurrent');
    await page.screenshot({ path: shotPath('editor-06b-colour-popover') });
    await page.keyboard.press('Escape');

    const p = await editor.at(300, 300);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await page.screenshot({ path: shotPath('editor-07-context-menu') });
    await page.keyboard.press('Escape');

    await editor.tool('text');
    await editor.click(300, 250);
    await page.keyboard.type('typing right now');
    await settle(page);
    await page.screenshot({ path: shotPath('editor-08-text-editing') });
    await page.keyboard.press('Escape');

    // Mid-rotation: the knob is held, so the outline is turned and the handles move.
    await editor.tool('select');
    await editor.click(150, 150);
    const knob = (await editor.handles(0)).find((h) => h.id === 'rot')!;
    const start = await editor.at(knob.x, knob.y);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 120, start.y + 90, { steps: 6 });
    await settle(page);
    await page.screenshot({ path: shotPath('editor-09-rotating') });
    await page.mouse.up();
    await page.keyboard.press('ControlOrMeta+z');

    await editor.tool('crop');
    await editor.drag([120, 120], [560, 420]);
    await settle(page);
    await page.screenshot({ path: shotPath('editor-10-crop-pending') });
    await page.click('#cropApply');
    await settle(page);
    await page.screenshot({ path: shotPath('editor-11-cropped') });

    // Style bar in each of its shapes, since it swaps controls per subject.
    for (const tool of ['rect', 'text', 'emoji', 'pen']) {
      await editor.tool(tool);
      await settle(page);
      await page.locator('.topbar').screenshot({ path: shotPath(`editor-12-stylebar-${tool}`) });
    }

    await page.setViewportSize(NARROW);
    await settle(page);
    await page.screenshot({ path: shotPath('editor-13-narrow-900') });
    await page.click('#btnHistory');
    await settle(page);
    await page.screenshot({ path: shotPath('editor-14-narrow-900-drawer') });

    expect(watch.errors).toEqual([]);
  });

  test('the empty and error states, photographed', async ({ editor, page }) => {
    await page.goto('/editor.html');
    await expect(page.locator('#emptyState')).toBeVisible();
    await page.screenshot({ path: shotPath('editor-20-no-capture') });

    await page.goto('/editor.html?history=1');
    await expect(page.locator('#history')).toBeVisible();
    await page.screenshot({ path: shotPath('editor-21-history-with-one') });

    await page.goto('/editor.html?id=does-not-exist');
    await expect(page.locator('#toast')).toBeVisible();
    await page.screenshot({ path: shotPath('editor-22-capture-missing') });
    await expect(page.locator('#toast')).toContainText('Capture not found');
  });

  test('nothing white flashes on the way in', async ({ editor, page }) => {
    await page.goto('/editor.html', { waitUntil: 'commit' });
    const early = await page.screenshot({ path: shotPath('editor-23-first-50ms') });
    const mean = await meanColor(page, early);

    // The head declares the shell before the stylesheet is even fetched, so the
    // browser's own canvas is dark from the very first frame.
    expect(await page.getAttribute('meta[name="color-scheme"]', 'content')).toBe('dark');
    expect(Math.max(...mean), `the first frame averaged rgb(${mean}), which is not the ink shell`).toBeLessThan(90);
  });
});

test.describe('options gallery', () => {
  test.use({ viewport: WIDE });

  test('the settings page, top to bottom', async ({ page }) => {
    await stubOptionsChrome(page);
    await page.goto('/options.html');
    await expect(page.locator('h1')).toBeVisible();
    await page.screenshot({ path: shotPath('options-01-full'), fullPage: true });
    await page.screenshot({ path: shotPath('options-02-first-screen') });

    await page.setViewportSize(NARROW);
    await page.screenshot({ path: shotPath('options-03-narrow-900'), fullPage: true });

    await page.setViewportSize(WIDE);
    await page.selectOption('#engine', 'turbo');
    await expect(page.locator('#saved')).toBeVisible();
    await page.screenshot({ path: shotPath('options-04-saved-confirmation') });
  });

  test('the settings page does not flash white either', async ({ page }) => {
    await stubOptionsChrome(page);
    await page.goto('/options.html', { waitUntil: 'commit' });
    const early = await page.screenshot({ path: shotPath('options-05-first-50ms') });
    expect(await page.getAttribute('meta[name="color-scheme"]', 'content')).toBe('dark');
    expect(Math.max(...(await meanColor(page, early)))).toBeLessThan(90);
  });
});

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

interface Reading {
  page: string;
  sel: string;
  text: string;
  size: number;
  weight: number;
  fg: string;
  bg: string;
  ratio: number;
  floor: number;
  passesAA: boolean;
}

function readings(name: string, samples: Awaited<ReturnType<typeof sampleText>>): Reading[] {
  return samples.map((s) => {
    const ratio = Math.round(contrast(s.fg, s.bg) * 100) / 100;
    const floor = aaFloor(s.size, s.weight);
    return {
      page: name,
      sel: s.sel,
      text: s.text,
      size: s.size,
      weight: s.weight,
      fg: `rgb(${s.fg})`,
      bg: `rgb(${s.bg})`,
      ratio,
      floor,
      passesAA: ratio >= floor,
    };
  });
}

/**
 * Contrast, measured off the rendered pixels rather than off the token names.
 *
 * The hard floor is 3:1, which is where text stops being readable at all; the AA
 * floor of 4.5:1 is reported instead of enforced, because moving a palette token is
 * a design decision and not something a test should make on its own. The full table
 * lands beside the screenshots.
 */
test('text contrast is measured on both pages', async ({ editor, page }) => {
  await editor.tool('rect');
  await editor.drag([80, 90], [320, 240]);
  await editor.tool('select');
  await page.click('#btnAnnos');
  await settle(page);
  const editorReadings = readings('editor', await sampleText(page));

  await page.click('#btnHistory');
  await settle(page);
  editorReadings.push(...readings('editor/history', await sampleText(page)));

  await stubOptionsChrome(page);
  await page.goto('/options.html');
  await expect(page.locator('h1')).toBeVisible();
  const all = [...editorReadings, ...readings('options', await sampleText(page))];

  writeFileSync(join(GALLERY_DIR, 'contrast.json'), JSON.stringify(all, null, 2));

  const unreadable = all.filter((r) => r.ratio < 3);
  expect(
    unreadable.map((r) => `${r.page} ${r.sel} ${r.ratio}:1`),
    'text below 3:1, which is unreadable rather than merely sub-AA'
  ).toEqual([]);
});

test('reduced motion is answered on both pages', async ({ editor, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/editor.html');
  const editorMotion = await page.evaluate(() => ({
    button: getComputedStyle(document.querySelector('#btnCopy')!).transitionDuration,
    spinner: getComputedStyle(document.querySelector('.spinner')!).animationName,
  }));
  expect(editorMotion.button).toBe('0.01s');
  expect(editorMotion.spinner, 'the spinner still loops under reduced motion').toBe('none');

  await stubOptionsChrome(page);
  await page.goto('/options.html');
  const optionsMotion = await page.evaluate(
    () => getComputedStyle(document.querySelector('#format')!).transitionDuration
  );
  expect(optionsMotion, 'the settings page ignores reduced motion').toBe('0.01s');
});

test('neither page traps a scroll', async ({ editor, page }) => {
  // The editor owns its own scrolling: the window must never grow a scrollbar.
  const doc = await page.evaluate(() => ({
    scrollH: document.documentElement.scrollHeight,
    clientH: document.documentElement.clientHeight,
    bodyOverflow: getComputedStyle(document.body).overflow,
  }));
  expect(doc.scrollH).toBeLessThanOrEqual(doc.clientH + 1);

  // Its lists scroll inside themselves instead, at any window height.
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.click('#btnHistory');
  expect(
    await page.evaluate(() => getComputedStyle(document.querySelector('#historyList')!).overflowY)
  ).toBe('auto');

  await stubOptionsChrome(page);
  await page.goto('/options.html');
  const optionsScroll = await page.evaluate(() => ({
    scrollH: document.documentElement.scrollHeight,
    clientH: document.documentElement.clientHeight,
  }));
  // The settings page is a document, so it scrolls: the check is that it can.
  expect(optionsScroll.scrollH).toBeGreaterThan(optionsScroll.clientH);
});

/**
 * The ground was painted with a token that does not exist, so the fill was ignored
 * and the canvas kept whatever colour the previous frame had left in the context:
 * paper white after one frame, cream after a frame that drew a selection handle.
 * Two samples, one before drawing and one after, are what catch that.
 */
test('the ground behind the artwork is the shell colour, in every frame', async ({ editor, page }) => {
  await editor.setZoom(25);
  const groundAt = () =>
    page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const dpr = window.devicePixelRatio || 1;
      const d = c.getContext('2d')!.getImageData(Math.round(4 * dpr), Math.round(4 * dpr), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!] as [number, number, number];
    });

  const want = await page.evaluate(() => {
    const probe = new OffscreenCanvas(1, 1);
    const g = probe.getContext('2d')!;
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface-canvas-deep');
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!] as [number, number, number];
  });

  const before = await groundAt();
  await editor.tool('rect');
  await editor.drag([100, 100], [400, 300]);
  await settle(page);
  const after = await groundAt();

  for (const [name, got] of [['before drawing', before], ['after drawing', after]] as const) {
    expect(
      Math.max(...got.map((v, i) => Math.abs(v - want[i]!))),
      `the ground ${name} is rgb(${got}) rather than the shell's rgb(${want})`
    ).toBeLessThan(6);
  }
  await page.screenshot({ path: shotPath('editor-15-ground') });
});

test('icons are one family at two deliberate sizes', async ({ editor, page }) => {
  // With a drawer open, so the in-row icons are laid out and counted too.
  await editor.tool('rect');
  await editor.drag([80, 90], [320, 240]);
  await editor.tool('select');
  await page.click('#btnAnnos');
  await settle(page);

  const icons = await page.evaluate(() =>
    [...document.querySelectorAll('svg')].map((s) => {
      const box = s.getBoundingClientRect();
      const style = getComputedStyle(s);
      return {
        w: Math.round(box.width),
        h: Math.round(box.height),
        stroke: s.getAttribute('stroke-width') ?? style.strokeWidth,
        viewBox: s.getAttribute('viewBox'),
        fill: style.fill,
      };
    })
  );
  const laidOut = icons.filter((i) => i.w > 0);
  expect(laidOut.length).toBeGreaterThan(15);
  // 18px in the chrome, 14px inside a list row. Any third size is a mistake.
  expect(
    [...new Set(laidOut.map((i) => `${i.w}x${i.h}`))].sort(),
    'icons at a size the shell does not define'
  ).toEqual(['14x14', '18x18']);
  expect([...new Set(laidOut.map((i) => i.viewBox))], 'icons drawn on more than one grid').toEqual(['0 0 24 24']);
  expect([...new Set(laidOut.map((i) => i.stroke))], 'icons at more than one stroke weight').toEqual(['2']);
});
