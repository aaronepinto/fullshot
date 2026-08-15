/**
 * "Turbo" capture engine: one debugger attach, then CDP Page.captureScreenshot with
 * captureBeyondViewport - no scrolling, no stitching seams, sticky headers render once.
 * Requires the optional "debugger" permission (user opts in from Options).
 */
import { putTile } from './lib/db';
import { base64ToBlob, pickFrameTarget, type FrameTargetInfo } from './lib/capture-common';
import type { Rect } from './lib/types';

const PROTOCOL = '1.3';
/** CSS-px height per CDP shot; keeps each PNG well under renderer texture limits. */
const SEGMENT_H = 4000;

export async function hasDebuggerPermission(): Promise<boolean> {
  return chrome.permissions.contains({ permissions: ['debugger'] });
}

/**
 * Prints the page to a real PDF with selectable, searchable text via Page.printToPDF.
 * Returns the PDF as base64. Chrome lays out the whole document in one go, so very
 * large pages can fail inside the renderer; such errors are rethrown with context.
 */
export async function printToPdf(tabId: number): Promise<string> {
  const target = { tabId };
  await chrome.debugger.attach(target, PROTOCOL);
  try {
    const res = (await chrome.debugger.sendCommand(target, 'Page.printToPDF', {
      printBackground: true,
    })) as { data?: string };
    if (!res.data) throw new Error('Page.printToPDF returned no data');
    return res.data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF print failed, the page may be too large to print: ${msg}`);
  } finally {
    await chrome.debugger.detach(target).catch(() => undefined);
  }
}

interface TurboResult {
  clip: Rect;
  tileCount: number;
  truncated: boolean;
}

export async function turboCapture(
  tabId: number,
  capId: string,
  requestedClip: Rect | null,
  maxHeight: number,
  onProgress: (done: number, total: number) => void
): Promise<TurboResult> {
  const target = { tabId };
  await chrome.debugger.attach(target, PROTOCOL);
  try {
    return await captureViaSession(target, capId, requestedClip, maxHeight, onProgress);
  } finally {
    await chrome.debugger.detach(target).catch(() => undefined);
  }
}

/**
 * Deep capture of a cross-origin iframe the page cannot script: locate the frame's
 * out-of-process target, attach a flattened child session, and shoot its full content.
 * Tile coordinates are in the frame's own CSS px.
 */
export async function captureCrossOriginFrame(
  tabId: number,
  capId: string,
  frameUrl: string,
  maxHeight: number,
  onProgress: (done: number, total: number) => void
): Promise<TurboResult> {
  const target = { tabId };
  await chrome.debugger.attach(target, PROTOCOL);
  try {
    const { targetInfos } = (await chrome.debugger.sendCommand(target, 'Target.getTargets')) as {
      targetInfos?: FrameTargetInfo[];
    };
    const frame = pickFrameTarget(targetInfos ?? [], frameUrl);
    if (!frame) throw new Error(`No debug target found for frame ${frameUrl}`);
    const { sessionId } = (await chrome.debugger.sendCommand(target, 'Target.attachToTarget', {
      targetId: frame.targetId,
      flatten: true,
    })) as { sessionId: string };
    return await captureViaSession({ tabId, sessionId }, capId, null, maxHeight, onProgress);
  } finally {
    await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function captureViaSession(
  session: chrome.debugger.DebuggerSession,
  capId: string,
  requestedClip: Rect | null,
  maxHeight: number,
  onProgress: (done: number, total: number) => void
): Promise<TurboResult> {
  const metrics = (await chrome.debugger.sendCommand(session, 'Page.getLayoutMetrics')) as {
    cssContentSize?: { width: number; height: number };
    contentSize?: { width: number; height: number };
  };
  const size = metrics.cssContentSize ?? metrics.contentSize;
  if (!size) throw new Error('Could not measure page via CDP');

  // Capture at the device pixel ratio so retina output stays sharp.
  const dprEval = (await chrome.debugger.sendCommand(session, 'Runtime.evaluate', {
    expression: 'window.devicePixelRatio',
    returnByValue: true,
  })) as { result?: { value?: unknown } };
  const dpr = Math.min(3, Number(dprEval.result?.value) || 1);

  const page: Rect = { x: 0, y: 0, w: Math.ceil(size.width), h: Math.ceil(size.height) };
  let clip = requestedClip ? intersect(requestedClip, page) : page;
  let truncated = false;
  if (clip.h > maxHeight) {
    clip = { ...clip, h: maxHeight };
    truncated = true;
  }
  if (clip.w < 1 || clip.h < 1) throw new Error('Empty capture region');

  const segments: Rect[] = [];
  for (let y = clip.y; y < clip.y + clip.h; y += SEGMENT_H) {
    segments.push({ x: clip.x, y, w: clip.w, h: Math.min(SEGMENT_H, clip.y + clip.h - y) });
  }

  let index = 0;
  for (const seg of segments) {
    const shot = (await chrome.debugger.sendCommand(session, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      fromSurface: true,
      clip: { x: seg.x, y: seg.y, width: seg.w, height: seg.h, scale: dpr },
    })) as { data: string };
    await putTile({
      key: `${capId}:${index}`,
      capId,
      index,
      x: seg.x,
      y: seg.y,
      cssW: seg.w,
      cssH: seg.h,
      blob: base64ToBlob(shot.data, 'image/png'),
    });
    index++;
    onProgress(index, segments.length);
  }
  return { clip, tileCount: segments.length, truncated };
}

function intersect(a: Rect, b: Rect): Rect {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}
