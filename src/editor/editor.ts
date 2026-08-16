/**
 * screencappy editor: loads a capture from IndexedDB, stitches it, and provides
 * annotation, crop, history, and export. Everything runs locally in this tab.
 */
import { deleteCapture, getCapture, listCaptures, putCapture } from '../lib/db';
import { renderFilename } from '../lib/filename';
import { getSettings, type Settings } from '../lib/settings';
import type { CaptureRecord, Rect, RuntimeMsg } from '../lib/types';
import {
  applyHandle,
  bounds,
  centerOf,
  drawAnno,
  handles,
  hitTest,
  isBoxKind,
  localBounds,
  normalizeAnno,
  rotateStem,
  rotationOf,
  translateAnno,
  TEXT_FONT,
  type Anno,
} from './annotations';
import {
  copyToClipboard,
  downloadBlobs,
  downloadPath,
  exportImages,
  exportPdf,
  type ImageFormat,
  type PdfPageMode,
} from './export';
import { loadBigImage, type BigImage } from './stitch';

type Tool =
  | 'select'
  | 'crop'
  | 'arrow'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'pen'
  | 'highlight'
  | 'text'
  | 'blur'
  | 'emoji';

/** The annotation palette, named: a hex code is not a tooltip anyone can read. */
const COLORS: { hex: string; name: string }[] = [
  { hex: '#ef4444', name: 'Red' },
  { hex: '#f97316', name: 'Orange' },
  { hex: '#eab308', name: 'Yellow' },
  { hex: '#22c55e', name: 'Green' },
  { hex: '#3b82f6', name: 'Blue' },
  { hex: '#a855f7', name: 'Purple' },
  { hex: '#ec4899', name: 'Pink' },
  { hex: '#0f172a', name: 'Ink' },
  { hex: '#ffffff', name: 'White' },
];

// Selection chrome is painted on the canvas rather than in CSS, so the shell's
// tokens have to exist here as literals. These five mirror editor.css: the ground
// behind the artwork, --accent, a wash of it, --cream for the handle bodies, and
// --ink-950 for the crop dim.
const GROUND = 'oklch(0.12 0.004 285)';
const ACCENT = '#38bdf8';
const ACCENT_WASH = 'rgba(56, 189, 248, 0.12)';
const HANDLE_FILL = '#faf6ec';
const DIM = 'rgba(10, 10, 12, 0.62)';
// Segment into graphemes so multi-codepoint emoji stay intact.
const EMOJI_SET = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment('✅❌⭐❤️🔥🎉👍👎👀💡⚠️❗❓🚀🐛💯😀😂😍🤔😱🙏🔒📌')].map((s) => s.segment);

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface Snapshot {
  annos: Anno[];
  crop: Rect | null;
  /** Undoing a move should not also lose your place. */
  selection: number[];
}

/**
 * The open text editor. The draft lives here rather than in the textarea's value,
 * so nothing that touches the DOM input on its way past can destroy pending text,
 * and the style is captured at open so what you see is what commits.
 */
interface TextEditing {
  mode: 'create' | 'edit';
  /** Index of the annotation being re-edited, or -1 while creating. */
  index: number;
  /** Anchor in image space. */
  x: number;
  y: number;
  draft: string;
  color: string;
  size: number;
  /** Set only by Escape, so the commit path can tell cancel from close. */
  cancelled: boolean;
}

const state = {
  settings: null as Settings | null,
  record: null as CaptureRecord | null,
  image: null as BigImage | null,
  annos: [] as Anno[],
  crop: null as Rect | null,
  selection: [] as number[],
  editing: null as TextEditing | null,
  tool: 'select' as Tool,
  style: { color: '#ef4444', strokeWidth: 6, fontSize: 36, fill: false, emoji: '✅', blurPx: 14 },
  zoom: 1,
  pan: { x: 0, y: 0 },
  undoStack: [] as Snapshot[],
  redoStack: [] as Snapshot[],
  draft: null as Anno | null,
  cropDraft: null as Rect | null,
  dirty: false,
};

const canvas = $<HTMLCanvasElement>('#canvas');
const ctx = canvas.getContext('2d')!;
const viewport = $('#viewport');

/** The single selected annotation, or -1 when the selection is empty or plural. */
const selectedIndex = () => (state.selection.length === 1 ? state.selection[0]! : -1);

function selectOnly(i: number) {
  state.selection = i >= 0 ? [i] : [];
}

function clearSelection() {
  state.selection = [];
}

/** Removes every selected annotation. Splices high-to-low so indices stay valid. */
function deleteSelection() {
  for (const i of [...state.selection].sort((a, b) => b - a)) state.annos.splice(i, 1);
  clearSelection();
}

function requestRender() {
  if (state.dirty) return;
  state.dirty = true;
  requestAnimationFrame(() => {
    state.dirty = false;
    render();
  });
}

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

const toImage = (clientX: number, clientY: number) => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: state.pan.x + (clientX - rect.left) / state.zoom,
    y: state.pan.y + (clientY - rect.top) / state.zoom,
  };
};
const toScreen = (x: number, y: number) => {
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + (x - state.pan.x) * state.zoom, y: rect.top + (y - state.pan.y) * state.zoom };
};

function clampView() {
  if (!state.image) return;
  const vw = viewport.clientWidth / state.zoom;
  const vh = viewport.clientHeight / state.zoom;
  const maxX = Math.max(-vw * 0.1, state.image.width - vw * 0.9);
  const maxY = Math.max(-vh * 0.1, state.image.height - vh * 0.9);
  state.pan.x = Math.min(Math.max(state.pan.x, -vw * 0.1), maxX);
  state.pan.y = Math.min(Math.max(state.pan.y, -vh * 0.1), maxY);
}

function setZoom(z: number, cx?: number, cy?: number) {
  const rect = canvas.getBoundingClientRect();
  const px = cx ?? rect.left + rect.width / 2;
  const py = cy ?? rect.top + rect.height / 2;
  const before = toImage(px, py);
  state.zoom = Math.min(8, Math.max(0.05, z));
  const after = toImage(px, py);
  state.pan.x += before.x - after.x;
  state.pan.y += before.y - after.y;
  clampView();
  updateStatus();
  requestRender();
}

