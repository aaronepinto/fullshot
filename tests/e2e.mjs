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
import {
  GAUNTLET,
  SCENARIOS,
  assertComposed,
  decodeIndex,
  startFixtureServer,
} from './fixtures.mjs';

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
 * Reads the composed image the editor stored in IndexedDB and answers three questions in
 * one pass over it: what colour is at these exact points, how many pixels of these exact
 * colours are there and where do they start and end, and how many pixels no tile ever
 * painted. All three are what the gauntlet's assertions are made of - a repeated header,
 * a missing band or a seam gap is a count or a coordinate, not a judgement call.
 *
 * Negative coordinates count in from the right and bottom edges, which is how "the bottom
 * bar must end at the composed bottom" is expressed without knowing the height up front.
 *
 * @param {import('puppeteer-core').Page} editor
 * @param {{ points: { x: number, y: number }[], colors: [number, number, number][] }} spec
 */
function inspectImage(editor, spec) {
  return editor.evaluate(
    async (/** @type {{ points: { x: number, y: number }[], colors: number[][] }} */ req) => {
      const id = new URLSearchParams(location.search).get('id');
      const db = /** @type {IDBDatabase} */ (
        await new Promise((resolve, reject) => {
          const open = indexedDB.open('screencappy');
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        })
      );
      const strips = /** @type {{ index: number, y: number, h: number, blob: Blob }[]} */ (
        await new Promise((resolve, reject) => {
          const get = db
            .transaction(['strips'], 'readonly')
            .objectStore('strips')
            .index('capId')
            .getAll(id);
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        })
      );
      if (!strips.length) throw new Error('the capture stored no strips');
      strips.sort((a, b) => a.index - b.index);
      const height = strips.reduce((h, s) => Math.max(h, s.y + s.h), 0);

      const probe = await createImageBitmap(strips[0].blob);
      const width = probe.width;
      probe.close();

      const points = req.points.map((p) => ({
        x: p.x < 0 ? width + p.x : p.x,
        y: p.y < 0 ? height + p.y : p.y,
      }));
      const wanted = new Map(req.colors.map((c, i) => [c[0] * 65536 + c[1] * 256 + c[2], i]));
      // A pixel no tile covered stays transparent, which is what a seam gap looks like.
      const gaps = { count: 0, minY: Infinity, maxY: -Infinity };
      const counts = req.colors.map(() => ({
        count: 0,
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
      }));
      /** @type {(number[] | null)[]} */
      const pixels = points.map(() => null);

      for (const strip of strips) {
        const needsPoints = points.some((p, i) => !pixels[i] && p.y >= strip.y && p.y < strip.y + strip.h);
        if (!needsPoints && wanted.size === 0 && !req.gaps) continue;
        const bmp = await createImageBitmap(strip.blob);
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          if (pixels[i] || p.y < strip.y || p.y >= strip.y + strip.h) continue;
          const off = ((p.y - strip.y) * canvas.width + Math.min(p.x, canvas.width - 1)) * 4;
          pixels[i] = [data[off], data[off + 1], data[off + 2]];
        }
        if (wanted.size === 0 && !req.gaps) continue;
        for (let y = 0; y < canvas.height; y++) {
          const row = y * canvas.width * 4;
          const absY = strip.y + y;
          for (let x = 0; x < canvas.width; x++) {
            const off = row + x * 4;
            if (req.gaps && data[off + 3] < 255) {
              gaps.count++;
              if (absY < gaps.minY) gaps.minY = absY;
              if (absY > gaps.maxY) gaps.maxY = absY;
            }
            const hit = wanted.get(data[off] * 65536 + data[off + 1] * 256 + data[off + 2]);
            if (hit === undefined) continue;
            const c = counts[hit];
            c.count++;
            if (x < c.minX) c.minX = x;
            if (x > c.maxX) c.maxX = x;
            if (absY < c.minY) c.minY = absY;
            if (absY > c.maxY) c.maxY = absY;
          }
        }
      }
      return { width, height, points, pixels, counts, gaps };
    },
    spec
  );
}

/** @param {[number, number, number] | null} rgb */
const fmt = (rgb) => (rgb ? `rgb(${rgb.join(',')})` : 'none');

/**
 * The stored capture record. Tile count and engine are what explain a slow or
 * wrong-shaped run, and neither is visible in the editor's own UI.
 * @param {import('puppeteer-core').Page} editor
 */
