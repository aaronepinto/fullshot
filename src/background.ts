/**
 * screencappy service worker: routes user gestures (toolbar click, shortcuts, context menu)
 * into a capture run, drives the chosen engine, stores tiles in IndexedDB, then opens
 * the editor tab. All capture state lives in IndexedDB so the editor is fully decoupled.
 */
import { getSettings } from './lib/settings';
import { deleteTiles, putCapture, putTile, pruneHistory } from './lib/db';
import {
  BLANK_TRIM,
  BLANK_TRIM_NOTICE,
  DEGRADED_NOTICE,
  HIJACK,
  HIJACK_NOTICE,
  countdownSteps,
  dataUrlToBlob,
  gridPositions,
  isUniform,
  makeRecord,
  mobileMetrics,
  newCaptureId,
} from './lib/capture-common';
import type { HugePageChoice } from './lib/capture-common';
import {
  captureCrossOriginFrame,
  hasDebuggerPermission,
  printToPdf,
  turboCapture,
  turboMobileCapture,
} from './cdp';
import { debuggerAvailable, requestDebuggerPermission } from './lib/debugger-permission';
import { pdfFilename } from './lib/filename';
import type {
  CaptureContentMsg,
  CaptureMode,
  PageMetrics,
  Rect,
  RuntimeMsg,
  ScrollProbe,
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
          : command === 'capture-element'
            ? 'element'
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
  chrome.contextMenus.create({
    id: 'fs-element',
    title: 'Capture an element',
    contexts: ['page', 'action'],
  });
  chrome.contextMenus.create({
    id: 'fs-full-delayed',
    title: 'Capture full page in 5s',
    contexts: ['page', 'action'],
  });
  if (debuggerAvailable()) chrome.contextMenus.create({
    id: 'fs-mobile',
    title: 'Capture as mobile (390px)',
    contexts: ['page', 'action'],
  });
  if (debuggerAvailable()) chrome.contextMenus.create({
    id: 'fs-pdf',
    title: 'Save as searchable PDF',
    contexts: ['page', 'action'],
  });
  chrome.contextMenus.create({ id: 'fs-history', title: 'Capture history', contexts: ['action'] });
  void getSettings().then((s) =>
    chrome.contextMenus.update('fs-mobile', {
      title: `Capture as mobile (${mobileMetrics(s.mobileCaptureWidth).width}px)`,
    })
  );
});

// Keep the mobile menu label in sync with the configured emulation width.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  const width = changes['mobileCaptureWidth']?.newValue;
  if (typeof width === 'number') {
    chrome.contextMenus.update('fs-mobile', {
      title: `Capture as mobile (${mobileMetrics(width).width}px)`,
    });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'fs-history') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('editor.html?history=1') });
    return;
  }
  if (!tab) return;
  if (info.menuItemId === 'fs-pdf') {
    void savePdf(tab);
    return;
  }
  if (info.menuItemId === 'fs-full-delayed') {
    void startCapture(tab, 'full', 5);
    return;
  }
  if (info.menuItemId === 'fs-mobile') {
    void startCapture(tab, 'full', undefined, true);
    return;
  }
  const mode: CaptureMode | null =
    info.menuItemId === 'fs-full'
      ? 'full'
      : info.menuItemId === 'fs-visible'
        ? 'visible'
        : info.menuItemId === 'fs-selection'
          ? 'selection'
          : info.menuItemId === 'fs-element'
            ? 'element'
            : null;
  if (mode) void startCapture(tab, mode);
});

// ---------------------------------------------------------------------------
// Capture orchestration
// ---------------------------------------------------------------------------

