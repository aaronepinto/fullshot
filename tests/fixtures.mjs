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
 */

/** @type {Scenario[]} */
export const SCENARIOS = [
  // 60px sticky header + 8 × 500px sections = 4060 CSS px, at any DPR ≥ 1.
  { name: 'full-page', path: '/', minW: 1100, minH: 4000 },
  // Gmail-style: the window never scrolls and an inner container holds 6 × 500px
  // sections, so the composed height must match the container content (3000px)
  // rather than the viewport.
  { name: 'container', path: '/container', minW: 1000, minH: 2950, maxH: 3100 },
];

export async function startFixtureServer() {
  /** @type {Record<string, Buffer>} */
  const pages = {
    '/': await readFile(`${ROOT}tests/fixture.html`),
    '/container': await readFile(`${ROOT}tests/fixture-container.html`),
  };
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(pages[req.url ?? '/'] ?? pages['/']);
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
export function assertComposed(label, text, { minW, minH, maxH }) {
  const m = /(\d+)\s*×\s*(\d+)/.exec(text ?? '');
  if (!m) throw new Error(`[${label}] Could not parse dimensions from "${text}"`);
  const [w, h] = [Number(m[1]), Number(m[2])];
  if (w < minW) throw new Error(`[${label}] Composed width ${w} < expected ${minW}`);
  if (h < minH) {
    throw new Error(`[${label}] Composed height ${h} < expected ${minH} - stitching incomplete`);
  }
  if (maxH && h > maxH) throw new Error(`[${label}] Composed height ${h} > expected max ${maxH}`);
  return { w, h };
}
