/**
 * The fixture pages and the dimensions a capture must reach, shared by the
 * Chromium e2e (tests/e2e.mjs) and the Firefox e2e (tests/e2e-firefox.mjs) so the
 * two drivers cannot drift into asserting different things.
 *
 * SCENARIOS is the cross-browser core: dimension-only assertions both drivers can
 * make. GAUNTLET is the Chromium-only set built from the failure-mode taxonomy; its
 * checks are pixel counts, colour sequences and request logs, which the Firefox
 * driver has no way to read out of the editor.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * @typedef {object} ColorCheck
 * @property {string} name Reported in the failure message.
 * @property {[number, number, number]} rgb Exact colour to count in the composed image.
 * @property {number} [count] Expected pixel count (within tolerance).
 * @property {number} [minCount] Lower bound when an exact count is not knowable.
 * @property {number} [maxCount] Upper bound.
 * @property {number} [tolerance] Fraction of `count` allowed either way, default 0.02.
 * @property {number} [topY] Expected topmost row holding the colour, ±2px.
 * @property {number} [bottomY] Expected bottommost row, ±2px; negative counts from the bottom.
 */

/**
 * @typedef {object} PointCheck
 * @property {string} name
 * @property {number} x Composed-image column; negative counts in from the right edge.
 * @property {number} y Composed-image row; negative counts up from the bottom edge.
 * @property {[number, number, number]} [rgb] Colour the pixel must be, exactly.
 * @property {[number, number, number]} [notRgb] Colour the pixel must not be.
 */

/**
 * @typedef {object} SequenceCheck
 * A column of index-encoded bands (see indexColor below) read top to bottom: the
 * decoded indices must be exactly 0, 1, 2 … so a duplicated frame, a skipped band
 * or a seam gap is a hard failure rather than a judgement call.
 * @property {number} x Column to sample; negative counts in from the right edge.
 * @property {number} y0 Row of the first band's sample point.
 * @property {number} dy Distance between band sample points.
 * @property {number} count How many bands to read.
 * @property {number} [first] Index the first band carries, default 0.
 */

/**
 * @typedef {object} Scenario
 * @property {string} name Label used in log lines and screenshot filenames.
 * @property {string} path Path to request from the fixture server.
 * @property {number} minW Narrowest composed width that still counts as a pass.
 * @property {number} minH Shortest composed height that still counts as a pass.
 * @property {number} [maxH] Tallest composed height, where overshooting is itself a bug.
 * @property {number} [maxW] Widest composed width, for pane-shaped captures.
 * @property {number[]} [samples] Height fractions to pixel-sample (Chromium harness only).
 * @property {string} [note] Substring the editor's status note must show; '' asserts none.
 * @property {{ width: number, height: number }} [viewport] Non-default window size.
 * @property {Record<string, unknown>} [settings] Extension settings to apply for this run.
 * @property {number} [maxMs] Wall-clock ceiling for the whole run, ms.
 * @property {ColorCheck[]} [colors] Per-colour pixel-count assertions.
 * @property {PointCheck[]} [points] Exact colours at fixed composed coordinates.
 * @property {SequenceCheck} [sequence] Index-encoded bands read down one column.
 * @property {string[]} [requested] Fixture-server paths that must all have been requested.
 * @property {string} [gap] Documented engine limitation this scenario pins down.
 */

