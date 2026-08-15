/**
 * Renders site/og-template.html to site/public/og.png at exactly 1200x630, the
 * size link unfurlers expect for og:image.
 *
 * The extension icon is inlined into the template as a data URI, so the page
 * loads with no network access and no local file reads at render time.
 *
 * Usage: node scripts/gen-og.mjs   (requires a local Chrome; override the
 * binary with CHROME=/path/to/chrome)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const TEMPLATE = `${ROOT}site/og-template.html`;
const ICON = `${ROOT}src/icons/icon128.png`;
const OUT = `${ROOT}site/public/og.png`;

const WIDTH = 1200;
const HEIGHT = 630;

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

async function main() {
  const [template, icon] = await Promise.all([
    readFile(TEMPLATE, 'utf8'),
    readFile(ICON),
  ]);

  const PLACEHOLDER = '__ICON_DATA_URI__';
  if (!template.includes(PLACEHOLDER)) {
    throw new Error(`og-template.html has no ${PLACEHOLDER} placeholder`);
  }
  const html = template.replaceAll(
    PLACEHOLDER,
    `data:image/png;base64,${icon.toString('base64')}`
  );

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    pipe: true,
    args: [
      '--no-first-run',
      ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    const png = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    });
    await writeFile(OUT, png);
  } finally {
    await browser.close();
  }

  console.log(`wrote site/public/og.png (${WIDTH}x${HEIGHT})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
