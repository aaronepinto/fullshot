/**
 * Renders the Smollet brand images that cannot be authored as flat files,
 * because every one of them is set in Instrument Serif Italic and there is no
 * outline of that font in the repository:
 *
 *   site-smollet/public/icon-16.png        favicon
 *   site-smollet/public/icon-32.png        favicon
 *   site-smollet/public/icon-48.png        favicon
 *   site-smollet/public/apple-touch-icon.png   180, home screen
 *   site-smollet/public/icon.png           512, the master monogram
 *   site-smollet/public/og.png             1200x630, the link unfurl card
 *
 * The woff2 is inlined as a data URI, so the page renders with no network
 * access at all. Same approach as scripts/gen-og.mjs.
 *
 * The monogram geometry below was measured off the approved logo reference
 * rather than guessed: the squircle's straight-edge run gives the corner
 * radius, a horizontal scan across its middle gives the stroke weight, and the
 * glyph was separated from the ring by flood fill to give its height and
 * position as fractions of the box. Instrument Serif Italic sets a narrower S
 * than the reference drawing, so the height is what is matched; the width
 * follows from the typeface.
 *
 * Usage: node scripts/gen-smollet-assets.mjs   (requires a local Chrome;
 * override the binary with CHROME=/path/to/chrome)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('..', import.meta.url).pathname;
const PUBLIC = `${ROOT}site-smollet/public`;
const FONT = `${PUBLIC}/fonts/InstrumentSerif-Italic.woff2`;

const INK = '#0a0a0c';
const CREAM = '#faf6ec';
const PAPER = '#f0eeea';

/** Fractions of the monogram's box, measured off the approved reference. */
const MONO = {
  radius: 0.335,
  stroke: 0.015,
  fontSize: 0.6875,
  dx: -0.0527,
  dy: 0.0215,
};

/**
 * Below this pixel size the reference's hairline ring collapses: a 1px stroke
 * around a cream tile reads as noise in a browser tab, and the S loses the
 * counter that makes it legible. At those sizes the mark inverts to a solid
 * ink tile with a cream S, which holds the same silhouette at a glance.
 */
const SOLID_BELOW = 40;

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

/**
 * One monogram. `variant` picks the treatment:
 *   'tile'   cream tile, ink ring and ink S (the reference, for favicons)
 *   'solid'  solid ink tile, cream S (small sizes, see SOLID_BELOW)
 *   'onInk'  transparent tile, cream ring and cream S (for the ink OG card)
 */
function monogram(size, variant) {
  const stroke = Math.max(1, Math.round(size * MONO.stroke));
  const font = size * MONO.fontSize;
  const dx = size * MONO.dx;
  const dy = size * MONO.dy;
  const fill = variant === 'tile' ? CREAM : variant === 'solid' ? INK : 'transparent';
  const mark = variant === 'solid' ? CREAM : variant === 'onInk' ? PAPER : INK;
  const border = variant === 'solid' ? 0 : stroke;
  return `<div class="mono" style="
      width:${size}px; height:${size}px;
      border-radius:${MONO.radius * 100}%;
      border:${border}px solid ${mark};
      background:${fill};
    "><span style="
      font-size:${font}px; color:${mark};
      transform:translate(${dx}px, ${dy}px);
    ">S</span></div>`;
}

function shell(fontDataUri, body, css, bg) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face {
      font-family: 'Instrument Serif';
      font-style: italic;
      font-weight: 400;
      src: url('${fontDataUri}') format('woff2');
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: ${bg}; }
    .mono { display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .mono span {
      font-family: 'Instrument Serif', serif;
      font-style: italic; font-weight: 400; line-height: 1; display: block;
    }
    ${css}
  </style></head><body>${body}</body></html>`;
}

const OG_CSS = `
  body {
    width: 1200px; height: 630px;
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 96px; color: ${PAPER};
  }
  .lockup { display: flex; align-items: center; gap: 40px; }
  h1 {
    font: italic 400 150px/1 'Instrument Serif', serif;
    margin: 0; letter-spacing: -0.01em; text-transform: lowercase;
  }
  p {
    margin: 40px 0 0; max-width: 840px;
    font: 400 31px/1.45 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    color: rgba(240, 238, 234, 0.72);
  }
  hr { border: 0; border-top: 1px solid rgba(255,255,255,0.14); margin: 44px 0 0; width: 200px; }
`;

async function render(page, html, width, height, out, omitBackground = false) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({
    type: 'png',
    clip: { x: 0, y: 0, width, height },
    omitBackground,
  });
  await writeFile(out, png);
  console.log(`wrote ${out.replace(ROOT, '')} (${width}x${height})`);
}

/**
 * A vector twin of the monogram, for design use rather than for the favicon
 * links: SVG <text> needs the font, and an embedded @font-face is honoured
 * when the SVG is rendered as a document but not reliably when it is used as
 * an <img> or a favicon. The PNGs above stay the source of truth.
 */
function monogramSvg(fontDataUri, size = 512) {
  const stroke = size * MONO.stroke;
  const font = size * MONO.fontSize;
  const r = size * MONO.radius;
  const half = stroke / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Smollet">
  <title>Smollet</title>
  <defs><style>
    @font-face { font-family: 'Instrument Serif'; font-style: italic; font-weight: 400; src: url('${fontDataUri}') format('woff2'); }
    .ring { fill: ${CREAM}; stroke: ${INK}; stroke-width: ${stroke}; }
    .s { fill: ${INK}; font-family: 'Instrument Serif', Georgia, serif; font-style: italic; font-weight: 400; font-size: ${font}px; }
  </style></defs>
  <rect class="ring" x="${half}" y="${half}" width="${size - stroke}" height="${size - stroke}" rx="${r}" ry="${r}" />
  <text class="s" x="${size / 2 + size * MONO.dx}" y="${size / 2 + size * MONO.dy}" text-anchor="middle" dominant-baseline="central">S</text>
</svg>
`;
}

async function main() {
  const font = await readFile(FONT);
  const fontDataUri = `data:font/woff2;base64,${font.toString('base64')}`;

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    pipe: true,
    args: ['--no-first-run', '--hide-scrollbars', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [])],
  });

  try {
    const page = await browser.newPage();

    for (const [size, name] of [[16, 'icon-16'], [32, 'icon-32'], [48, 'icon-48'], [180, 'apple-touch-icon'], [512, 'icon']]) {
      const variant = size < SOLID_BELOW ? 'solid' : 'tile';
      const html = shell(fontDataUri, monogram(size, variant), 'body{display:flex}', 'transparent');
      await render(page, html, size, size, `${PUBLIC}/${name}.png`, true);
    }

    const og = shell(
      fontDataUri,
      `<div class="lockup">${monogram(132, 'onInk')}<h1>Smollet</h1></div>` +
        '<hr><p>Small, free, open source applications. Each one replaces a single-purpose product that used to be worth paying for.</p>',
      OG_CSS,
      INK
    );
    await render(page, og, 1200, 630, `${PUBLIC}/og.png`);
  } finally {
    await browser.close();
  }

  await writeFile(`${PUBLIC}/logo-monogram.svg`, monogramSvg(fontDataUri));
  console.log('wrote site-smollet/public/logo-monogram.svg (design asset, not a favicon)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