/** @type {Scenario[]} */
export const SCENARIOS = [
  // 60px sticky header + 8 × 500px sections = 4060 CSS px, at any DPR ≥ 1.
  { name: 'full-page', path: '/', minW: 1100, minH: 4000 },
  // Gmail-style: the window never scrolls and an inner container holds 6 × 500px
  // sections, so the composed height must match the container content (3000px)
  // rather than the viewport.
  { name: 'container', path: '/container', minW: 1000, minH: 2950, maxH: 3100 },
  // Virtualized feed: 50 rows of 120px behind a spacer, streamed in over ~750ms after
  // each scroll. The samples sit 20px above the bottom edge of four different tiles,
  // where the last rows of that tile land, so a capture that shot early leaves white.
  { name: 'virtualized', path: '/virtualized', minW: 1100, minH: 5950, maxH: 6100, samples: [1580 / 6000, 3180 / 6000, 4780 / 6000, 5980 / 6000] },
  // Mail layout: the reading pane (75% wide, 2600px of content) must win over the
  // folder list beside it, so the capture is pane-shaped rather than window-shaped.
  { name: 'mail', path: '/mail', minW: 850, maxW: 950, minH: 2550, maxH: 2700 },
  // Scroll-jacked page: 6000px of reported height that nothing can scroll. The capture
  // must stay viewport-sized and say why, instead of stitching one repeated frame.
  { name: 'hijack', path: '/hijack', minW: 1100, maxW: 1300, minH: 700, maxH: 900, note: 'custom scrolling' },
  // The same page without the spacer is an ordinary one-viewport capture, no note.
  { name: 'hijack-nospacer', path: '/hijack?spacer=0', minW: 1100, maxW: 1300, minH: 700, maxH: 900, note: '' },
];

/**
 * Colour a fixture paints on band `i` so the harness can read the band's index back
 * out of a single pixel. Green and blue are fixed markers, so an unrelated colour can
 * never be mistaken for a band, and red carries the index.
 */
export function indexColor(i) {
  return [6 + i, 90, 160];
}

/** The index encoded in a sampled pixel, or null when it is not a band colour. */
export function decodeIndex([r, g, b]) {
  return g === 90 && b === 160 ? r - 6 : null;
}

/** Solid colours the furniture fixture paints its pinned elements, shared with the checks. */
export const FURNITURE = {
  header: /** @type {[number, number, number]} */ ([14, 165, 233]),
  bottomBar: /** @type {[number, number, number]} */ ([220, 38, 38]),
  rail: /** @type {[number, number, number]} */ ([22, 163, 74]),
  fab: /** @type {[number, number, number]} */ ([234, 179, 8]),
  cookie: /** @type {[number, number, number]} */ ([147, 51, 234]),
};

/** Geometry the furniture fixture and its assertions both depend on. */
export const FURNITURE_BOX = {
  pageW: 1200,
  pageH: 4000,
  headerH: 60,
  barH: 56,
  railW: 72,
  fabW: 56,
  fabH: 56,
  fabBottom: 80,
  cookieW: 400,
  cookieH: 40,
  cookieBottom: 160,
};

/** Gauntlet fixture pages, added to the routes the fixture server serves. */
const GAUNTLET_PAGES = {
  '/reveal': 'fixture-reveal.html',
  '/furniture': 'fixture-furniture.html',
  '/lazy': 'fixture-lazy.html',
  '/tall': 'fixture-tall.html',
  '/parallax': 'fixture-parallax.html',
  '/modal': 'fixture-modal.html',
  '/clipped': 'fixture-clipped.html',
  '/embed': 'fixture-embed.html',
  '/embed-inner': 'fixture-embed-inner.html',
};

/** The page behind the modal, which must not reach the composed image at all. */
const MODAL_BEHIND = /** @type {[number, number, number]} */ ([120, 120, 120]);

/** The bands at each end of the tall fixture. */
const TALL = {
  top: /** @type {[number, number, number]} */ ([14, 165, 233]),
  bottom: /** @type {[number, number, number]} */ ([236, 72, 153]),
};

/** Every image path the lazy fixture is expected to have asked the server for. */
const LAZY_IMAGES = Array.from({ length: 25 }, (_, i) => `/img/${i}.png`);

/** Pixel counts the furniture fixture's geometry works out to, over a 1200px page. */
const FURN = {
  full: (h) => (1200 - FURNITURE_BOX.railW) * h,
  rail: (h) => FURNITURE_BOX.railW * h,
};

