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

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = `${ROOT}dist`;
const DIST_E2E = `${ROOT}dist-e2e`;
const BROWSER = process.env.BROWSER ?? 'chromium';

function findChrome() {
  const candidates = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Chrome not found - set CHROME=/path/to/chrome');
  return found;
}

async function runScenario(browser, url, scenario) {
  const label = `${BROWSER}/${scenario.name}`;
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto(url, { waitUntil: 'load' });

  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().endsWith('background.js'),
    { timeout: 15000 }
  );
  const worker = await swTarget.worker();

  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await globalThis.__screencappyStart(tab, 'full');
  });

  const editorTarget = await browser.waitForTarget(
    (t) => t.url().includes('editor.html'),
    { timeout: 60000 }
  );
  const editor = await editorTarget.page();
  await editor.waitForSelector('#loading[hidden]', { timeout: 60000 });

  const dims = await editor.$eval('#statDims', (el) => el.textContent);
  console.log(`[${label}] editor reports:`, dims);
  const { w, h } = assertComposed(label, dims, scenario);

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
