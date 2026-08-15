/**
 * End-to-end test: loads the built extension into a real Chromium browser (new
 * headless) and runs the shared capture scenarios from tests/fixtures.mjs, each
 * asserting that the editor composes the expected image dimensions.
 *
 * One script covers every Chromium browser we test: Chrome, Edge and Brave all
 * speak the same CDP, so only the binary changes.
 *
 * Usage: bun run e2e   (requires `bun run build` output in dist/ and Chrome installed;
 * override the binary with CHROME=/path/to/chrome, and label the run with BROWSER=edge)
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { SCENARIOS, assertComposed, startFixtureServer } from './fixtures.mjs';

/** @typedef {import('./fixtures.mjs').Scenario} Scenario */
/** @typedef {import('puppeteer-core').Browser} Browser */
/** @typedef {import('puppeteer-core').Target} Target */

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = `${ROOT}dist`;
const DIST_E2E = `${ROOT}dist-e2e`;
const BROWSER = process.env.BROWSER ?? 'chromium';

function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  if (process.env.CHROME) candidates.unshift(process.env.CHROME);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Chrome not found - set CHROME=/path/to/chrome');
  return found;
}

/**
 * Reads single pixels out of the composed image the editor stored in IndexedDB, one
 * per fraction of the total height, taken near the right edge so row text never
 * interferes. Chromium harness only; the Firefox driver checks dimensions alone.
 * @param {import('puppeteer-core').Page} editor
 * @param {number[]} fractions
 * @returns {Promise<{ y: number, rgb: number[] }[]>}
 */
