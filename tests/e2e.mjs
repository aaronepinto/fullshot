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
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
 * The extension's service worker, which is where the capture entry point lives.
 * @param {Browser} browser
 * @param {string} label
 */
async function backgroundWorker(browser, label) {
  const swTarget = await browser.waitForTarget(
    (/** @type {Target} */ t) => t.type() === 'service_worker' && t.url().endsWith('background.js'),
    { timeout: 15000 }
  );
  const worker = await swTarget.worker();
  if (!worker) throw new Error(`[${label}] The background service worker target had no worker`);
  return worker;
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

  const worker = await backgroundWorker(browser, label);

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

/**
 * Width and height straight out of a PNG's IHDR chunk: 8 bytes of signature, a
 * 4-byte length and the "IHDR" tag, then the two big-endian dimensions.
 * @param {Buffer} buf
 */
function pngSize(buf) {
  if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error('Not a PNG, or truncated before the header');
  }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/**
 * Waits for a finished download whose name starts with `prefix`. Chrome writes a
 * .crdownload placeholder first, so a matching name alone does not mean done.
 * @param {string} dir
 * @param {string} prefix
 */
async function waitForDownloadedFile(dir, prefix) {
  for (let waited = 0; waited < 30000; waited += 250) {
    const names = existsSync(dir) ? await readdir(dir) : [];
    const hit = names.find((n) => n.startsWith(prefix) && !n.endsWith('.crdownload'));
    if (hit) return `${dir}/${hit}`;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No download starting with "${prefix}" landed in ${dir}`);
}

/**
 * "Download immediately" has to behave like a download, not like a capture that
 * hijacks the browser: the editor tab it borrows must never take focus and must
 * not still be there once the file has landed.
 * @param {Browser} browser
 * @param {string} url
 * @param {string} downloadDir
 */
async function runDownloadModeCase(browser, url, downloadDir) {
  const label = `${BROWSER}/download-mode`;
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto(url, { waitUntil: 'load' });

  const worker = await backgroundWorker(browser, label);
  const startedAt = Date.now();

  // The extension cannot read chrome-extension: urls out of its own tab events
  // without the "tabs" permission, which this feature has no reason to want. So
  // the worker counts the tabs and their focus, and Puppeteer, which sees every
  // target's url, says which of them was the editor.
  /** @type {string[]} */
  const editorTargets = [];
  const onTarget = (/** @type {Target} */ t) => {
    if (t.url().includes('editor.html')) editorTargets.push(t.url());
  };
  browser.on('targetcreated', onTarget);

  const seen = await worker.evaluate(async () => {
    await chrome.storage.sync.set({
      afterCapture: 'download',
      filenameTemplate: 'download-mode-probe',
    });
    // Recorded from the events rather than read back afterwards, because the tab
    // is expected to be gone by the time the capture call returns.
    /** @type {{ id: number | undefined, active: boolean }[]} */
    const created = [];
    /** @type {number[]} */
    const activated = [];
    const onCreated = (/** @type {chrome.tabs.Tab} */ t) =>
      created.push({ id: t.id, active: t.active });
    const onActivated = (/** @type {{ tabId: number }} */ info) => activated.push(info.tabId);
    chrome.tabs.onCreated.addListener(onCreated);
    chrome.tabs.onActivated.addListener(onActivated);

    const hook = /** @type {typeof globalThis & { __screencappyStart(tab: chrome.tabs.Tab, mode: string): Promise<void> }} */ (
      globalThis
    );
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab to capture');
    await hook.__screencappyStart(tab, 'full');

    // The tab is closed only after the download finishes writing, which happens
    // some time after the capture itself returns.
    let stillOpen = true;
    for (let i = 0; i < 120 && stillOpen; i++) {
      const open = await chrome.tabs.query({});
      stillOpen = open.some((t) => created.some((c) => c.id === t.id));
      if (stillOpen) await new Promise((r) => setTimeout(r, 250));
    }
    chrome.tabs.onCreated.removeListener(onCreated);
    chrome.tabs.onActivated.removeListener(onActivated);
    return { created, activated, stillOpen };
  });

  browser.off('targetcreated', onTarget);

  if (editorTargets.length !== 1) {
    throw new Error(`[${label}] Expected exactly one editor page, saw ${editorTargets.length}`);
  }
  if (seen.created.length !== 1) {
    throw new Error(`[${label}] The capture opened ${seen.created.length} tabs, expected 1`);
  }
  const editor = seen.created[0];
  if (editor.active) throw new Error(`[${label}] The editor tab was opened focused`);
  if (seen.activated.includes(editor.id)) {
    throw new Error(`[${label}] The editor tab took focus while the download ran`);
  }
  if (seen.stillOpen) throw new Error(`[${label}] The editor tab was still open after the download`);
  const left = browser.targets().filter((/** @type {Target} */ t) => t.url().includes('editor.html'));
  if (left.length > 0) throw new Error(`[${label}] ${left.length} editor page(s) survived the download`);

  const file = await waitForDownloadedFile(downloadDir, 'download-mode-probe');
  const { w, h } = pngSize(await readFile(file));
  console.log(`[${label}] wrote ${file} at ${w}×${h} after ${Date.now() - startedAt}ms`);
  if (w < 1100 || h < 4000) {
    throw new Error(`[${label}] Download wrote ${w}×${h}, expected at least 1100×4000`);
  }

  await worker.evaluate(async () => {
    await chrome.storage.sync.set({
      afterCapture: 'editor',
      filenameTemplate: '{domain} {date} {time}',
    });
  });
  await page.close();
  console.log(`✓ [${label}] downloaded without focus, tab closed itself`);
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

  // Downloads have to land somewhere this script can read them back from. The
  // directory is seeded through a profile rather than through CDP's
  // Browser.setDownloadBehavior, which renames every file after its download guid
  // and would throw away the filename half of what the download case asserts.
  const downloadDir = `${ROOT}.scratch/e2e-downloads`;
  const profileDir = `${ROOT}.scratch/e2e-profile`;
  await rm(downloadDir, { recursive: true, force: true });
  await rm(profileDir, { recursive: true, force: true });
  await mkdir(downloadDir, { recursive: true });
  await mkdir(`${profileDir}/Default`, { recursive: true });
  await writeFile(
    `${profileDir}/Default/Preferences`,
    JSON.stringify({
      download: { default_directory: downloadDir, prompt_for_download: false, directory_upgrade: true },
      savefile: { default_directory: downloadDir },
    })
  );

  // Chrome 137+ dropped --load-extension in branded builds; the supported path is
  // the CDP Extensions domain via Puppeteer's enableExtensions/installExtension.
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    pipe: true,
    enableExtensions: true,
    userDataDir: profileDir,
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
    await runDownloadModeCase(browser, `${fixtures.base}/`, downloadDir);
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
