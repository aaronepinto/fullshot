/**
 * The settings page, swept the same way as the editor: every control activated,
 * every option of every select chosen, and the result read back out of the storage
 * stub rather than off the screen. A setting that looks changed but was never
 * written is the failure this is here to catch.
 */
import { type Page } from '@playwright/test';
import { enumerateControls, tabOrder, watchConsole } from './audit';
import { expect, openedTabs, storedSettings, stubOptionsChrome, test } from './options-fixtures';

/** Every option of every select, as the page offers them. */
async function optionsOf(page: Page, sel: string): Promise<string[]> {
  return page.$$eval(`${sel} option:not([disabled])`, (els) =>
    els.map((e) => (e as HTMLOptionElement).value)
  );
}

test('every control on the settings page says what it is', async ({ options: page }) => {
  const controls = await enumerateControls(page);
  const shown = controls.filter((c) => c.visible);
  expect(shown.length, 'the sweep found no controls').toBeGreaterThan(14);

  const nameless = shown.filter((c) => !c.name.trim());
  expect(nameless.map((c) => c.sel), 'controls with no accessible name').toEqual([]);
});

test('every select writes every one of its options', async ({ options: page }) => {
  const watch = watchConsole(page);
  const selects = ['captureDelayMs', 'captureStartDelaySeconds', 'maxCaptureHeight',
    'mobileCaptureWidth', 'format', 'pdfPageMode', 'historyLimit'];

  for (const id of selects) {
    for (const value of await optionsOf(page, `#${id}`)) {
      await page.selectOption(`#${id}`, value);
      await expect
        .poll(async () => String((await storedSettings(page))[id]), {
          message: `#${id} did not write ${value}`,
        })
        .toBe(value);
      // Every write says so, and the confirmation clears itself.
      await expect(page.locator('#saved')).toBeVisible();
    }
  }
  expect(watch.errors).toEqual([]);
});

test('every checkbox writes both of its states', async ({ options: page }) => {
  for (const id of ['prescroll', 'autoLoadMore', 'hideSticky', 'freezeAnimations', 'saveAs']) {
    // Away from where it starts first: setting a box to what it already is fires no
    // change event, and there would be nothing for the store to have written.
    const start = await page.isChecked(`#${id}`);
    for (const want of [!start, start]) {
      await page.setChecked(`#${id}`, want);
      await expect
        .poll(async () => (await storedSettings(page))[id], { message: `#${id} did not write ${want}` })
        .toBe(want);
    }
  }
});

test('the quality slider writes its value and shows it as a percentage', async ({ options: page }) => {
  await page.locator('#quality').fill('0.75');
  await page.locator('#quality').dispatchEvent('change');
  await expect.poll(async () => (await storedSettings(page)).quality).toBe(0.75);
  await expect(page.locator('#qualityOut')).toHaveText('75%');
});

test('the filename template writes what is typed', async ({ options: page }) => {
  await page.fill('#filenameTemplate', '{title}-{date}');
  await page.locator('#filenameTemplate').dispatchEvent('change');
  await expect.poll(async () => (await storedSettings(page)).filenameTemplate).toBe('{title}-{date}');
});

test('the shortcuts link opens the browser page that owns them', async ({ options: page }) => {
  await page.click('#editShortcuts');
  await expect.poll(() => openedTabs(page)).toEqual(['chrome://extensions/shortcuts']);
});

test('Turbo is offered where the debugger exists and refused where it does not', async ({ page }) => {
  await stubOptionsChrome(page, { debugger: false });
  await page.goto('/options.html');
  await expect(page.locator('#engine option[value="turbo"]')).toBeDisabled();
  await expect(page.locator('#turboHint')).toContainText('needs the DevTools debugger API');
  await expect(page.locator('#grantDebugger')).toBeHidden();
});

test('Turbo falls back to stitch when the permission is refused', async ({ page }) => {
  await stubOptionsChrome(page, { debuggerGranted: false });
  await page.goto('/options.html');
  await page.selectOption('#engine', 'turbo');

  await expect(page.locator('#engine')).toHaveValue('stitch');
  await expect.poll(async () => (await storedSettings(page)).engine).toBe('stitch');
  // The way back is on screen rather than only in the console.
  await expect(page.locator('#grantDebugger')).toBeVisible();
});

test('every settings control is reachable and rings when focused', async ({ options: page }) => {
  const stops = (await enumerateControls(page)).filter((c) => c.visible && c.focusable && !c.disabled);
  const visited = await tabOrder(page, stops, stops.length * 2 + 4);
  expect(
    stops.map((c) => c.sel).filter((sel) => !visited.includes(sel)),
    'controls tabbing never reaches'
  ).toEqual([]);

  const unringed: string[] = [];
  for (const { sel } of stops) {
    const ring = await page.evaluate((s) => {
      const el = document.querySelector<HTMLElement>(s)!;
      el.focus();
      const style = getComputedStyle(el);
      return { width: style.outlineWidth, style: style.outlineStyle, matches: el.matches(':focus-visible') };
    }, sel);
    if (ring.matches && (ring.width === '0px' || ring.style === 'none')) unringed.push(sel);
  }
  expect(unringed, 'focused settings controls with no visible ring').toEqual([]);
});

test('the settings page loads without complaint', async ({ page }) => {
  const watch = watchConsole(page);
  await stubOptionsChrome(page);
  await page.goto('/options.html');
  await expect(page.locator('#filenameTemplate')).toHaveValue('{domain} {date} {time}');
  expect(watch.errors).toEqual([]);
});

test('the page says which build is running and where the source is', async ({ options: page }) => {
  // The category's reviews ask for this by name: a version you can check against a
  // public repository, rather than being told to trust the binary.
  await expect(page.locator('#version')).toHaveText('screencappy 0.2.0');
  await expect(page.locator('#sourceLink')).toHaveAttribute(
    'href',
    'https://github.com/smollet-app/screencappy'
  );
  await expect(page.locator('footer')).toContainText('No account, no telemetry, no network requests');
});
