/**
 * Capture content script (injected on demand with activeTab).
 * Measures the page, neutralizes things that break stitching (smooth scrolling,
 * scrollbars, sticky/fixed elements, animations), drives the scroll loop, and
 * restores everything afterwards.
 */
import { pickDominantScroller } from '../lib/capture-common';
import type { CaptureContentMsg, PageMetrics, Rect, ScrollResult } from '../lib/types';

interface SavedInline {
  el: HTMLElement;
  prop: string;
  value: string;
  priority: string;
}

(() => {
  const w = window as typeof window & {
    __fullshotCapture?: boolean;
    /** Scrollable element chosen by the element picker (shared isolated world). */
    __fullshotPickedEl?: HTMLElement;
  };
  if (w.__fullshotCapture) return;
  w.__fullshotCapture = true;

  let styleEl: HTMLStyleElement | null = null;
  let fixedEls: HTMLElement[] = [];
  let savedInline: SavedInline[] = [];
  let fixedHidden = false;
  let originalScroll = { x: 0, y: 0 };
  let containerEl: HTMLElement | null = null;

  const scroller = () => containerEl ?? document.scrollingElement ?? document.documentElement;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

  function measure(maxHeight: number, usePicked: boolean): PageMetrics {
    const de = document.documentElement;
    const body = document.body;
    const pageW = Math.max(de.scrollWidth, body?.scrollWidth ?? 0, de.clientWidth);
    const rawH = Math.max(de.scrollHeight, body?.scrollHeight ?? 0, de.clientHeight);

    if (usePicked && !w.__fullshotPickedEl?.isConnected) {
      throw new Error('The picked element is no longer in the page.');
    }
    // Element capture pins the scroller to the picked element; otherwise, when the
    // window barely scrolls, look for the SPA-style inner container holding the content.
    containerEl = usePicked
      ? w.__fullshotPickedEl!
      : rawH - window.innerHeight < 200
        ? findScrollContainer()
        : null;
    if (containerEl) {
      const rawContainerH = containerEl.scrollHeight;
      const truncated = rawContainerH > maxHeight;
      return {
        pageW: containerEl.scrollWidth,
        pageH: truncated ? maxHeight : rawContainerH,
        vpW: window.innerWidth,
        vpH: window.innerHeight,
        dpr: window.devicePixelRatio,
        scrollX: containerEl.scrollLeft,
        scrollY: containerEl.scrollTop,
        title: document.title,
        url: location.href,
        truncated,
        containerRect: visibleClientRect(containerEl),
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
      truncated,
    };
  }

  function findScrollContainer(): HTMLElement | null {
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const minArea = vpW * vpH * 0.4;
    const all = document.querySelectorAll<HTMLElement>('body *');
    const limit = Math.min(all.length, 60_000);
    const candidates: { el: HTMLElement; overflowY: string; scrollHeight: number; clientWidth: number; clientHeight: number }[] = [];
    for (let i = 0; i < limit; i++) {
      const el = all[i]!;
      const ch = el.clientHeight;
      // Cheap geometry pre-filter before the expensive computed-style read.
      if (ch === 0 || el.scrollHeight <= ch + 100 || el.clientWidth * ch < minArea) continue;
      candidates.push({
        el,
        overflowY: getComputedStyle(el).overflowY,
        scrollHeight: el.scrollHeight,
        clientWidth: el.clientWidth,
        clientHeight: ch,
      });
    }
    return pickDominantScroller(candidates, vpW, vpH)?.el ?? null;
  }

  /** Client area of el (borders excluded) clamped to the viewport, in viewport CSS px. */
  function visibleClientRect(el: HTMLElement): Rect {
    const r = el.getBoundingClientRect();
    const left = r.left + el.clientLeft;
    const top = r.top + el.clientTop;
    const x = Math.max(0, left);
    const y = Math.max(0, top);
    return {
      x,
      y,
      w: Math.max(1, Math.min(window.innerWidth, left + el.clientWidth) - x),
      h: Math.max(1, Math.min(window.innerHeight, top + el.clientHeight) - y),
    };
  }

  function setInline(el: HTMLElement, prop: string, value: string) {
    savedInline.push({
      el,
      prop,
      value: el.style.getPropertyValue(prop),
      priority: el.style.getPropertyPriority(prop),
    });
    el.style.setProperty(prop, value, 'important');
  }

  function prepare(hideSticky: boolean, freezeAnimations: boolean) {
    originalScroll = { x: scroller().scrollLeft, y: scroller().scrollTop };
    styleEl = document.createElement('style');
    styleEl.textContent = `
      html, body { scroll-behavior: auto !important; overscroll-behavior: none !important; }
      ::-webkit-scrollbar { display: none !important; }
      html { scrollbar-width: none !important; }
      ${
        freezeAnimations
          ? `*, *::before, *::after {
               animation-play-state: paused !important;
               transition-property: none !important;
             }`
          : ''
      }
    `;
    document.documentElement.appendChild(styleEl);

    // One pass over the DOM: sticky elements are pinned back into normal flow for the
    // whole capture (they render once, at their natural position); fixed elements are
    // remembered so they can be hidden for every tile after the first.
    fixedEls = [];
    const all = document.querySelectorAll<HTMLElement>('body *');
    const limit = Math.min(all.length, 60_000);
    for (let i = 0; i < limit; i++) {
      const el = all[i]!;
      const position = getComputedStyle(el).position;
      if (position === 'fixed') {
        fixedEls.push(el);
      } else if (hideSticky && position === 'sticky') {
        setInline(el, 'position', 'static');
      }
    }
  }

  function setFixedHidden(hide: boolean) {
    if (hide === fixedHidden) return;
    fixedHidden = hide;
    for (const el of fixedEls) {
      if (hide) {
        setInline(el, 'visibility', 'hidden');
      } else {
        // restore just the visibility entries for this element
        for (let i = savedInline.length - 1; i >= 0; i--) {
          const s = savedInline[i]!;
          if (s.el === el && s.prop === 'visibility') {
            applySaved(s);
            savedInline.splice(i, 1);
          }
        }
      }
    }
  }

  function applySaved(s: SavedInline) {
    if (s.value) s.el.style.setProperty(s.prop, s.value, s.priority);
    else s.el.style.removeProperty(s.prop);
  }

  async function prescroll(stepY: number, maxY: number) {
    // Quick pass down the page to trigger lazy loading, bounded to ~50 stops.
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

  async function scrollTo(x: number, y: number, settleMs: number, hideFixed: boolean): Promise<ScrollResult> {
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
    styleEl?.remove();
    styleEl = null;
    for (let i = savedInline.length - 1; i >= 0; i--) applySaved(savedInline[i]!);
    savedInline = [];
    fixedEls = [];
    fixedHidden = false;
    const s = scroller();
    s.scrollLeft = originalScroll.x;
    s.scrollTop = originalScroll.y;
    containerEl = null;
    delete w.__fullshotPickedEl;
  }

  async function handle(msg: CaptureContentMsg): Promise<unknown> {
    switch (msg.type) {
      case 'fs:ping':
        return { ok: true };
      case 'fs:measure':
        return measure(msg.maxHeight, msg.usePicked ?? false);
      case 'fs:prepare':
        prepare(msg.hideSticky, msg.freezeAnimations);
        return { ok: true };
      case 'fs:prescroll':
        await prescroll(msg.stepY, msg.maxY);
        return { ok: true };
      case 'fs:scrollTo':
        return scrollTo(msg.x, msg.y, msg.settleMs, msg.hideFixed);
      case 'fs:restore':
        restore();
        return { ok: true };
    }
  }

  chrome.runtime.onMessage.addListener((msg: CaptureContentMsg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('fs:')) return;
    handle(msg).then(sendResponse, (err) => sendResponse({ __err: String(err) }));
    return true;
  });
})();