function fitWidth() {
  if (!state.image) return;
  const target = state.crop ?? { x: 0, y: 0, w: state.image.width, h: state.image.height };
  state.zoom = Math.min(2, (viewport.clientWidth - 32) / target.w);
  state.pan.x = target.x - (viewport.clientWidth / state.zoom - target.w) / 2;
  state.pan.y = target.y - 16 / state.zoom;
  updateStatus();
  requestRender();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(viewport.clientWidth * dpr);
  const h = Math.round(viewport.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function render() {
  resizeCanvas();
  syncTextOverlay();
  syncStyleBar();
  syncAnnoPanel();
  syncFlash();
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const img = state.image;
  if (!img) return;

  const s = state.zoom * dpr;
  ctx.setTransform(s, 0, 0, s, -state.pan.x * s, -state.pan.y * s);
  ctx.imageSmoothingEnabled = state.zoom < 1;
  ctx.imageSmoothingQuality = 'high';

  // Visible image region only.
  const vx = Math.max(0, state.pan.x);
  const vy = Math.max(0, state.pan.y);
  const vw = Math.min(img.width - vx, viewport.clientWidth / state.zoom + 2);
  const vh = Math.min(img.height - vy, viewport.clientHeight / state.zoom + 2);
  if (vw > 0 && vh > 0) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = 24 / s;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, img.width, img.height);
    ctx.restore();
    img.drawRegion(ctx, vx, vy, vw, vh, vx, vy, vw, vh);
  }

  const editingIndex = state.editing?.mode === 'edit' ? state.editing.index : -1;
  state.annos.forEach((a, i) => {
    // The open editor already shows this one; painting it too would double it.
    if (i !== editingIndex) drawAnno(ctx, a, img);
  });
  if (state.draft) drawAnno(ctx, state.draft, img);

  // Crop dimming (committed crop, or in-progress draft).
  const cropRect = state.cropDraft ?? state.crop;
  if (cropRect) {
    ctx.save();
    ctx.fillStyle = DIM;
    ctx.beginPath();
    ctx.rect(-1e6, -1e6, 2e6, 2e6);
    const r = normRect(cropRect);
    ctx.rect(r.x, r.y + r.h, r.w, -r.h); // counter-clockwise hole
    ctx.fill('evenodd');
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5 / s;
    ctx.setLineDash([6 / s, 4 / s]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  if (drag.kind === 'marquee') {
    const r = normRect({ x: drag.x0, y: drag.y0, w: drag.x1 - drag.x0, h: drag.y1 - drag.y0 });
    ctx.save();
    ctx.fillStyle = ACCENT_WASH;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5 / s;
    ctx.setLineDash([5 / s, 4 / s]);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  // Selection outline + handles, drawn crisp in screen space.
  for (const i of state.selection) {
    const sel = state.annos[i];
    if (!sel) continue;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5 / s;
    ctx.setLineDash([5 / s, 4 / s]);
    // The outline hugs the shape rather than its upright bounding box, so a turned
    // annotation reads as turned instead of as a bigger untidy rectangle.
    const rot = rotationOf(sel);
    const b = localBounds(sel);
    if (rot) {
      const c = centerOf(sel);
      ctx.translate(c.x, c.y);
      ctx.rotate(rot);
      ctx.translate(-c.x, -c.y);
    }
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.restore();

    ctx.save();
    ctx.setLineDash([]);
    const list = selHandles(sel);
    const stem = rotateStem(sel);
    const knob = list.find((h) => h.id === 'rot');
    if (stem && knob) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5 / s;
      ctx.beginPath();
      ctx.moveTo(stem.x, stem.y);
      ctx.lineTo(knob.x, knob.y);
      ctx.stroke();
    }
    for (const h of list) {
      const hot = h.id === hoverHandle && drag.kind !== 'handle' && drag.kind !== 'rotate';
      ctx.fillStyle = hot ? ACCENT : HANDLE_FILL;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2 / s;
      ctx.beginPath();
      ctx.arc(h.x, h.y, HANDLE_RADIUS / s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Undo / redo / persistence
// ---------------------------------------------------------------------------

/** Consecutive same-tag pushes inside this window fold into the first entry. */
const UNDO_COALESCE_MS = 500;
let lastUndoTag: { tag: string; at: number } | null = null;

function pushUndo(tag?: string) {
  const now = Date.now();
  if (tag && lastUndoTag?.tag === tag && now - lastUndoTag.at < UNDO_COALESCE_MS) {
    lastUndoTag.at = now;
    return;
  }
  lastUndoTag = tag ? { tag, at: now } : null;
  state.undoStack.push(snapshot());
  if (state.undoStack.length > 100) state.undoStack.shift();
  state.redoStack.length = 0;
  updateUndoButtons();
}

const snapshot = (): Snapshot => ({
  annos: structuredClone(state.annos),
  crop: state.crop && { ...state.crop },
  selection: [...state.selection],
});

/** Drops the newest entry, for a gesture that turned out to change nothing. */
function popUndo() {
  state.undoStack.pop();
  updateUndoButtons();
}

function applySnapshot(snap: Snapshot) {
  // A burst that has been undone must not fold the next one into it.
  lastUndoTag = null;
  state.annos = snap.annos;
  state.crop = snap.crop;
  state.selection = snap.selection.filter((i) => i < state.annos.length);
  persistAnnos();
  updateStatus();
  requestRender();
}

function undo() {
  const snap = state.undoStack.pop();
  if (!snap) return;
  state.redoStack.push(snapshot());
  applySnapshot(snap);
  updateUndoButtons();
}

function redo() {
  const snap = state.redoStack.pop();
  if (!snap) return;
  state.undoStack.push(snapshot());
  applySnapshot(snap);
  updateUndoButtons();
}

function updateUndoButtons() {
  $<HTMLButtonElement>('#btnUndo').disabled = state.undoStack.length === 0;
  $<HTMLButtonElement>('#btnRedo').disabled = state.redoStack.length === 0;
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persistAnnos() {
  if (!state.record) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (!state.record) return;
    const rec = state.record as CaptureRecord & { annos?: Anno[]; cropRect?: Rect | null };
    rec.annos = state.annos;
    rec.cropRect = state.crop;
    void putCapture(rec);
  }, 400);
}

// ---------------------------------------------------------------------------
// Pointer interaction
// ---------------------------------------------------------------------------

type Drag =
  | { kind: 'none' }
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number; moved: boolean }
  | { kind: 'draw'; anno: Anno; ox: number; oy: number }
  | { kind: 'crop' }
  | { kind: 'move'; indices: number[]; startAnnos: Anno[]; lastX: number; lastY: number; moved: boolean }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; additive: boolean }
  | { kind: 'handle'; index: number; id: string; start: Anno; pressX: number; pressY: number; moved: boolean }
  | { kind: 'rotate'; index: number; start: Anno; moved: boolean };

let drag: Drag = { kind: 'none' };
let spaceDown = false;

canvas.addEventListener('pointerdown', (e) => {
  // The text tool reopens the editor itself; every other gesture closes it first.
  if (state.editing && state.tool !== 'text') closeTextEditor('blur');
  // Dragging empty canvas with the select tool draws a marquee, so panning is
  // space-drag, middle-drag and the wheel.
  const wantsPan = e.button === 1 || (e.button === 0 && spaceDown);
  if (wantsPan) {
    drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, panX: state.pan.x, panY: state.pan.y, moved: false };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (e.button !== 0 || !state.image) return;
  const p = toImage(e.clientX, e.clientY);
  const st = state.style;
  // Only gestures that actually drag take the pointer.
  const capture = () => canvas.setPointerCapture(e.pointerId);

  switch (state.tool) {
    case 'select': {
      const h = handleHit(e);
      if (h) {
        capture();
        const index = selectedIndex();
        // Undo is deferred to the first actual movement: pressing a handle and
        // letting go must not leave a no-op entry behind.
        drag =
          h.id === 'rot'
            ? { kind: 'rotate', index, start: structuredClone(state.annos[index]!), moved: false }
            : {
                kind: 'handle',
                index,
                id: h.id,
                start: structuredClone(state.annos[index]!),
                pressX: p.x,
                pressY: p.y,
                moved: false,
              };
        return;
      }
      const hit = topHit(e);
      if (hit < 0) {
        capture();
        drag = { kind: 'marquee', x0: p.x, y0: p.y, x1: p.x, y1: p.y, additive: e.shiftKey };
        return;
      }
      capture();
      if (e.shiftKey) {
        state.selection = state.selection.includes(hit)
          ? state.selection.filter((i) => i !== hit)
          : [...state.selection, hit];
      } else if (!state.selection.includes(hit)) {
        // Pressing inside an existing multi-selection keeps it, so the group drags.
        selectOnly(hit);
      }
      drag = {
        kind: 'move',
        indices: [...state.selection],
        startAnnos: state.selection.map((i) => structuredClone(state.annos[i]!)),
        lastX: p.x,
        lastY: p.y,
        moved: false,
      };
      requestRender();
      return;
    }
    case 'crop':
      capture();
      state.cropDraft = { x: p.x, y: p.y, w: 0, h: 0 };
      drag = { kind: 'crop' };
      hideCropBar();
      return;
    case 'text': {
      // Suppressing the compatibility mousedown means no focus change, so no blur
      // fires against the editor we are about to open.
      e.preventDefault();
      const hit = topHit(e);
      if (state.annos[hit]?.kind === 'text') {
        editTextAnno(hit);
        return;
      }
      // A label dropped outside the artwork is invisible the moment it exports, so
      // the click is refused with a reason rather than silently swallowed.
      if (!onArtwork(p.x, p.y)) {
        toast('That is outside the image, so no label was placed.');
        return;
      }
      openTextEditor(p.x, p.y);
      return;
    }
    case 'emoji': {
      if (!onArtwork(p.x, p.y)) {
        toast('That is outside the image, so no emoji was placed.');
        return;
      }
      pushUndo();
      state.annos.push({ kind: 'emoji', x: p.x, y: p.y, char: st.emoji, size: st.fontSize * 2 });
      selectOnly(state.annos.length - 1);
      persistAnnos();
      requestRender();
      return;
    }
    case 'pen':
      capture();
      drag = { kind: 'draw', anno: { kind: 'pen', points: [p.x, p.y], color: st.color, width: st.strokeWidth }, ox: p.x, oy: p.y };
      state.draft = drag.anno;
      return;
    case 'arrow':
    case 'line':
      capture();
      drag = {
        kind: 'draw',
        anno: { kind: state.tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: st.color, width: st.strokeWidth },
        ox: p.x,
        oy: p.y,
      };
      state.draft = drag.anno;
      return;
    case 'rect':
    case 'ellipse':
      capture();
      drag = {
        kind: 'draw',
        anno: { kind: state.tool, x: p.x, y: p.y, w: 0, h: 0, color: st.color, width: st.strokeWidth, fill: st.fill },
        ox: p.x,
        oy: p.y,
      };
      state.draft = drag.anno;
      return;
    case 'highlight':
      capture();
      drag = { kind: 'draw', anno: { kind: 'highlight', x: p.x, y: p.y, w: 0, h: 0, color: st.color === '#0f172a' ? '#eab308' : st.color }, ox: p.x, oy: p.y };
      state.draft = drag.anno;
      return;
    case 'blur':
      capture();
      drag = { kind: 'draw', anno: { kind: 'blur', x: p.x, y: p.y, w: 0, h: 0, px: st.blurPx }, ox: p.x, oy: p.y };
      state.draft = drag.anno;
      return;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = toImage(e.clientX, e.clientY);
  switch (drag.kind) {
    case 'pan':
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 3) drag.moved = true;
      state.pan.x = drag.panX - (e.clientX - drag.startX) / state.zoom;
      state.pan.y = drag.panY - (e.clientY - drag.startY) / state.zoom;
      clampView();
      requestRender();
      return;
    case 'draw': {
      const a = drag.anno;
      if (a.kind === 'pen') {
        const n = a.points.length;
        const lx = a.points[n - 2]!;
        const ly = a.points[n - 1]!;
        if (Math.hypot(p.x - lx, p.y - ly) > 2 / state.zoom) a.points.push(p.x, p.y);
      } else if (a.kind === 'line' || a.kind === 'arrow') {
        a.x2 = p.x;
        a.y2 = p.y;
        if (e.shiftKey) snapAngle(a);
      } else if (isBoxKind(a)) {
        let w = p.x - drag.ox;
        let h = p.y - drag.oy;
        if (e.shiftKey) {
          const m = Math.max(Math.abs(w), Math.abs(h));
          w = (Math.sign(w) || 1) * m;
          h = (Math.sign(h) || 1) * m;
        }
        // Alt draws outwards from where the drag began rather than towards it.
        a.x = e.altKey ? drag.ox - w : drag.ox;
        a.y = e.altKey ? drag.oy - h : drag.oy;
        a.w = e.altKey ? w * 2 : w;
        a.h = e.altKey ? h * 2 : h;
      }
      requestRender();
      return;
    }
    case 'crop': {
      const c = state.cropDraft!;
      c.w = p.x - c.x;
      c.h = p.y - c.y;
      requestRender();
      return;
    }
    case 'move': {
      if (!drag.moved) {
        pushUndo();
        drag.moved = true;
      }
      for (const i of drag.indices) {
        const a = state.annos[i];
        if (a) translateAnno(a, p.x - drag.lastX, p.y - drag.lastY);
      }
      drag.lastX = p.x;
      drag.lastY = p.y;
      persistAnnos();
      requestRender();
      return;
    }
    case 'marquee':
      drag.x1 = p.x;
      drag.y1 = p.y;
      requestRender();
      return;
    case 'handle': {
      const a = state.annos[drag.index];
      if (!a) return;
      if (!drag.moved) {
        // A pointermove that has not travelled is not a resize.
        if (Math.hypot(p.x - drag.pressX, p.y - drag.pressY) * state.zoom < 1) return;
        pushUndo();
        drag.moved = true;
      }
      applyHandle(a, drag.start, drag.id, p.x, p.y, { shift: e.shiftKey, alt: e.altKey });
      persistAnnos();
      requestRender();
      return;
    }
    case 'rotate': {
      const a = state.annos[drag.index];
      if (!a) return;
      if (!drag.moved) {
        pushUndo();
        drag.moved = true;
      }
      applyHandle(a, drag.start, 'rot', p.x, p.y, { shift: e.shiftKey });
      persistAnnos();
      requestRender();
      return;
    }
    case 'none':
      updateCursor(e);
  }
});

canvas.addEventListener('pointerup', () => {
  if (drag.kind === 'marquee') {
    const r = normRect({ x: drag.x0, y: drag.y0, w: drag.x1 - drag.x0, h: drag.y1 - drag.y0 });
    // A press that never travelled is a deselect, not an empty marquee.
    const swept = r.w > 2 || r.h > 2;
    const caught = swept ? state.annos.flatMap((a, i) => (overlaps(bounds(a), r) ? [i] : [])) : [];
    state.selection = drag.additive ? [...new Set([...state.selection, ...caught])] : caught;
    requestRender();
  } else if (drag.kind === 'draw') {
    const a = drag.anno;
    const b = bounds(a);
    const big = b.w > 3 || b.h > 3 || a.kind === 'pen';
    state.draft = null;
    if (big) {
      pushUndo();
      state.annos.push(a);
      selectOnly(state.annos.length - 1);
      persistAnnos();
    } else {
      toast('That was too small to draw, so nothing was added.');
    }
    requestRender();
  } else if (drag.kind === 'handle' && drag.moved) {
    const a = state.annos[drag.index];
    if (a) {
      normalizeAnno(a);
      const b = localBounds(a);
      if (b.w < MIN_SIZE || b.h < MIN_SIZE) {
        // Nothing usable came of the gesture, so leave neither the shape nor the
        // history changed by it.
        state.annos[drag.index] = drag.start;
        popUndo();
        toast('That would be too small to see, so the size was kept.');
      }
      persistAnnos();
    }
    requestRender();
  } else if (drag.kind === 'crop' && state.cropDraft) {
    const r = normRect(state.cropDraft);
    if (r.w > 8 && r.h > 8) {
      state.cropDraft = clampRect(r);
      showCropBar();
    } else {
      state.cropDraft = null;
    }
    requestRender();
  }
  drag = { kind: 'none' };
});

/**
 * Rolls an in-flight gesture back to where it started and leaves history clean.
 * Without this an interrupted gesture left `drag` live, so the next press carried
 * on from a state the user thought they had abandoned.
 */
function cancelGesture(): boolean {
  switch (drag.kind) {
    case 'none':
      return false;
    case 'pan':
      state.pan.x = drag.panX;
      state.pan.y = drag.panY;
      clampView();
      break;
    case 'draw':
      state.draft = null;
      break;
    case 'crop':
      state.cropDraft = null;
      hideCropBar();
      break;
    case 'move':
      drag.indices.forEach((index, n) => {
        const original = drag.kind === 'move' ? drag.startAnnos[n] : undefined;
        if (original) state.annos[index] = original;
      });
      if (drag.moved) popUndo();
      persistAnnos();
      break;
    case 'handle':
    case 'rotate':
      state.annos[drag.index] = drag.start;
      if (drag.moved) popUndo();
      persistAnnos();
      break;
    case 'marquee':
      break;
  }
  drag = { kind: 'none' };
  requestRender();
  return true;
}

canvas.addEventListener('pointercancel', () => cancelGesture());

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function topHit(e: MouseEvent): number {
  const p = toImage(e.clientX, e.clientY);
  const tol = 6 / state.zoom;
  for (let i = state.annos.length - 1; i >= 0; i--) {
    if (hitTest(state.annos[i]!, p.x, p.y, tol)) return i;
  }
  return -1;
}

/** Generous enough to be easy to grab, still tight enough to pick one of eight. */
const HANDLE_HIT = 10;
const HANDLE_RADIUS = 6;
/** Smallest annotation a resize may leave behind, in image px. */
const MIN_SIZE = 2;

const HANDLE_CURSORS: Record<string, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  p1: 'crosshair',
  p2: 'crosshair',
  rot: 'grab',
};

/** Handle currently under the pointer, drawn highlighted so the target is visible. */
let hoverHandle: string | null = null;

/**
 * Handles for a selection, with the rotation arm converted from screen px to image
 * px at the current zoom. Every caller has to agree on that length or the knob is
 * drawn in one place and grabbed in another.
 */
const selHandles = (a: Anno) => handles(a, 1 / state.zoom);

function handleHit(e: MouseEvent): { id: string } | null {
  const sel = state.annos[selectedIndex()];
  if (!sel) return null;
  for (const h of selHandles(sel)) {
    const s = toScreen(h.x, h.y);
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < HANDLE_HIT) return { id: h.id };
  }
  return null;
}

/** Whether a point in image space is somewhere a stamp or label would survive export. */
function onArtwork(x: number, y: number): boolean {
  const img = state.image;
  if (!img) return false;
  const r = state.crop ?? { x: 0, y: 0, w: img.width, h: img.height };
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/**
 * Cursors describe what the next click will actually do.
 *
 * The emoji tool used to claim a text caret, which is what made clicking around
 * feel wrong: nothing about stamping a glyph involves typing. It gets a crosshair
 * plus a live ghost of the emoji instead, and the text caret is now reserved for
 * places a caret really will appear, including an existing label under the select
 * tool, where it is the only hint that the label can be reopened.
 */
function updateCursor(e: MouseEvent) {
  const hovered = state.tool === 'select' ? (handleHit(e)?.id ?? null) : null;
  if (hovered !== hoverHandle) {
    hoverHandle = hovered;
    requestRender();
  }
  const p = toImage(e.clientX, e.clientY);
  if (state.tool === 'select') {
    const hit = topHit(e);
    canvas.style.cursor = hovered
      ? (HANDLE_CURSORS[hovered] ?? 'nwse-resize')
      : hit < 0
        ? 'grab'
        : state.annos[hit]?.kind === 'text'
          ? 'text'
          : 'move';
  } else if (state.tool === 'text') {
    canvas.style.cursor = onArtwork(p.x, p.y) ? 'text' : 'not-allowed';
  } else if (state.tool === 'emoji') {
    canvas.style.cursor = onArtwork(p.x, p.y) ? 'crosshair' : 'not-allowed';
  } else {
    canvas.style.cursor = 'crosshair';
  }
  syncToolGhost(e);
}

// ---------------------------------------------------------------------------
// Placement preview
// ---------------------------------------------------------------------------

const toolGhost = $('#toolGhost');

/**
 * A preview of what the next click places, following the pointer: the emoji at the
 * size and zoom it will land at, or a caret bar at the height of the label about to
 * be typed. Seeing the thing before committing it is what makes a stamp feel aimed
 * rather than guessed at.
 */
function syncToolGhost(e?: MouseEvent) {
  const stamping = state.tool === 'emoji';
  const typing = state.tool === 'text' && !state.editing;
  if (!e || (!stamping && !typing) || !state.image) {
    toolGhost.hidden = true;
    return;
  }
  const p = toImage(e.clientX, e.clientY);
  if (!onArtwork(p.x, p.y)) {
    toolGhost.hidden = true;
    return;
  }
  const rect = viewport.getBoundingClientRect();
  toolGhost.hidden = false;
  toolGhost.classList.toggle('caret', typing);
  toolGhost.style.left = `${e.clientX - rect.left}px`;
  toolGhost.style.top = `${e.clientY - rect.top}px`;
  if (stamping) {
    toolGhost.textContent = state.style.emoji;
    toolGhost.style.font = `${state.style.fontSize * 2 * state.zoom}px system-ui`;
    toolGhost.style.height = '';
  } else {
    toolGhost.textContent = '';
    toolGhost.style.font = '';
    toolGhost.style.height = `${state.style.fontSize * 1.25 * state.zoom}px`;
  }
}

canvas.addEventListener('pointerleave', () => {
  toolGhost.hidden = true;
});

function snapAngle(a: Extract<Anno, { kind: 'line' | 'arrow' }>) {
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  a.x2 = a.x1 + Math.cos(angle) * len;
  a.y2 = a.y1 + Math.sin(angle) * len;
}

canvas.addEventListener('dblclick', (e) => {
  const hit = topHit(e);
  if (state.annos[hit]?.kind !== 'text') return;
  e.preventDefault();
  editTextAnno(hit);
});

/**
 * A wheel notch is not always a pixel. Chrome on macOS and every trackpad report
 * DOM_DELTA_PIXEL, but Firefox and most Windows and Linux mice report whole lines,
 * and a few report pages. Reading a three-line notch as three pixels is what made
 * the wheel appear to do nothing at all: ctrl+wheel moved the zoom by 0.7 percent
 * per notch, and a plain wheel panned three image pixels.
 */
const WHEEL_LINE = 16;

function wheelPixels(e: WheelEvent): { x: number; y: number } {
  const f =
    e.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? WHEEL_LINE
      : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? Math.max(1, viewport.clientHeight)
        : 1;
  return { x: e.deltaX * f, y: e.deltaY * f };
}

/**
 * Bound on the window rather than the viewport so a pinch or ctrl+wheel started
 * over the toolbar or the status bar still zooms the artwork. Left unclaimed there,
 * the browser zooms its own page instead, which moves every control under the
 * pointer and reads as the editor's zoom being broken.
 */
window.addEventListener(
  'wheel',
  (e) => {
    const d = wheelPixels(e);
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(state.zoom * Math.exp(-d.y * 0.0022), e.clientX, e.clientY);
      return;
    }
    // A plain wheel over a drawer scrolls that drawer, as any list should; only the
    // bare canvas pans.
    if (e.target !== canvas && e.target !== viewport) return;
    e.preventDefault();
    state.pan.x += (e.shiftKey ? d.y : d.x) / state.zoom;
    state.pan.y += (e.shiftKey ? 0 : d.y) / state.zoom;
    clampView();
    requestRender();
  },
  { passive: false }
);

// ---------------------------------------------------------------------------
// Text editing overlay
// ---------------------------------------------------------------------------

const textEditor = $('#textEditor');
const textArea = textEditor.querySelector('textarea')!;
/** Screen-space inset from the overlay's corner to the first glyph. */
const TEXT_INSET = 4;

type CloseReason = 'enter' | 'blur' | 'escape' | 'tool-change' | 'reopen';

interface OpenTextOptions {
  /** Index of an existing text annotation to re-edit in place. */
  index?: number;
  text?: string;
  color?: string;
  size?: number;
}

function openTextEditor(x: number, y: number, opts: OpenTextOptions = {}) {
  // Whatever was open resolves first. Open and close must never race through the
  // same hidden flag: that race is what used to swallow every second editor.
  closeTextEditor('reopen');
  const editing: TextEditing = {
    mode: opts.index === undefined ? 'create' : 'edit',
    index: opts.index ?? -1,
    x,
    y,
    draft: opts.text ?? '',
    color: opts.color ?? state.style.color,
    size: opts.size ?? state.style.fontSize,
    cancelled: false,
  };
  state.editing = editing;
  // The caret preview has done its job the moment the real caret appears.
  toolGhost.hidden = true;
  textEditor.hidden = false;
  textArea.value = editing.draft;
  syncTextOverlay();
  // Synchronous focus: the overlay is already visible, and the pointerdown that
  // opened it was preventDefault'ed, so nothing takes focus back afterwards.
  textArea.focus();
  textArea.setSelectionRange(editing.draft.length, editing.draft.length);
  requestRender();
}

function closeTextEditor(reason: CloseReason) {
  const ed = state.editing;
  if (!ed) return;
  // Cleared first: hiding the overlay blurs the textarea, and the blur handler has
  // to find nothing left to do rather than re-enter this function.
  state.editing = null;
  textEditor.hidden = true;
  textArea.value = '';
  if (reason !== 'escape' && !ed.cancelled) commitText(ed);
  if (document.activeElement === document.body) canvas.focus();
  requestRender();
}

/** Writes an editing session back to the annotation list. */
/** Reopens an existing label in place, seeded with its own text and style. */
function editTextAnno(index: number) {
  const a = state.annos[index];
  if (a?.kind !== 'text') return;
  openTextEditor(a.x, a.y, { index, text: a.text, color: a.color, size: a.size });
}

function commitText(ed: TextEditing) {
  const text = ed.draft.trim();
  if (ed.mode === 'create') {
    if (!text) {
      toast('Nothing typed, so no label was added.');
      return;
    }
    pushUndo();
    state.annos.push({ kind: 'text', x: ed.x, y: ed.y, text, color: ed.color, size: ed.size });
    selectOnly(state.annos.length - 1);
    persistAnnos();
    return;
  }
  const a = state.annos[ed.index];
  if (!a || a.kind !== 'text') return;
  if (!text) {
    pushUndo();
    state.annos.splice(ed.index, 1);
    clearSelection();
    persistAnnos();
    toast('Emptied label removed.');
    return;
  }
  // An unchanged re-edit is not a change: it must not stack an undo entry.
  if (a.text === text && a.color === ed.color && a.size === ed.size) return;
  pushUndo();
  a.text = text;
  a.color = ed.color;
  a.size = ed.size;
  selectOnly(ed.index);
  persistAnnos();
}

/**
 * Repositions and restyles the overlay from the current pan, zoom and captured
 * style. Called every frame, so zooming, panning, wheeling and resizing all keep
 * the box on its anchor instead of drifting off the text it is about to become.
 */
function syncTextOverlay() {
  const ed = state.editing;
  if (!ed) return;
  const s = toScreen(ed.x, ed.y);
  const rect = viewport.getBoundingClientRect();
  textEditor.style.left = `${s.x - rect.left - TEXT_INSET}px`;
  textEditor.style.top = `${s.y - rect.top - TEXT_INSET}px`;
  textArea.style.font = TEXT_FONT(ed.size * state.zoom);
  textArea.style.color = ed.color;
  autosizeText();
}

function autosizeText() {
  textArea.style.height = 'auto';
  textArea.style.width = 'auto';
  textArea.style.width = `${Math.max(60, textArea.scrollWidth + 8)}px`;
  textArea.style.height = `${textArea.scrollHeight}px`;
}

// Every chrome control is a focus thief. A blur mid-entry used to commit the draft
// before the control's own handler ran, so the change landed on the wrong annotation,
// or the deferred focus landed on a hidden element and the editor vanished.
for (const bar of document.querySelectorAll<HTMLElement>('#tools, #stylebar, .actions, .zoomctl')) {
  bar.addEventListener('mousedown', (e) => {
    // Selects are left alone: suppressing their mousedown suppresses the dropdown too.
    if ((e.target as HTMLElement).closest('select')) return;
    e.preventDefault();
  });
}

textArea.addEventListener('input', () => {
  if (state.editing) state.editing.draft = textArea.value;
  autosizeText();
});
textArea.addEventListener('blur', (e) => {
  // Focus landing on a chrome control means the user is restyling text they are
  // still typing; that control's handler hands focus straight back.
  if ((e.relatedTarget as Element | null)?.closest('#tools, #stylebar, .actions, .zoomctl')) return;
  closeTextEditor('blur');
});
textArea.addEventListener('keydown', (e) => {
  // Only the keys the editor owns are intercepted. Everything else, Cmd+Z and
  // Cmd+C included, is left to the textarea and to the browser.
  if (e.key === 'Escape') {
    e.preventDefault();
    if (state.editing) state.editing.cancelled = true;
    closeTextEditor('escape');
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    closeTextEditor('enter');
  }
});

// ---------------------------------------------------------------------------
// Crop bar
// ---------------------------------------------------------------------------

const cropBar = $('#cropBar');

function showCropBar() {
  const r = state.cropDraft!;
  $('#cropDims').textContent = `${Math.round(r.w)} × ${Math.round(r.h)}`;
  cropBar.hidden = false;
}
function hideCropBar() {
  cropBar.hidden = true;
}

$('#cropApply').addEventListener('click', () => {
  if (!state.cropDraft) return;
  pushUndo();
  state.crop = state.cropDraft;
  state.cropDraft = null;
  hideCropBar();
  setTool('select');
  persistAnnos();
  fitWidth();
  updateStatus();
});
$('#cropCancel').addEventListener('click', () => {
  state.cropDraft = null;
  hideCropBar();
  requestRender();
});
$('#btnCropReset').addEventListener('click', () => resetCrop());

// ---------------------------------------------------------------------------
// Toolbar / style bar
// ---------------------------------------------------------------------------

/** Kinds and tools each style control is relevant to. */
const WIDTH_SUBJECTS = ['arrow', 'line', 'rect', 'ellipse', 'pen'];
const FONT_SUBJECTS = ['text', 'emoji'];
const FILL_SUBJECTS = ['rect', 'ellipse'];

/**
 * The ARIA toolbar pattern: the whole group is one tab stop, the arrow keys move
 * within it, Home and End go to the ends, and the position is remembered so tabbing
 * back in lands where you left rather than at the start.
 *
 * Eleven tools and nine colours as eleven and nine separate tab stops meant twenty
 * presses between the top of the page and the Copy button.
 */
function rovingToolbar(group: HTMLElement, itemSelector: string): { setCurrent(el: Element | null): void } {
  const items = () => [...group.querySelectorAll<HTMLElement>(itemSelector)];
  const setCurrent = (el: Element | null) => {
    const list = items();
    const current = el && list.includes(el as HTMLElement) ? el : list[0];
    for (const item of list) item.tabIndex = item === current ? 0 : -1;
  };

  group.addEventListener('keydown', (e) => {
    const list = items();
    const from = list.indexOf(document.activeElement as HTMLElement);
    if (from < 0) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    const to = step ? (from + step + list.length) % list.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? list.length - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    setCurrent(list[to]!);
    list[to]!.focus();
  });
  // Arriving by any route makes that item the group's tab stop.
  group.addEventListener('focusin', (e) => {
    setCurrent((e.target as HTMLElement).closest(itemSelector));
  });

  setCurrent(group.querySelector(`${itemSelector}.active`));
  return { setCurrent };
}

const toolRoving = rovingToolbar($('#tools'), '.tool');

function setTool(tool: Tool) {
  // Switching tools resolves an open editor rather than leaving it orphaned.
  closeTextEditor('tool-change');
  state.tool = tool;
  document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => {
    const active = b.dataset.tool === tool;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  toolRoving.setCurrent(document.querySelector('.tool.active'));
  if (tool !== 'crop') {
    state.cropDraft = null;
    hideCropBar();
  }
  // The preview belongs to the pointer, and the pointer has not moved yet.
  toolGhost.hidden = true;
  requestRender();
}

/**
 * Shows the controls relevant to what is being worked on, and fills them from that
 * annotation's own style rather than from the global defaults, so the bar is never
 * a lie about what a change is going to affect.
 */
function syncStyleBar() {
  // While text is being typed the draft is the subject, whatever is still selected
  // behind it, because that is what a style change would apply to.
  const sel = state.editing ? undefined : state.annos[selectedIndex()];
  const subject = state.editing ? 'text' : sel ? sel.kind : state.tool;
  $('#ctlWidth').hidden = !WIDTH_SUBJECTS.includes(subject);
  $('#ctlFont').hidden = !FONT_SUBJECTS.includes(subject);
  $('#ctlFill').hidden = !FILL_SUBJECTS.includes(subject);
  $('#emojiAnchor').hidden = state.tool !== 'emoji';

  const color = sel && 'color' in sel ? sel.color : (state.editing?.color ?? state.style.color);
  // The button stands in for the row, so it has to wear the colour the row would
  // have shown as chosen.
  $('#colorDot').style.background = color;
  swatches.querySelectorAll<HTMLElement>('.swatch').forEach((b) => {
    const active = b.dataset.color === color;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  swatchRoving?.setCurrent(swatches.querySelector('.swatch.active'));
  setSelectValue('#strokeWidth', sel && 'width' in sel ? sel.width : state.style.strokeWidth);
  const size =
    sel?.kind === 'text' ? sel.size
    : sel?.kind === 'emoji' ? sel.size / 2
    : (state.editing?.size ?? state.style.fontSize);
  setSelectValue('#fontSize', size);
  const fill = sel && 'fill' in sel ? sel.fill : state.style.fill;
  const fillBox = $<HTMLInputElement>('#fillShape');
  if (fillBox.checked !== fill) fillBox.checked = fill;
}

function setSelectValue(sel: string, value: number) {
  const el = $<HTMLSelectElement>(sel);
  const next = String(value);
  if (el.value !== next && [...el.options].some((o) => o.value === next)) el.value = next;
}

/** Applies a style change to every selected annotation it fits, in one undo entry. */
function styleSelection(fits: (a: Anno) => boolean, apply: (a: Anno) => void) {
  const targets = state.selection
    .map((i) => state.annos[i])
    .filter((a): a is Anno => a !== undefined && fits(a));
  if (!targets.length) return;
  pushUndo();
  for (const a of targets) apply(a);
  persistAnnos();
  requestRender();
}

document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => {
  b.addEventListener('click', () => setTool(b.dataset.tool as Tool));
});

const swatches = $('#swatches');
/** Assigned once the swatches exist, and read by syncStyleBar on every render. */
let swatchRoving: { setCurrent(el: Element | null): void } | undefined;

for (const { hex: color, name } of COLORS) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.style.background = color;
  b.title = name;
  b.dataset.color = color;
  b.tabIndex = -1;
  b.setAttribute('aria-label', `${name} annotations`);
  b.addEventListener('click', () => {
    state.style.color = color;
    swatches.hidden = true;
    syncPopoverButtons();
    // While text is being typed the change belongs to that draft, not to whatever
    // happens to be selected behind it.
    if (state.editing) {
      state.editing.color = color;
      syncTextOverlay();
      textArea.focus();
      requestRender();
      return;
    }
    styleSelection((a) => 'color' in a, (a) => {
      if ('color' in a) a.color = color;
    });
    requestRender();
  });
  swatches.appendChild(b);
}
swatchRoving = rovingToolbar(swatches, '.swatch');

$('#colorCurrent').addEventListener('click', () => {
  swatches.hidden = !swatches.hidden;
  syncPopoverButtons();
  // Opening it lands on the colour already chosen, unless a label is being typed:
  // taking focus off that textarea is what closes it.
  if (!swatches.hidden && !state.editing) {
    swatches.querySelector<HTMLElement>('.swatch.active')?.focus();
  }
});

$<HTMLSelectElement>('#strokeWidth').addEventListener('change', (e) => {
  const width = Number((e.target as HTMLSelectElement).value);
  state.style.strokeWidth = width;
  styleSelection((a) => 'width' in a, (a) => {
    if ('width' in a) a.width = width;
  });
});
$<HTMLSelectElement>('#fontSize').addEventListener('change', (e) => {
  const size = Number((e.target as HTMLSelectElement).value);
  state.style.fontSize = size;
  if (state.editing) {
    state.editing.size = size;
    syncTextOverlay();
    textArea.focus();
    requestRender();
    return;
  }
  styleSelection(
    (a) => a.kind === 'text' || a.kind === 'emoji',
    (a) => {
      if (a.kind === 'text') a.size = size;
      if (a.kind === 'emoji') a.size = size * 2;
    }
  );
});
$<HTMLInputElement>('#fillShape').addEventListener('change', (e) => {
  const fill = (e.target as HTMLInputElement).checked;
  state.style.fill = fill;
  styleSelection((a) => 'fill' in a, (a) => {
    if ('fill' in a) a.fill = fill;
  });
});

const emojiPicker = $('#emojiPicker');
for (const em of EMOJI_SET) {
  const b = document.createElement('button');
  b.textContent = em;
  b.addEventListener('click', () => {
    state.style.emoji = em;
    $('#emojiCurrent').textContent = em;
    emojiPicker.hidden = true;
    syncPopoverButtons();
  });
  emojiPicker.appendChild(b);
}
$('#emojiCurrent').addEventListener('click', () => {
  emojiPicker.hidden = !emojiPicker.hidden;
  syncPopoverButtons();
});

// ---------------------------------------------------------------------------
// Export actions
// ---------------------------------------------------------------------------

const FORMAT_LABEL: Record<string, string> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP' };

function exportSource() {
  return { image: state.image!, annos: state.annos, crop: state.crop };
}

function baseName(): string {
  const s = state.settings!;
  const r = state.record!;
  return renderFilename(s.filenameTemplate, { title: r.title, url: r.url, mode: r.mode });
}

/** Returns the ids of the downloads that started, or an empty list if none did. */
async function doDownload(format: ImageFormat | `pdf-${PdfPageMode}`): Promise<number[]> {
  if (!state.image || !state.record || !state.settings) return [];
  try {
    toast('Exporting…');
    let ids: number[];
    let count = 1;
    if (format.startsWith('pdf')) {
      const mode = format.slice(4) as PdfPageMode;
      const blob = await exportPdf(exportSource(), mode);
      ids = await downloadBlobs([blob], baseName(), 'pdf', state.settings.saveAs);
    } else {
      const fmt = format as ImageFormat;
      const blobs = await exportImages(exportSource(), fmt, state.settings.quality);
      const ext = fmt === 'jpeg' ? 'jpg' : fmt;
      ids = await downloadBlobs(blobs, baseName(), ext, state.settings.saveAs);
      count = blobs.length;
      if (count > 1) toast(`Image exceeded canvas limits, so it was saved as ${count} numbered files.`);
    }
    // Where it went, not just that it went: the browser picks the folder, renames
    // around collisions, and a Save As dialog can put it anywhere.
    const path = await downloadPath(ids[0]);
    toast(
      path
        ? count > 1
          ? `Saved ${count} files, starting at ${path}`
          : `Saved to ${path}`
        : 'Saved ✓'
    );
    return ids;
  } catch (err) {
    toast(`Export failed: ${err}`, true);
    return [];
  }
}

$('#btnDownload').addEventListener('click', () => void doDownload(state.settings?.format ?? 'png'));
$('#btnCopy').addEventListener('click', async () => {
  if (!state.image) return;
  try {
    const result = await copyToClipboard(exportSource());
    toast(result === 'split' ? 'Copied the top section (image is huge) ✓' : 'Copied to clipboard ✓');
  } catch (err) {
    toast(`Copy failed: ${err}`, true);
  }
});

const formatMenu = $('#formatMenu');

/** Keeps each popover's opener honest about whether the popover is showing. */
function syncPopoverButtons() {
  $('#btnFormat').setAttribute('aria-expanded', String(!formatMenu.hidden));
  $('#emojiCurrent').setAttribute('aria-expanded', String(!emojiPicker.hidden));
  $('#colorCurrent').setAttribute('aria-expanded', String(!swatches.hidden));
}

$('#btnFormat').addEventListener('click', () => {
  formatMenu.hidden = !formatMenu.hidden;
  syncPopoverButtons();
});
formatMenu.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
  b.addEventListener('click', () => {
    formatMenu.hidden = true;
    syncPopoverButtons();
    void doDownload(b.dataset.format as ImageFormat | `pdf-${PdfPageMode}`);
  });
});
document.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('.split')) formatMenu.hidden = true;
  if (!(e.target as HTMLElement).closest('#emojiCurrent, #emojiPicker')) emojiPicker.hidden = true;
  if (!(e.target as HTMLElement).closest('#colorCurrent, #swatches')) swatches.hidden = true;
  if (!(e.target as HTMLElement).closest('#ctxMenu')) $('#ctxMenu').hidden = true;
  syncPopoverButtons();
});

