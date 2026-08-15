/**
 * Screencappy service worker: routes user gestures (toolbar click, shortcuts, context menu)
 * into a capture run, drives the chosen engine, stores tiles in IndexedDB, then opens
 * the editor tab. All capture state lives in IndexedDB so the editor is fully decoupled.
 */
import { getSettings } from './lib/settings';
import { putCapture, putTile, pruneHistory } from './lib/db';
import { dataUrlToBlob, gridPositions, makeRecord, newCaptureId } from './lib/capture-common';
import { hasDebuggerPermission, turboCapture } from './cdp';
import type {
  CaptureContentMsg,
  CaptureMode,
  PageMetrics,
  Rect,
  RuntimeMsg,
  ScrollResult,
} from './lib/types';

const busyTabs = new Set<number>();

// ---------------------------------------------------------------------------
// Gesture wiring
// ---------------------------------------------------------------------------

chrome.action.onClicked.addListener((tab) => void startCapture(tab, 'full'));

chrome.commands.onCommand.addListener((command, tab) => {
  const mode: CaptureMode | null =
    command === 'capture-full'
      ? 'full'
      : command === 'capture-visible'
        ? 'visible'
        : command === 'capture-selection'
          ? 'selection'
          : null;
  if (mode && tab) void startCapture(tab, mode);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'fs-full',
    title: 'Capture full page',
    contexts: ['page', 'action'],
  });
  chrome.contextMenus.create({
    id: 'fs-visible',
    title: 'Capture visible area',
    contexts: ['page', 'action'],
  });
  chrome.contextMenus.create({
    id: 'fs-selection',
    title: 'Capture a region…',
    contexts: ['page', 'action'],
  });
  chrome.contextMenus.create({ id: 'fs-history', title: 'Capture history', contexts: ['action'] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'fs-history') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('editor.html?history=1') });
    return;
  }
  if (!tab) return;
  const mode: CaptureMode | null =
    info.menuItemId === 'fs-full'
      ? 'full'
      : info.menuItemId === 'fs-visible'
        ? 'visible'
        : info.menuItemId === 'fs-selection'
          ? 'selection'
          : null;
  if (mode) void startCapture(tab, mode);
});

// ---------------------------------------------------------------------------
// Capture orchestration
// ---------------------------------------------------------------------------

async function startCapture(tab: chrome.tabs.Tab, mode: CaptureMode): Promise<void> {
  const tabId = tab.id;
  if (tabId === undefined || busyTabs.has(tabId)) return;
  busyTabs.add(tabId);
  const badge = badgeFor(tabId);
  try {
    const settings = await getSettings();
    const capId = newCaptureId();
    const injectable = !isRestrictedUrl(tab.url ?? '');

    // Region selection happens first, in-page, regardless of engine.
    let selection: Rect | null = null;
    if (mode === 'selection') {
      if (!injectable) throw new Error('This page does not allow region selection.');
      selection = await pickRegion(tabId);
      if (!selection) return; // user cancelled
    }

    await badge.set('…');

    let clip: Rect;
    let tileCount: number;
    let truncated = false;
    let engine = settings.engine;
    let title = tab.title ?? '';
    let url = tab.url ?? '';

    if (mode === 'visible' || !injectable) {
      // Single shot; also the graceful fallback on chrome:// pages and the Web Store.
      ({ clip, tileCount } = await captureVisibleSingle(tab, capId));
      engine = 'stitch';
      mode = mode === 'selection' ? mode : 'visible';
    } else if (engine === 'turbo' && (await hasDebuggerPermission())) {
      const result = await turboCapture(
        tabId,
        capId,
        selection,
        settings.maxCaptureHeight,
        (done, total) => void badge.set(`${Math.round((done / total) * 100)}%`)
      );
      ({ clip, tileCount, truncated } = result);
    } else {
      engine = 'stitch';
      const result = await stitchCapture(tab, capId, selection, settings, (done, total) =>
        badge.set(`${Math.round((done / total) * 100)}%`)
      );
      ({ clip, tileCount, truncated } = result);
      title = result.title || title;
      url = result.url || url;
    }

    const record = makeRecord({ id: capId, mode, engine, title, url, tileCount, truncated, clip });
    await putCapture(record);
    await pruneHistory(settings.historyLimit);

    const params = new URLSearchParams({ id: capId });
    if (settings.afterCapture !== 'editor') params.set('autodownload', '1');
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`editor.html?${params}`),
      index: tab.index + 1,
      openerTabId: tabId,
    });
    await badge.clear();
  } catch (err) {
    console.error('[screencappy] capture failed', err);
    await badge.set('ERR', '#dc2626');
    setTimeout(() => void badge.clear(), 4000);
  } finally {
    busyTabs.delete(tabId);
  }
}

