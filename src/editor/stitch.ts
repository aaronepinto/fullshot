/**
 * Composes captured tiles into a strip-backed BigImage. Strips (≤4096px tall each)
 * mean no single canvas ever exceeds browser limits, so arbitrarily tall pages work.
 * After the first compose, strips are persisted and the raw tiles are dropped.
 */
import {
  deleteTiles,
  getStrips,
  getTiles,
  putCapture,
  putStrip,
} from '../lib/db';
import { EDITOR_LIMITS, type CaptureRecord } from '../lib/types';

export interface BigImage {
  width: number;
  height: number;
  strips: { y: number; h: number; bmp: ImageBitmap }[];
  drawRegion(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ): void;
}

function makeBigImage(
  width: number,
  height: number,
  strips: { y: number; h: number; bmp: ImageBitmap }[]
): BigImage {
  return {
    width,
    height,
    strips,
    drawRegion(ctx, sx, sy, sw, sh, dx, dy, dw, dh) {
      if (sw < 1 || sh < 1) return;
      const scaleY = dh / sh;
      for (const strip of strips) {
        const top = Math.max(sy, strip.y);
        const bottom = Math.min(sy + sh, strip.y + strip.h);
        if (bottom <= top) continue;
        ctx.drawImage(
          strip.bmp,
          sx,
          top - strip.y,
          sw,
          bottom - top,
          dx,
          dy + (top - sy) * scaleY,
          dw,
          (bottom - top) * scaleY
        );
      }
    },
  };
}

export async function loadBigImage(record: CaptureRecord): Promise<BigImage> {
  if (record.status === 'composed') {
    const stored = await getStrips(record.id);
    const strips = await Promise.all(
      stored.map(async (s) => ({ y: s.y, h: s.h, bmp: await createImageBitmap(s.blob) }))
    );
    return makeBigImage(record.width, record.height, strips);
  }
  return composeFromTiles(record);
}

async function composeFromTiles(record: CaptureRecord): Promise<BigImage> {
  const tiles = await getTiles(record.id);
  if (!tiles.length) throw new Error('Capture data not found — it may have been pruned.');

  // Derive the device-pixel scale from the first tile's actual bitmap size. Browser
  // zoom and DPR are both captured by this single factor.
  const first = await createImageBitmap(tiles[0]!.blob);
  const scale = tiles[0]!.cssW > 0 ? first.width / tiles[0]!.cssW : 1;
  const width = Math.max(1, Math.round(record.clip.w * scale));
  const height = Math.max(1, Math.round(record.clip.h * scale));

  const stripCount = Math.ceil(height / EDITOR_LIMITS.stripH);
  const strips: { y: number; h: number; bmp: ImageBitmap }[] = [];

  // Decode tiles lazily per strip to keep peak memory bounded on huge pages.
  const tileMeta = tiles.map((t, i) => {
    const x = Math.round((t.x - record.clip.x) * scale);
    const y = Math.round((t.y - record.clip.y) * scale);
    return { index: i, tile: t, x, y };
  });
  const bitmaps = new Map<number, ImageBitmap>();
  bitmaps.set(0, first);
  const getBmp = async (i: number) => {
    let bmp = bitmaps.get(i);
    if (!bmp) {
      bmp = await createImageBitmap(tileMeta[i]!.tile.blob);
      bitmaps.set(i, bmp);
    }
    return bmp;
  };

  for (let s = 0; s < stripCount; s++) {
    const stripY = s * EDITOR_LIMITS.stripH;
    const stripH = Math.min(EDITOR_LIMITS.stripH, height - stripY);
    const canvas = new OffscreenCanvas(width, stripH);
    const ctx = canvas.getContext('2d')!;
    // Reverse order so earlier-captured tiles win overlap regions: the first row is
    // the only one with fixed headers visible, and clamped last-row tiles must not
    // overwrite it with header-hidden pixels.
    for (const meta of [...tileMeta].reverse()) {
      const bmpH = Math.round(meta.tile.cssH * scale);
      if (meta.y + bmpH <= stripY || meta.y >= stripY + stripH) continue;
      const bmp = await getBmp(meta.index);
      ctx.drawImage(bmp, meta.x, meta.y - stripY);
    }
    // Free bitmaps that can no longer intersect later strips.
    for (const [i, bmp] of [...bitmaps]) {
      const meta = tileMeta[i]!;
      if (meta.y + Math.round(meta.tile.cssH * scale) <= stripY + stripH) {
        bmp.close();
        bitmaps.delete(i);
      }
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    await putStrip({ key: `${record.id}:${s}`, capId: record.id, index: s, y: stripY, h: stripH, blob });
    strips.push({ y: stripY, h: stripH, bmp: canvas.transferToImageBitmap() });
  }
  for (const bmp of bitmaps.values()) bmp.close();

  const image = makeBigImage(width, height, strips);
  record.width = width;
  record.height = height;
  record.status = 'composed';
  record.thumb = await makeThumb(image);
  await putCapture(record);
  await deleteTiles(record.id);
  return image;
}

async function makeThumb(image: BigImage): Promise<Blob> {
  const w = 320;
  const scale = w / image.width;
  const h = Math.min(Math.round(image.height * scale), 420);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  image.drawRegion(ctx, 0, 0, image.width, Math.round(h / scale), 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}