$('#btnSettings').addEventListener('click', () => void chrome.runtime.openOptionsPage());

// Custom right-click menu on the canvas. The browser's native "Copy image" would
// only grab the on-screen viewport canvas (the pixels currently rendered at the
// current zoom), not the full composed capture, so we route the context menu
// through the same export pipeline as the Copy button.
const ctxMenu = $('#ctxMenu');
canvas.addEventListener('contextmenu', (e) => {
  if (!state.image) return;
  e.preventDefault();
  const rect = viewport.getBoundingClientRect();
  ctxMenu.hidden = false;
  const x = Math.min(e.clientX - rect.left, rect.width - ctxMenu.offsetWidth - 8);
  const y = Math.min(e.clientY - rect.top, rect.height - ctxMenu.offsetHeight - 8);
  ctxMenu.style.left = `${Math.max(4, x)}px`;
  ctxMenu.style.top = `${Math.max(4, y)}px`;
});
$('#ctxCopy').addEventListener('click', () => {
  ctxMenu.hidden = true;
  $('#btnCopy').click();
});
$('#ctxDownload').addEventListener('click', () => {
  ctxMenu.hidden = true;
  void doDownload(state.settings?.format ?? 'png');
});

// ---------------------------------------------------------------------------
// Annotation panel
// ---------------------------------------------------------------------------