// ---------------------------------------------------------------------------
// Engine: scroll & stitch (activeTab only - the privacy-first default)
// ---------------------------------------------------------------------------

interface StitchResult {
  clip: Rect;
  tileCount: number;
  truncated: boolean;
  title: string;
  url: string;
}

async function stitchCapture(
  tab: chrome.tabs.Tab,
  capId: string,
  selection: Rect | null,
  settings: Awaited<ReturnType<typeof getSettings>>,
  onProgress: (done: number, total: number) => void
): Promise<StitchResult> {
  const tabId = tab.id!;
  await ensureContentScript(tabId, 'content-capture.js');
  let metrics = await sendToTab<PageMetrics>(tabId, {
    type: 'fs:measure',
    maxHeight: settings.maxCaptureHeight,
  });

  const clipFor = (m: PageMetrics): Rect => {
    const page: Rect = { x: 0, y: 0, w: m.pageW, h: m.pageH };
    if (!selection) return page;
    // Selections are in document coords; container content coords differ by the
    // container's on-screen origin and its scroll position at measure time.
    const sel = m.containerRect
      ? {
          x: selection.x - m.containerRect.x + m.scrollX,
          y: selection.y - m.containerRect.y + m.scrollY,
          w: selection.w,
          h: selection.h,
        }
      : selection;
    return intersect(sel, page);
  };
  let clip = clipFor(metrics);
  if (clip.w < 1 || clip.h < 1) throw new Error('Empty capture region');

  await sendToTab(tabId, {
    type: 'fs:prepare',
    hideSticky: settings.hideSticky,
    freezeAnimations: settings.freezeAnimations,
  });

  try {
    if (settings.prescroll && clip.h > (metrics.containerRect?.h ?? metrics.vpH)) {
      await sendToTab(tabId, {
        type: 'fs:prescroll',
        stepY: metrics.containerRect?.h ?? metrics.vpH,
        maxY: clip.y + clip.h,
      });
      // Lazy-loaded content can grow the page; re-measure so the grid covers it.
      metrics = await sendToTab<PageMetrics>(tabId, {
        type: 'fs:measure',
        maxHeight: settings.maxCaptureHeight,
      });
      clip = clipFor(metrics);
    }

    // Build the scroll grid. Positions are clamped by the page itself; we record
    // the actual scroll offsets so stitching never depends on the plan being honored.
    // A scroll container caps each step at its visible client area, not the window.
    const crop = metrics.containerRect;
    const stepW = crop?.w ?? metrics.vpW;
    const stepH = crop?.h ?? metrics.vpH;
    const cols = gridPositions(clip.x, clip.w, stepW, metrics.pageW - stepW);
    const rows = gridPositions(clip.y, clip.h, stepH, metrics.pageH - stepH);
    const total = cols.length * rows.length;
    if (total > 600) throw new Error(`Page needs ${total} tiles - beyond the safety limit.`);

    let index = 0;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < cols.length; c++) {
        const pos = await sendToTab<ScrollResult>(tabId, {
          type: 'fs:scrollTo',
          x: cols[c]!,
          y: rows[r]!,
          settleMs: settings.captureDelayMs,
          hideFixed: r > 0 || c > 0,
        });
        const dataUrl = await captureVisibleThrottled(tab.windowId);
        await putTile({
          key: `${capId}:${index}`,
          capId,
          index,
          x: pos.x,
          y: pos.y,
          cssW: metrics.vpW,
          cssH: metrics.vpH,
          ...(crop ? { crop } : {}),
          blob: await dataUrlToBlob(dataUrl),
        });
        index++;
        onProgress(index, total);
      }
    }
    return {
      clip,
      tileCount: index,
      truncated: metrics.truncated,
      title: metrics.title,
      url: metrics.url,
    };
  } finally {
    await sendToTab(tabId, { type: 'fs:restore' }).catch(() => undefined);
  }
}

