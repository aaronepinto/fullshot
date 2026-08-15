/**
 * Vector annotation model. Annotations live in image (device-pixel) space and are
 * re-rendered over the bitmap every frame, so they stay crisp at any zoom and are
 * non-destructive until export.
 */
import type { Rect } from '../lib/types';
import type { BigImage } from './stitch';

export type Anno =
  | { kind: 'arrow' | 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { kind: 'rect' | 'ellipse'; x: number; y: number; w: number; h: number; color: string; width: number; fill: boolean }
  | { kind: 'highlight'; x: number; y: number; w: number; h: number; color: string }
  | { kind: 'pen'; points: number[]; color: string; width: number }
  | { kind: 'text'; x: number; y: number; text: string; color: string; size: number }
  | { kind: 'blur'; x: number; y: number; w: number; h: number; px: number }
  | { kind: 'emoji'; x: number; y: number; char: string; size: number };

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const TEXT_FONT = (size: number) =>
  `600 ${size}px -apple-system, "Segoe UI", system-ui, sans-serif`;

export function drawAnno(ctx: Ctx, a: Anno, image: BigImage): void {
  ctx.save();
  switch (a.kind) {
    case 'line':
    case 'arrow': {
      ctx.strokeStyle = a.color;
      ctx.fillStyle = a.color;
      ctx.lineWidth = a.width;
      ctx.lineCap = 'round';
      const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
      const head = a.kind === 'arrow' ? Math.max(10, a.width * 3.2) : 0;
      const endX = a.x2 - Math.cos(angle) * head * 0.6;
      const endY = a.y2 - Math.sin(angle) * head * 0.6;
      ctx.beginPath();
      ctx.moveTo(a.x1, a.y1);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      if (a.kind === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(a.x2, a.y2);
        ctx.lineTo(
          a.x2 - Math.cos(angle - 0.45) * head,
          a.y2 - Math.sin(angle - 0.45) * head
        );
        ctx.lineTo(
          a.x2 - Math.cos(angle + 0.45) * head,
          a.y2 - Math.sin(angle + 0.45) * head
        );
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'rect': {
      ctx.lineWidth = a.width;
      ctx.strokeStyle = a.color;
      const r = norm(a);
      if (a.fill) {
        ctx.fillStyle = withAlpha(a.color, 0.25);
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      break;
    }
    case 'ellipse': {
      ctx.lineWidth = a.width;
      ctx.strokeStyle = a.color;
      const r = norm(a);
      ctx.beginPath();
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      if (a.fill) {
        ctx.fillStyle = withAlpha(a.color, 0.25);
        ctx.fill();
      }
      ctx.stroke();
      break;
    }
    case 'highlight': {
      const r = norm(a);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = withAlpha(a.color, 0.4);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      break;
    }
    case 'pen': {
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i + 1 < a.points.length; i += 2) {
        const x = a.points[i]!;
        const y = a.points[i + 1]!;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      break;
    }
    case 'text': {
      ctx.font = TEXT_FONT(a.size);
      ctx.textBaseline = 'top';
      ctx.fillStyle = a.color;
      ctx.shadowColor = 'rgba(0,0,0,.45)';
      ctx.shadowBlur = a.size / 8;
      const lines = a.text.split('\n');
      lines.forEach((line, i) => ctx.fillText(line, a.x, a.y + i * a.size * 1.25));
      break;
    }
    case 'blur': {
      const r = norm(a);
      if (r.w < 2 || r.h < 2) break;
      const sw = Math.max(1, Math.round(r.w / a.px));
      const sh = Math.max(1, Math.round(r.h / a.px));
      const small = new OffscreenCanvas(sw, sh);
      const sctx = small.getContext('2d')!;
      sctx.imageSmoothingEnabled = true;
      image.drawRegion(sctx, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, r.x, r.y, r.w, r.h);
      break;
    }
    case 'emoji': {
      ctx.font = `${a.size}px system-ui`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(a.char, a.x, a.y);
      break;
    }
  }
  ctx.restore();
}

/**
 * Text metrics measured with the real font, cached on the annotation object and
 * keyed by the text and size that produced them. The old monospace estimate made
 * the selection rectangle and the hit region visibly wrong for wide or narrow
 * strings, so clicking on visible glyphs could miss.
 */
const textMetrics = new WeakMap<object, { key: string; w: number; h: number }>();
let sharedMeasurer: Ctx | null | undefined;

function measurer(): Ctx | null {
  if (sharedMeasurer === undefined) {
    sharedMeasurer =
      typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(8, 8).getContext('2d') : null;
  }
  return sharedMeasurer;
}

/**
 * Size of a rendered text run. Takes the measuring context so it stays testable;
 * without one it falls back to a monospace estimate rather than throwing.
 */
export function measureText(text: string, size: number, ctx: Ctx | null = measurer()): {
  w: number;
  h: number;
} {
  const lines = text.split('\n');
  const h = lines.length * size * 1.25;
  if (!ctx) return { w: Math.max(...lines.map((l) => l.length), 1) * size * 0.62, h };
  ctx.font = TEXT_FONT(size);
  return { w: Math.max(...lines.map((l) => ctx.measureText(l).width), 1), h };
}

function textSize(a: Extract<Anno, { kind: 'text' }>): { w: number; h: number } {
  const key = `${a.size}\u0000${a.text}`;
  const cached = textMetrics.get(a);
  if (cached?.key === key) return cached;
  const m = measureText(a.text, a.size);
  textMetrics.set(a, { key, ...m });
  return m;
}

export function bounds(a: Anno): Rect {
  switch (a.kind) {
    case 'line':
    case 'arrow': {
      const pad = a.width * 2 + 6;
      return {
        x: Math.min(a.x1, a.x2) - pad,
        y: Math.min(a.y1, a.y2) - pad,
        w: Math.abs(a.x2 - a.x1) + pad * 2,
        h: Math.abs(a.y2 - a.y1) + pad * 2,
      };
    }
    case 'rect':
    case 'ellipse':
    case 'highlight':
    case 'blur':
      return norm(a);
    case 'pen': {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i + 1 < a.points.length; i += 2) {
        minX = Math.min(minX, a.points[i]!);
        maxX = Math.max(maxX, a.points[i]!);
        minY = Math.min(minY, a.points[i + 1]!);
        maxY = Math.max(maxY, a.points[i + 1]!);
      }
      const pad = a.width + 4;
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }
    case 'text': {
      const m = textSize(a);
      return { x: a.x, y: a.y, w: m.w, h: m.h };
    }
    case 'emoji':
      return { x: a.x - a.size / 2, y: a.y - a.size / 2, w: a.size, h: a.size };
  }
}

/**
 * Whether a point lands on the annotation itself, not merely inside its bounding
 * box. A bounding-box test let a large unfilled rectangle swallow every click in
 * its empty interior and let a diagonal line claim its whole box, which is why
 * picking one of several overlapping annotations used to feel random.
 *
 * `tol` is a screen-constant slop already converted to image units by the caller.
 */
export function hitTest(a: Anno, x: number, y: number, tol: number): boolean {
  switch (a.kind) {
    case 'line':
    case 'arrow':
      return distToSegment(x, y, a.x1, a.y1, a.x2, a.y2) <= Math.max(a.width / 2, tol);
    case 'pen': {
      const reach = Math.max(a.width / 2, tol);
      if (a.points.length === 2) return Math.hypot(x - a.points[0]!, y - a.points[1]!) <= reach;
      for (let i = 0; i + 3 < a.points.length; i += 2) {
        const d = distToSegment(x, y, a.points[i]!, a.points[i + 1]!, a.points[i + 2]!, a.points[i + 3]!);
        if (d <= reach) return true;
      }
      return false;
    }
    case 'rect': {
      const r = norm(a);
      const band = Math.max(a.width / 2, tol);
      if (a.fill) return inRect(r, x, y, band);
      // The stroke band only: outside the outer edge or inside the inner one misses.
      return inRect(r, x, y, band) && !inRect(r, x, y, -band);
    }
    case 'ellipse': {
      const r = norm(a);
      const rx = Math.max(r.w / 2, 0.01);
      const ry = Math.max(r.h / 2, 0.01);
      const d = Math.hypot((x - (r.x + rx)) / rx, (y - (r.y + ry)) / ry);
      // The band is in pixels and d is normalised, so convert with the tighter
      // radius: that errs towards a slightly generous target rather than a mean one.
      const band = Math.max(a.width / 2, tol) / Math.min(rx, ry);
      return a.fill ? d <= 1 + band : Math.abs(d - 1) <= band;
    }
    case 'highlight':
    case 'blur':
      // Opaque regions: the whole interior is the annotation.
      return inRect(norm(a), x, y, tol);
    case 'text':
    case 'emoji':
      return inRect(bounds(a), x, y, tol);
  }
}

function inRect(r: Rect, x: number, y: number, pad: number): boolean {
  return x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function translateAnno(a: Anno, dx: number, dy: number): void {
  switch (a.kind) {
    case 'line':
    case 'arrow':
      a.x1 += dx;
      a.y1 += dy;
      a.x2 += dx;
      a.y2 += dy;
      break;
    case 'pen':
      for (let i = 0; i + 1 < a.points.length; i += 2) {
        a.points[i]! += dx;
        a.points[i + 1]! += dy;
      }
      break;
    default:
      a.x += dx;
      a.y += dy;
  }
}

export interface Handle {
  id: string;
  x: number;
  y: number;
}

/** Resize/endpoint handles for the selected annotation. */
export function handles(a: Anno): Handle[] {
  switch (a.kind) {
    case 'line':
    case 'arrow':
      return [
        { id: 'p1', x: a.x1, y: a.y1 },
        { id: 'p2', x: a.x2, y: a.y2 },
      ];
    case 'rect':
    case 'ellipse':
    case 'highlight':
    case 'blur': {
      const r = norm(a);
      return [
        { id: 'nw', x: r.x, y: r.y },
        { id: 'ne', x: r.x + r.w, y: r.y },
        { id: 'sw', x: r.x, y: r.y + r.h },
        { id: 'se', x: r.x + r.w, y: r.y + r.h },
      ];
    }
    default:
      return [];
  }
}

export function applyHandle(a: Anno, id: string, x: number, y: number): void {
  if (a.kind === 'line' || a.kind === 'arrow') {
    if (id === 'p1') {
      a.x1 = x;
      a.y1 = y;
    } else {
      a.x2 = x;
      a.y2 = y;
    }
    return;
  }
  if (a.kind === 'rect' || a.kind === 'ellipse' || a.kind === 'highlight' || a.kind === 'blur') {
    const r = norm(a);
    const right = r.x + r.w;
    const bottom = r.y + r.h;
    if (id === 'nw') Object.assign(a, { x, y, w: right - x, h: bottom - y });
    if (id === 'ne') Object.assign(a, { x: r.x, y, w: x - r.x, h: bottom - y });
    if (id === 'sw') Object.assign(a, { x, y: r.y, w: right - x, h: y - r.y });
    if (id === 'se') Object.assign(a, { x: r.x, y: r.y, w: x - r.x, h: y - r.y });
  }
}

function norm(r: { x: number; y: number; w: number; h: number }): Rect {
  return {
    x: r.w < 0 ? r.x + r.w : r.x,
    y: r.h < 0 ? r.y + r.h : r.y,
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
