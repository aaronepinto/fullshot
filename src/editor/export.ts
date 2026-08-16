/**
 * Export pipeline: bakes the (cropped) image plus annotations into PNG/JPEG/WebP,
 * a PDF, or the clipboard. Gigantic captures are automatically split into vertical
 * segments (numbered files, or extra PDF pages) instead of failing.
 */
import { buildPdf, type PdfPage } from '../lib/pdf';
import { EDITOR_LIMITS, type Rect } from '../lib/types';
import { drawAnno, type Anno } from './annotations';
import type { BigImage } from './stitch';

export type ImageFormat = 'png' | 'jpeg' | 'webp';
export type PdfPageMode = 'single' | 'a4' | 'letter';

export interface ExportSource {
  image: BigImage;
  annos: Anno[];
  crop: Rect | null;
}

function region(src: ExportSource): Rect {
  return src.crop ?? { x: 0, y: 0, w: src.image.width, h: src.image.height };
}

/** Renders a horizontal slice of the final artwork (image + annotations) at 1:1. */
function renderSlice(src: ExportSource, r: Rect, opaque: boolean): OffscreenCanvas {
  const canvas = new OffscreenCanvas(Math.round(r.w), Math.round(r.h));
  const ctx = canvas.getContext('2d')!;
  if (opaque) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.save();
  ctx.translate(-r.x, -r.y);
  src.image.drawRegion(ctx, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  for (const a of src.annos) drawAnno(ctx, a, src.image);
  ctx.restore();
  return canvas;
}

/** Splits the export region into slices that fit single-canvas limits. */
function slices(src: ExportSource): Rect[] {
  const r = region(src);
  const maxH = Math.min(
    EDITOR_LIMITS.maxDim,
    Math.floor(EDITOR_LIMITS.maxArea / Math.max(1, r.w))
  );
  const out: Rect[] = [];
  for (let y = r.y; y < r.y + r.h; y += maxH) {
    out.push({ x: r.x, y, w: r.w, h: Math.min(maxH, r.y + r.h - y) });
  }
  return out;
}

export async function exportImages(
  src: ExportSource,
  format: ImageFormat,
  quality: number
): Promise<Blob[]> {
  const type = `image/${format}`;
  const opaque = format === 'jpeg';
  const blobs: Blob[] = [];
  for (const slice of slices(src)) {
    const canvas = renderSlice(src, slice, opaque);
    blobs.push(
      await canvas.convertToBlob(format === 'png' ? { type } : { type, quality })
    );
  }
  return blobs;
}

export async function exportPdf(src: ExportSource, mode: PdfPageMode): Promise<Blob> {
  const r = region(src);
  // Page height in px: aspect-ratio pages for A4/Letter, or one tall page (split only
  // when it would exceed the PDF page-size ceiling of 200 inches).
  const maxSingle = Math.floor((14400 / 72) * 96); // 200in in CSS px
  const pageH =
    mode === 'a4'
      ? Math.round(r.w * (297 / 210))
      : mode === 'letter'
        ? Math.round(r.w * (11 / 8.5))
        : Math.min(r.h, maxSingle, EDITOR_LIMITS.maxDim);

  const pages: PdfPage[] = [];
  for (let y = r.y; y < r.y + r.h; y += pageH) {
    const slice: Rect = { x: r.x, y, w: r.w, h: Math.min(pageH, r.y + r.h - y) };
    const canvas = renderSlice(src, slice, true);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    pages.push({ jpeg: await blob.arrayBuffer(), wPx: canvas.width, hPx: canvas.height });
  }
  return buildPdf(pages);
}

export async function copyToClipboard(src: ExportSource): Promise<'ok' | 'split'> {
  const all = slices(src);
  const canvas = renderSlice(src, all[0]!, false);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  return all.length > 1 ? 'split' : 'ok';
}

/** Downloads the blobs and returns the download ids, in the order they started. */
export async function downloadBlobs(
  blobs: Blob[],
  baseName: string,
  ext: string,
  saveAs: boolean
): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < blobs.length; i++) {
    const suffix = blobs.length > 1 ? `-${i + 1}` : '';
    ids.push(
      await chrome.downloads.download({
        url: URL.createObjectURL(blobs[i]!),
        filename: `${baseName}${suffix}.${ext}`,
        saveAs: saveAs && i === 0,
      })
    );
  }
  return ids;
}

/**
 * Where a download actually landed, as an absolute path.
 *
 * "Saved" on its own is the complaint the whole category collects: the browser
 * decides the folder, may rename around a collision, and the Save As dialog can
 * move it anywhere, so the only honest answer comes from asking afterwards. The
 * item exists as soon as the download starts, but its filename is not final until
 * it does, so this waits briefly for the real one.
 */
export async function downloadPath(id: number | undefined): Promise<string | null> {
  if (id === undefined || !chrome.downloads?.search) return null;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const [item] = await chrome.downloads.search({ id });
      if (item?.filename && item.state !== 'in_progress') return item.filename;
      if (item?.filename && attempt === 9) return item.filename;
    } catch {
      return null;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return null;
}