const annoPanel = $('#annoPanel');
const annoList = $('#annoList');
const annoFlash = $('#annoFlash');
/** Which annotation is flashing after a jump, and until when. */
let flash: { index: number; until: number } | null = null;
let flashTimer: ReturnType<typeof setTimeout> | undefined;
/** What the rendered list was built from, so it is only rebuilt when it changes. */
let annoListKey = '';

$('#btnAnnos').addEventListener('click', () => {
  annoPanel.hidden = !annoPanel.hidden;
  if (!annoPanel.hidden) historyPanel.hidden = true;
  syncDrawerButtons();
  requestRender();
});
$('#annoClose').addEventListener('click', () => {
  annoPanel.hidden = true;
  syncDrawerButtons();
});

/**
 * The lucide/x the drawer headers already wear, at the size the drawers use for a
 * small icon. The rows used a literal glyph, which put a second icon family two
 * lines from the first.
 */
const X_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

/** One line describing an annotation, for the list. */
function annoSummary(a: Anno): string {
  switch (a.kind) {
    case 'text':
      return a.text.replace(/\s+/g, ' ');
    case 'emoji':
      return a.char;
    case 'pen':
      return `${Math.round(a.points.length / 2)} points`;
    case 'line':
    case 'arrow':
      return `${Math.round(Math.hypot(a.x2 - a.x1, a.y2 - a.y1))} px long`;
    default: {
      // The annotation's own size, so turning it does not appear to resize it.
      const r = localBounds(a);
      return `${Math.round(r.w)} × ${Math.round(r.h)}`;
    }
  }
}