function samplePixels(editor, fractions) {
  return editor.evaluate(async (/** @type {number[]} */ fracs) => {
    const id = new URLSearchParams(location.search).get('id');
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('screencappy');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const strips = await new Promise((resolve, reject) => {
      const req = /** @type {IDBDatabase} */ (db)
        .transaction(['strips'], 'readonly')
        .objectStore('strips')
        .index('capId')
        .getAll(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    /** @type {{ index: number, y: number, h: number, blob: Blob }[]} */ (strips).sort(
      (a, b) => a.index - b.index
    );
    const all = /** @type {{ index: number, y: number, h: number, blob: Blob }[]} */ (strips);
    const height = all.reduce((h, s) => Math.max(h, s.y + s.h), 0);
    const out = [];
    for (const fraction of fracs) {
      const y = Math.min(height - 1, Math.round(height * fraction));
      const strip = all.find((s) => y >= s.y && y < s.y + s.h);
      if (!strip) throw new Error(`no strip covers y=${y}`);
      const bmp = await createImageBitmap(strip.blob);
      const canvas = new OffscreenCanvas(bmp.width, 1);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bmp, 0, y - strip.y, bmp.width, 1, 0, 0, bmp.width, 1);
      const px = ctx.getImageData(Math.round(bmp.width * 0.9), 0, 1, 1).data;
      bmp.close();
      out.push({ y, rgb: [px[0], px[1], px[2]] });
    }
    return out;
  }, fractions);
}

/**
 * Blank bands mean rows never rendered before the shot; repeated bands mean the
 * same frame was stitched twice. Both are the exact defects the virtualized
 * fixture exists to catch.
 * @param {string} label
 * @param {import('puppeteer-core').Page} editor
 * @param {number[]} fractions
 */
async function checkSamples(label, editor, fractions) {
  const samples = await samplePixels(editor, fractions);
  console.log(
    `[${label}] pixel samples:`,
    samples.map((s) => `${s.y}:rgb(${s.rgb})`).join(' ')
  );
  for (const s of samples) {
    if (s.rgb.every((c) => c > 245)) {
      throw new Error(`[${label}] blank band at y=${s.y}, rows never rendered there`);
    }
  }
  const seen = new Map();
  for (const s of samples) {
    const key = s.rgb.join(',');
    if (seen.has(key)) {
      throw new Error(`[${label}] y=${s.y} repeats the pixels at y=${seen.get(key)}, duplicated region`);
    }
    seen.set(key, s.y);
  }
}

/**
 * @param {Browser} browser
 * @param {string} url
 * @param {Scenario} scenario
 */
async function runScenario(browser, url, scenario) {
  const label = `${BROWSER}/${scenario.name}`;
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto(url, { waitUntil: 'load' });
  const startedAt = Date.now();

  const swTarget = await browser.waitForTarget(
    (/** @type {Target} */ t) => t.type() === 'service_worker' && t.url().endsWith('background.js'),
    { timeout: 15000 }
  );
  const worker = await swTarget.worker();
  if (!worker) throw new Error(`[${label}] The background service worker target had no worker`);

  await worker.evaluate(async () => {
    // The extension parks its capture entry point on the worker's global.
    const hook = /** @type {typeof globalThis & { __screencappyStart(tab: chrome.tabs.Tab, mode: string): Promise<void> }} */ (
      globalThis
    );
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab to capture');
    await hook.__screencappyStart(tab, 'full');
  });

  const editorTarget = await browser.waitForTarget(
    (/** @type {Target} */ t) => t.url().includes('editor.html'),
    { timeout: 60000 }
  );
  const editor = await editorTarget.page();
  if (!editor) throw new Error(`[${label}] The editor target had no page`);
  await editor.waitForSelector('#loading[hidden]', { timeout: 60000 });

  const dims = await editor.$eval('#statDims', (el) => el.textContent);

  console.log(`[${label}] editor reports:`, dims, `after ${Date.now() - startedAt}ms`);
  const { w, h } = assertComposed(label, dims, scenario);

  if (scenario.note !== undefined) {
    const statNote = (await editor.$eval('#statNote', (el) => el.textContent))?.trim() ?? '';
    if (scenario.note && !statNote.includes(scenario.note)) {
      throw new Error(`[${label}] Expected a status note containing "${scenario.note}", got "${statNote}"`);
    }
    if (!scenario.note && statNote) {
      throw new Error(`[${label}] Unexpected status note "${statNote}"`);
    }
  }
  if (scenario.samples) await checkSamples(label, editor, scenario.samples);

  await mkdir(`${ROOT}.scratch`, { recursive: true });
  await editor.screenshot({ path: `${ROOT}.scratch/e2e-${BROWSER}-${scenario.name}.png` });
  console.log(`✓ [${label}] stitched to ${w}×${h}`);

  // Close both tabs so the next scenario's editor is the only editor.html target.
  await editor.close();
  await page.close();
}

async function main() {
  if (!existsSync(`${DIST}/manifest.json`)) throw new Error('Run `bun run build` first.');

  // Patch a copy of the build with host permissions so the test hook can capture
  // without a user gesture (activeTab needs one; automation can't produce it).
  await rm(DIST_E2E, { recursive: true, force: true });
  await cp(DIST, DIST_E2E, { recursive: true });
  const manifest = JSON.parse(await readFile(`${DIST_E2E}/manifest.json`, 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  await writeFile(`${DIST_E2E}/manifest.json`, JSON.stringify(manifest));

  const fixtures = await startFixtureServer();

  // Chrome 137+ dropped --load-extension in branded builds; the supported path is
  // the CDP Extensions domain via Puppeteer's enableExtensions/installExtension.
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    pipe: true,
    enableExtensions: true,
    args: [
      '--no-first-run',
      '--window-size=1200,800',
      // Hosted CI runners need these to launch Chrome at all.
      ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    ],
  });
  await browser.installExtension(DIST_E2E);

  let failed = false;
  try {
    for (const scenario of SCENARIOS) {
      await runScenario(browser, `${fixtures.base}${scenario.path}`, scenario);
    }
    console.log(`✓ e2e passed (${BROWSER})`);
  } catch (err) {
    failed = true;
    console.error(`✗ e2e failed (${BROWSER}):`, err);
  } finally {
    await browser.close();
    fixtures.close();
    await rm(DIST_E2E, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

await main();