async function startCapture(
  tab: chrome.tabs.Tab,
  mode: CaptureMode,
  startDelayOverrideS?: number,
  mobile = false
): Promise<void> {
  const tabId = tab.id;
  if (tabId === undefined || busyTabs.has(tabId)) return;
  busyTabs.add(tabId);
  const badge = badgeFor(tabId);
  try {
    // Mobile emulation needs CDP; requesting before any other await keeps the
    // context menu click's user gesture valid (a no-op prompt when already granted).
    if (mobile) {
      const granted = await requestDebuggerPermission();
      if (!granted) throw new Error('Mobile capture needs the debugger permission.');
    }
    const settings = await getSettings();

    // Countdown on the badge before touching the page, so the user can open
    // menus or hover states first. The tab stays in busyTabs the whole time.
    for (const s of countdownSteps(startDelayOverrideS ?? settings.captureStartDelaySeconds)) {
      await badge.set(String(s));
      await sleep(1000);
    }

    const capId = newCaptureId();
    const injectable = !isRestrictedUrl(tab.url ?? '');

    // Region/element selection happens first, in-page, regardless of engine.
    let selection: Rect | null = null;
    let pickedScroller = false;
    let frameUrl: string | null = null;
    if (mode === 'selection') {
      if (!injectable) throw new Error('This page does not allow region selection.');
      selection = await pickRegion(tabId);
      if (!selection) {
        await badge.clear();
        return; // user cancelled
      }
    } else if (mode === 'element') {
      if (!injectable) throw new Error('This page does not allow element picking.');
      const pick = await pickElement(tabId);
      if (!pick) {
        await badge.clear();
        return; // user cancelled
      }
      // Scrollable containers (including same-origin iframes) get their full content
      // via the inner-scroll machinery; everything else is just a clip over the page.
      // A cross-origin iframe additionally carries its URL for a CDP deep capture.
      if (pick.scrollable) pickedScroller = true;
      else selection = pick.rect;
      frameUrl = pick.frameUrl ?? null;
    }

    await badge.set('…');

    let clip: Rect;
    let tileCount: number;
    let truncated = false;
    let notice: string | undefined;
    let engine = settings.engine;
    let title = tab.title ?? '';
    let url = tab.url ?? '';

    // Cross-origin iframe pick: try a CDP deep capture of the frame's full content
    // first; null means unavailable or failed, and the chain below then clips the
    // iframe's visible box via `selection` so the user always gets something.
    const frameResult = frameUrl
      ? await frameDeepCapture(tabId, capId, frameUrl, settings.maxCaptureHeight, badge)
      : null;

    if (frameResult) {
      engine = 'turbo';
      ({ clip, tileCount, truncated } = frameResult);
    } else if (mobile) {
      // Device emulation reflows the page to a phone-width layout without touching
      // the real window; tiles land in IndexedDB like any other Turbo capture.
      if (!injectable) throw new Error('This page cannot be captured with device emulation.');
      engine = 'turbo';
      const result = await turboMobileCapture(
        tabId,
        capId,
        settings.mobileCaptureWidth,
        settings.maxCaptureHeight,
        (done, total) => void badge.set(`${Math.round((done / total) * 100)}%`)
      );
      ({ clip, tileCount, truncated } = result);
    } else if (mode === 'visible' || !injectable) {
      // Single shot; also the graceful fallback on chrome:// pages and the Web Store.
      ({ clip, tileCount } = await captureVisibleSingle(tab, capId));
      engine = 'stitch';
      mode = mode === 'selection' ? mode : 'visible';
    } else if (engine === 'turbo' && !pickedScroller && (await hasDebuggerPermission())) {
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
      const result = await stitchCapture(tab, capId, selection, pickedScroller, settings, (done, total) =>
        badge.set(`${Math.round((done / total) * 100)}%`)
      );
      // Null means the user cancelled at the impossible-height prompt: nothing was
      // captured and nothing was changed, so there is nothing to report either.
      if (!result) {
        await deleteTiles(capId).catch(() => undefined);
        await badge.clear();
        return;
      }
      ({ clip, tileCount, truncated, notice } = result);
      title = result.title || title;
      url = result.url || url;
    }

    const record = makeRecord({
      id: capId,
      mode,
      engine,
      title,
      url,
      tileCount,
      truncated,
      clip,
      ...(notice ? { notice } : {}),
    });
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
// Searchable PDF export (CDP Page.printToPDF, downloads directly)
// ---------------------------------------------------------------------------

/**
 * Prints the tab to a real PDF with selectable text and downloads it straight to
 * disk, skipping the editor. Requesting the debugger permission first, before any
 * other await, keeps the context menu click's user gesture valid; when already
 * granted the request resolves true without prompting.
 */
async function savePdf(tab: chrome.tabs.Tab): Promise<void> {
  const tabId = tab.id;
  if (tabId === undefined || busyTabs.has(tabId)) return;
  busyTabs.add(tabId);
  const badge = badgeFor(tabId);
  try {
    if (isRestrictedUrl(tab.url ?? '')) throw new Error('This page cannot be printed to PDF.');
    const granted = await requestDebuggerPermission();
    if (!granted) throw new Error('Searchable PDF needs the debugger permission.');
    await badge.set('…');
    const base64 = await printToPdf(tabId);
    const settings = await getSettings();
    // Service workers have no createObjectURL; downloads accept data: URLs.
    await chrome.downloads.download({
      url: `data:application/pdf;base64,${base64}`,
      filename: pdfFilename(settings.filenameTemplate, {
        title: tab.title ?? '',
        url: tab.url ?? '',
        mode: 'pdf',
      }),
      saveAs: settings.saveAs,
    });
    await badge.clear();
  } catch (err) {
    console.error('[screencappy] pdf export failed', err);
    await badge.set('ERR', '#dc2626');
    setTimeout(() => void badge.clear(), 4000);
  } finally {
    busyTabs.delete(tabId);
  }
}

// ---------------------------------------------------------------------------
// Iframe deep capture (cross-origin, CDP)
// ---------------------------------------------------------------------------

/**
 * Best-effort full-content capture of a cross-origin iframe. Only runs when the
 * debugger permission is already granted; any failure (frame target not found,
 * attach refused, CDP error) returns null after clearing partial tiles so the
 * caller falls back to clipping the iframe's visible box.
 */
async function frameDeepCapture(
  tabId: number,
  capId: string,
  frameUrl: string,
  maxHeight: number,
  badge: ReturnType<typeof badgeFor>
): Promise<{ clip: Rect; tileCount: number; truncated: boolean } | null> {
  if (!(await hasDebuggerPermission())) return null;
  try {
    return await captureCrossOriginFrame(
      tabId,
      capId,
      frameUrl,
      maxHeight,
      (done, total) => void badge.set(`${Math.round((done / total) * 100)}%`)
    );
  } catch (err) {
    console.warn('[screencappy] iframe deep capture failed, falling back to visible box', err);
    await deleteTiles(capId).catch(() => undefined);
    return null;
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
  notice?: string;
}

async function stitchCapture(
  tab: chrome.tabs.Tab,
  capId: string,
  selection: Rect | null,
  pickedScroller: boolean,
  settings: Awaited<ReturnType<typeof getSettings>>,
  onProgress: (done: number, total: number) => void
): Promise<StitchResult | null> {
  const tabId = tab.id!;
  await ensureContentScript(tabId, 'content-capture.js');
  let allowHuge = false;
  let metrics = await sendToTab<PageMetrics>(tabId, {
    type: 'fs:measure',
    maxHeight: settings.maxCaptureHeight,
    usePicked: pickedScroller,
  });

  // A page reporting a height nothing could walk is a decision, not a defect to route
  // around: capturing the first screenful and capturing the ceiling's worth are both
  // reasonable, and which one is right depends on what the page actually is. Ask before
  // touching anything, unless the user has already said what they want.
  if (metrics.degraded === 'huge') {
    const choice: HugePageChoice =
      settings.hugePageAction === 'ask'
        ? await sendToTab<HugePageChoice>(tabId, {
            type: 'fs:askHugePage',
            reportedHeight: metrics.reportedH ?? 0,
            limitHeight: settings.maxCaptureHeight,
          })
        : settings.hugePageAction;
    if (choice === 'cancel') return null;
    if (choice === 'limit') {
      // Take the page at its word, capped at the ceiling, exactly like any other page
      // taller than the limit. The blank-run trim below is what keeps that affordable.
      allowHuge = true;
      metrics = await sendToTab<PageMetrics>(tabId, {
        type: 'fs:measure',
        maxHeight: settings.maxCaptureHeight,
        usePicked: pickedScroller,
        allowHuge,
      });
    }
  }

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

  const remeasure = async () => {
    metrics = await sendToTab<PageMetrics>(tabId, {
      type: 'fs:measure',
      maxHeight: settings.maxCaptureHeight,
      usePicked: pickedScroller,
      allowHuge,
    });
    clip = clipFor(metrics);
  };

  try {
    // What is left after the decision above: the page limits the capture to the visible
    // area on its own terms, and all the engine can do is say why.
    let notice = metrics.degraded ? DEGRADED_NOTICE[metrics.degraded] : undefined;

    // Pages that drive their own scrolling report a tall page but never move, which
    // would stitch the same frame into every tile. The probe tries to get them moving
    // and, failing that, keeps the capture honest: the visible area plus a note.
    if (
      !notice &&
      !pickedScroller &&
      !metrics.containerRect &&
      clip.h > metrics.vpH + HIJACK.minOverflow
    ) {
      const probe = await sendToTab<ScrollProbe>(tabId, {
        type: 'fs:probeScroll',
        maxY: clip.y + clip.h,
      });
      if (probe.recovered) await remeasure();
      else if (probe.blocked) {
        notice = HIJACK_NOTICE;
        clip = intersect(clip, { x: 0, y: 0, w: metrics.vpW, h: metrics.vpH });
      }
    }

    if (
      !notice &&
      (settings.prescroll || settings.autoLoadMore) &&
      clip.h > (metrics.containerRect?.h ?? metrics.vpH)
    ) {
      await sendToTab(tabId, {
        type: 'fs:prescroll',
        stepY: metrics.containerRect?.h ?? metrics.vpH,
        maxY: clip.y + clip.h,
        ...(settings.autoLoadMore ? { autoLoadMaxHeight: settings.maxCaptureHeight } : {}),
      });
      // Lazy-loaded content can grow the page; re-measure so the grid covers it.
      await remeasure();
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

    // A capture already cut short at the height ceiling is walking a page that claims
    // more than it has, so a run of identical blank frames means the content ended and
    // the rest of the grid is a minute spent on nothing. Pages whose real height is known
    // are never trimmed: every tile of those was asked for and every tile is kept.
    const trimBlank = metrics.truncated;
    let blankRun = 0;
    let contentBottom = clip.y;
    let sawContent = false;

    let index = 0;
    walk: for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < cols.length; c++) {
        const pos = await sendToTab<ScrollResult>(tabId, {
          type: 'fs:scrollTo',
          x: cols[c]!,
          y: rows[r]!,
          settleMs: settings.captureDelayMs,
          firstTile: r === 0 && c === 0,
          lastTile: r === rows.length - 1 && c === cols.length - 1,
        });
        const dataUrl = await captureVisibleThrottled(tab.windowId);
        const blob = await dataUrlToBlob(dataUrl);
        await putTile({
          key: `${capId}:${index}`,
          capId,
          index,
          x: pos.x,
          y: pos.y,
          cssW: metrics.vpW,
          cssH: metrics.vpH,
          ...(crop ? { crop } : {}),
          blob,
        });
        index++;
        onProgress(index, total);

        if (!trimBlank) continue;
        if (await isBlankTile(blob)) {
          blankRun++;
          // Blank tiles before the trim point still have to be stored, or the composed
          // image would have a hole where one was skipped.
          if (sawContent && blankRun >= BLANK_TRIM.runTiles) {
            clip = { ...clip, h: contentBottom - clip.y };
            notice = BLANK_TRIM_NOTICE;
            break walk;
          }
        } else {
          blankRun = 0;
          sawContent = true;
          contentBottom = Math.min(pos.y + stepH, clip.y + clip.h);
        }
      }
    }
    return {
      clip,
      tileCount: index,
      truncated: metrics.truncated,
      title: metrics.title,
      url: metrics.url,
      ...(notice ? { notice } : {}),
    };
  } finally {
    await sendToTab(tabId, { type: 'fs:restore' }).catch(() => undefined);
  }
}

/**
 * Whether a tile holds nothing at all. The bitmap is drawn down to a small square first,
 * so the question costs one downscale rather than a pass over two million pixels, and a
 * page that only paints a flat colour there answers the same either way. A decode that
 * fails answers "not blank", which keeps the walk going rather than cutting it short.
 */
async function isBlankTile(blob: Blob): Promise<boolean> {
  try {
    const bmp = await createImageBitmap(blob);
    const size = BLANK_TRIM.sampleSize;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, 0, size, size);
    bmp.close();
    return isUniform(ctx.getImageData(0, 0, size, size).data, BLANK_TRIM.tolerance);
  } catch {
    return false;
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
// Element picking
// ---------------------------------------------------------------------------

interface ElementPick {
  rect: Rect;
  scrollable: boolean;
  /** Resolved src of a picked cross-origin iframe. */
  frameUrl?: string;
}

function pickElement(tabId: number): Promise<ElementPick | null> {
  return new Promise<ElementPick | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 180_000);
    const onMessage = (msg: RuntimeMsg, sender: chrome.runtime.MessageSender) => {
      if (sender.tab?.id !== tabId) return;
      if (msg.type === 'fs:element') {
        cleanup();
        resolve({ rect: msg.rect, scrollable: msg.scrollable, frameUrl: msg.frameUrl });
      } else if (msg.type === 'fs:element-cancel') {
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
      .executeScript({ target: { tabId }, files: ['content-element.js'] })
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
    // Sky is the product's one accent, so progress wears it. The error calls pass
    // a red instead, which is functional rather than decorative.
    async set(text: string, color = '#38bdf8') {
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
