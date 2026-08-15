"use strict";
(() => {
  // src/lib/capture-common.ts
  var AUTO_LOAD = {
    /** Minimum growth per round (CSS px) for the page to count as still loading. */
    minGrowth: 200,
    /** Hard cap on scroll-to-bottom rounds. */
    maxRounds: 40,
    /** Wall-clock budget for the whole loop, ms. */
    maxTotalMs: 3e4,
    /** Wait after each scroll to the bottom for new content to arrive, ms. */
    settleMs: 500
  };
  function shouldContinueAutoLoad(prevHeight, height, maxHeight, rounds, elapsedMs) {
    return height - prevHeight >= AUTO_LOAD.minGrowth && height < maxHeight && rounds < AUTO_LOAD.maxRounds && elapsedMs < AUTO_LOAD.maxTotalMs;
  }
  var MAX_SCAN_NODES = 8e4;
  function hasFixedBackground(backgroundAttachment) {
    return backgroundAttachment.split(",").some((layer) => layer.trim() === "fixed");
  }
  function walkShadowTree(roots, visit, budget) {
    const stack = [];
    for (let i = roots.length - 1; i >= 0; i--) stack.push(roots[i]);
    let visited = 0;
    while (stack.length > 0 && visited < budget) {
      const el = stack.pop();
      visit(el);
      visited++;
      const light = el.children;
      for (let i = light.length - 1; i >= 0; i--) stack.push(light[i]);
      const shadow = el.shadowRoot?.children;
      if (shadow) for (let i = shadow.length - 1; i >= 0; i--) stack.push(shadow[i]);
    }
    return visited;
  }
  function pickDominantScroller(candidates, vpW, vpH) {
    const minArea = vpW * vpH * 0.4;
    let best = null;
    let bestArea = 0;
    for (const c of candidates) {
      if (c.overflowY !== "auto" && c.overflowY !== "scroll") continue;
      if (c.scrollHeight <= c.clientHeight + 100) continue;
      const area = c.clientWidth * c.clientHeight;
      if (area < minArea || area <= bestArea) continue;
      best = c;
      bestArea = area;
    }
    return best;
  }

  // src/content/capture.ts
  (() => {
    const w = window;
    if (w.__screencappyCapture) return;
    w.__screencappyCapture = true;
    let styleEls = [];
    let fixedEls = [];
    let savedInline = [];
    let fixedHidden = false;
    let originalScroll = { x: 0, y: 0 };
    let containerEl = null;
    let frameDoc = null;
    const scroller = () => frameDoc ? frameDoc.scrollingElement ?? frameDoc.documentElement : containerEl ?? document.scrollingElement ?? document.documentElement;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
    function measure(maxHeight, usePicked) {
      const de = document.documentElement;
      const body = document.body;
      const pageW = Math.max(de.scrollWidth, body?.scrollWidth ?? 0, de.clientWidth);
      const rawH = Math.max(de.scrollHeight, body?.scrollHeight ?? 0, de.clientHeight);
      if (usePicked && !w.__screencappyPickedEl?.isConnected) {
        throw new Error("The picked element is no longer in the page.");
      }
      frameDoc = null;
      containerEl = usePicked ? w.__screencappyPickedEl : rawH - window.innerHeight < 200 ? findScrollContainer() : null;
      if (containerEl instanceof HTMLIFrameElement) {
        const doc = accessibleFrameDoc(containerEl);
        if (!doc) throw new Error("The iframe content is no longer accessible.");
        frameDoc = doc;
        const se = doc.scrollingElement ?? doc.documentElement;
        const rawFrameH = se.scrollHeight;
        const truncated2 = rawFrameH > maxHeight;
        return {
          pageW: se.scrollWidth,
          pageH: truncated2 ? maxHeight : rawFrameH,
          vpW: window.innerWidth,
          vpH: window.innerHeight,
          dpr: window.devicePixelRatio,
          scrollX: se.scrollLeft,
          scrollY: se.scrollTop,
          title: document.title,
          url: location.href,
          truncated: truncated2,
          containerRect: visibleClientRect(containerEl)
        };
      }
      if (containerEl) {
        const rawContainerH = containerEl.scrollHeight;
        const truncated2 = rawContainerH > maxHeight;
        return {
          pageW: containerEl.scrollWidth,
          pageH: truncated2 ? maxHeight : rawContainerH,
          vpW: window.innerWidth,
          vpH: window.innerHeight,
          dpr: window.devicePixelRatio,
          scrollX: containerEl.scrollLeft,
          scrollY: containerEl.scrollTop,
          title: document.title,
          url: location.href,
          truncated: truncated2,
          containerRect: visibleClientRect(containerEl)
        };
      }
      const truncated = rawH > maxHeight;
      return {
        pageW,
        pageH: truncated ? maxHeight : rawH,
        vpW: window.innerWidth,
        vpH: window.innerHeight,
        dpr: window.devicePixelRatio,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        title: document.title,
        url: location.href,
        truncated
      };
    }
    function findScrollContainer() {
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      const minArea = vpW * vpH * 0.4;
      const all = document.querySelectorAll("body *");
      const limit = Math.min(all.length, 6e4);
      const candidates = [];
      for (let i = 0; i < limit; i++) {
        const el = all[i];
        const ch = el.clientHeight;
        if (ch === 0 || el.scrollHeight <= ch + 100 || el.clientWidth * ch < minArea) continue;
        candidates.push({
          el,
          overflowY: getComputedStyle(el).overflowY,
          scrollHeight: el.scrollHeight,
          clientWidth: el.clientWidth,
          clientHeight: ch
        });
      }
      return pickDominantScroller(candidates, vpW, vpH)?.el ?? null;
    }
    function accessibleFrameDoc(el) {
      try {
        return el.contentDocument;
      } catch {
        return null;
      }
    }
    function visibleClientRect(el) {
      const r = el.getBoundingClientRect();
      const left = r.left + el.clientLeft;
      const top = r.top + el.clientTop;
      const x = Math.max(0, left);
      const y = Math.max(0, top);
      return {
        x,
        y,
        w: Math.max(1, Math.min(window.innerWidth, left + el.clientWidth) - x),
        h: Math.max(1, Math.min(window.innerHeight, top + el.clientHeight) - y)
      };
    }
    function setInline(el, prop, value) {
      savedInline.push({
        el,
        prop,
        value: el.style.getPropertyValue(prop),
        priority: el.style.getPropertyPriority(prop)
      });
      el.style.setProperty(prop, value, "important");
    }
    function prepare(hideSticky, freezeAnimations) {
      originalScroll = { x: scroller().scrollLeft, y: scroller().scrollTop };
      const css = `
      html, body { scroll-behavior: auto !important; overscroll-behavior: none !important; }
      ::-webkit-scrollbar { display: none !important; }
      html { scrollbar-width: none !important; }
      ${freezeAnimations ? `*, *::before, *::after {
               animation-play-state: paused !important;
               transition-property: none !important;
             }` : ""}
    `;
      const docs = frameDoc ? [document, frameDoc] : [document];
      fixedEls = [];
      let budget = MAX_SCAN_NODES;
      for (const doc of docs) {
        const styleEl = doc.createElement("style");
        styleEl.textContent = css;
        doc.documentElement.appendChild(styleEl);
        styleEls.push(styleEl);
        const view = doc.defaultView ?? window;
        for (const root of [doc.documentElement, doc.body]) {
          if (root && hasFixedBackground(view.getComputedStyle(root).backgroundAttachment)) {
            setInline(root, "background-attachment", "scroll");
          }
        }
        if (!doc.body) continue;
        budget -= walkShadowTree(
          doc.body.children,
          (el) => {
            const style = view.getComputedStyle(el);
            if (style.position === "fixed") {
              fixedEls.push(el);
            } else if (hideSticky && style.position === "sticky") {
              setInline(el, "position", "static");
            }
            if (hasFixedBackground(style.backgroundAttachment)) {
              setInline(el, "background-attachment", "scroll");
            }
          },
          budget
        );
      }
    }
    function setFixedHidden(hide) {
      if (hide === fixedHidden) return;
      fixedHidden = hide;
      for (const el of fixedEls) {
        if (hide) {
          setInline(el, "visibility", "hidden");
        } else {
          for (let i = savedInline.length - 1; i >= 0; i--) {
            const s = savedInline[i];
            if (s.el === el && s.prop === "visibility") {
              applySaved(s);
              savedInline.splice(i, 1);
            }
          }
        }
      }
    }
    function applySaved(s) {
      if (s.value) s.el.style.setProperty(s.prop, s.value, s.priority);
      else s.el.style.removeProperty(s.prop);
    }
    async function prescroll(stepY, maxY) {
      const step = Math.max(stepY, Math.ceil(maxY / 50));
      for (let y = 0; y <= maxY; y += step) {
        scroller().scrollTop = y;
        await nextFrame();
        await sleep(40);
      }
      scroller().scrollTop = 0;
      scroller().scrollLeft = 0;
      await nextFrame();
      await sleep(120);
    }
    async function autoLoadMore(maxHeight) {
      const start = Date.now();
      let rounds = 0;
      let height = scroller().scrollHeight;
      for (; ; ) {
        const s = scroller();
        s.scrollTop = s.scrollHeight;
        await nextFrame();
        await sleep(AUTO_LOAD.settleMs);
        rounds++;
        const grown = scroller().scrollHeight;
        if (!shouldContinueAutoLoad(height, grown, maxHeight, rounds, Date.now() - start)) break;
        height = grown;
      }
    }
    async function scrollTo(x, y, settleMs, hideFixed) {
      setFixedHidden(hideFixed);
      const s = scroller();
      s.scrollLeft = x;
      s.scrollTop = y;
      await nextFrame();
      await nextFrame();
      if (settleMs > 0) await sleep(settleMs);
      return { x: s.scrollLeft, y: s.scrollTop };
    }
    function restore() {
      for (const styleEl of styleEls) styleEl.remove();
      styleEls = [];
      for (let i = savedInline.length - 1; i >= 0; i--) applySaved(savedInline[i]);
      savedInline = [];
      fixedEls = [];
      fixedHidden = false;
      const s = scroller();
      s.scrollLeft = originalScroll.x;
      s.scrollTop = originalScroll.y;
      containerEl = null;
      frameDoc = null;
      delete w.__screencappyPickedEl;
    }
    async function handle(msg) {
      switch (msg.type) {
        case "fs:ping":
          return { ok: true };
        case "fs:measure":
          return measure(msg.maxHeight, msg.usePicked ?? false);
        case "fs:prepare":
          prepare(msg.hideSticky, msg.freezeAnimations);
          return { ok: true };
        case "fs:prescroll": {
          let maxY = msg.maxY;
          if (msg.autoLoadMaxHeight) {
            await autoLoadMore(msg.autoLoadMaxHeight);
            maxY = Math.max(maxY, Math.min(scroller().scrollHeight, msg.autoLoadMaxHeight));
          }
          await prescroll(msg.stepY, maxY);
          return { ok: true };
        }
        case "fs:scrollTo":
          return scrollTo(msg.x, msg.y, msg.settleMs, msg.hideFixed);
        case "fs:restore":
          restore();
          return { ok: true };
      }
    }
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("fs:")) return;
      handle(msg).then(sendResponse, (err) => sendResponse({ __err: String(err) }));
      return true;
    });
  })();
})();