function readRecord(editor) {
  return editor.evaluate(async () => {
    const id = new URLSearchParams(location.search).get('id');
    const db = /** @type {IDBDatabase} */ (
      await new Promise((resolve, reject) => {
        const open = indexedDB.open('screencappy');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      })
    );
    const rec = await new Promise((resolve, reject) => {
      const get = db.transaction(['captures'], 'readonly').objectStore('captures').get(id);
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    const r = /** @type {{ engine: string, tileCount: number, truncated: boolean }} */ (rec);
    return { engine: r.engine, tileCount: r.tileCount, truncated: r.truncated };
  });
}

/**
 * Runs a scenario's pixel-level checks: exact colours at fixed points, per-colour pixel
 * counts and extents, and the index-encoded band sequence.
 * @param {string} label
 * @param {import('puppeteer-core').Page} editor
 * @param {Scenario} scenario
 */
async function checkPixels(label, editor, scenario) {
  const seq = scenario.sequence;
  const seqPoints = seq
    ? Array.from({ length: seq.count }, (_, i) => ({ x: seq.x, y: seq.y0 + i * seq.dy }))
    : [];
  const points = [...(scenario.points ?? []), ...seqPoints];
  const colors = (scenario.colors ?? []).map((c) => c.rgb);
  if (!points.length && !colors.length && !scenario.noGaps) return;

  const img = await inspectImage(editor, { points, colors, gaps: !!scenario.noGaps });

  if (scenario.noGaps && img.gaps.count > 0) {
    throw new Error(
      `[${label}] ${img.gaps.count} pixels no tile ever painted, rows ${img.gaps.minY}..${img.gaps.maxY}` +
        ' - the tiles did not land where the grid planned and left a hole between them'
    );
  }

  (scenario.points ?? []).forEach((check, i) => {
    const got = img.pixels[i];
    const at = `(${img.points[i].x}, ${img.points[i].y})`;
    if (check.rgb && (!got || check.rgb.some((c, k) => c !== got[k]))) {
      throw new Error(`[${label}] ${check.name}: expected ${fmt(check.rgb)} at ${at}, got ${fmt(got)}`);
    }
    if (check.notRgb && got && check.notRgb.every((c, k) => c === got[k])) {
      throw new Error(`[${label}] ${check.name}: ${fmt(got)} must not appear at ${at}`);
    }
  });

  (scenario.colors ?? []).forEach((check, i) => {
    const got = img.counts[i];
    const where = `count=${got.count} rows ${got.minY}..${got.maxY} cols ${got.minX}..${got.maxX}`;
    if (check.count !== undefined) {
      const slack = Math.max(4, Math.round(check.count * (check.tolerance ?? 0.02)));
      if (Math.abs(got.count - check.count) > slack) {
        throw new Error(
          `[${label}] ${check.name}: expected ${check.count} ±${slack} pixels of ${fmt(check.rgb)}, ${where}`
        );
      }
    }
    if (check.minCount !== undefined && got.count < check.minCount) {
      throw new Error(`[${label}] ${check.name}: expected ≥${check.minCount} pixels of ${fmt(check.rgb)}, ${where}`);
    }
    if (check.maxCount !== undefined && got.count > check.maxCount) {
      throw new Error(`[${label}] ${check.name}: expected ≤${check.maxCount} pixels of ${fmt(check.rgb)}, ${where}`);
    }
    if (check.topY !== undefined && Math.abs(got.minY - check.topY) > 2) {
      throw new Error(`[${label}] ${check.name}: topmost row ${got.minY}, expected ${check.topY}`);
    }
    if (check.bottomY !== undefined) {
      const want = check.bottomY < 0 ? img.height + check.bottomY : check.bottomY;
      if (Math.abs(got.maxY - want) > 2) {
        throw new Error(`[${label}] ${check.name}: bottommost row ${got.maxY}, expected ${want}`);
      }
    }
  });

  if (seq) {
    const base = (scenario.points ?? []).length;
    const decoded = seqPoints.map((_, i) => decodeIndex(img.pixels[base + i] ?? [0, 0, 0]));
    console.log(`[${label}] band sequence:`, decoded.join(' '));
    decoded.forEach((got, i) => {
      const want = (seq.first ?? 0) + i;
      if (got !== want) {
        throw new Error(
          `[${label}] band ${want} at y=${img.points[base + i].y} decoded as ${got === null ? fmt(img.pixels[base + i]) : got}` +
            ' - a repeated frame, a skipped band or a mid-animation blend'
        );
      }
    });
  }
}

/**
 * The extension's background service worker, which the harness drives the capture
 * through and applies per-scenario settings from.
 * @param {Browser} browser
 */
async function backgroundWorker(browser) {
  const swTarget = await browser.waitForTarget(
    (/** @type {Target} */ t) => t.type() === 'service_worker' && t.url().endsWith('background.js'),
    { timeout: 15000 }
  );
  const worker = await swTarget.worker();
  if (!worker) throw new Error('The background service worker target had no worker');
  return worker;
}

/**
 * @param {import('puppeteer-core').WebWorker} worker
 * @param {Record<string, unknown>} settings
 */
async function applySettings(worker, settings) {
  await worker.evaluate(async (/** @type {Record<string, unknown>} */ patch) => {
    await chrome.storage.sync.clear();
    if (Object.keys(patch).length) await chrome.storage.sync.set(patch);
  }, settings);
}

/** Starts a capture of the active tab through the hook the background parks on itself. */
async function startCapture(worker, mode = 'full') {
  await worker.evaluate(async (/** @type {string} */ m) => {
    const hook = /** @type {typeof globalThis & { __screencappyStart(tab: chrome.tabs.Tab, mode: string): Promise<void> }} */ (
      globalThis
    );
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab to capture');
    await hook.__screencappyStart(tab, m);
  }, mode);
}

/**
 * @param {Browser} browser
 * @param {string} url
 * @param {Scenario} scenario
 * @param {{ base: string }} fixtures
 */
async function runScenario(browser, url, scenario, fixtures) {
  const label = `${BROWSER}/${scenario.name}`;
  const budget = scenario.maxMs ?? 60_000;
  const page = await browser.newPage();
  await page.setViewport(scenario.viewport ?? { width: 1200, height: 800 });
  await page.goto(url, { waitUntil: 'load' });

  const worker = await backgroundWorker(browser);
  await applySettings(worker, scenario.settings ?? {});

  const startedAt = Date.now();
  await startCapture(worker);

  const editorTarget = await browser.waitForTarget(
    (/** @type {Target} */ t) => t.url().includes('editor.html'),
    { timeout: budget }
  );
  const editor = await editorTarget.page();
  if (!editor) throw new Error(`[${label}] The editor target had no page`);
  await editor.waitForSelector('#loading[hidden]', { timeout: budget });
  const elapsed = Date.now() - startedAt;

  const dims = await editor.$eval('#statDims', (el) => el.textContent);
  const record = await readRecord(editor);

  console.log(
    `[${label}] editor reports:`,
    dims,
    `after ${elapsed}ms (${record.engine}, ${record.tileCount} tiles${record.truncated ? ', truncated' : ''})`
  );
  const { w, h } = assertComposed(label, dims, scenario);

  if (scenario.maxMs && elapsed > scenario.maxMs) {
    throw new Error(`[${label}] took ${elapsed}ms, over the ${scenario.maxMs}ms ceiling`);
  }

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
  await checkPixels(label, editor, scenario);

  if (scenario.requested) {
    const log = await (await fetch(`${fixtures.base}/img-log`)).json();
    const missing = scenario.requested.filter((p) => !log.includes(p));
    if (missing.length) {
      throw new Error(
        `[${label}] the page never requested ${missing.length} of ${scenario.requested.length} images` +
          ` (first missing: ${missing[0]}); the engine scrolled past them without letting them load`
      );
    }
  }

  await mkdir(`${ROOT}.scratch`, { recursive: true });
  await editor.screenshot({ path: `${ROOT}.scratch/e2e-${BROWSER}-${scenario.name}.png` });
  console.log(`✓ [${label}] stitched to ${w}×${h}${scenario.gap ? ` (known gap: ${scenario.gap})` : ''}`);

  // Close both tabs so the next scenario's editor is the only editor.html target.
  await editor.close();
  await page.close();
  await applySettings(worker, {});
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

  // ONLY=reveal,furniture narrows the run while iterating on one fixture.
  const only = process.env.ONLY?.split(',').filter(Boolean);
  const scenarios = [...SCENARIOS, ...GAUNTLET].filter((s) => !only || only.includes(s.name));

  let failed = false;
  try {
    for (const scenario of scenarios) {
      await runScenario(browser, `${fixtures.base}${scenario.path}`, scenario, fixtures);
    }
    console.log(`✓ e2e passed (${BROWSER}): ${scenarios.length} scenarios`);
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
