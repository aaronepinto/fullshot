export type CaptureMode = 'full' | 'visible' | 'selection';
export type Engine = 'stitch' | 'turbo';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Page geometry reported by the content script, in CSS pixels. */
export interface PageMetrics {
  pageW: number;
  pageH: number;
  vpW: number;
  vpH: number;
  dpr: number;
  scrollX: number;
  scrollY: number;
  title: string;
  url: string;
  /** True when the page was taller than the configured capture ceiling and got clipped. */
  truncated: boolean;
}

/** One captured viewport-sized (or CDP-clip-sized) piece of the page. */
export interface Tile {
  key: string; // `${capId}:${index}`
  capId: string;
  index: number;
  /** Position of the tile in CSS pixels, relative to the capture origin. */
  x: number;
  y: number;
  /** CSS-pixel size of the tile (used to derive the device-pixel scale from the bitmap). */
  cssW: number;
  cssH: number;
  blob: Blob;
}

/** A horizontal strip of the composed image, stored so huge pages never need one giant canvas. */
export interface Strip {
  key: string; // `${capId}:${index}`
  capId: string;
  index: number;
  /** Y offset in image (device) pixels. */
  y: number;
  h: number;
  blob: Blob;
}

export interface CaptureRecord {
  id: string;
  createdAt: number;
  mode: CaptureMode;
  engine: Engine;
  title: string;
  url: string;
  /** Final composed image size in device pixels (unknown until composed for tile captures). */
  width: number;
  height: number;
  tileCount: number;
  status: 'tiles' | 'composed';
  truncated: boolean;
  /** Region of the page this capture covers, in CSS pixels relative to the document. */
  clip: Rect;
  thumb?: Blob;
}

/** Messages the background sends to the capture content script. */
export type CaptureContentMsg =
  | { type: 'fs:ping' }
  | { type: 'fs:measure'; maxHeight: number }
  | { type: 'fs:prepare'; hideSticky: boolean; freezeAnimations: boolean }
  | { type: 'fs:prescroll'; stepY: number; maxY: number }
  | { type: 'fs:scrollTo'; x: number; y: number; settleMs: number; hideFixed: boolean }
  | { type: 'fs:restore' };

export interface ScrollResult {
  x: number;
  y: number;
}

/** Messages content scripts send to the background. */
export type RuntimeMsg =
  | { type: 'fs:selection'; rect: Rect }
  | { type: 'fs:selection-cancel' };

export const EDITOR_LIMITS = {
  /** Max safe canvas dimension we will ever allocate. */
  maxDim: 16384,
  /** Strip height for the composed image store. */
  stripH: 4096,
  /** Max canvas area for single-canvas operations (export/clipboard). */
  maxArea: 220_000_000,
} as const;