const annoColor = (a: Anno) => ('color' in a ? a.color : 'transparent');

/**
 * The crop is an edit like any other, so it gets a row of its own. Leaving it out
 * meant cropping an image changed the picture but left this list looking untouched,
 * and undoing the crop looked like undoing nothing.
 */
function cropRow(): HTMLLIElement {
  const r = state.crop!;
  const li = document.createElement('li');
  li.dataset.testid = 'crop-row';
  li.className = 'crop-row';

  const chip = document.createElement('span');
  chip.className = 'chip-icon';
  // lucide/crop, the same icon the tool wears, at the family's line weight. Colour
  // comes from .chip-icon through currentColor rather than from an attribute here.
  chip.innerHTML =
    '<svg viewBox="0 0 24 24" stroke-width="2"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>';
  const kind = document.createElement('span');
  kind.className = 'kind';
  kind.textContent = 'Crop';
  const summary = document.createElement('span');
  summary.className = 'summary';
  summary.textContent = `${Math.round(r.w)} × ${Math.round(r.h)}`;

  const reset = document.createElement('button');
  reset.className = 'del';
  reset.dataset.testid = 'crop-reset';
  reset.title = 'Reset crop';
  reset.setAttribute('aria-label', 'Reset crop');
  reset.innerHTML = X_ICON;
  reset.addEventListener('click', (e) => {
    e.stopPropagation();
    resetCrop();
  });

  li.append(chip, kind, summary, reset);
  activateOn(li, () => fitWidth());
  return li;
}