async function captureVisibleSingle(
  tab: chrome.tabs.Tab,
  capId: string
): Promise<{ clip: Rect; tileCount: number }> {
  const dataUrl = await captureVisibleThrottled(tab.windowId);
  const cssW = tab.width ?? 0;
  const cssH = tab.height ?? 0;
  await putTile({
    key: `${capId}:0`,
    capId,
    index: 0,
    x: 0,
    y: 0,
    cssW,
    cssH,
    blob: await dataUrlToBlob(dataUrl),
  });
  return { clip: { x: 0, y: 0, w: cssW, h: cssH }, tileCount: 1 };
}

// captureVisibleTab is quota-limited to ~2 calls/sec; space calls and retry on quota errors.
let lastShotAt = 0;
async function captureVisibleThrottled(windowId: number): Promise<string> {
  const MIN_GAP = 550;
  for (let attempt = 0; ; attempt++) {
    const wait = lastShotAt + MIN_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    lastShotAt = Date.now();
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (err) {
      if (attempt < 4 && String(err).includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
        await sleep(700);
        continue;
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Region selection
// ---------------------------------------------------------------------------

function pickRegion(tabId: number): Promise<Rect | null> {
  return new Promise<Rect | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 180_000);
    const onMessage = (msg: RuntimeMsg, sender: chrome.runtime.MessageSender) => {
      if (sender.tab?.id !== tabId) return;
      if (msg.type === 'fs:selection') {
        cleanup();
        resolve(msg.rect);
      } else if (msg.type === 'fs:selection-cancel') {
        cleanup();
        resolve(null);
      }
    };
    const cleanup = () => {
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(onMessage);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.scripting
      .executeScript({ target: { tabId }, files: ['content-select.js'] })
      .catch((err) => {
        cleanup();
        reject(err);
      });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureContentScript(tabId: number, file: string): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'fs:ping' } satisfies CaptureContentMsg);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
  }
}

async function sendToTab<T = void>(tabId: number, msg: CaptureContentMsg): Promise<T> {
  const res = (await chrome.tabs.sendMessage(tabId, msg)) as T | { __err: string };
  if (res && typeof res === 'object' && '__err' in res) {
    throw new Error((res as { __err: string }).__err);
  }
  return res as T;
}

function isRestrictedUrl(url: string): boolean {
  if (!url) return true;
  if (/^(chrome|chrome-extension|devtools|edge|about|view-source|chrome-untrusted):/.test(url)) {
    return true;
  }
  return /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url);
}

function intersect(a: Rect, b: Rect): Rect {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

function badgeFor(tabId: number) {
  return {
    async set(text: string, color = '#0ea5e9') {
      await chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => undefined);
      await chrome.action.setBadgeText({ tabId, text }).catch(() => undefined);
    },
    async clear() {
      await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Test hook: lets the e2e harness drive a capture without a user gesture (the
// harness grants host permissions in its patched manifest). Inert otherwise -
// only code running inside the extension's own service worker can reach it.
(globalThis as { __screencappyStart?: typeof startCapture }).__screencappyStart = startCapture;
