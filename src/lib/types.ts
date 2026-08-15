export type CaptureMode = 'full' | 'visible' | 'selection' | 'element';
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
  /**
   * Visible client area of the scroll container that drives the capture, in viewport
   * CSS px. Present only when the window barely scrolls and an inner element (Gmail,
   * Slack, Notion style SPAs) holds the real content. pageW/pageH and scrollX/scrollY
   * then refer to that container; vpW/vpH stay the window size the screenshots cover.
   */
  containerRect?: Rect;
}

/** One captured viewport-sized (or CDP-clip-sized) piece of the page. */
export interface Tile {
  key: string; // `${capId}:${index}`
  capId: string;
  index: number;
  /** Position of the tile in CSS pixels, relative to the capture origin. */
  x: number;
  y: number;
  /** CSS-pixel size of the captured bitmap (used to derive the device-pixel scale). */
  cssW: number;
  cssH: number;
  /**
   * When set, crop the captured viewport image to this CSS-px rect before placing it
   * (scroll-container captures: the screenshot is the whole window, the tile is just
   * the container's visible client area).
   */
  crop?: Rect;
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
  | { type: 'fs:measure'; maxHeight: number; usePicked?: boolean }
  | { type: 'fs:prepare'; hideSticky: boolean; freezeAnimations: boolean }
  /** autoLoadMaxHeight, when set, runs the infinite-scroll auto-load loop first (CSS px ceiling). */
  | { type: 'fs:prescroll'; stepY: number; maxY: number; autoLoadMaxHeight?: number }
  | { type: 'fs:scrollTo'; x: number; y: number; settleMs: number; hideFixed: boolean }
  | { type: 'fs:restore' };

export interface ScrollResult {
  x: number;
  y: number;
}

/** Messages content scripts send to the background. */
export type RuntimeMsg =
  | { type: 'fs:selection'; rect: Rect }
  | { type: 'fs:selection-cancel' }
  | {
      type: 'fs:element';
      rect: Rect;
      scrollable: boolean;
      /** Set when the picked element is a cross-origin iframe: its resolved src URL. */
      frameUrl?: string;
    }
  | { type: 'fs:element-cancel' };

export const EDITOR_LIMITS = {
  /** Max safe canvas dimension we will ever allocate. */
  maxDim: 16384,
  /** Strip height for the composed image store. */
  stripH: 4096,
  /** Max canvas area for single-canvas operations (export/clipboard). */
  maxArea: 220_000_000,
} as const;