/**
 * Makes a list row behave like the button it already looked like. The rows are
 * <li>, so without this they answered the mouse and nothing else: a keyboard user
 * could tab to a row's delete button but never to the row itself.
 */
function activateOn(li: HTMLLIElement, run: () => void) {
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  li.addEventListener('click', run);
  li.addEventListener('keydown', (e) => {
    // Only the row's own keys. Swallowing a bubbled one would cancel the native
    // activation of the delete button sitting inside it.
    if (e.target !== li) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    run();
  });
}

function resetCrop() {
  if (!state.crop) return;
  pushUndo();
  state.crop = null;
  persistAnnos();
  fitWidth();
  updateStatus();
}

function syncAnnoPanel() {
  if (annoPanel.hidden) return;
  const crop = state.crop;
  const key =
    (crop ? `crop:${Math.round(crop.w)}x${Math.round(crop.h)}` : 'uncropped') +
    '|' +
    state.annos.map((a) => `${a.kind}:${annoColor(a)}:${annoSummary(a)}`).join('|') +
    `#${state.selection.join(',')}`;
  if (key === annoListKey) return;
  annoListKey = key;
  annoList.textContent = '';
  if (crop) annoList.appendChild(cropRow());

  if (!state.annos.length) {
    const li = document.createElement('li');
    li.className = 'empty-row';
    li.textContent = 'Nothing drawn yet.';
    annoList.appendChild(li);
    return;
  }

  // Newest first, so the row order matches what is on top of the image.
  for (let i = state.annos.length - 1; i >= 0; i--) {
    const a = state.annos[i]!;
    const li = document.createElement('li');
    li.dataset.testid = 'anno-row';
    li.dataset.index = String(i);
    if (state.selection.includes(i)) li.classList.add('current');

    const chip = document.createElement('span');
    chip.className = 'chip-color';
    chip.style.background = annoColor(a);
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = a.kind;
    const summary = document.createElement('span');
    summary.className = 'summary';
    summary.textContent = annoSummary(a);

    const del = document.createElement('button');
    del.className = 'del';
    del.dataset.testid = 'anno-delete';
    del.title = 'Delete this annotation';
    del.setAttribute('aria-label', 'Delete this annotation');
    del.innerHTML = X_ICON;
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      pushUndo();
      state.annos.splice(i, 1);
      clearSelection();
      persistAnnos();
      requestRender();
    });

    li.append(chip, kind, summary, del);
    activateOn(li, () => jumpToAnno(i));
    annoList.appendChild(li);
  }
}

