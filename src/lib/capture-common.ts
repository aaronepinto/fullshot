import type { CaptureMode, CaptureRecord, Engine, Rect } from './types';

export function newCaptureId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeRecord(opts: {
  id: string;
  mode: CaptureMode;
  engine: Engine;
  title: string;
  url: string;
  tileCount: number;
  truncated: boolean;
  clip: Rect;
  notice?: string;
}): CaptureRecord {
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
    status: 'tiles',
    truncated: opts.truncated,
    clip: opts.clip,
    ...(opts.notice ? { notice: opts.notice } : {}),
  };
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * Scroll stops covering [start, start+span) in viewport-size steps, clamped to
 * what the page can actually scroll to. Consecutive duplicates are dropped.
 */
export function gridPositions(
  start: number,
  span: number,
  step: number,
  maxScroll: number
): number[] {
  const positions: number[] = [];
  const limit = Math.max(0, maxScroll);
  for (let v = start; v < start + span; v += step) {
    const clamped = Math.max(0, Math.min(v, limit));
    if (positions[positions.length - 1] !== clamped) positions.push(clamped);
    if (clamped >= limit && v > start) break;
  }
  return positions.length ? positions : [0];
}

/**
 * Descending whole seconds to show on the badge before a delayed capture:
 * 5 gives [5, 4, 3, 2, 1]. Zero, negative, or invalid delays give [].
 */
export function countdownSteps(seconds: number): number[] {
  const n = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
  const steps: number[] = [];
  for (let s = n; s > 0; s--) steps.push(s);
  return steps;
}

/** Limits for the infinite-scroll auto-load loop. */
export const AUTO_LOAD = {
  /** Minimum growth per round (CSS px) for the page to count as still loading. */
  minGrowth: 200,
  /** Hard cap on scroll-to-bottom rounds. */
  maxRounds: 40,
  /** Wall-clock budget for the whole loop, ms. */
  maxTotalMs: 30_000,
  /** Wait after each scroll to the bottom for new content to arrive, ms. */
  settleMs: 500,
} as const;

/**
 * Whether the auto-load loop should scroll to the bottom again: the last round must
 * have grown the page by at least minGrowth, the page must still be under the capture
 * ceiling, and neither the round cap nor the time budget is exhausted.
 */
export function shouldContinueAutoLoad(
  prevHeight: number,
  height: number,
  maxHeight: number,
  rounds: number,
  elapsedMs: number
): boolean {
  return (
    height - prevHeight >= AUTO_LOAD.minGrowth &&
    height < maxHeight &&
    rounds < AUTO_LOAD.maxRounds &&
    elapsedMs < AUTO_LOAD.maxTotalMs
  );
}

/**
 * Adaptive settle after each scroll stop. Virtualized feeds (LinkedIn, Twitter, Gemini)
 * keep a correct scrollHeight through spacer elements but only render the rows near the
 * viewport, on a timer, after the scroll event. Shooting on a fixed delay catches those
 * pages mid-render and the tile comes out blank.
 */
export const SETTLE = {
  /** Consecutive mutation-free animation frames that end the wait. */
  quietFrames: 2,
  /**
   * Minimum window watched after each scroll, ms. A timer-driven renderer leaves the
   * page quiet for a few frames before it repaints the whole viewport, so quiet frames
   * alone are not proof the page is done. Kept under the ~550ms captureVisibleTab
   * throttle gap: for every tile after the first this wait costs no wall-clock time,
   * because the shot would have been waiting on the quota anyway.
   */
  minWatchMs: 400,
  /** Hard cap, ms, so tickers and spinners that never go quiet still get shot. */
  maxWaitMs: 900,
  /** Mutation records inspected per batch when testing against the visible region. */
  maxRecordsPerBatch: 30,
} as const;

/**
 * Whether the adaptive settle should watch the page for another frame. Elapsed time is
 * measured from the moment the scroll was commanded, so a generous captureDelayMs
 * already counts towards the minimum watch window.
 */
export function shouldKeepSettling(quietFrames: number, elapsedMs: number): boolean {
  if (elapsedMs >= SETTLE.maxWaitMs) return false;
  return quietFrames < SETTLE.quietFrames || elapsedMs < SETTLE.minWatchMs;
}

/** Viewport-relative box, matching the fields of a DOMRect that we care about. */
export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** True when any part of the box is inside the viewport. */
export function intersectsViewport(box: Box, vpW: number, vpH: number): boolean {
  return box.bottom > 0 && box.top < vpH && box.right > 0 && box.left < vpW;
}

/** Limits for the hijacked-scrolling probe. */
export const HIJACK = {
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
  anchorYs: [0.3, 0.5, 0.7],
} as const;

/** True when a commanded scroll of `commanded` px produced a real movement of `delta` px. */
export function movedEnough(commanded: number, delta: number): boolean {
  return commanded <= 0 || delta >= commanded * HIJACK.moveRatio;
}

/**
 * Shown in the editor when a page drives its own scrolling (Lenis, locomotive-scroll)
 * and neither the window nor any inner element can be moved: an honest viewport shot
 * beats a stitch of the same frame repeated a dozen times.
 */
export const HIJACK_NOTICE =
  'This page uses custom scrolling that blocks full-page capture; captured the visible area';

/** Cap on elements visited by the prepare() sticky/fixed scan, across all documents. */
export const MAX_SCAN_NODES = 80_000;

