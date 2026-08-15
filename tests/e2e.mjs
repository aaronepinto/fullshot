/**
 * End-to-end test: loads the built extension into real Chrome (new headless) and
 * runs two capture scenarios:
 *  1. a 4000px-tall window-scrolled fixture with a sticky header and a fixed badge,
 *  2. a Gmail-style fixture where the window never scrolls and an inner container
 *     holds 3000px of content.
 * Each asserts the editor composes the expected image dimensions.
 *
 * Usage: bun run e2e   (requires `bun run build` output in dist/ and Chrome installed;
 * override the binary with CHROME=/path/to/chrome)
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = `${ROOT}dist`;
const DIST_E2E = `${ROOT}dist-e2e`;

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

async function runScenario(browser, url, { name, minW, minH, maxH }) {
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
    await globalThis.__fullshotStart(tab, 'full');
  });

  const editorTarget = await browser.waitForTarget(
    (t) => t.url().includes('editor.html'),
    { timeout: 60000 }
  );
  const editor = await editorTarget.page();
  await editor.waitForSelector('#loading[hidden]', { timeout: 60000 });

  const dims = await editor.$eval('#statDims', (el) => el.textContent);
  console.log(`[${name}] editor reports:`, dims);
  const m = /(\d+)\s*×\s*(\d+)/.exec(dims ?? '');
  if (!m) throw new Error(`[${name}] Could not parse dimensions from "${dims}"`);
  const [w, h] = [Number(m[1]), Number(m[2])];
  if (w < minW) throw new Error(`[${name}] Composed width ${w} < expected ${minW}`);
  if (h < minH) throw new Error(`[${name}] Composed height ${h} < expected ${minH} - stitching incomplete`);
  if (maxH && h > maxH) throw new Error(`[${name}] Composed height ${h} > expected max ${maxH}`);

  await mkdir(`${ROOT}.scratch`, { recursive: true });
  await editor.screenshot({ path: `${ROOT}.scratch/e2e-${name}.png` });
  console.log(`✓ [${name}] stitched to ${w}×${h}`);

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

  const fixtures = {
    '/': await readFile(`${ROOT}tests/fixture.html`),
    '/container': await readFile(`${ROOT}tests/fixture-container.html`),
  };
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(fixtures[req.url] ?? fixtures['/']);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

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
    // Fixture: 60px sticky header + 8 × 500px sections = 4060 CSS px, any DPR ≥ 1.
    await runScenario(browser, `${base}/`, { name: 'full-page', minW: 1100, minH: 4000 });
    // Container fixture: window scroll is disabled, inner div holds 6 × 500px sections.
    // The composed height must match the container content (3000px), not the viewport.
    await runScenario(browser, `${base}/container`, {
      name: 'container',
      minW: 1000,
      minH: 2950,
      maxH: 3100,
    });
    console.log('✓ e2e passed');
  } catch (err) {
    failed = true;
    console.error('✗ e2e failed:', err);
  } finally {
    await browser.close();
    server.close();
    await rm(DIST_E2E, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

await main();
