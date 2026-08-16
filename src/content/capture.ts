/**
 * Capture content script (injected on demand with activeTab).
 * Measures the page, neutralizes things that break stitching (smooth scrolling,
 * scrollbars, sticky/fixed elements, animations), drives the scroll loop, and
 * restores everything afterwards.
 */
import {
  AUTO_LOAD,
  HIJACK,
  IMAGE_WAIT,
  MAX_SCAN_NODES,
  SETTLE,
  fixedEdge,
  hasFixedBackground,
  intersectsViewport,
  movedEnough,
  pickDominantScroller,
  settleWatchMs,
  shouldContinueAutoLoad,
  shouldKeepSettling,
  showsOnTile,
  walkShadowTree,
} from '../lib/capture-common';
import type { FixedEdge } from '../lib/capture-common';
import type {
  CaptureContentMsg,
  PageMetrics,
  Rect,
  ScrollProbe,
  ScrollResult,
} from '../lib/types';

interface SavedInline {
  el: HTMLElement;
  prop: string;
  value: string;
  priority: string;
}

/** A viewport-pinned element, the edge it is pinned to, and whether it is hidden now. */
interface PinnedEl {
  el: HTMLElement;
  edge: FixedEdge;
  hidden: boolean;
}

(() => {
  const w = window as typeof window & {
    __screencappyCapture?: boolean;
    /** Scrollable element chosen by the element picker (shared isolated world). */
    __screencappyPickedEl?: HTMLElement;
  };
  if (w.__screencappyCapture) return;
  w.__screencappyCapture = true;

  let styleEls: HTMLStyleElement[] = [];
  let fixedEls: PinnedEl[] = [];
  let savedInline: SavedInline[] = [];
  let originalScroll = { x: 0, y: 0 };
  let containerEl: HTMLElement | null = null;
  /** Set when the picked element is a same-origin iframe: scrolling happens in here. */
  let frameDoc: Document | null = null;
  /** Scroller the hijack probe recovered; measure() keeps using it for the whole run. */
  let adoptedScroller: HTMLElement | null = null;
  /** Viewport mutation watcher, live from prepare() to restore(). */
  let watcher: ReturnType<typeof watchMutations> | null = null;
  let lastScrollAt = 0;
  /** Slowest reaction to a scroll seen in this run, ms: how long the next tile waits. */
  let renderLatency = 0;
  /** What is left of the run's budget for waiting on images still on the wire, ms. */
  let imageBudgetMs = IMAGE_WAIT.totalMs;

  const scroller = () =>
    frameDoc
      ? (frameDoc.scrollingElement ?? frameDoc.documentElement)
      : (containerEl ?? document.scrollingElement ?? document.documentElement);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

  function measure(maxHeight: number, usePicked: boolean): PageMetrics {
    const de = document.documentElement;
    const body = document.body;
    const pageW = Math.max(de.scrollWidth, body?.scrollWidth ?? 0, de.clientWidth);
    const rawH = Math.max(de.scrollHeight, body?.scrollHeight ?? 0, de.clientHeight);

    if (usePicked && !w.__screencappyPickedEl?.isConnected) {
      throw new Error('The picked element is no longer in the page.');
    }
    // Element capture pins the scroller to the picked element; otherwise, when the
    // window barely scrolls, look for the SPA-style inner container holding the content.
    frameDoc = null;
    containerEl = usePicked
      ? w.__screencappyPickedEl!
      : (adoptedScroller ??
        (rawH - window.innerHeight < 200 ? findScrollContainer() : null));
    // A picked same-origin iframe scrolls inside its own document: the frame's
    // scrollingElement is the scroller and its full content size is the page.
    if (containerEl instanceof HTMLIFrameElement) {
      const doc = accessibleFrameDoc(containerEl);
      if (!doc) throw new Error('The iframe content is no longer accessible.');
      frameDoc = doc;
      const se = doc.scrollingElement ?? doc.documentElement;
      const rawFrameH = se.scrollHeight;
      const truncated = rawFrameH > maxHeight;
      return {
        pageW: se.scrollWidth,
        pageH: truncated ? maxHeight : rawFrameH,
        vpW: window.innerWidth,
        vpH: window.innerHeight,
        dpr: window.devicePixelRatio,
        scrollX: se.scrollLeft,
        scrollY: se.scrollTop,
        title: document.title,
        url: location.href,
        truncated,
        containerRect: visibleClientRect(containerEl),
      };
    }
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

  function findScrollContainer(ignoreOverflow = false): HTMLElement | null {
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
    return pickDominantScroller(candidates, vpW, vpH, ignoreOverflow)?.el ?? null;
  }

  // contentDocument is null for cross-origin frames; sandboxed ones can also throw.
  function accessibleFrameDoc(el: HTMLIFrameElement): Document | null {
    try {
      return el.contentDocument;
    } catch {
      return null;
    }
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
    const css = `
      html, body { scroll-behavior: auto !important; overscroll-behavior: none !important; }
      ::-webkit-scrollbar { display: none !important; }
      html { scrollbar-width: none !important; }
      ${
        freezeAnimations
          ? `*, *::before, *::after {
               animation-play-state: paused !important;
               transition-property: none !important;
               /* Scroll-driven animations (animation-timeline: view()) advance with the
                  scroll offset, so there is no time to wait for and pausing one freezes
                  it wherever it stood: a section below the fold stays fully transparent
                  and displaced. Detaching the timeline drops the animation out of effect
                  and the element renders its settled base style. */
               animation-timeline: none !important;
             }`
          : ''
      }
    `;
    // When capturing inside a same-origin iframe, its document needs the same treatment.
    const docs = frameDoc ? [document, frameDoc] : [document];
    fixedEls = [];
    let budget = MAX_SCAN_NODES;
    for (const doc of docs) {
      const styleEl = doc.createElement('style');
      styleEl.textContent = css;
      doc.documentElement.appendChild(styleEl);
      styleEls.push(styleEl);

      // One pass over the DOM: sticky elements are pinned back into normal flow for the
      // whole capture (they render once, at their natural position); fixed elements are
      // remembered so they can be hidden for every tile after the first. querySelectorAll
      // cannot pierce shadow roots, so the walk descends into open shadow trees too.
      const view = doc.defaultView ?? window;
      // The walk starts below body, so the roots need their own parallax check:
      // background-attachment fixed most often lives on html or body.
      for (const root of [doc.documentElement, doc.body]) {
        if (root && hasFixedBackground(view.getComputedStyle(root).backgroundAttachment)) {
          setInline(root, 'background-attachment', 'scroll');
        }
      }
      if (!doc.body) continue;
      budget -= walkShadowTree<Element>(
        doc.body.children,
        (el) => {
          const style = view.getComputedStyle(el);
          if (style.position === 'fixed') {
            // Measured now, before anything scrolls, so the box is where the user sees it.
            const edge = fixedEdge(
              el.getBoundingClientRect(),
              window.innerWidth,
              window.innerHeight
            );
            fixedEls.push({ el: el as HTMLElement, edge, hidden: false });
          } else if (hideSticky && style.position === 'sticky') {
            setInline(el as HTMLElement, 'position', 'static');
          }
          // Viewport-glued backgrounds repeat in every tile: scroll them with the page.
          if (hasFixedBackground(style.backgroundAttachment)) {
            setInline(el as HTMLElement, 'background-attachment', 'scroll');
          }
        },
        budget
      );
    }
    // Started last so the sticky and fixed pass above is not mistaken for the page
    // reacting to a scroll.
    watcher = watchMutations();
  }

  /**
   * Hides the pinned furniture that does not belong on this tile: a header shows on the
   * first, a bottom bar or floating button on the last, a full-height rail on every one.
   * The scroll container itself is never hidden - on a page whose real content lives in a
   * fixed panel (a modal, an app shell) that panel *is* the capture.
   */
  function setFixedForTile(firstTile: boolean, lastTile: boolean) {
    for (const pinned of fixedEls) {
      if (pinned.el === containerEl || pinned.el.contains(containerEl)) continue;
      const hide = !showsOnTile(pinned.edge, firstTile, lastTile);
      if (hide === pinned.hidden) continue;
      pinned.hidden = hide;
      if (hide) {
        setInline(pinned.el, 'visibility', 'hidden');
      } else {
        // restore just the visibility entries for this element
        for (let i = savedInline.length - 1; i >= 0; i--) {
          const s = savedInline[i]!;
          if (s.el === pinned.el && s.prop === 'visibility') {
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

  /** Rolls every inline override made since `mark` back, newest first. */
  function unwindInline(mark: number) {
    for (let i = savedInline.length - 1; i >= mark; i--) applySaved(savedInline[i]!);
    savedInline.length = mark;
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

  /**
   * Repeatedly jumps to the bottom so infinite-scroll pages load more content,
   * until growth stalls or a bound (height ceiling, rounds, time) is hit.
   */
  async function autoLoadMore(maxHeight: number) {
    const start = Date.now();
    let rounds = 0;
    let height = scroller().scrollHeight;
    for (;;) {
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

  /** Sets an offset, gives the page two frames, and reports where it actually landed. */
  async function tryScroll(el: Element, y: number): Promise<number> {
    el.scrollTop = y;
    await nextFrame();
    await nextFrame();
    return el.scrollTop;
  }

  /** True when el or one of its ancestors is glued to the viewport. */
  function viewportGlued(el: Element): boolean {
    for (let n: Element | null = el; n; n = n.parentElement) {
      const pos = getComputedStyle(n).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
    }
    return false;
  }

  /**
   * Elements hit-tested across the viewport that have to move when the given scroller
   * scrolls. html and body always move with the document, so they say nothing about
   * what is painted and are left out. For the window, viewport-glued elements are left
   * out too; for a candidate container, only its own descendants count. An empty list
   * therefore means nothing on screen can move, however far the offset travels.
   */
  function anchors(container: Element | null): { el: Element; top: number }[] {
    const out: { el: Element; top: number }[] = [];
    for (const fx of HIJACK.anchorXs) {
      for (const fy of HIJACK.anchorYs) {
        const el = document.elementFromPoint(window.innerWidth * fx, window.innerHeight * fy);
        if (!el || el === document.body || el === document.documentElement) continue;
        if (container ? !container.contains(el) : viewportGlued(el)) continue;
        if (out.some((a) => a.el === el)) continue;
        out.push({ el, top: el.getBoundingClientRect().top });
      }
    }
    return out;
  }

  /** True when at least one anchor moved: what the user sees really did change. */
  function contentMoved(before: { el: Element; top: number }[], commanded: number): boolean {
    return before.some(
      (a) => a.el.isConnected && movedEnough(commanded, a.top - a.el.getBoundingClientRect().top)
    );
  }

  /** Drops the root-level styles that stop a document from scrolling. */
  function unlockRoots() {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      setInline(el, 'position', 'static');
      setInline(el, 'overflow', 'visible');
      setInline(el, 'height', 'auto');
    }
  }

  /**
   * Checks the page really scrolls before the tile loop commits to a grid. Pages driven
   * by custom scroll libraries keep a tall scrollHeight while the content is moved with
   * transforms, so every tile would come back holding the same frame. Recovery is tried
   * first (an inner element that scrolls programmatically, then lifting the root scroll
   * locks) and only counts when the picture on screen actually changes.
   */
  async function probeScroll(maxY: number): Promise<ScrollProbe> {
    const se = scroller();
    const target = Math.min(window.innerHeight, maxY - window.innerHeight);
    if (target < HIJACK.minOverflow) return { blocked: false, recovered: false };

    if (await scrollWorks(se, null, target)) return { blocked: false, recovered: false };

    // Custom scroll libraries lock their container with overflow hidden, which still
    // scrolls when scrollTop is set, so an inner scroller is worth a try even though
    // the dominant-scroller pass (which needs the overflow opt-in) found nothing.
    const inner = findScrollContainer(true);
    if (inner && inner !== se) {
      const from = { x: inner.scrollLeft, y: inner.scrollTop };
      if (await scrollWorks(inner, inner, target)) {
        adoptedScroller = inner;
        originalScroll = from;
        return { blocked: false, recovered: true };
      }
    }

    // Last resort: lift the root scroll locks. Unwound right away when it does not
    // help, so a blocked page is still shot with its own layout intact.
    const mark = savedInline.length;
    unlockRoots();
    if (await scrollWorks(se, null, target)) return { blocked: false, recovered: true };
    unwindInline(mark);
    return { blocked: true, recovered: false };
  }

  /**
   * Scrolls `el` by `target` and puts it back, reporting whether both the offset and
   * the content on screen actually moved. Requiring the content to move is what catches
   * the pages that keep a tall scrollHeight for a spacer while pinning what is painted.
   */
  async function scrollWorks(el: Element, container: Element | null, target: number): Promise<boolean> {
    const from = el.scrollTop;
    const before = anchors(container);
    const reached = await tryScroll(el, from + target);
    const ok = movedEnough(target, reached - from) && contentMoved(before, target);
    await tryScroll(el, from);
    return ok;
  }

  /**
   * Counts DOM mutations landing inside the viewport. Off-screen churn (a ticker, an
   * analytics beacon rewriting a hidden node) must not hold the capture up, and only
   * the first few records of a batch are inspected so a huge batch stays cheap.
   */
  function watchMutations(): {
    readonly count: number;
    readonly lastAt: number;
    reset: () => void;
    stop: () => void;
  } {
    let count = 0;
    let lastAt = 0;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const inViewport = (node: Node): boolean => {
      const el = node instanceof Element ? node : node.parentElement;
      return !!el && intersectsViewport(el.getBoundingClientRect(), vpW, vpH);
    };
    const obs = new MutationObserver((records) => {
      const limit = Math.min(records.length, SETTLE.maxRecordsPerBatch);
      for (let i = 0; i < limit; i++) {
        const rec = records[i]!;
        // Rows arriving in a virtualized list are added nodes; for anything else the
        // mutated element itself is the thing that has to be on screen.
        if (rec.addedNodes.length > 0) {
          for (let j = 0; j < rec.addedNodes.length; j++) {
            if (inViewport(rec.addedNodes[j]!)) {
              count++;
              lastAt = Date.now();
              return;
            }
          }
        } else if (inViewport(rec.target)) {
          count++;
          lastAt = Date.now();
          return;
        }
      }
    });
    const opts = { subtree: true, childList: true, attributes: true, characterData: true };
    obs.observe(document.documentElement, opts);
    if (frameDoc) obs.observe(frameDoc.documentElement, opts);
    return {
      get count() {
        return count;
      },
      get lastAt() {
        return lastAt;
      },
      reset: () => {
        lastAt = 0;
      },
      stop: () => obs.disconnect(),
    };
  }

  /** Images on screen that have been asked for and have not arrived yet. */
  function pendingImages(): HTMLImageElement[] {
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const out: HTMLImageElement[] = [];
    let scanned = 0;
    for (const doc of frameDoc ? [document, frameDoc] : [document]) {
      const images = doc.images;
      for (let i = 0; i < images.length && scanned < IMAGE_WAIT.maxScanned; i++, scanned++) {
        const img = images[i]!;
        if (img.complete) continue;
        if (!intersectsViewport(img.getBoundingClientRect(), vpW, vpH)) continue;
        out.push(img);
      }
    }
    return out;
  }

  function imageSettled(img: HTMLImageElement): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        img.removeEventListener('load', done);
        img.removeEventListener('error', done);
        resolve();
      };
      img.addEventListener('load', done);
      img.addEventListener('error', done);
    });
  }

  /**
   * Holds the shot while images this tile will show are still on their way. The mutation
   * settle cannot cover this: a requested image mutates nothing while it waits, so a
   * page of lazy images on a slow connection stitches together out of placeholders.
   */
  async function awaitImages() {
    if (imageBudgetMs <= 0) return;
    const startedAt = Date.now();
    const deadline = startedAt + Math.min(imageBudgetMs, IMAGE_WAIT.perTileMs);
    for (;;) {
      const pending = pendingImages();
      const left = deadline - Date.now();
      if (!pending.length || left <= 0) break;
      // Racing the sleep bounds the wait; looping again picks up images that only
      // started loading once the ones ahead of them finished.
      await Promise.race([Promise.all(pending.map(imageSettled)), sleep(left)]);
    }
    imageBudgetMs -= Date.now() - startedAt;
    // One frame for the decoded image to actually paint.
    await nextFrame();
  }

  /**
   * Folds the previous tile's reaction into the run's render latency. The observer keeps
   * running while the tile is shot and stored, so a page that reacted only after the
   * shot still gets counted here and buys the next tile a longer wait.
   */
  function noteRenderLatency() {
    if (!watcher || !lastScrollAt || !watcher.lastAt) return;
    renderLatency = Math.max(renderLatency, watcher.lastAt - lastScrollAt);
  }

  async function scrollTo(
    x: number,
    y: number,
    settleMs: number,
    firstTile: boolean,
    lastTile: boolean
  ): Promise<ScrollResult> {
    setFixedForTile(firstTile, lastTile);
    const s = scroller();
    noteRenderLatency();
    const watchMs = settleWatchMs(renderLatency);
    // The reset comes before the scroll, so renders landing during settleMs count too.
    watcher?.reset();
    const startedAt = Date.now();
    lastScrollAt = startedAt;
    s.scrollLeft = x;
    s.scrollTop = y;
    await nextFrame();
    await nextFrame();
    if (settleMs > 0) await sleep(settleMs);
    // settleMs is the floor; a virtualized feed streams its rows in well after it, so
    // the shot waits for the viewport to hold still (or for the hard cap).
    let seen = watcher?.count ?? 0;
    let quiet = 0;
    for (;;) {
      const now = Date.now();
      const lastAt = watcher?.lastAt ?? 0;
      const quietFor = lastAt ? now - lastAt : now - startedAt;
      if (!shouldKeepSettling(quiet, quietFor, now - startedAt, watchMs)) break;
      await nextFrame();
      const count = watcher?.count ?? 0;
      quiet = count === seen ? quiet + 1 : 0;
      seen = count;
    }
    await awaitImages();
    return { x: s.scrollLeft, y: s.scrollTop };
  }

  function restore() {
    watcher?.stop();
    watcher = null;
    lastScrollAt = 0;
    renderLatency = 0;
    imageBudgetMs = IMAGE_WAIT.totalMs;
    for (const styleEl of styleEls) styleEl.remove();
    styleEls = [];
    for (let i = savedInline.length - 1; i >= 0; i--) applySaved(savedInline[i]!);
    savedInline = [];
    fixedEls = [];
    const s = scroller();
    s.scrollLeft = originalScroll.x;
    s.scrollTop = originalScroll.y;
    containerEl = null;
    frameDoc = null;
    adoptedScroller = null;
    delete w.__screencappyPickedEl;
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
      case 'fs:prescroll': {
        let maxY = msg.maxY;
        if (msg.autoLoadMaxHeight) {
          await autoLoadMore(msg.autoLoadMaxHeight);
          // The lazy-load pass should now sweep the grown page, up to the ceiling.
          maxY = Math.max(maxY, Math.min(scroller().scrollHeight, msg.autoLoadMaxHeight));
        }
        await prescroll(msg.stepY, maxY);
        return { ok: true };
      }
      case 'fs:probeScroll':
        return probeScroll(msg.maxY);
      case 'fs:scrollTo':
        return scrollTo(msg.x, msg.y, msg.settleMs, msg.firstTile, msg.lastTile);
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
