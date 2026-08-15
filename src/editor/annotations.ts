/**
 * Vector annotation model. Annotations live in image (device-pixel) space and are
 * re-rendered over the bitmap every frame, so they stay crisp at any zoom and are
 * non-destructive until export.
 */
import type { Rect } from '../lib/types';
import type { BigImage } from './stitch';

/**
 * `rotation` is in radians, clockwise, about the centre of the annotation's own
 * unrotated box, and is optional so every capture saved before it existed still
 * loads. Lines and arrows carry their angle in their endpoints instead, and a
 * freehand stroke has no box to turn, so neither kind has the field.
 */
export type Anno =
  | { kind: 'arrow' | 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { kind: 'rect' | 'ellipse'; x: number; y: number; w: number; h: number; color: string; width: number; fill: boolean; rotation?: number }
  | { kind: 'highlight'; x: number; y: number; w: number; h: number; color: string; rotation?: number }
  | { kind: 'pen'; points: number[]; color: string; width: number }
  | { kind: 'text'; x: number; y: number; text: string; color: string; size: number; rotation?: number }
  | { kind: 'blur'; x: number; y: number; w: number; h: number; px: number; rotation?: number }
  | { kind: 'emoji'; x: number; y: number; char: string; size: number; rotation?: number };

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const TEXT_FONT = (size: number) =>
  `600 ${size}px -apple-system, "Segoe UI", system-ui, sans-serif`;

export function drawAnno(ctx: Ctx, a: Anno, image: BigImage): void {
  ctx.save();
  // One transform ahead of every kind, so each case keeps drawing in the annotation's
  // own upright frame and export bakes the same rotation the screen shows.
  const rot = rotationOf(a);
  if (rot) {
    const c = centerOf(a);
    ctx.translate(c.x, c.y);
    ctx.rotate(rot);
    ctx.translate(-c.x, -c.y);
  }
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

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

/** Angle snap for a rotation drag held with Shift. */
export const ROTATE_STEP = Math.PI / 12;
/** How far above the top edge the rotation handle floats, in screen px. */
export const ROTATE_ARM = 28;

/** Kinds that turn about their centre rather than by moving their endpoints. */
export const canRotate = (a: Anno): boolean =>
  a.kind !== 'line' && a.kind !== 'arrow' && a.kind !== 'pen';

export const rotationOf = (a: Anno): number => ('rotation' in a && a.rotation ? a.rotation : 0);

/** The pivot every rotation turns about: the centre of the unrotated box. */
export function centerOf(a: Anno): { x: number; y: number } {
  const r = localBounds(a);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Folds an angle into [-PI, PI), so a full turn reads as zero rather than 2PI. */
export function normalizeAngle(rad: number): number {
  const t = ((rad + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  return t - Math.PI;
}

function rotateAbout(x: number, y: number, cx: number, cy: number, rad: number) {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** Image-space point mapped into the annotation's upright frame. */
export function toLocal(a: Anno, x: number, y: number): { x: number; y: number } {
  const rot = rotationOf(a);
  if (!rot) return { x, y };
  const c = centerOf(a);
  return rotateAbout(x, y, c.x, c.y, -rot);
}

/** The inverse of `toLocal`: a point in the upright frame, placed on the image. */
export function toWorld(a: Anno, x: number, y: number): { x: number; y: number } {
  const rot = rotationOf(a);
  if (!rot) return { x, y };
  const c = centerOf(a);
  return rotateAbout(x, y, c.x, c.y, rot);
}

/**
 * The annotation's own box, ignoring any rotation. This is what resize handles,
 * hit tests and the size readout work in; `bounds` wraps it in the axis-aligned
 * box the rotated shape actually occupies.
 */
export function localBounds(a: Anno): Rect {
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
 * The upright box the annotation occupies once its rotation is applied. Marquee
 * sweeps, the jump-to-annotation camera and the flash outline all want this one;
 * anything working in the annotation's own frame wants `localBounds`.
 */
export function bounds(a: Anno): Rect {
  const r = localBounds(a);
  const rot = rotationOf(a);
  if (!rot) return r;
  const cos = Math.abs(Math.cos(rot));
  const sin = Math.abs(Math.sin(rot));
  const w = r.w * cos + r.h * sin;
  const h = r.w * sin + r.h * cos;
  return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
}

/**
 * Whether a point lands on the annotation itself, not merely inside its bounding
 * box. A bounding-box test let a large unfilled rectangle swallow every click in
 * its empty interior and let a diagonal line claim its whole box, which is why
 * picking one of several overlapping annotations used to feel random.
 *
 * `tol` is a screen-constant slop already converted to image units by the caller.
 */
export function hitTest(a: Anno, px: number, py: number, tol: number): boolean {
  // Every shape below is described in its upright frame, so the point comes to it
  // rather than each case learning to turn.
  const p = toLocal(a, px, py);
  const x = p.x;
  const y = p.y;
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
      return inRect(localBounds(a), x, y, tol);
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

/** Corners first, so they win over edge handles on a shape too small to separate them. */
function boxHandles(r: Rect): Handle[] {
  return [
    { id: 'nw', x: r.x, y: r.y },
    { id: 'ne', x: r.x + r.w, y: r.y },
    { id: 'se', x: r.x + r.w, y: r.y + r.h },
    { id: 'sw', x: r.x, y: r.y + r.h },
    { id: 'n', x: r.x + r.w / 2, y: r.y },
    { id: 'e', x: r.x + r.w, y: r.y + r.h / 2 },
    { id: 's', x: r.x + r.w / 2, y: r.y + r.h },
    { id: 'w', x: r.x, y: r.y + r.h / 2 },
  ];
}

/**
 * Resize, rotate and endpoint handles for the selected annotation, in image space
 * with any rotation already applied, so callers hit-test and draw them directly.
 *
 * `scale` is image px per screen px (1 / zoom). Only the rotation handle's arm
 * uses it: the arm has to stay the same length on screen at every magnification,
 * where the box handles simply sit on the geometry.
 */
export function handles(a: Anno, scale = 1): Handle[] {
  switch (a.kind) {
    case 'line':
    case 'arrow':
      return [
        { id: 'p1', x: a.x1, y: a.y1 },
        { id: 'p2', x: a.x2, y: a.y2 },
      ];
    case 'pen':
      // A freehand stroke has no meaningful box to pull on.
      return [];
    default: {
      // Text and emoji resize by scaling their size, so they get the same eight.
      const r = localBounds(a);
      const list = boxHandles(r);
      list.push({ id: 'rot', x: r.x + r.w / 2, y: r.y - ROTATE_ARM * scale });
      return list.map((h) => ({ id: h.id, ...toWorld(a, h.x, h.y) }));
    }
  }
}

/** Foot of the lollipop stem: the top edge midpoint, turned with the shape. */
export function rotateStem(a: Anno): { x: number; y: number } | null {
  if (!canRotate(a)) return null;
  const r = localBounds(a);
  return toWorld(a, r.x + r.w / 2, r.y);
}

export const isBoxKind = (a: Anno): a is Extract<Anno, { kind: 'rect' | 'ellipse' | 'highlight' | 'blur' }> =>
  a.kind === 'rect' || a.kind === 'ellipse' || a.kind === 'highlight' || a.kind === 'blur';

export interface HandleMods {
  /** Lock to the aspect ratio the gesture started with. */
  shift?: boolean;
  /** Resize about the centre instead of the opposite corner. */
  alt?: boolean;
}

/**
 * Resizes from a handle. Every result is computed from `start`, the geometry the
 * gesture began with, rather than from the running state: that is what keeps a
 * handle naming the same edge after the pointer crosses to the far side, and what
 * lets Shift and Alt be pressed or released mid-drag.
 */
export function applyHandle(a: Anno, start: Anno, id: string, x: number, y: number, mods: HandleMods = {}): void {
  if ((a.kind === 'line' || a.kind === 'arrow') && (start.kind === 'line' || start.kind === 'arrow')) {
    if (id === 'p1') {
      a.x1 = x;
      a.y1 = y;
      a.x2 = start.x2;
      a.y2 = start.y2;
    } else {
      a.x1 = start.x1;
      a.y1 = start.y1;
      a.x2 = x;
      a.y2 = y;
    }
    if (mods.shift) snapToOctant(a, id === 'p1');
    return;
  }
  if (id === 'rot') {
    applyRotation(a, start, x, y, mods);
    return;
  }
  // A resize is described in the frame the gesture started in, so the pointer is
  // unturned before any edge maths and the result is turned back afterwards.
  const rot = rotationOf(start);
  const c = centerOf(start);
  const p = rot ? rotateAbout(x, y, c.x, c.y, -rot) : { x, y };
  if (isBoxKind(a) && isBoxKind(start)) {
    Object.assign(a, anchored(localBounds(start), id, p.x, p.y, mods, c, rot));
    return;
  }
  if (a.kind === 'text' || a.kind === 'emoji') scaleGlyph(a, start, id, p.x, p.y, c, rot);
}

/**
 * Turns an annotation so its rotation handle follows the pointer. The handle sits
 * straight above the centre at rest, hence the quarter turn; Shift lands it on the
 * nearest 15 degree step. A pointer sitting on the centre has no angle to report,
 * so the gesture holds whatever it had rather than snapping to an arbitrary one.
 */
function applyRotation(a: Anno, start: Anno, x: number, y: number, mods: HandleMods): void {
  if (!canRotate(a)) return;
  const c = centerOf(start);
  const dx = x - c.x;
  const dy = y - c.y;
  if (Math.hypot(dx, dy) < 1) return;
  let rot = Math.atan2(dy, dx) + Math.PI / 2;
  if (mods.shift) rot = Math.round(rot / ROTATE_STEP) * ROTATE_STEP;
  (a as { rotation?: number }).rotation = normalizeAngle(rot);
}

/**
 * The point a resize pivots on: the corner or edge opposite the handle, or the
 * centre when Alt is held. It is what must stay put on screen while a rotated
 * shape changes size, since the box's own centre moves as the edges do.
 */
function anchorOf(r: Rect, id: string, mods: HandleMods): { x: number; y: number } {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  if (mods.alt) return { x: cx, y: cy };
  const west = id.includes('w');
  const east = id.includes('e');
  const north = id.includes('n');
  const south = id.includes('s');
  return {
    x: west ? r.x + r.w : east ? r.x : cx,
    y: north ? r.y + r.h : south ? r.y : cy,
  };
}

/**
 * Resizes in the upright frame, then places the result so the anchor lands back
 * where it was on the image. With no rotation the placement is the identity, so
 * an upright resize comes out exactly as it did before rotation existed.
 */
function anchored(
  r: Rect,
  id: string,
  x: number,
  y: number,
  mods: HandleMods,
  c: { x: number; y: number },
  rot: number
): Rect {
  const nr = resizeBox(r, id, x, y, mods);
  if (!rot) return nr;
  const anchor = anchorOf(r, id, mods);
  const world = rotateAbout(anchor.x, anchor.y, c.x, c.y, rot);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const dx = nr.x + nr.w / 2 - anchor.x;
  const dy = nr.y + nr.h / 2 - anchor.y;
  return {
    x: world.x + dx * cos - dy * sin - nr.w / 2,
    y: world.y + dx * sin + dy * cos - nr.h / 2,
    w: nr.w,
    h: nr.h,
  };
}

/** New edges for a box, given the handle being dragged and where the pointer is. */
function resizeBox(r: Rect, id: string, x: number, y: number, mods: HandleMods): Rect {
  let left = r.x;
  let top = r.y;
  let right = r.x + r.w;
  let bottom = r.y + r.h;
  const west = id.includes('w');
  const east = id.includes('e');
  const north = id.includes('n');
  const south = id.includes('s');
  if (west) left = x;
  if (east) right = x;
  if (north) top = y;
  if (south) bottom = y;

  if (mods.shift && r.w > 0 && r.h > 0 && (west || east) && (north || south)) {
    const aspect = r.w / r.h;
    let w = right - left;
    let h = bottom - top;
    if (Math.abs(w) / aspect > Math.abs(h)) h = (Math.sign(h) || 1) * (Math.abs(w) / aspect);
    else w = (Math.sign(w) || 1) * Math.abs(h) * aspect;
    if (west) left = right - w;
    else right = left + w;
    if (north) top = bottom - h;
    else bottom = top + h;
  }

  if (mods.alt) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    if (west) right = 2 * cx - left;
    else if (east) left = 2 * cx - right;
    if (north) bottom = 2 * cy - top;
    else if (south) top = 2 * cy - bottom;
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

const GLYPH_MIN = 8;
const GLYPH_MAX = 400;

/**
 * Text and emoji resize by scaling their font size, opposite corner pinned. `x`
 * and `y` arrive already unturned into `start`'s frame; `c` and `rot` put the
 * result back on the image with that corner still where the eye left it.
 */
function scaleGlyph(
  a: Extract<Anno, { kind: 'text' | 'emoji' }>,
  start: Anno,
  id: string,
  x: number,
  y: number,
  c: { x: number; y: number },
  rot: number
): void {
  if (start.kind !== 'text' && start.kind !== 'emoji') return;
  const b = localBounds(start);
  const west = id.includes('w');
  const north = id.includes('n');
  const anchorX = west ? b.x + b.w : b.x;
  const anchorY = north ? b.y + b.h : b.y;
  const horizontal = west || id.includes('e');
  const vertical = north || id.includes('s');
  const sx = horizontal ? Math.abs(x - anchorX) / Math.max(b.w, 1) : 0;
  const sy = vertical ? Math.abs(y - anchorY) / Math.max(b.h, 1) : 0;
  const scale = Math.max(sx, sy);
  a.size = Math.min(GLYPH_MAX, Math.max(GLYPH_MIN, start.size * scale));

  // Only the size of the new box matters here; its position is about to be set.
  const now = localBounds(a);
  const left = west ? anchorX - now.w : anchorX;
  const top = north ? anchorY - now.h : anchorY;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const world = rot ? rotateAbout(anchorX, anchorY, c.x, c.y, rot) : { x: anchorX, y: anchorY };
  const dx = left + now.w / 2 - anchorX;
  const dy = top + now.h / 2 - anchorY;
  const cx = world.x + dx * cos - dy * sin;
  const cy = world.y + dx * sin + dy * cos;
  if (a.kind === 'text') {
    a.x = cx - now.w / 2;
    a.y = cy - now.h / 2;
  } else {
    a.x = cx;
    a.y = cy;
  }
}

function snapToOctant(a: Extract<Anno, { kind: 'line' | 'arrow' }>, fromStart: boolean): void {
  const ox = fromStart ? a.x2 : a.x1;
  const oy = fromStart ? a.y2 : a.y1;
  const px = fromStart ? a.x1 : a.x2;
  const py = fromStart ? a.y1 : a.y2;
  const angle = Math.round(Math.atan2(py - oy, px - ox) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(px - ox, py - oy);
  const nx = ox + Math.cos(angle) * len;
  const ny = oy + Math.sin(angle) * len;
  if (fromStart) {
    a.x1 = nx;
    a.y1 = ny;
  } else {
    a.x2 = nx;
    a.y2 = ny;
  }
}

/** Undoes any inversion a resize left behind, so w and h are never negative. */
export function normalizeAnno(a: Anno): void {
  if (isBoxKind(a)) Object.assign(a, norm(a));
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
