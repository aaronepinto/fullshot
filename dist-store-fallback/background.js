"use strict";
(() => {
  // src/lib/settings.ts
  var DEFAULTS = {
    engine: "stitch",
    format: "png",
    quality: 0.92,
    filenameTemplate: "{domain} {date} {time}",
    captureDelayMs: 150,
    captureStartDelaySeconds: 0,
    hideSticky: true,
    freezeAnimations: true,
    prescroll: true,
    autoLoadMore: false,
    afterCapture: "editor",
    pdfPageMode: "single",
    saveAs: false,
    maxCaptureHeight: 4e4,
    mobileCaptureWidth: 390,
    historyLimit: 30
  };
  async function getSettings() {
    const stored = await chrome.storage.sync.get({ ...DEFAULTS });
    return { ...DEFAULTS, ...stored };
  }

  // src/lib/db.ts
  var DB_NAME = "screencappy";
  var DB_VERSION = 1;
  var dbPromise = null;
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const captures = db.createObjectStore("captures", { keyPath: "id" });
        captures.createIndex("createdAt", "createdAt");
        db.createObjectStore("tiles", { keyPath: "key" }).createIndex("capId", "capId");
        db.createObjectStore("strips", { keyPath: "key" }).createIndex("capId", "capId");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  function tx(stores, mode, run) {
    return open().then(
      (db) => new Promise((resolve, reject) => {
        const t = db.transaction(stores, mode);
        t.onerror = () => reject(t.error);
        const out = run(t);
        if (out instanceof IDBRequest) {
          out.onsuccess = () => resolve(out.result);
          out.onerror = () => reject(out.error);
        } else {
          out.then(resolve, reject);
        }
      })
    );
  }
  var putCapture = (c) => tx(["captures"], "readwrite", (t) => t.objectStore("captures").put(c));
  var listCaptures = async () => {
    const all = await tx(
      ["captures"],
      "readonly",
      (t) => t.objectStore("captures").getAll()
    );
    return all.sort((a, b) => b.createdAt - a.createdAt);
  };
  var putTile = (tile) => tx(["tiles"], "readwrite", (t) => t.objectStore("tiles").put(tile));
  async function deleteByIndex(store, capId) {
    await tx([store], "readwrite", async (t) => {
      const idx = t.objectStore(store).index("capId");
      await new Promise((resolve, reject) => {
        const req = idx.openCursor(capId);
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return resolve();
          cursor.delete();
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      });
    });
  }
  var deleteTiles = (capId) => deleteByIndex("tiles", capId);
  var deleteStrips = (capId) => deleteByIndex("strips", capId);
  async function deleteCapture(capId) {
    await tx(["captures"], "readwrite", (t) => t.objectStore("captures").delete(capId));
    await deleteTiles(capId);
    await deleteStrips(capId);
  }
  async function pruneHistory(limit) {
    const all = await listCaptures();
    for (const old of all.slice(Math.max(1, limit))) {
      await deleteCapture(old.id);
    }
  }

  // src/lib/capture-common.ts
  function newCaptureId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
  function makeRecord(opts) {
    return {
      id: opts.id,
      createdAt: Date.now(),
      mode: opts.mode,
      engine: opts.engine,
      title: opts.title,
      url: opts.url,
      width: 0,
      height: 0,
      tileCount: opts.tileCount,
      status: "tiles",
      truncated: opts.truncated,
      clip: opts.clip,
      ...opts.notice ? { notice: opts.notice } : {}
    };
  }
  async function dataUrlToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return res.blob();
  }
  function gridPositions(start, span, step, maxScroll) {
    const positions = [];
    const limit = Math.max(0, maxScroll);
    for (let v = start; v < start + span; v += step) {
      const clamped = Math.max(0, Math.min(v, limit));
      if (positions[positions.length - 1] !== clamped) positions.push(clamped);
      if (clamped >= limit && v > start) break;
    }
    return positions.length ? positions : [0];
  }
  function countdownSteps(seconds) {
    const n = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
    const steps = [];
    for (let s = n; s > 0; s--) steps.push(s);
    return steps;
  }
  var HIJACK = {
    /** Page height over the viewport before a stuck scroll is worth reporting, CSS px. */
    minOverflow: 200,
    /** Fraction of the commanded offset that counts as the page really having moved. */
    moveRatio: 0.5,
    /**
     * Viewport fractions hit-tested for content that has to move when the page scrolls.
     * A grid rather than one point: a single sample down the middle would miss a page
     * whose content sits in a side column.
     */
    anchorXs: [0.25, 0.5, 0.75],
    anchorYs: [0.3, 0.5, 0.7]
  };
  var HIJACK_NOTICE = "This page uses custom scrolling that blocks full-page capture; captured the visible area";
  function pickFrameTarget(targets, frameUrl) {
    const frames = targets.filter((t) => t.type === "iframe");
    const exact = frames.find((t) => t.url === frameUrl);
    if (exact) return exact;
    const noHash = (u) => u.split("#", 1)[0] ?? u;
    const want = noHash(frameUrl);
    const loose = frames.find((t) => noHash(t.url) === want);
    if (loose) return loose;
    return frames.length === 1 ? frames[0] : null;
  }
  function mobileMetrics(width) {
    const w = Number.isFinite(width) ? Math.round(width) : 390;
    return {
      width: Math.min(1200, Math.max(240, w)),
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    };
  }
  function segmentRects(clip, segH) {
    const segments = [];
    for (let y = clip.y; y < clip.y + clip.h; y += segH) {
      segments.push({ x: clip.x, y, w: clip.w, h: Math.min(segH, clip.y + clip.h - y) });
    }
    return segments;
  }
  function base64ToBlob(base64, type) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  // src/lib/debugger-permission.ts
  function debuggerAvailable() {
    return typeof chrome.debugger !== "undefined";
  }
  async function hasDebuggerPermission() {
    if (!debuggerAvailable()) return false;
    try {
      return await chrome.permissions.contains({ permissions: ["debugger"] });
    } catch {
      return false;
    }
  }
  async function requestDebuggerPermission() {
    return hasDebuggerPermission();
  }

  // src/cdp.ts
  var PROTOCOL = "1.3";
  var SEGMENT_H = 4e3;
  async function printToPdf(tabId) {
    const target = { tabId };
    await chrome.debugger.attach(target, PROTOCOL);
    try {
      const res = await chrome.debugger.sendCommand(target, "Page.printToPDF", {
        printBackground: true
      });
      if (!res.data) throw new Error("Page.printToPDF returned no data");
      return res.data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`PDF print failed, the page may be too large to print: ${msg}`);
    } finally {
      await chrome.debugger.detach(target).catch(() => void 0);
    }
  }
  async function turboCapture(tabId, capId, requestedClip, maxHeight, onProgress) {
    const target = { tabId };
    await chrome.debugger.attach(target, PROTOCOL);
    try {
      return await captureViaSession(target, capId, requestedClip, maxHeight, onProgress);
    } finally {
      await chrome.debugger.detach(target).catch(() => void 0);
    }
  }
  async function turboMobileCapture(tabId, capId, width, maxHeight, onProgress) {
    const target = { tabId };
    await chrome.debugger.attach(target, PROTOCOL);
    try {
      await chrome.debugger.sendCommand(
        target,
        "Emulation.setDeviceMetricsOverride",
        mobileMetrics(width)
      );
      await new Promise((r) => setTimeout(r, 500));
      return await captureViaSession(target, capId, null, maxHeight, onProgress);
    } finally {
      await chrome.debugger.sendCommand(target, "Emulation.clearDeviceMetricsOverride").catch(() => void 0);
      await chrome.debugger.detach(target).catch(() => void 0);
    }
  }
  async function captureCrossOriginFrame(tabId, capId, frameUrl, maxHeight, onProgress) {
    const target = { tabId };
    await chrome.debugger.attach(target, PROTOCOL);
    try {
      const { targetInfos } = await chrome.debugger.sendCommand(target, "Target.getTargets");
      const frame = pickFrameTarget(targetInfos ?? [], frameUrl);
      if (!frame) throw new Error(`No debug target found for frame ${frameUrl}`);
      const { sessionId } = await chrome.debugger.sendCommand(target, "Target.attachToTarget", {
        targetId: frame.targetId,
        flatten: true
      });
      return await captureViaSession({ tabId, sessionId }, capId, null, maxHeight, onProgress);
    } finally {
      await chrome.debugger.detach(target).catch(() => void 0);
    }
  }
  async function captureViaSession(session, capId, requestedClip, maxHeight, onProgress) {
    const metrics = await chrome.debugger.sendCommand(session, "Page.getLayoutMetrics");
    const size = metrics.cssContentSize ?? metrics.contentSize;
    if (!size) throw new Error("Could not measure page via CDP");
    const dprEval = await chrome.debugger.sendCommand(session, "Runtime.evaluate", {
      expression: "window.devicePixelRatio",
      returnByValue: true
    });
    const dpr = Math.min(3, Number(dprEval.result?.value) || 1);
    const page = { x: 0, y: 0, w: Math.ceil(size.width), h: Math.ceil(size.height) };
    let clip = requestedClip ? intersect(requestedClip, page) : page;
    let truncated = false;
    if (clip.h > maxHeight) {
      clip = { ...clip, h: maxHeight };
      truncated = true;
    }
    if (clip.w < 1 || clip.h < 1) throw new Error("Empty capture region");
    const segments = segmentRects(clip, SEGMENT_H);
    let index = 0;
    for (const seg of segments) {
      const shot = await chrome.debugger.sendCommand(session, "Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        fromSurface: true,
        clip: { x: seg.x, y: seg.y, width: seg.w, height: seg.h, scale: dpr }
      });
      await putTile({
        key: `${capId}:${index}`,
        capId,
        index,
        x: seg.x,
        y: seg.y,
        cssW: seg.w,
        cssH: seg.h,
        blob: base64ToBlob(shot.data, "image/png")
      });
      index++;
      onProgress(index, segments.length);
    }
    return { clip, tileCount: segments.length, truncated };
  }
  function intersect(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
  }

  // src/lib/filename.ts
  function renderFilename(template, info) {
    const when = info.when ?? /* @__PURE__ */ new Date();
    const pad = (n) => String(n).padStart(2, "0");
    let domain = "";
    let urlPath = "";
    try {
      const u = new URL(info.url);
      domain = u.hostname.replace(/^www\./, "");
      urlPath = `${domain}${u.pathname}`;
    } catch {
      domain = "page";
      urlPath = "page";
    }
    const tokens = {
      title: info.title || domain || "capture",
      domain,
      url: urlPath,
      date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`,
      time: `${pad(when.getHours())}.${pad(when.getMinutes())}.${pad(when.getSeconds())}`,
      mode: info.mode
    };
    const raw = template.replace(/\{(\w+)\}/g, (m, key) => tokens[key] ?? m);
    return sanitizeFilename(raw) || "screencappy";
  }
  function pdfFilename(template, info) {
    return `${renderFilename(template, info)}.pdf`;
  }
  function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>| -]/g, "-").replace(/\s+/g, " ").replace(/^[\s.-]+|[\s.-]+$/g, "").slice(0, 180);
  }

  // src/background.ts
  var busyTabs = /* @__PURE__ */ new Set();
  chrome.action.onClicked.addListener((tab) => void startCapture(tab, "full"));
  chrome.commands.onCommand.addListener((command, tab) => {
    const mode = command === "capture-full" ? "full" : command === "capture-visible" ? "visible" : command === "capture-selection" ? "selection" : command === "capture-element" ? "element" : null;
    if (mode && tab) void startCapture(tab, mode);
  });
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: "fs-full",
      title: "Capture full page",
      contexts: ["page", "action"]
    });
    chrome.contextMenus.create({
      id: "fs-visible",
      title: "Capture visible area",
      contexts: ["page", "action"]
    });
    chrome.contextMenus.create({
      id: "fs-selection",
      title: "Capture a region\u2026",
      contexts: ["page", "action"]
    });
    chrome.contextMenus.create({
      id: "fs-element",
      title: "Capture an element",
      contexts: ["page", "action"]
    });
    chrome.contextMenus.create({
      id: "fs-full-delayed",
      title: "Capture full page in 5s",
      contexts: ["page", "action"]
    });
    if (debuggerAvailable()) chrome.contextMenus.create({
      id: "fs-mobile",
      title: "Capture as mobile (390px)",
      contexts: ["page", "action"]
    });
    if (debuggerAvailable()) chrome.contextMenus.create({
      id: "fs-pdf",
      title: "Save as searchable PDF",
      contexts: ["page", "action"]
    });
    chrome.contextMenus.create({ id: "fs-history", title: "Capture history", contexts: ["action"] });
    void getSettings().then(
      (s) => chrome.contextMenus.update("fs-mobile", {
        title: `Capture as mobile (${mobileMetrics(s.mobileCaptureWidth).width}px)`
      })
    );
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const width = changes["mobileCaptureWidth"]?.newValue;
    if (typeof width === "number") {
      chrome.contextMenus.update("fs-mobile", {
        title: `Capture as mobile (${mobileMetrics(width).width}px)`
      });
    }
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "fs-history") {
      void chrome.tabs.create({ url: chrome.runtime.getURL("editor.html?history=1") });
      return;
    }
    if (!tab) return;
    if (info.menuItemId === "fs-pdf") {
      void savePdf(tab);
      return;
    }
    if (info.menuItemId === "fs-full-delayed") {
      void startCapture(tab, "full", 5);
      return;
    }
    if (info.menuItemId === "fs-mobile") {
      void startCapture(tab, "full", void 0, true);
      return;
    }
    const mode = info.menuItemId === "fs-full" ? "full" : info.menuItemId === "fs-visible" ? "visible" : info.menuItemId === "fs-selection" ? "selection" : info.menuItemId === "fs-element" ? "element" : null;
    if (mode) void startCapture(tab, mode);
  });
  async function startCapture(tab, mode, startDelayOverrideS, mobile = false) {
    const tabId = tab.id;
    if (tabId === void 0 || busyTabs.has(tabId)) return;
    busyTabs.add(tabId);
    const badge = badgeFor(tabId);
    try {
      if (mobile) {
        const granted = await requestDebuggerPermission();
        if (!granted) throw new Error("Mobile capture needs the debugger permission.");
      }
      const settings = await getSettings();
      for (const s of countdownSteps(startDelayOverrideS ?? settings.captureStartDelaySeconds)) {
        await badge.set(String(s));
        await sleep(1e3);
      }
      const capId = newCaptureId();
      const injectable = !isRestrictedUrl(tab.url ?? "");
      let selection = null;
      let pickedScroller = false;
      let frameUrl = null;
      if (mode === "selection") {
        if (!injectable) throw new Error("This page does not allow region selection.");
        selection = await pickRegion(tabId);
        if (!selection) {
          await badge.clear();
          return;
        }
      } else if (mode === "element") {
        if (!injectable) throw new Error("This page does not allow element picking.");
        const pick = await pickElement(tabId);
        if (!pick) {
          await badge.clear();
          return;
        }
        if (pick.scrollable) pickedScroller = true;
        else selection = pick.rect;
        frameUrl = pick.frameUrl ?? null;
      }
      await badge.set("\u2026");
      let clip;
      let tileCount;
      let truncated = false;
      let notice;
      let engine = settings.engine;
      let title = tab.title ?? "";
      let url = tab.url ?? "";
      const frameResult = frameUrl ? await frameDeepCapture(tabId, capId, frameUrl, settings.maxCaptureHeight, badge) : null;
      if (frameResult) {
        engine = "turbo";
        ({ clip, tileCount, truncated } = frameResult);
      } else if (mobile) {
        if (!injectable) throw new Error("This page cannot be captured with device emulation.");
        engine = "turbo";
        const result = await turboMobileCapture(
          tabId,
          capId,
          settings.mobileCaptureWidth,
          settings.maxCaptureHeight,
          (done, total) => void badge.set(`${Math.round(done / total * 100)}%`)
        );
        ({ clip, tileCount, truncated } = result);
      } else if (mode === "visible" || !injectable) {
        ({ clip, tileCount } = await captureVisibleSingle(tab, capId));
        engine = "stitch";
        mode = mode === "selection" ? mode : "visible";
      } else if (engine === "turbo" && !pickedScroller && await hasDebuggerPermission()) {
        const result = await turboCapture(
          tabId,
          capId,
          selection,
          settings.maxCaptureHeight,
          (done, total) => void badge.set(`${Math.round(done / total * 100)}%`)
        );
        ({ clip, tileCount, truncated } = result);
      } else {
        engine = "stitch";
        const result = await stitchCapture(
          tab,
          capId,
          selection,
          pickedScroller,
          settings,
          (done, total) => badge.set(`${Math.round(done / total * 100)}%`)
        );
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
        ...notice ? { notice } : {}
      });
      await putCapture(record);
      await pruneHistory(settings.historyLimit);
      const params = new URLSearchParams({ id: capId });
      if (settings.afterCapture !== "editor") params.set("autodownload", "1");
      await chrome.tabs.create({
        url: chrome.runtime.getURL(`editor.html?${params}`),
        index: tab.index + 1,
        openerTabId: tabId
      });
      await badge.clear();
    } catch (err) {
      console.error("[screencappy] capture failed", err);
      await badge.set("ERR", "#dc2626");
      setTimeout(() => void badge.clear(), 4e3);
    } finally {
      busyTabs.delete(tabId);
    }
  }
  async function savePdf(tab) {
    const tabId = tab.id;
    if (tabId === void 0 || busyTabs.has(tabId)) return;
    busyTabs.add(tabId);
    const badge = badgeFor(tabId);
    try {
      if (isRestrictedUrl(tab.url ?? "")) throw new Error("This page cannot be printed to PDF.");
      const granted = await requestDebuggerPermission();
      if (!granted) throw new Error("Searchable PDF needs the debugger permission.");
      await badge.set("\u2026");
      const base64 = await printToPdf(tabId);
      const settings = await getSettings();
      await chrome.downloads.download({
        url: `data:application/pdf;base64,${base64}`,
        filename: pdfFilename(settings.filenameTemplate, {
          title: tab.title ?? "",
          url: tab.url ?? "",
          mode: "pdf"
        }),
        saveAs: settings.saveAs
      });
      await badge.clear();
    } catch (err) {
      console.error("[screencappy] pdf export failed", err);
      await badge.set("ERR", "#dc2626");
      setTimeout(() => void badge.clear(), 4e3);
    } finally {
      busyTabs.delete(tabId);
    }
  }
  async function frameDeepCapture(tabId, capId, frameUrl, maxHeight, badge) {
    if (!await hasDebuggerPermission()) return null;
    try {
      return await captureCrossOriginFrame(
        tabId,
        capId,
        frameUrl,
        maxHeight,
        (done, total) => void badge.set(`${Math.round(done / total * 100)}%`)
      );
    } catch (err) {
      console.warn("[screencappy] iframe deep capture failed, falling back to visible box", err);
      await deleteTiles(capId).catch(() => void 0);
      return null;
    }
  }
  async function stitchCapture(tab, capId, selection, pickedScroller, settings, onProgress) {
    const tabId = tab.id;
    await ensureContentScript(tabId, "content-capture.js");
    let metrics = await sendToTab(tabId, {
      type: "fs:measure",
      maxHeight: settings.maxCaptureHeight,
      usePicked: pickedScroller
    });
    const clipFor = (m) => {
      const page = { x: 0, y: 0, w: m.pageW, h: m.pageH };
      if (!selection) return page;
      const sel = m.containerRect ? {
        x: selection.x - m.containerRect.x + m.scrollX,
        y: selection.y - m.containerRect.y + m.scrollY,
        w: selection.w,
        h: selection.h
      } : selection;
      return intersect2(sel, page);
    };
    let clip = clipFor(metrics);
    if (clip.w < 1 || clip.h < 1) throw new Error("Empty capture region");
    await sendToTab(tabId, {
      type: "fs:prepare",
      hideSticky: settings.hideSticky,
      freezeAnimations: settings.freezeAnimations
    });
    const remeasure = async () => {
      metrics = await sendToTab(tabId, {
        type: "fs:measure",
        maxHeight: settings.maxCaptureHeight,
        usePicked: pickedScroller
      });
      clip = clipFor(metrics);
    };
    try {
      let notice;
      if (!pickedScroller && !metrics.containerRect && clip.h > metrics.vpH + HIJACK.minOverflow) {
        const probe = await sendToTab(tabId, {
          type: "fs:probeScroll",
          maxY: clip.y + clip.h
        });
        if (probe.recovered) await remeasure();
        else if (probe.blocked) {
          notice = HIJACK_NOTICE;
          clip = intersect2(clip, { x: 0, y: 0, w: metrics.vpW, h: metrics.vpH });
        }
      }
      if (!notice && (settings.prescroll || settings.autoLoadMore) && clip.h > (metrics.containerRect?.h ?? metrics.vpH)) {
        await sendToTab(tabId, {
          type: "fs:prescroll",
          stepY: metrics.containerRect?.h ?? metrics.vpH,
          maxY: clip.y + clip.h,
          ...settings.autoLoadMore ? { autoLoadMaxHeight: settings.maxCaptureHeight } : {}
        });
        await remeasure();
      }
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
          const pos = await sendToTab(tabId, {
            type: "fs:scrollTo",
            x: cols[c],
            y: rows[r],
            settleMs: settings.captureDelayMs,
            hideFixed: r > 0 || c > 0
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
            ...crop ? { crop } : {},
            blob: await dataUrlToBlob(dataUrl)
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
        ...notice ? { notice } : {}
      };
    } finally {
      await sendToTab(tabId, { type: "fs:restore" }).catch(() => void 0);
    }
  }
  async function captureVisibleSingle(tab, capId) {
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
      blob: await dataUrlToBlob(dataUrl)
    });
    return { clip: { x: 0, y: 0, w: cssW, h: cssH }, tileCount: 1 };
  }
  var lastShotAt = 0;
  async function captureVisibleThrottled(windowId) {
    const MIN_GAP = 550;
    for (let attempt = 0; ; attempt++) {
      const wait = lastShotAt + MIN_GAP - Date.now();
      if (wait > 0) await sleep(wait);
      lastShotAt = Date.now();
      try {
        return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
      } catch (err) {
        if (attempt < 4 && String(err).includes("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND")) {
          await sleep(700);
          continue;
        }
        throw err;
      }
    }
  }
  function pickRegion(tabId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 18e4);
      const onMessage = (msg, sender) => {
        if (sender.tab?.id !== tabId) return;
        if (msg.type === "fs:selection") {
          cleanup();
          resolve(msg.rect);
        } else if (msg.type === "fs:selection-cancel") {
          cleanup();
          resolve(null);
        }
      };
      const cleanup = () => {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(onMessage);
      };
      chrome.runtime.onMessage.addListener(onMessage);
      chrome.scripting.executeScript({ target: { tabId }, files: ["content-select.js"] }).catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }
  function pickElement(tabId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 18e4);
      const onMessage = (msg, sender) => {
        if (sender.tab?.id !== tabId) return;
        if (msg.type === "fs:element") {
          cleanup();
          resolve({ rect: msg.rect, scrollable: msg.scrollable, frameUrl: msg.frameUrl });
        } else if (msg.type === "fs:element-cancel") {
          cleanup();
          resolve(null);
        }
      };
      const cleanup = () => {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(onMessage);
      };
      chrome.runtime.onMessage.addListener(onMessage);
      chrome.scripting.executeScript({ target: { tabId }, files: ["content-element.js"] }).catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }
  async function ensureContentScript(tabId, file) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "fs:ping" });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    }
  }
  async function sendToTab(tabId, msg) {
    const res = await chrome.tabs.sendMessage(tabId, msg);
    if (res && typeof res === "object" && "__err" in res) {
      throw new Error(res.__err);
    }
    return res;
  }
  function isRestrictedUrl(url) {
    if (!url) return true;
    if (/^(chrome|chrome-extension|devtools|edge|about|view-source|chrome-untrusted):/.test(url)) {
      return true;
    }
    return /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url);
  }
  function intersect2(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
  }
  function badgeFor(tabId) {
    return {
      // Sky is the product's one accent, so progress wears it. The error calls pass
      // a red instead, which is functional rather than decorative.
      async set(text, color = "#38bdf8") {
        await chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => void 0);
        await chrome.action.setBadgeText({ tabId, text }).catch(() => void 0);
      },
      async clear() {
        await chrome.action.setBadgeText({ tabId, text: "" }).catch(() => void 0);
      }
    };
  }
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  globalThis.__screencappyStart = startCapture;
})();
