// Generates the Screencappy toolbar/store icons as PNGs with zero dependencies.
// Design: rounded dark slate tile, sky-blue camera lens with a bright inner ring,
// and a small "full page" strip down the right edge.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../src/icons/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Signed distance helpers (in normalized 0..1 space, y down).
const sdRoundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
};
const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;

function drawRGBA(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 1.25 / size; // anti-alias width in normalized units
  const cover = (d) => Math.min(1, Math.max(0, 0.5 - d / (2 * aa)));
  const put = (i, r, g, b, a) => {
    const inv = 1 - a;
    rgba[i] = Math.round(r * a + rgba[i] * inv);
    rgba[i + 1] = Math.round(g * a + rgba[i + 1] * inv);
    rgba[i + 2] = Math.round(b * a + rgba[i + 2] * inv);
    rgba[i + 3] = Math.round(Math.min(255, a * 255 + rgba[i + 3] * inv));
  };
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size;
      const y = (py + 0.5) / size;
      const i = (py * size + px) * 4;
      // Tile
      let a = cover(sdRoundRect(x, y, 0.5, 0.5, 0.46, 0.46, 0.16));
      if (a > 0) put(i, 0x0a, 0x0a, 0x0c, a); // family ink
      // "Full page" strip along the right edge
      a = cover(sdRoundRect(x, y, 0.80, 0.5, 0.055, 0.30, 0.04));
      if (a > 0) put(i, 0x3a, 0x39, 0x36, a); // ink lifted toward cream
      for (const cy of [0.28, 0.44, 0.6, 0.76]) {
        a = cover(sdRoundRect(x, y, 0.80, cy, 0.038, 0.045, 0.02));
        if (a > 0) put(i, 0xfa, 0xf6, 0xec, a); // cream
      }
      // Lens (outer)
      a = cover(sdCircle(x, y, 0.42, 0.5, 0.24));
      if (a > 0) put(i, 0x38, 0xbd, 0xf8, a); // family accent
      // Lens ring
      const ring = Math.abs(sdCircle(x, y, 0.42, 0.5, 0.155)) - 0.035;
      a = cover(ring);
      if (a > 0) put(i, 0xfa, 0xf6, 0xec, a); // cream
      // Glint
      a = cover(sdCircle(x, y, 0.35, 0.42, 0.045));
      if (a > 0) put(i, 0xff, 0xff, 0xff, a * 0.9);
    }
  }
  return rgba;
}

const draw = (size) => png(size, size, drawRGBA(size));

for (const size of [16, 32, 48, 128]) {
  writeFileSync(`${OUT}icon${size}.png`, draw(size));
  console.log(`icons/icon${size}.png`);
}

// Chrome Web Store listing icon guideline: 96x96 of artwork centred on a
// 128x128 transparent canvas. Not referenced by the manifest; uploaded to
// the store listing form.
{
  const art = drawRGBA(96);
  const canvas = Buffer.alloc(128 * 128 * 4);
  for (let y = 0; y < 96; y++) {
    art.copy(canvas, ((y + 16) * 128 + 16) * 4, y * 96 * 4, (y + 1) * 96 * 4);
  }
  writeFileSync(`${OUT}icon128-store.png`, png(128, 128, canvas));
  console.log('icons/icon128-store.png');
}