/**
 * Chromium-only scenarios built from the failure-mode taxonomy. Each one reproduces a
 * construct that competitors are reported to get wrong, and asserts the pixels rather
 * than only the dimensions.
 * @type {Scenario[]}
 */
export const GAUNTLET = [
  // Reveal-on-scroll: 12 × 500px sections that start transparent and 48px low, with an
  // IntersectionObserver clearing both over 400ms. A capture that shoots while a section
  // is mid-transition gets a blend toward white at the wrong offset, which is the
  // mechanism behind a large share of the "blank" and "cut off" reports.
  {
    name: 'reveal',
    path: '/reveal',
    minW: 1100,
    minH: 6000,
    maxH: 6000,
    maxMs: 60_000,
    sequence: { x: 60, y0: 250, dy: 500, count: 12 },
  },
  // The same page with a 1500ms transition, well past any settle budget: waiting cannot
  // save this one, only neutralising the transition can.
  {
    name: 'reveal-slow',
    path: '/reveal?dur=1500',
    minW: 1100,
    minH: 6000,
    maxH: 6000,
    maxMs: 60_000,
    sequence: { x: 60, y0: 250, dy: 500, count: 12 },
  },
  // Scroll-driven animation variant: progress is tied to the scroll position through
  // animation-timeline: view(), so there is no time to wait for at all. Pausing such an
  // animation freezes it at whatever progress it had, which for a section below the fold
  // is fully transparent.
  {
    name: 'reveal-timeline',
    path: '/reveal?mode=timeline',
    minW: 1100,
    minH: 6000,
    maxH: 6000,
    maxMs: 60_000,
    sequence: { x: 60, y0: 250, dy: 500, count: 12 },
  },
  // Pinned furniture on all four edges. The counts below are the geometry worked out:
  // each pinned element must contribute its own area exactly once, at the edge it is
  // pinned to, and the full-height rail must run the whole composed image rather than
  // stopping after the first screen.
  {
    name: 'furniture',
    path: '/furniture',
    minW: 1200,
    maxW: 1200,
    minH: 4000,
    maxH: 4000,
    note: '',
    maxMs: 60_000,
    colors: [
      { name: 'sticky header', rgb: FURNITURE.header, count: FURN.full(FURNITURE_BOX.headerH), topY: 0, bottomY: FURNITURE_BOX.headerH - 1 },
      { name: 'bottom bar', rgb: FURNITURE.bottomBar, count: FURN.full(FURNITURE_BOX.barH), bottomY: -1 },
      { name: 'left rail', rgb: FURNITURE.rail, count: FURN.rail(FURNITURE_BOX.pageH), topY: 0, bottomY: -1 },
      { name: 'floating button', rgb: FURNITURE.fab, count: FURNITURE_BOX.fabW * FURNITURE_BOX.fabH, bottomY: -(FURNITURE_BOX.fabBottom + 1) },
      { name: 'cookie banner', rgb: FURNITURE.cookie, count: FURNITURE_BOX.cookieW * FURNITURE_BOX.cookieH, bottomY: -(FURNITURE_BOX.cookieBottom + 1) },
    ],
    sequence: { x: 600, y0: 257, dy: 394, count: 10 },
  },
  // One viewport of page, where hiding any of the five would itself be the bug.
  {
    name: 'furniture-single',
    path: '/furniture?tiles=1',
    minW: 1200,
    maxW: 1200,
    minH: 800,
    maxH: 800,
    note: '',
    maxMs: 30_000,
    colors: [
      { name: 'sticky header', rgb: FURNITURE.header, count: FURN.full(FURNITURE_BOX.headerH), topY: 0 },
      { name: 'bottom bar', rgb: FURNITURE.bottomBar, count: FURN.full(FURNITURE_BOX.barH), bottomY: -1 },
      { name: 'left rail', rgb: FURNITURE.rail, count: FURN.rail(800), topY: 0, bottomY: -1 },
      { name: 'floating button', rgb: FURNITURE.fab, count: FURNITURE_BOX.fabW * FURNITURE_BOX.fabH, bottomY: -(FURNITURE_BOX.fabBottom + 1) },
      { name: 'cookie banner', rgb: FURNITURE.cookie, count: FURNITURE_BOX.cookieW * FURNITURE_BOX.cookieH, bottomY: -(FURNITURE_BOX.cookieBottom + 1) },
    ],
  },
  // Deferred media: 20 native loading="lazy" images and 5 swapped in by an
  // IntersectionObserver, each a solid colour encoding its own index, each delayed by the
  // server. The band sequence catches a placeholder as surely as a duplicated tile.
  {
    name: 'lazy',
    path: '/lazy',
    minW: 1200,
    maxW: 1200,
    minH: 10_000,
    maxH: 10_000,
    note: '',
    maxMs: 90_000,
    requested: LAZY_IMAGES,
    sequence: { x: 400, y0: 200, dy: 400, count: 25 },
  },
  // The same page with responses 2s late, well past any per-tile settle: the engine has
  // to hold the shot for content it can see is still on its way.
  {
    name: 'lazy-slow',
    path: '/lazy?delay=2000',
    minW: 1200,
    maxW: 1200,
    minH: 10_000,
    maxH: 10_000,
    maxMs: 120_000,
    requested: LAZY_IMAGES,
    sequence: { x: 400, y0: 200, dy: 400, count: 25 },
  },
  // 20000px, past Chrome's 16384px compositor texture limit, which is where competitors
  // crop without saying so. The bottom band has to be at the bottom of the image.
  {
    name: 'tall-20k',
    path: '/tall?h=20000',
    minW: 1200,
    maxW: 1200,
    minH: 20_000,
    maxH: 20_000,
    note: '',
    maxMs: 120_000,
    points: [
      { name: 'top band', x: 600, y: 100, rgb: TALL.top },
      { name: 'bottom band', x: 600, y: -100, rgb: TALL.bottom },
      { name: 'last row', x: 600, y: -2, rgb: TALL.bottom },
    ],
  },
  // 40000px is the capture ceiling itself, and the memory-pressure case: an engine
  // holding every tile as a live canvas does not get here.
  {
    name: 'tall-40k',
    path: '/tall?h=40000',
    minW: 1200,
    maxW: 1200,
    minH: 40_000,
    maxH: 40_000,
    note: '',
    maxMs: 240_000,
    points: [
      { name: 'top band', x: 600, y: 100, rgb: TALL.top },
      { name: 'last row', x: 600, y: -2, rgb: TALL.bottom },
    ],
  },
  // 2^25 px, the height a real docs site was observed reporting. There is no honest
  // capture of a page like this, so the contract is a fast, explained degradation
  // rather than forty seconds of walking a spacer.
  {
    name: 'tall-implausible',
    path: '/tall?h=33554432',
    minW: 1200,
    maxW: 1200,
    minH: 700,
    maxH: 900,
    note: 'implausible height',
    maxMs: 30_000,
    points: [{ name: 'top band', x: 600, y: 100, rgb: TALL.top }],
  },
  // Viewport-glued backgrounds, the witness for the shipped fix. The page background is
  // eight index-encoded bands: pinned to scroll they run 0 to 7 down the image, glued to
  // the viewport they restart in every tile. The element-level fixed layer and the
  // untouched local control are two points each.
  {
    name: 'parallax',
    path: '/parallax',
    minW: 1200,
    maxW: 1200,
    minH: 4800,
    maxH: 4800,
    note: '',
    maxMs: 60_000,
    sequence: { x: 1100, y0: 300, dy: 600, count: 8 },
    points: [
      { name: 'fixed layer, top half', x: 200, y: 1350, rgb: [255, 0, 0] },
      { name: 'fixed layer, bottom half', x: 200, y: 1650, rgb: [0, 0, 255] },
      { name: 'local control, top half', x: 200, y: 1950, rgb: [0, 200, 0] },
      { name: 'local control, bottom half', x: 200, y: 2250, rgb: [200, 200, 0] },
    ],
    colors: [
      { name: 'sticky parallax layer', rgb: [255, 140, 0], count: 400 * 200, tolerance: 0.05 },
    ],
  },
  // Scroll-locked body, 4000px of page behind, and 2600px of what the user actually wants
  // inside a fixed panel that scrolls on its own. The capture has to be the panel: its
  // width, its height, and none of the page behind it.
  {
    name: 'modal',
    path: '/modal',
    minW: 1100,
    maxW: 1125,
    minH: 2600,
    maxH: 2600,
    note: '',
    maxMs: 60_000,
    sequence: { x: 560, y0: 100, dy: 200, count: 13 },
    colors: [{ name: 'the page behind the modal', rgb: MODAL_BEHIND, maxCount: 0 }],
  },
  // The same panel in the top layer, where hit testing and painting both differ.
  {
    name: 'modal-native',
    path: '/modal?native=1',
    minW: 1100,
    maxW: 1125,
    minH: 2600,
    maxH: 2600,
    note: '',
    maxMs: 60_000,
    sequence: { x: 560, y0: 100, dy: 200, count: 13 },
    colors: [{ name: 'the page behind the modal', rgb: MODAL_BEHIND, maxCount: 0 }],
  },
  // A wrapper clipping 4000px to 100vh with nothing on the page able to scroll. The
  // document really is one viewport tall, so the honest capture is one viewport - plus a
  // note, because a one-screen image that looks like the whole page is the complaint.
  {
    name: 'clipped',
    path: '/clipped',
    minW: 1200,
    maxW: 1200,
    minH: 800,
    maxH: 800,
    note: 'cannot be scrolled',
    maxMs: 30_000,
    points: [{ name: 'first band', x: 600, y: 200, rgb: indexColor(0) }],
  },
  // The same page with a scrollable wrapper: all 4000px, and nothing to warn about.
  {
    name: 'clipped-fixed',
    path: '/clipped?fix=1',
    minW: 1150,
    maxW: 1200,
    minH: 4000,
    maxH: 4000,
    note: '',
    maxMs: 60_000,
    sequence: { x: 600, y0: 200, dy: 400, count: 10 },
  },
  // A single full-bleed same-origin iframe holding 5000px of paginated document, so the
  // outer page's height is exactly one viewport. All 25 pages have to be in the capture.
  {
    name: 'embed-iframe',
    path: '/embed',
    minW: 1150,
    maxW: 1200,
    minH: 5000,
    maxH: 5000,
    note: '',
    maxMs: 60_000,
    sequence: { x: 600, y0: 100, dy: 200, count: 25 },
  },
  // The same document behind an <embed>, which is what Chrome's PDF viewer uses and which
  // exposes no document to reach through. The contract is the honest fallback: the
  // visible area plus a note saying why, never a silent one-page image.
  {
    name: 'embed-plugin',
    path: '/embed?tag=embed',
    minW: 1200,
    maxW: 1200,
    minH: 800,
    maxH: 800,
    note: 'embedded viewer',
    maxMs: 30_000,
    gap: 'the scroll-and-stitch engine cannot reach inside <embed>',
  },
];

