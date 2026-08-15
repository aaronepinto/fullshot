/**
 * Renders the screencappy product icon.
 *
 * Same pipeline as the smollet monogram in the umbrella site's
 * scripts/gen-smollet-assets.mjs: exact SVG geometry, laid out in fractions of
 * the icon box, rasterised by a real browser at each target size. Nothing here
 * is drawn by hand or by eye. Every coordinate below is a number, and the two
 * variants are the same numbers with a different treatment, so the mark cannot
 * drift between sizes.
 *
 * The mark is a smollet family tile holding a tall page being captured: a slim
 * vertical page in thin ink, its bottom edge left open with two fading dashes
 * under it because the page carries on past the frame, viewfinder brackets on
 * its top two corners, and one sky blue dot by the right bracket as the live
 * indicator. Full page capture, stated in the smallest number of marks that
 * still says it.
 *
 *   src/icons/icon16.png      toolbar, small
 *   src/icons/icon32.png      toolbar, retina
 *   src/icons/icon48.png      extensions page
 *   src/icons/icon128.png     install dialog and store
 *   src/icons/icon128-store.png   96 of artwork centred on a transparent 128
 *
 * Usage: node scripts/gen-icons.mjs   (requires a local Chrome; override the
 * binary with CHROME=/path/to/chrome)
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const OUT = new URL('../src/icons/', import.meta.url).pathname;

const INK = '#0a0a0c';
const CREAM = '#faf6ec';
const SKY = '#38bdf8';

/** The smollet family tile, shared with the monogram. Do not diverge. */
const TILE = {
  radius: 0.335,
  stroke: 0.015,
};

/**
 * Below this size the outlined treatment collapses: the page becomes a two
 * pixel wide box, the brackets stop being brackets, and the dot is a stray
 * speck. The monogram has the same cliff and answers it the same way, by
 * inverting to a solid ink tile carrying a solid cream mark. Kept in step with
 * SOLID_BELOW in scripts/gen-smollet-assets.mjs.
 */
const SOLID_BELOW = 40;

/**
 * And below this size the brackets go too. At 16 the whole mark is sixteen
 * pixels across: a bracket is then a single pixel of stroke with a pixel and a
 * half of arm, sitting one pixel from the page, and antialiasing spreads that
 * into two grey nubs fused to the page's shoulders. Dropping them leaves the
 * page alone in the tile, which is the same silhouette with one fewer thing to
 * lose, and is the correct answer at a size where detail cannot be drawn. The
 * page widens to take the room the brackets were holding.
 */
const BRACKETS_BELOW = 24;

/**
 * The outlined mark, in fractions of the icon box.
 *
 * The page is `width` wide and `width * aspect` tall. Its top corners are
 * rounded and its sides simply stop at the bottom, so there is no bottom edge
 * to close it; the dashes below continue the line the sides were on. The
 * brackets sit `bracketGap` clear of the page's top corners, and the dot sits
 * outside the right bracket's vertex on the diagonal, far enough out that it
 * stays a separate mark at 48 rather than fusing with the bracket.
 */
const OUTLINE = {
  width: 0.23,
  // The low end of "two and a half times taller than wide". The ratio is the
  // idea of the mark, so it is not negotiable by much, but every tenth above
  // this has to be paid for out of the page's width, and a page narrow enough
  // to fit a taller ratio stops reading as a page and starts reading as a slot.
  aspect: 2.5,
  top: 0.18,
  // A sixth of the width. Rounder than this and the top of the page turns into
  // the top of a capsule.
  radius: 0.036,
  stroke: 0.022,
  bracketGap: 0.072,
  // Comfortably shorter than the gap. The arm only has to state the direction
  // the corner turns; run it the full width of the gap and it arrives close
  // enough to the page's top corner to look welded to it.
  bracketArmX: 0.045,
  bracketArmY: 0.11,
  // The first dash is exactly the page's width, so it lands under the two sides
  // rather than between them: that is what makes the eye read a page carrying
  // on past the frame instead of a rule drawn underneath it. The second is
  // narrower and fainter, and the spacing opens up as they fall away.
  dashes: [
    { y: 0.822, width: 0.23, opacity: 0.45 },
    { y: 0.896, width: 0.15, opacity: 0.22 },
  ],
  // Outside the right bracket's vertex on the diagonal. Inside the crook is the
  // more obvious spot and does not survive 48px: at that size the clearance to
  // the bracket and to the page both fall under a pixel and the three fuse.
  dot: { x: 0.737, y: 0.066, r: 0.023 },
};

/**
 * The solid mark, for 16 and 32.
 *
 * Same composition as the outline, rebuilt for the pixel grid it has to survive
 * on rather than scaled down onto it. The page is filled instead of outlined,
 * because at these sizes an outlined page is one pixel of stroke around one
 * pixel of counter and the counter greys out, where a filled page is an
 * unambiguous shape at any size. The proportions are looser than the outline's
 * for the same reason: at the outline's ratio a filled page reads as a bar.
 *
 * At 32 this leaves 2px of bracket, 2px of clear air and 10px of page, and all
 * of it is snapped to whole pixels before it is drawn. Scaled straight down
 * without that snapping the brackets landed on half pixels and painted grey.
 */
