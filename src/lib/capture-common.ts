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
 * the window; the largest client area wins.
 */
export function pickDominantScroller<T extends ScrollerCandidate>(
  candidates: readonly T[],
  vpW: number,
  vpH: number
): T | null {
  const minArea = vpW * vpH * 0.4;
  let best: T | null = null;
  let bestArea = 0;
  for (const c of candidates) {
    if (c.overflowY !== 'auto' && c.overflowY !== 'scroll') continue;
    if (c.scrollHeight <= c.clientHeight + 100) continue;
    const area = c.clientWidth * c.clientHeight;
    if (area < minArea || area <= bestArea) continue;
    best = c;
    bestArea = area;
  }
  return best;
}

export function base64ToBlob(base64: string, type: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