/**
 * True when a computed background-attachment keeps any layer glued to the viewport.
 * Multi-background values are comma lists ("scroll, fixed"), so each layer is checked.
 * Such parallax backgrounds repeat identically in every stitched tile, so prepare()
 * pins them to scroll for the capture.
 */
export function hasFixedBackground(backgroundAttachment: string): boolean {
  return backgroundAttachment.split(',').some((layer) => layer.trim() === 'fixed');
}

/** Minimal element shape for walkShadowTree, structural so plain objects test it. */
export interface ShadowWalkNode<T> {
  readonly children: ArrayLike<T>;
  readonly shadowRoot?: { readonly children: ArrayLike<T> } | null;
}

/**
 * Preorder walk over roots and their descendants that also descends into open
 * shadow roots (shadow children before light children). Slot assignment is never
 * followed: slotted elements are reached only through their light-DOM parent, so
 * each element is visited exactly once. Stops after budget visits to bound cost
 * on huge pages; returns the number of elements visited.
 */
export function walkShadowTree<T extends ShadowWalkNode<T>>(
  roots: ArrayLike<T>,
  visit: (el: T) => void,
  budget: number
): number {
  const stack: T[] = [];
  for (let i = roots.length - 1; i >= 0; i--) stack.push(roots[i]!);
  let visited = 0;
  while (stack.length > 0 && visited < budget) {
    const el = stack.pop()!;
    visit(el);
    visited++;
    // Children are pushed in reverse so they pop in document order, light after shadow.
    const light = el.children;
    for (let i = light.length - 1; i >= 0; i--) stack.push(light[i]!);
    const shadow = el.shadowRoot?.children;
    if (shadow) for (let i = shadow.length - 1; i >= 0; i--) stack.push(shadow[i]!);
  }
  return visited;
}

/** Plain-data description of a possible inner scroll container. */
export interface ScrollerCandidate {
  overflowY: string;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
}

/**
 * Picks the element that really scrolls the page on SPAs where the window itself
 * barely moves (Gmail, Slack, Notion). A candidate must opt into vertical scrolling,
 * have meaningfully more content than viewport (>100px), and occupy at least 40% of
 * the window; the largest client area wins. That area rule is what makes a mail app's
 * reading pane win over the narrow folder list beside it.
 *
 * `ignoreOverflow` drops the opt-in requirement, for the hijack probe: an overflow
 * hidden wrapper still scrolls when its scrollTop is set, and custom scroll libraries
 * lock their container exactly that way.
 */
export function pickDominantScroller<T extends ScrollerCandidate>(
  candidates: readonly T[],
  vpW: number,
  vpH: number,
  ignoreOverflow = false
): T | null {
  const minArea = vpW * vpH * 0.4;
  let best: T | null = null;
  let bestArea = 0;
  for (const c of candidates) {
    if (!ignoreOverflow && c.overflowY !== 'auto' && c.overflowY !== 'scroll') continue;
    if (c.scrollHeight <= c.clientHeight + 100) continue;
    const area = c.clientWidth * c.clientHeight;
    if (area < minArea || area <= bestArea) continue;
    best = c;
    bestArea = area;
  }
  return best;
}

/**
 * True when a picked element scrolls its own content vertically, so element capture
 * should grab its full scrollable content instead of just the visible box.
 */
export function isScrollableTarget(
  c: Pick<ScrollerCandidate, 'overflowY' | 'scrollHeight' | 'clientHeight'>
): boolean {
  return (
    (c.overflowY === 'auto' || c.overflowY === 'scroll') && c.scrollHeight > c.clientHeight + 100
  );
}

/** Debug-target row as returned by CDP Target.getTargets. */
export interface FrameTargetInfo {
  targetId: string;
  type: string;
  url: string;
}

/**
 * Locates the CDP target for a cross-origin iframe by URL. Exact match wins, then a
 * match ignoring the fragment (frames often self-navigate to anchors), then the only
 * iframe target there is (covers redirects on single-embed pages).
 */
export function pickFrameTarget<T extends FrameTargetInfo>(
  targets: readonly T[],
  frameUrl: string
): T | null {
  const frames = targets.filter((t) => t.type === 'iframe');
  const exact = frames.find((t) => t.url === frameUrl);
  if (exact) return exact;
  const noHash = (u: string) => u.split('#', 1)[0] ?? u;
  const want = noHash(frameUrl);
  const loose = frames.find((t) => noHash(t.url) === want);
  if (loose) return loose;
  return frames.length === 1 ? frames[0]! : null;
}

/** Chip text for the element picker: tag name plus rounded CSS pixel size. */
export function elementLabel(tagName: string, w: number, h: number): string {
  return `${tagName.toLowerCase()} · ${Math.round(w)} × ${Math.round(h)}`;
}

/**
 * CDP Emulation.setDeviceMetricsOverride params for a phone-width capture.
 * Width is clamped to a sane device range; invalid values fall back to 390.
 */
export function mobileMetrics(width: number): {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
} {
  const w = Number.isFinite(width) ? Math.round(width) : 390;
  return {
    width: Math.min(1200, Math.max(240, w)),
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  };
}

/** Splits a clip into full-width horizontal segments of at most segH CSS px. */
export function segmentRects(clip: Rect, segH: number): Rect[] {
  const segments: Rect[] = [];
  for (let y = clip.y; y < clip.y + clip.h; y += segH) {
    segments.push({ x: clip.x, y, w: clip.w, h: Math.min(segH, clip.y + clip.h - y) });
  }
  return segments;
}

export function base64ToBlob(base64: string, type: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