const SOLID = {
  width: 0.31,
  aspect: 2.0,
  top: 0.22,
  radius: 0.055,
  // Wide enough that the page and the bracket stay two marks at 32, tight
  // enough that the bracket still belongs to the corner it is framing.
  bracketGap: 0.08,
  // The horizontal arm never exceeds the gap, or it reaches over the page.
  bracketArmX: 0.078,
  bracketArmY: 0.125,
  // Used at the sizes that carry no brackets, see BRACKETS_BELOW. Wider than
  // the bracketed page because it no longer has to leave room either side, and
  // set higher so that at the full 2.0 ratio the bottom corners stay inside the
  // tile: the tile is a squircle, so the width available at the page's bottom
  // edge is less than the width of the box.
  widthAlone: 0.34,
  topAlone: 0.185,
  // Whole pixels only. A stroke that lands on a fraction of a pixel at these
  // sizes is a grey smudge, and grey is the one thing a two-colour mark this
  // small cannot spend.
  stroke: 0.0625,
};

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
  if (!found) throw new Error('Chrome not found, set CHROME=/path/to/chrome');
  return found;
}

const n = (v) => Number(v.toFixed(3));

/**
 * Pixel snapping, for the small sizes only.
 *
 * A filled edge is crisp when it falls on a pixel boundary. A stroke is crisp
 * when its centre line falls on a boundary for an even width and on a half for
 * an odd one, because the stroke spreads half its width either side. Ignoring
 * this is what turned the 32px brackets grey: the geometry is derived from
 * fractions of the box, so the coordinates landed wherever the arithmetic put
 * them, and a two pixel stroke centred on x.48 paints three columns of grey
 * instead of two of cream.
 */
const snapFill = (v) => Math.round(v);
const snapStroke = (v, width) => (width % 2 ? Math.round(v - 0.5) + 0.5 : Math.round(v));

/**
 * The page: rounded top corners, straight sides, no bottom edge. Drawn as an
 * open path rather than a rect so the bottom can genuinely be absent, which is
 * the whole point of the glyph.
 */
function pagePath(left, right, top, bottom, r) {
  return [
    `M ${n(left)} ${n(bottom)}`,
    `L ${n(left)} ${n(top + r)}`,
    `A ${n(r)} ${n(r)} 0 0 1 ${n(left + r)} ${n(top)}`,
    `L ${n(right - r)} ${n(top)}`,
    `A ${n(r)} ${n(r)} 0 0 1 ${n(right)} ${n(top + r)}`,
    `L ${n(right)} ${n(bottom)}`,
  ].join(' ');
}

/**
 * The filled page, for the solid mark: rounded top corners, square bottom, no
 * open edge. An open bottom needs two visible sides to be open between, which a
 * filled shape does not have; the flat bottom running low in the tile carries
 * the same "keeps going" reading at a size where nothing subtler survives.
 */
function pageFilledPath(left, right, top, bottom, r) {
  return [
    `M ${n(left)} ${n(bottom)}`,
    `L ${n(left)} ${n(top + r)}`,
    `A ${n(r)} ${n(r)} 0 0 1 ${n(left + r)} ${n(top)}`,
    `L ${n(right - r)} ${n(top)}`,
    `A ${n(r)} ${n(r)} 0 0 1 ${n(right)} ${n(top + r)}`,
    `L ${n(right)} ${n(bottom)}`,
    'Z',
  ].join(' ');
}

/**
 * One viewfinder bracket. `dir` is the direction the horizontal arm runs from
 * the vertex: +1 for the left bracket, whose arm runs right, and -1 for the
 * right one, whose arm runs left. Both therefore point inward, along the edges
 * of the page they are framing, which is what a viewfinder mark does. Pointing
 * them outward, as they were at first, turns each one into a hook facing away
 * from the subject and puts the right one's arm underneath the dot.
 *
 * The two arms are deliberately unequal. Equal arms give a square corner mark,
 * which against a page two and a half times taller than it is wide reads as a
 * serif on the page's top edge rather than as a frame around it; the long
 * vertical arm restates the subject's proportion. The horizontal arm is kept
 * shorter than the gap so it stops before it reaches the page and the two
 * shapes never touch.
 */
function bracketPath(x, y, armX, armY, dir) {
  return `M ${n(x + dir * armX)} ${n(y)} L ${n(x)} ${n(y)} L ${n(x)} ${n(y + armY)}`;
}