/** Selects an annotation, brings it into view, and flashes it briefly. */
function jumpToAnno(index: number) {
  const a = state.annos[index];
  if (!a) return;
  selectOnly(index);
  const b = bounds(a);
  state.pan.x = b.x + b.w / 2 - viewport.clientWidth / state.zoom / 2;
  state.pan.y = b.y + b.h / 2 - viewport.clientHeight / state.zoom / 2;
  clampView();
  flash = { index, until: Date.now() + FLASH_MS };
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flash = null;
    requestRender();
  }, FLASH_MS);
  requestRender();
}

const FLASH_MS = 700;

function syncFlash() {
  const a = flash ? state.annos[flash.index] : undefined;
  if (!a) {
    annoFlash.hidden = true;
    return;
  }
  const b = bounds(a);
  const tl = toScreen(b.x, b.y);
  const rect = viewport.getBoundingClientRect();
  annoFlash.hidden = false;
  annoFlash.style.left = `${tl.x - rect.left - 4}px`;
  annoFlash.style.top = `${tl.y - rect.top - 4}px`;
  annoFlash.style.width = `${b.w * state.zoom + 8}px`;
  annoFlash.style.height = `${b.h * state.zoom + 8}px`;
}

// ---------------------------------------------------------------------------
// History drawer
// ---------------------------------------------------------------------------

const historyPanel = $('#history');
$('#btnHistory').addEventListener('click', () => void toggleHistory());
$('#historyClose').addEventListener('click', () => {
  historyPanel.hidden = true;
  syncDrawerButtons();
});

async function toggleHistory(forceOpen = false) {
  if (!historyPanel.hidden && !forceOpen) {
    historyPanel.hidden = true;
    syncDrawerButtons();
    return;
  }
  await renderHistory();
  historyPanel.hidden = false;
  annoPanel.hidden = true;
  syncDrawerButtons();
}

/** Both drawer buttons report their drawer's state, so neither can drift. */
function syncDrawerButtons() {
  $('#btnAnnos').setAttribute('aria-expanded', String(!annoPanel.hidden));
  $('#btnHistory').setAttribute('aria-expanded', String(!historyPanel.hidden));
}

async function renderHistory() {
  const list = $('#historyList');
  list.textContent = '';
  const captures = await listCaptures();
  if (!captures.length) {
    const li = document.createElement('li');
    li.textContent = 'No captures yet.';
    list.appendChild(li);
    return;
  }
  for (const c of captures) {
    const li = document.createElement('li');
    if (c.id === state.record?.id) li.classList.add('current');
    const img = document.createElement('img');
    // The row's own title says what this is, so the thumbnail is decoration.
    img.alt = '';
    if (c.thumb) img.src = URL.createObjectURL(c.thumb);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = c.title || c.url || 'Capture';
    const d = document.createElement('div');
    d.className = 'd';
    d.textContent = `${new Date(c.createdAt).toLocaleString()} · ${c.mode}${c.width ? ` · ${c.width}×${c.height}` : ''}`;
    meta.append(t, d);
    const del = document.createElement('button');
    del.className = 'del';
    del.title = 'Delete this capture';
    del.setAttribute('aria-label', 'Delete this capture');
    del.innerHTML = X_ICON;
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteCapture(c.id);
      await renderHistory();
      if (c.id === state.record?.id) location.search = '?history=1';
    });
    li.append(img, meta, del);
    activateOn(li, () => {
      location.search = `?id=${encodeURIComponent(c.id)}`;
    });
    list.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Status bar, toast, keyboard
// ---------------------------------------------------------------------------

function updateStatus() {
  const img = state.image;
  const r = state.crop;
  $('#statDims').textContent = img
    ? r
      ? `${Math.round(r.w)} × ${Math.round(r.h)} (cropped from ${img.width} × ${img.height})`
      : `${img.width} × ${img.height}`
    : '';
  $('#statZoom').textContent = `${Math.round(state.zoom * 100)}%`;
  $('#btnCropReset').hidden = !state.crop;
  const url = $<HTMLAnchorElement>('#statUrl');
  url.textContent = state.record?.url ?? '';
  url.href = state.record?.url ?? '#';
  // An empty link is still a tab stop, and one with no name at that.
  url.hidden = !state.record?.url;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

/** One press of a zoom button, or one keyboard step. */
const ZOOM_STEP = 1.25;

$('#zoomIn').addEventListener('click', () => setZoom(state.zoom * ZOOM_STEP));
$('#zoomOut').addEventListener('click', () => setZoom(state.zoom / ZOOM_STEP));
$('#zoom100').addEventListener('click', () => setZoom(1));
$('#zoomFit').addEventListener('click', fitWidth);
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redo);

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select', c: 'crop', a: 'arrow', l: 'line', r: 'rect', o: 'ellipse',
  p: 'pen', h: 'highlight', t: 'text', b: 'blur', e: 'emoji',
};

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Fine step for a keyboard nudge, in image px; Shift multiplies it. */
const NUDGE = 1;
const NUDGE_COARSE = 10;
/** Offset a duplicate is placed at, so it does not hide under its original. */
const DUPLICATE_OFFSET = 16;

/**
 * Whether a key belongs to whatever the user is typing into rather than to the
 * editor. Covers contenteditable as well as form fields, so a future rich field
 * does not silently start eating tool hotkeys.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable === true
  );
}

/** Grows an annotation from its top-left, the keyboard equivalent of the SE handle. */
function resizeAnno(a: Anno, dw: number, dh: number): void {
  if (isBoxKind(a)) {
    a.w += dw;
    a.h += dh;
    return;
  }
  if (a.kind === 'line' || a.kind === 'arrow') {
    a.x2 += dw;
    a.y2 += dh;
    return;
  }
  if (a.kind === 'text' || a.kind === 'emoji') {
    a.size = Math.min(400, Math.max(8, a.size + dw + dh));
    return;
  }
  if (a.kind !== 'pen') return;
  const b = bounds(a);
  const fx = b.w > 0 ? (b.w + dw) / b.w : 1;
  const fy = b.h > 0 ? (b.h + dh) / b.h : 1;
  for (let i = 0; i + 1 < a.points.length; i += 2) {
    a.points[i] = b.x + (a.points[i]! - b.x) * fx;
    a.points[i + 1] = b.y + (a.points[i + 1]! - b.y) * fy;
  }
}

function nudgeSelection(dx: number, dy: number, coarse: boolean, resize: boolean) {
  if (!state.selection.length) return;
  const step = coarse ? NUDGE_COARSE : NUDGE;
  // One entry per burst: holding an arrow key should not fill history.
  pushUndo(resize ? 'nudge-resize' : 'nudge-move');
  for (const i of state.selection) {
    const a = state.annos[i];
    if (!a) continue;
    if (resize) resizeAnno(a, dx * step, dy * step);
    else translateAnno(a, dx * step, dy * step);
  }
  persistAnnos();
  requestRender();
}

/** Steps the selection through the annotation list in paint order, wrapping. */
function cycleSelection(step: number) {
  if (!state.annos.length) return;
  const from = state.selection.length ? Math.max(...state.selection) : step > 0 ? -1 : 0;
  const next = (from + step + state.annos.length) % state.annos.length;
  selectOnly(next);
  requestRender();
}

/**
 * Paint order is array order, so z-order is a splice. Identity rather than index
 * tracks the selection across the move, since the indices are what changes.
 */
function reorderSelection(mode: 'forward' | 'backward' | 'front' | 'back') {
  if (!state.selection.length) return;
  pushUndo();
  const picked = new Set(state.selection.map((i) => state.annos[i]!));
  const arr = state.annos;
  if (mode === 'front' || mode === 'back') {
    const rest = arr.filter((a) => !picked.has(a));
    const moved = arr.filter((a) => picked.has(a));
    state.annos = mode === 'front' ? [...rest, ...moved] : [...moved, ...rest];
  } else if (mode === 'forward') {
    for (let i = arr.length - 2; i >= 0; i--) {
      if (picked.has(arr[i]!) && !picked.has(arr[i + 1]!)) [arr[i], arr[i + 1]] = [arr[i + 1]!, arr[i]!];
    }
  } else {
    for (let i = 1; i < arr.length; i++) {
      if (picked.has(arr[i]!) && !picked.has(arr[i - 1]!)) [arr[i], arr[i - 1]] = [arr[i - 1]!, arr[i]!];
    }
  }
  state.selection = state.annos.flatMap((a, i) => (picked.has(a) ? [i] : []));
  persistAnnos();
  requestRender();
}

function duplicateSelection() {
  if (!state.selection.length) return;
  pushUndo();
  const copies = state.selection
    .map((i) => state.annos[i])
    .filter((a): a is Anno => a !== undefined)
    .map((a) => {
      const copy = structuredClone(a);
      translateAnno(copy, DUPLICATE_OFFSET, DUPLICATE_OFFSET);
      return copy;
    });
  const first = state.annos.length;
  state.annos.push(...copies);
  state.selection = copies.map((_, i) => first + i);
  persistAnnos();
  requestRender();
}