// ---------------------------------------------------------------------------
// Fixture server
// ---------------------------------------------------------------------------

const PAGES = {
  '/': 'fixture.html',
  '/container': 'fixture-container.html',
  '/virtualized': 'fixture-virtualized.html',
  '/mail': 'fixture-mail.html',
  '/hijack': 'fixture-hijack.html',
};

/** PNG chunk CRC, table built once. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * A solid-colour PNG, encoded here rather than pulled from a package: the fixture
 * server stays dependency-free, and the exact bytes of the colour are what the pixel
 * assertions compare against.
 */
function solidPng(w, h, [r, g, b]) {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const pngCache = new Map();
function bandPng(index) {
  let png = pngCache.get(index);
  if (!png) {
    png = solidPng(800, 300, indexColor(index));
    pngCache.set(index, png);
  }
  return png;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Serves the fixture pages plus two things the gauntlet needs: image responses the
 * server can delay on demand (so "did the engine wait for the lazy image?" is a real
 * question), and a log of which image paths were ever requested (so "did the engine
 * even ask?" is answerable separately from "did it wait?").
 *
 * A second server on its own port acts as a foreign origin for the iframe fixture:
 * same loopback host, different port, so cross-origin behaviour is exercised without
 * the browser ever leaving the machine.
 */
export async function startFixtureServer() {
  /** @type {Record<string, string>} */
  const pages = {};
  for (const [route, file] of Object.entries(PAGES)) {
    pages[route] = await readFile(`${ROOT}tests/${file}`, 'utf8');
  }
  for (const [route, file] of Object.entries(GAUNTLET_PAGES)) {
    pages[route] = await readFile(`${ROOT}tests/${file}`, 'utf8');
  }

  /** @type {string[]} */
  let imageLog = [];

  const listen = (handler) =>
    new Promise((resolve) => {
      const server = createServer(handler);
      server.listen(0, '127.0.0.1', () => resolve(server));
    });

  const portOf = (server) => {
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('The fixture server did not bind to a TCP port');
    }
    return address.port;
  };

  // The foreign-origin server comes up first so its base URL can be substituted into
  // the pages the main server hands out.
  const alt = await listen((req, res) => {
    const path = (req.url ?? '/').split('?', 1)[0];
    res.setHeader('content-type', 'text/html');
    res.end(pages[path] ?? pages['/']);
  });
  const altBase = `http://127.0.0.1:${portOf(alt)}`;

  const main = await listen(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    if (path === '/img-log') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(imageLog));
      return;
    }
    if (path.startsWith('/img/')) {
      imageLog.push(path);
      const index = Number(path.slice('/img/'.length).replace('.png', ''));
      const delay = Number(url.searchParams.get('delay') ?? 0);
      if (delay > 0) await sleep(delay);
      res.setHeader('content-type', 'image/png');
      res.setHeader('cache-control', 'no-store');
      res.end(bandPng(Number.isFinite(index) ? index : 0));
      return;
    }
    // Loading a page starts a fresh request log, so each scenario reads only its own.
    if (path === '/lazy') imageLog = [];
    res.setHeader('content-type', 'text/html');
    res.end((pages[path] ?? pages['/']).replaceAll('__ALT_ORIGIN__', altBase));
  });

  return {
    base: `http://127.0.0.1:${portOf(main)}`,
    altBase,
    imageLog: () => imageLog.slice(),
    close: () => {
      main.close();
      alt.close();
    },
  };
}

/**
 * Parses the editor's "W × H" stat and checks it against a scenario's bounds.
 * @param {string} label Browser and scenario, for the error message.
 * @param {string | null} text The editor's #statDims text.
 * @param {Scenario} scenario
 */
export function assertComposed(label, text, { minW, maxW, minH, maxH }) {
  const m = /(\d+)\s*×\s*(\d+)/.exec(text ?? '');
  if (!m) throw new Error(`[${label}] Could not parse dimensions from "${text}"`);
  const [w, h] = [Number(m[1]), Number(m[2])];
  if (w < minW) throw new Error(`[${label}] Composed width ${w} < expected ${minW}`);
  if (maxW && w > maxW) throw new Error(`[${label}] Composed width ${w} > expected max ${maxW}`);
  if (h < minH) {
    throw new Error(`[${label}] Composed height ${h} < expected ${minH} - stitching incomplete`);
  }
  if (maxH && h > maxH) throw new Error(`[${label}] Composed height ${h} > expected max ${maxH}`);
  return { w, h };
}