function outlineMark(size) {
  const g = OUTLINE;
  const stroke = size * g.stroke;
  const w = size * g.width;
  const left = size * 0.5 - w / 2;
  const right = size * 0.5 + w / 2;
  const top = size * g.top;
  const bottom = top + w * g.aspect;
  const gap = size * g.bracketGap;
  const armX = size * g.bracketArmX;
  const armY = size * g.bracketArmY;
  const dot = g.dot;

  const dashes = g.dashes
    .map(({ y, width, opacity }) => {
      const half = (size * width) / 2;
      return `<path d="M ${n(size * 0.5 - half)} ${n(size * y)} L ${n(size * 0.5 + half)} ${n(size * y)}" opacity="${opacity}" />`;
    })
    .join('\n    ');

  return `
  <g fill="none" stroke="${INK}" stroke-width="${n(stroke)}" stroke-linecap="round" stroke-linejoin="round">
    <path d="${pagePath(left, right, top, bottom, size * g.radius)}" />
    <path d="${bracketPath(left - gap, top - gap, armX, armY, 1)}" />
    <path d="${bracketPath(right + gap, top - gap, armX, armY, -1)}" />
    ${dashes}
  </g>
  <circle cx="${n(size * dot.x)}" cy="${n(size * dot.y)}" r="${n(size * dot.r)}" fill="${SKY}" />`;
}

function solidMark(size) {
  const g = SOLID;
  const brackets = size >= BRACKETS_BELOW;
  const stroke = Math.max(1, Math.round(size * g.stroke));
  const w = snapFill(size * (brackets ? g.width : g.widthAlone));
  const left = snapFill(size * 0.5 - w / 2);
  const right = left + w;
  const top = snapFill(size * (brackets ? g.top : g.topAlone));
  const bottom = top + snapFill(w * g.aspect);

  const page = `<path d="${pageFilledPath(left, right, top, bottom, size * g.radius)}" fill="${CREAM}" />`;
  if (!brackets) return `\n  ${page}`;

  const gap = Math.max(1, Math.round(size * g.bracketGap));
  const armX = Math.max(1, Math.round(size * g.bracketArmX));
  const armY = Math.max(1, Math.round(size * g.bracketArmY));
  const bx = (v) => snapStroke(v, stroke);

  return `
  ${page}
  <g fill="none" stroke="${CREAM}" stroke-width="${n(stroke)}" stroke-linecap="butt" stroke-linejoin="miter">
    <path d="${bracketPath(bx(left - gap), bx(top - gap), armX, armY, 1)}" />
    <path d="${bracketPath(bx(right + gap), bx(top - gap), armX, armY, -1)}" />
  </g>`;
}

/**
 * `variant` picks the treatment:
 *   'tile'   cream tile, thin ink border, outlined ink mark, sky dot
 *   'solid'  solid ink tile, no border, solid cream mark (see SOLID_BELOW)
 */
function icon(size, variant) {
  const solid = variant === 'solid';
  // The border is stroked on the path, so it straddles the edge. Insetting the
  // rect by half the stroke keeps the whole of it inside the icon box, which is
  // what the monogram's `border` does by virtue of being a CSS border.
  const stroke = Math.max(1, Math.round(size * TILE.stroke));
  const half = stroke / 2;
  const r = size * TILE.radius;
  const tile = solid
    ? `<rect x="0" y="0" width="${size}" height="${size}" rx="${n(r)}" ry="${n(r)}" fill="${INK}" />`
    : `<rect x="${n(half)}" y="${n(half)}" width="${n(size - stroke)}" height="${n(size - stroke)}"
        rx="${n(r - half)}" ry="${n(r - half)}" fill="${CREAM}" stroke="${INK}" stroke-width="${n(stroke)}" />`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${tile}${solid ? solidMark(size) : outlineMark(size)}
</svg>`;
}

function shell(body, width, height) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; background: transparent; }
    body { width: ${width}px; height: ${height}px; display: flex; align-items: center; justify-content: center; }
    svg { display: block; }
  </style></head><body>${body}</body></html>`;
}

async function render(page, html, width, height, out) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  const png = await page.screenshot({
    type: 'png',
    clip: { x: 0, y: 0, width, height },
    omitBackground: true,
  });
  writeFileSync(out, png);
  console.log(`icons/${out.split('/').pop()} (${width}x${height})`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    pipe: true,
    args: ['--no-first-run', '--hide-scrollbars', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [])],
  });

  try {
    const page = await browser.newPage();

    for (const size of [16, 32, 48, 128]) {
      const variant = size < SOLID_BELOW ? 'solid' : 'tile';
      await render(page, shell(icon(size, variant), size, size), size, size, `${OUT}icon${size}.png`);
    }

    // Chrome Web Store listing icon guideline: 96x96 of artwork centred on a
    // 128x128 transparent canvas. Not referenced by the manifest; uploaded to
    // the store listing form.
    await render(page, shell(icon(96, 'tile'), 128, 128), 128, 128, `${OUT}icon128-store.png`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
