/**
 * Static file server for the built editor page, used by the Playwright UX suite.
 * The editor is a plain HTML page: nothing about it needs an extension context
 * except four chrome.* calls, which the suite stubs. HTTP rather than file://
 * because Chromium's IndexedDB on file:// origins is unreliable.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const DIST = new URL('../../dist/', import.meta.url).pathname;
const PORT = Number(process.env.UX_PORT ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json',
};

if (!existsSync(join(DIST, 'editor.html'))) {
  console.error('dist/editor.html is missing - run `bun run build` first.');
  process.exit(1);
}

const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?', 1)[0]);
  const file = join(DIST, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => console.log(`editor fixtures on http://127.0.0.1:${PORT}`));
