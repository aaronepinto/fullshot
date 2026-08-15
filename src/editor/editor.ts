/**
 * Screencappy editor: loads a capture from IndexedDB, stitches it, and provides
 * annotation, crop, history, and export. Everything runs locally in this tab.
 */
import { deleteCapture, getCapture, listCaptures, putCapture } from '../lib/db';
import { renderFilename } from '../lib/filename';
import { getSettings, type Settings } from '../lib/settings';
import type { CaptureRecord, Rect } from '../lib/types';
import {
  applyHandle,
  bounds,
  drawAnno,
  handles,
  hitTest,
  translateAnno,
  TEXT_FONT,
  type Anno,
} from './annotations';
import {
  copyToClipboard,
  downloadBlobs,
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

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#0f172a', '#ffffff'];
// Segment into graphemes so multi-codepoint emoji stay intact.
const EMOJI_SET = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment('✅❌⭐❤️🔥🎉👍👎👀💡⚠️❗❓🚀🐛💯😀😂😍🤔😱🙏🔒📌')].map((s) => s.segment);

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface Snapshot {
  annos: Anno[];
  crop: Rect | null;
}

const state = {
  settings: null as Settings | null,
  record: null as CaptureRecord | null,
  image: null as BigImage | null,
  annos: [] as Anno[],
  crop: null as Rect | null,
  selected: -1,
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
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas');
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

  for (const a of state.annos) drawAnno(ctx, a, img);
  if (state.draft) drawAnno(ctx, state.draft, img);

  // Crop dimming (committed crop, or in-progress draft).
  const cropRect = state.cropDraft ?? state.crop;
  if (cropRect) {
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.55)';
    ctx.beginPath();
    ctx.rect(-1e6, -1e6, 2e6, 2e6);
    const r = normRect(cropRect);
    ctx.rect(r.x, r.y + r.h, r.w, -r.h); // counter-clockwise hole
    ctx.fill('evenodd');
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5 / s;
    ctx.setLineDash([6 / s, 4 / s]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  // Selection outline + handles, drawn crisp in screen space.
  const sel = state.annos[state.selected];
  if (sel) {
    const b = bounds(sel);
    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5 / s;
    ctx.setLineDash([5 / s, 4 / s]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    for (const h of handles(sel)) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#0ea5e9';
      ctx.lineWidth = 1.5 / s;
      const r = 5 / s;
      ctx.beginPath();
      ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Undo / redo / persistence
// ---------------------------------------------------------------------------

function pushUndo() {
  state.undoStack.push({ annos: structuredClone(state.annos), crop: state.crop && { ...state.crop } });
  if (state.undoStack.length > 100) state.undoStack.shift();
  state.redoStack.length = 0;
  updateUndoButtons();
}

function applySnapshot(snap: Snapshot) {
  state.annos = snap.annos;
  state.crop = snap.crop;
  state.selected = -1;
  persistAnnos();
  updateStatus();
  requestRender();
}

function undo() {
  const snap = state.undoStack.pop();
  if (!snap) return;
  state.redoStack.push({ annos: structuredClone(state.annos), crop: state.crop && { ...state.crop } });
  applySnapshot(snap);
  updateUndoButtons();
}

function redo() {
  const snap = state.redoStack.pop();
  if (!snap) return;
  state.undoStack.push({ annos: structuredClone(state.annos), crop: state.crop && { ...state.crop } });
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
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | { kind: 'draw'; anno: Anno }
  | { kind: 'crop' }
  | { kind: 'move'; index: number; lastX: number; lastY: number; moved: boolean }
  | { kind: 'handle'; index: number; id: string };

let drag: Drag = { kind: 'none' };
let spaceDown = false;

canvas.addEventListener('pointerdown', (e) => {
  const wantsPan =
    e.button === 1 ||
    (e.button === 0 && (spaceDown || (state.tool === 'select' && !topHit(e) && !handleHit(e))));
  if (wantsPan) {
    drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, panX: state.pan.x, panY: state.pan.y };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (e.button !== 0 || !state.image) return;
  canvas.setPointerCapture(e.pointerId);
  const p = toImage(e.clientX, e.clientY);
  const st = state.style;

  switch (state.tool) {
    case 'select': {
      const h = handleHit(e);
      if (h) {
        pushUndo();
        drag = { kind: 'handle', index: state.selected, id: h.id };
        return;
      }
      const hit = topHit(e);
      if (hit >= 0) {
        state.selected = hit;
        drag = { kind: 'move', index: hit, lastX: p.x, lastY: p.y, moved: false };
        requestRender();
      }
      return;
    }
    case 'crop':
      state.cropDraft = { x: p.x, y: p.y, w: 0, h: 0 };
      drag = { kind: 'crop' };
      hideCropBar();
      return;
    case 'text':
      openTextEditor(p.x, p.y);
      return;
    case 'emoji': {
      pushUndo();
      state.annos.push({ kind: 'emoji', x: p.x, y: p.y, char: st.emoji, size: st.fontSize * 2 });
      state.selected = state.annos.length - 1;
      persistAnnos();
      requestRender();
      return;
    }
    case 'pen':
      drag = { kind: 'draw', anno: { kind: 'pen', points: [p.x, p.y], color: st.color, width: st.strokeWidth } };
      state.draft = drag.anno;
      return;
    case 'arrow':
    case 'line':
      drag = {
        kind: 'draw',
        anno: { kind: state.tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: st.color, width: st.strokeWidth },
      };
      state.draft = drag.anno;
      return;
    case 'rect':
    case 'ellipse':
      drag = {
        kind: 'draw',
        anno: { kind: state.tool, x: p.x, y: p.y, w: 0, h: 0, color: st.color, width: st.strokeWidth, fill: st.fill },
      };
      state.draft = drag.anno;
      return;
    case 'highlight':
      drag = { kind: 'draw', anno: { kind: 'highlight', x: p.x, y: p.y, w: 0, h: 0, color: st.color === '#0f172a' ? '#eab308' : st.color } };
      state.draft = drag.anno;
      return;
    case 'blur':
      drag = { kind: 'draw', anno: { kind: 'blur', x: p.x, y: p.y, w: 0, h: 0, px: st.blurPx } };
      state.draft = drag.anno;
      return;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = toImage(e.clientX, e.clientY);
  switch (drag.kind) {
    case 'pan':
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
      } else if (a.kind === 'rect' || a.kind === 'ellipse' || a.kind === 'highlight' || a.kind === 'blur') {
        a.w = p.x - a.x;
        a.h = p.y - a.y;
        if (e.shiftKey) {
          const m = Math.max(Math.abs(a.w), Math.abs(a.h));
          a.w = Math.sign(a.w || 1) * m;
          a.h = Math.sign(a.h || 1) * m;
        }
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
      const a = state.annos[drag.index];
      if (!a) return;
      if (!drag.moved) {
        pushUndo();
        drag.moved = true;
      }
      translateAnno(a, p.x - drag.lastX, p.y - drag.lastY);
      drag.lastX = p.x;
      drag.lastY = p.y;
      persistAnnos();
      requestRender();
      return;
    }
    case 'handle': {
      const a = state.annos[drag.index];
      if (!a) return;
      applyHandle(a, drag.id, p.x, p.y);
      persistAnnos();
      requestRender();
      return;
    }
    case 'none':
      updateCursor(e);
  }
});

canvas.addEventListener('pointerup', () => {
  if (drag.kind === 'draw') {
    const a = drag.anno;
    const b = bounds(a);
    const big = b.w > 3 || b.h > 3 || a.kind === 'pen';
    state.draft = null;
    if (big) {
      pushUndo();
      state.annos.push(a);
      state.selected = state.annos.length - 1;
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

function topHit(e: MouseEvent): number {
  const p = toImage(e.clientX, e.clientY);
  const tol = 6 / state.zoom;
  for (let i = state.annos.length - 1; i >= 0; i--) {
    if (hitTest(state.annos[i]!, p.x, p.y, tol)) return i;
  }
  return -1;
}

function handleHit(e: MouseEvent): { id: string } | null {
  const sel = state.annos[state.selected];
  if (!sel) return null;
  for (const h of handles(sel)) {
    const s = toScreen(h.x, h.y);
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < 8) return { id: h.id };
  }
  return null;
}

function updateCursor(e: MouseEvent) {
  if (state.tool === 'select') {
    canvas.style.cursor = handleHit(e) ? 'nwse-resize' : topHit(e) >= 0 ? 'move' : 'grab';
  } else if (state.tool === 'text' || state.tool === 'emoji') {
    canvas.style.cursor = 'text';
  } else {
    canvas.style.cursor = 'crosshair';
  }
}

function snapAngle(a: Extract<Anno, { kind: 'line' | 'arrow' }>) {
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  a.x2 = a.x1 + Math.cos(angle) * len;
  a.y2 = a.y1 + Math.sin(angle) * len;
}

viewport.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      setZoom(state.zoom * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
    } else {
      state.pan.x += (e.shiftKey ? e.deltaY : e.deltaX) / state.zoom;
      state.pan.y += (e.shiftKey ? 0 : e.deltaY) / state.zoom;
      clampView();
      requestRender();
    }
  },
  { passive: false }
);

// ---------------------------------------------------------------------------
// Text editing overlay
// ---------------------------------------------------------------------------

const textEditor = $('#textEditor');
const textArea = textEditor.querySelector('textarea')!;
let textAt = { x: 0, y: 0 };

function openTextEditor(x: number, y: number) {
  textAt = { x, y };
  const s = toScreen(x, y);
  const rect = viewport.getBoundingClientRect();
  textEditor.hidden = false;
  textEditor.style.left = `${s.x - rect.left - 4}px`;
  textEditor.style.top = `${s.y - rect.top - 4}px`;
  const px = state.style.fontSize * state.zoom;
  textArea.style.font = TEXT_FONT(px);
  textArea.style.color = state.style.color;
  textArea.value = '';
  autosizeText();
  setTimeout(() => textArea.focus(), 0);
}

function commitText() {
  const text = textArea.value.trim();
  textEditor.hidden = true;
  if (!text) return;
  pushUndo();
  state.annos.push({ kind: 'text', x: textAt.x, y: textAt.y, text, color: state.style.color, size: state.style.fontSize });
  state.selected = state.annos.length - 1;
  persistAnnos();
  requestRender();
}

function autosizeText() {
  textArea.style.height = 'auto';
  textArea.style.width = 'auto';
  textArea.style.width = `${Math.max(60, textArea.scrollWidth + 8)}px`;
  textArea.style.height = `${textArea.scrollHeight}px`;
}
textArea.addEventListener('input', autosizeText);
textArea.addEventListener('blur', commitText);
textArea.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') {
    textArea.value = '';
    textEditor.hidden = true;
  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    commitText();
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
$('#btnCropReset').addEventListener('click', () => {
  pushUndo();
  state.crop = null;
  persistAnnos();
  fitWidth();
  updateStatus();
});

// ---------------------------------------------------------------------------
// Toolbar / style bar
// ---------------------------------------------------------------------------

function setTool(tool: Tool) {
  state.tool = tool;
  document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
  $('#ctlFont').hidden = tool !== 'text' && tool !== 'emoji';
  $('#ctlWidth').hidden = !['arrow', 'line', 'rect', 'ellipse', 'pen'].includes(tool);
  $('#ctlFill').hidden = tool !== 'rect' && tool !== 'ellipse';
  $('#emojiCurrent').hidden = tool !== 'emoji';
  if (tool !== 'crop') {
    state.cropDraft = null;
    hideCropBar();
  }
  requestRender();
}

document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => {
  b.addEventListener('click', () => setTool(b.dataset.tool as Tool));
});

const swatches = $('#swatches');
for (const color of COLORS) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.style.background = color;
  b.title = color;
  b.addEventListener('click', () => {
    state.style.color = color;
    swatches.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
    b.classList.add('active');
    const sel = state.annos[state.selected];
    if (sel && 'color' in sel) {
      pushUndo();
      sel.color = color;
      persistAnnos();
      requestRender();
    }
  });
  swatches.appendChild(b);
}
swatches.querySelector('.swatch')?.classList.add('active');

$<HTMLSelectElement>('#strokeWidth').addEventListener('change', (e) => {
  state.style.strokeWidth = Number((e.target as HTMLSelectElement).value);
});
$<HTMLSelectElement>('#fontSize').addEventListener('change', (e) => {
  state.style.fontSize = Number((e.target as HTMLSelectElement).value);
});
$<HTMLInputElement>('#fillShape').addEventListener('change', (e) => {
  state.style.fill = (e.target as HTMLInputElement).checked;
});

const emojiPicker = $('#emojiPicker');
for (const em of EMOJI_SET) {
  const b = document.createElement('button');
  b.textContent = em;
  b.addEventListener('click', () => {
    state.style.emoji = em;
    $('#emojiCurrent').textContent = em;
    emojiPicker.hidden = true;
  });
  emojiPicker.appendChild(b);
}
$('#emojiCurrent').addEventListener('click', () => {
  emojiPicker.hidden = !emojiPicker.hidden;
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

async function doDownload(format: ImageFormat | `pdf-${PdfPageMode}`) {
  if (!state.image || !state.record || !state.settings) return;
  try {
    toast('Exporting…');
    if (format.startsWith('pdf')) {
      const mode = format.slice(4) as PdfPageMode;
      const blob = await exportPdf(exportSource(), mode);
      await downloadBlobs([blob], baseName(), 'pdf', state.settings.saveAs);
    } else {
      const fmt = format as ImageFormat;
      const blobs = await exportImages(exportSource(), fmt, state.settings.quality);
      const ext = fmt === 'jpeg' ? 'jpg' : fmt;
      await downloadBlobs(blobs, baseName(), ext, state.settings.saveAs);
      if (blobs.length > 1) toast(`Image exceeded canvas limits - saved as ${blobs.length} numbered files.`);
    }
    toast('Saved ✓');
  } catch (err) {
    toast(`Export failed: ${err}`, true);
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
$('#btnFormat').addEventListener('click', () => {
  formatMenu.hidden = !formatMenu.hidden;
});
formatMenu.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
  b.addEventListener('click', () => {
    formatMenu.hidden = true;
    void doDownload(b.dataset.format as ImageFormat | `pdf-${PdfPageMode}`);
  });
});
document.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('.split')) formatMenu.hidden = true;
  if (!(e.target as HTMLElement).closest('#emojiCurrent, #emojiPicker')) emojiPicker.hidden = true;
  if (!(e.target as HTMLElement).closest('#ctxMenu')) $('#ctxMenu').hidden = true;
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
// History drawer
// ---------------------------------------------------------------------------

const historyPanel = $('#history');
$('#btnHistory').addEventListener('click', () => void toggleHistory());
$('#historyClose').addEventListener('click', () => {
  historyPanel.hidden = true;
});

async function toggleHistory(forceOpen = false) {
  if (!historyPanel.hidden && !forceOpen) {
    historyPanel.hidden = true;
    return;
  }
  await renderHistory();
  historyPanel.hidden = false;
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
    del.title = 'Delete';
    del.textContent = '✕';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteCapture(c.id);
      await renderHistory();
      if (c.id === state.record?.id) location.search = '?history=1';
    });
    li.append(img, meta, del);
    li.addEventListener('click', () => {
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

$('#zoomIn').addEventListener('click', () => setZoom(state.zoom * 1.25));
$('#zoomOut').addEventListener('click', () => setZoom(state.zoom / 1.25));
$('#zoom100').addEventListener('click', () => setZoom(1));
$('#zoomFit').addEventListener('click', fitWidth);
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redo);

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select', c: 'crop', a: 'arrow', l: 'line', r: 'rect', o: 'ellipse',
  p: 'pen', h: 'highlight', t: 'text', b: 'blur', e: 'emoji',
};

document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'INPUT') return;
  const meta = e.metaKey || e.ctrlKey;
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
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected >= 0) {
    pushUndo();
    state.annos.splice(state.selected, 1);
    state.selected = -1;
    persistAnnos();
    requestRender();
  } else if (e.key === 'Escape') {
    state.selected = -1;
    state.cropDraft = null;
    hideCropBar();
    ctxMenu.hidden = true;
    requestRender();
  } else if (!meta && TOOL_KEYS[e.key.toLowerCase()]) {
    setTool(TOOL_KEYS[e.key.toLowerCase()]!);
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') spaceDown = false;
});

new ResizeObserver(() => requestRender()).observe(viewport);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  state.settings = await getSettings();
  $('#btnDownload').textContent = `Download ${FORMAT_LABEL[state.settings.format] ?? 'PNG'}`;
  $('#ctxDownload').textContent = `Download ${FORMAT_LABEL[state.settings.format] ?? 'PNG'}`;

  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (!id) {
    $('#loading').hidden = true;
    $('#emptyState').hidden = false;
    if (params.get('history')) await toggleHistory(true);
    return;
  }

  try {
    const record = await getCapture(id);
    if (!record) throw new Error('Capture not found - it may have been pruned from history.');
    state.record = record;
    document.title = `Screencappy - ${record.title || record.url}`;
    const stored = record as CaptureRecord & { annos?: Anno[]; cropRect?: Rect | null };
    state.annos = stored.annos ?? [];
    state.crop = stored.cropRect ?? null;

    state.image = await loadBigImage(record);
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
      await doDownload(state.settings.format);
    }
  } catch (err) {
    $('#loading').hidden = true;
    $('#emptyState').hidden = false;
    toast(String(err), true);
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

void boot();
