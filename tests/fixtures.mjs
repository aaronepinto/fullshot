/**
 * The fixture pages and the dimensions a capture must reach, shared by the
 * Chromium e2e (tests/e2e.mjs) and the Firefox e2e (tests/e2e-firefox.mjs) so the
 * two drivers cannot drift into asserting different things.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const ROOT = new URL('..', import.meta.url).pathname;

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

export async function startFixtureServer() {
  /** @type {Record<string, Buffer>} */
  const pages = {
    '/': await readFile(`${ROOT}tests/fixture.html`),
    '/container': await readFile(`${ROOT}tests/fixture-container.html`),
    '/virtualized': await readFile(`${ROOT}tests/fixture-virtualized.html`),
    '/mail': await readFile(`${ROOT}tests/fixture-mail.html`),
    '/hijack': await readFile(`${ROOT}tests/fixture-hijack.html`),
  };
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    // Fixtures take query parameters of their own, so route on the path alone.
    const path = (req.url ?? '/').split('?', 1)[0];
    res.end(pages[path] ?? pages['/']);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The fixture server did not bind to a TCP port');
  }
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => server.close(),
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