document.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target)) return;
  const meta = e.metaKey || e.ctrlKey;
  const arrow = ARROWS[e.key];
  if (e.code === 'Space') spaceDown = true;
  if (meta && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (meta && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void doDownload(state.settings?.format ?? 'png');
  } else if (meta && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    $('#btnCopy').click();
  } else if (meta && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    duplicateSelection();
  } else if (meta && (e.key === '=' || e.key === '+')) {
    // Claimed from the browser's own page zoom, which would scale the toolbars too
    // and leave the artwork exactly the same size relative to them.
    e.preventDefault();
    setZoom(state.zoom * ZOOM_STEP);
  } else if (meta && (e.key === '-' || e.key === '_')) {
    e.preventDefault();
    setZoom(state.zoom / ZOOM_STEP);
  } else if (meta && e.key === '0') {
    e.preventDefault();
    setZoom(1);
  } else if (meta && e.key === '9') {
    e.preventDefault();
    fitWidth();
  } else if (arrow && state.selection.length) {
    e.preventDefault();
    nudgeSelection(arrow[0], arrow[1], e.shiftKey, e.altKey);
  } else if ((e.code === 'BracketRight' || e.code === 'BracketLeft') && state.selection.length) {
    e.preventDefault();
    const forward = e.code === 'BracketRight';
    reorderSelection(e.shiftKey ? (forward ? 'front' : 'back') : forward ? 'forward' : 'backward');
  } else if (e.key === 'Tab' && state.annos.length && document.activeElement === canvas) {
    // Only the artwork claims Tab. Claiming it document-wide meant that as soon as
    // anything was drawn, a keyboard user could never tab out to Copy or Download:
    // every press cycled the selection instead. Escape hands focus back out.
    e.preventDefault();
    cycleSelection(e.shiftKey ? -1 : 1);
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selection.length) {
    pushUndo();
    deleteSelection();
    persistAnnos();
    requestRender();
  } else if (e.key === 'Enter' && state.annos[selectedIndex()]?.kind === 'text') {
    e.preventDefault();
    editTextAnno(selectedIndex());
  } else if (e.key === 'Escape') {
    dismiss();
  } else if (!meta && TOOL_KEYS[e.key.toLowerCase()]) {
    setTool(TOOL_KEYS[e.key.toLowerCase()]!);
  }
});
/**
 * Escape dismisses one thing at a time, most transient first, so it never throws
 * away more than the user meant.
 */
function dismiss() {
  if (cancelGesture()) return;
  if (state.editing) {
    state.editing.cancelled = true;
    closeTextEditor('escape');
    return;
  }
  for (const el of [ctxMenu, swatches, emojiPicker, formatMenu]) {
    if (!el.hidden) {
      el.hidden = true;
      syncPopoverButtons();
      return;
    }
  }
  if (state.cropDraft) {
    state.cropDraft = null;
    hideCropBar();
    requestRender();
    return;
  }
  if (state.selection.length) {
    clearSelection();
    requestRender();
    return;
  }
  // Nothing left to dismiss, so the last thing Escape gives up is the canvas's
  // claim on Tab: focus returns to the document and the toolbar is tabbable again.
  if (document.activeElement === canvas) canvas.blur();
}

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') spaceDown = false;
});

new ResizeObserver(() => requestRender()).observe(viewport);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/**
 * Everything that needs a capture to act on. Left enabled on the empty state these
 * looked like ordinary controls and answered a press with nothing at all: export
 * returned early on the missing image, the tools switched a mode that could not
 * draw, and the zoom buttons drove a readout that stayed blank.
 */
function setCaptureLoaded(on: boolean) {
  for (const sel of ['#btnCopy', '#btnDownload', '#btnFormat', '#colorCurrent']) {
    $<HTMLButtonElement>(sel).disabled = !on;
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('.tool')) b.disabled = !on;
  $('#zoomctl').hidden = !on;
}
setCaptureLoaded(false);

async function boot() {
  state.settings = await getSettings();
  $('#btnDownload').textContent = `Download ${FORMAT_LABEL[state.settings.format] ?? 'PNG'}`;
  $('#ctxDownload').textContent = `Download ${FORMAT_LABEL[state.settings.format] ?? 'PNG'}`;

  const params = new URLSearchParams(location.search);
  const blocked = params.get('blocked');
  if (blocked !== null) {
    // The capture was refused by the browser itself; explain that instead of
    // showing an empty editor under an ERR badge.
    $('#loading').hidden = true;
    $('#blockedState').hidden = false;
    const short = blocked.replace(/^https?:\/\//, '').split('?')[0] ?? '';
    $('#blockedUrl').textContent = short.length > 64 ? `${short.slice(0, 64)}…` : short;
    document.title = 'screencappy | page protected by the browser';
    return;
  }
  const id = params.get('id');
  if (!id) {
    $('#loading').hidden = true;
    $('#emptyState').hidden = false;
    if (params.get('history')) await toggleHistory(true);
    return;
  }

  try {
    const record = await getCapture(id);
    if (!record) throw new Error('Capture not found. It may have been pruned from history.');
    state.record = record;
    document.title = `screencappy | ${record.title || record.url}`;
    const stored = record as CaptureRecord & { annos?: Anno[]; cropRect?: Rect | null };
    state.annos = stored.annos ?? [];
    state.crop = stored.cropRect ?? null;

    state.image = await loadBigImage(record);
    setCaptureLoaded(true);
    $('#loading').hidden = true;
    fitWidth();
    updateStatus();
    if (record.notice) {
      $('#statNote').textContent = record.notice;
      toast(record.notice, false);
    } else if (record.truncated) {
      $('#statNote').textContent = 'Truncated at the capture height limit';
      toast('Heads up: the page exceeded the capture height limit and was truncated.', false);
    }
    if (params.get('autodownload')) {
      const ids = await doDownload(state.settings.format);
      // Download-only mode opens this tab purely to run the export, so it needs to
      // hear how that went. Nothing listens in the other modes, and the rejection
      // that follows from that is expected.
      void chrome.runtime
        .sendMessage({ type: 'fs:autodownload', ids } satisfies RuntimeMsg)
        .catch(() => undefined);
    }
  } catch (err) {
    $('#loading').hidden = true;
    $('#emptyState').hidden = false;
    // The message, not the Error's toString: "Error: Capture not found" reads like
    // a stack trace escaped into the interface.
    toast(err instanceof Error ? err.message : String(err), true);
  }
}

function normRect(r: Rect): Rect {
  return {
    x: r.w < 0 ? r.x + r.w : r.x,
    y: r.h < 0 ? r.y + r.h : r.y,
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

function clampRect(r: Rect): Rect {
  const img = state.image!;
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  return {
    x,
    y,
    w: Math.min(img.width, r.x + r.w) - x,
    h: Math.min(img.height, r.y + r.h) - y,
  };
}

// ---------------------------------------------------------------------------
// Test surface
// ---------------------------------------------------------------------------

/**
 * Everything is painted to one canvas, so a UI test has nothing to locate by role
 * or text. This exposes the state a spec needs to assert on, plus the coordinate
 * transforms it needs to drive the mouse to an exact image pixel at any zoom.
 * Unconditional: it reads state and never mutates it, so it is harmless shipped.
 */
interface TestApi {
  getState(): {
    tool: Tool;
    zoom: number;
    pan: { x: number; y: number };
    crop: Rect | null;
    selection: number[];
    editing: TextEditing | null;
    annos: Anno[];
    undoDepth: number;
    redoDepth: number;
  };
  imageToClient(x: number, y: number): { x: number; y: number };
  clientToImage(x: number, y: number): { x: number; y: number };
  handlesOf(index: number): { id: string; x: number; y: number }[];
  boundsOf(index: number): Rect | null;
  localBoundsOf(index: number): Rect | null;
  centerOf(index: number): { x: number; y: number } | null;
}

const testApi: TestApi = {
  getState: () => ({
    tool: state.tool,
    zoom: state.zoom,
    pan: { ...state.pan },
    crop: state.crop && { ...state.crop },
    selection: [...state.selection],
    editing: state.editing && { ...state.editing },
    annos: structuredClone(state.annos),
    undoDepth: state.undoStack.length,
    redoDepth: state.redoStack.length,
  }),
  imageToClient: (x, y) => toScreen(x, y),
  clientToImage: (x, y) => toImage(x, y),
  handlesOf: (index) => {
    const a = state.annos[index];
    // The same zoom-aware arm the editor hit-tests, so a spec can aim at the knob.
    return a ? selHandles(a).map((h) => ({ ...h })) : [];
  },
  boundsOf: (index) => {
    const a = state.annos[index];
    return a ? bounds(a) : null;
  },
  localBoundsOf: (index) => {
    const a = state.annos[index];
    return a ? localBounds(a) : null;
  },
  centerOf: (index) => {
    const a = state.annos[index];
    return a ? centerOf(a) : null;
  },
};
(window as unknown as { __screencappyTest: TestApi }).__screencappyTest = testApi;

void boot();
