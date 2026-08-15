import { describe, expect, test } from 'bun:test';
import { SETTLE, intersectsViewport, shouldKeepSettling } from '../../src/lib/capture-common';

describe('shouldKeepSettling', () => {
  test('keeps watching until the minimum window, even on a quiet page', () => {
    expect(shouldKeepSettling(SETTLE.quietFrames, 0)).toBe(true);
    expect(shouldKeepSettling(SETTLE.quietFrames, SETTLE.minWatchMs - 1)).toBe(true);
  });

  test('stops once the page has been quiet past the minimum window', () => {
    expect(shouldKeepSettling(SETTLE.quietFrames, SETTLE.minWatchMs)).toBe(false);
  });

  test('keeps waiting while mutations keep arriving', () => {
    expect(shouldKeepSettling(0, SETTLE.minWatchMs + 100)).toBe(true);
    expect(shouldKeepSettling(SETTLE.quietFrames - 1, SETTLE.maxWaitMs - 1)).toBe(true);
  });

  test('gives up at the hard cap so a ticker cannot stall the capture', () => {
    expect(shouldKeepSettling(0, SETTLE.maxWaitMs)).toBe(false);
    expect(shouldKeepSettling(SETTLE.quietFrames, SETTLE.maxWaitMs)).toBe(false);
  });

  test('the minimum window stays under the captureVisibleTab throttle gap', () => {
    expect(SETTLE.minWatchMs).toBeLessThan(550);
  });
});

describe('intersectsViewport', () => {
  const vp = { w: 1200, h: 800 };
  const box = (top: number, bottom: number, left = 0, right = 100) => ({ top, bottom, left, right });

  test('accepts boxes on screen, including partly scrolled off', () => {
    expect(intersectsViewport(box(0, 100), vp.w, vp.h)).toBe(true);
    expect(intersectsViewport(box(-50, 10), vp.w, vp.h)).toBe(true);
    expect(intersectsViewport(box(790, 900), vp.w, vp.h)).toBe(true);
  });

  test('rejects boxes above, below, or beside the viewport', () => {
    expect(intersectsViewport(box(-200, -100), vp.w, vp.h)).toBe(false);
    expect(intersectsViewport(box(900, 1000), vp.w, vp.h)).toBe(false);
    expect(intersectsViewport(box(0, 100, 1300, 1400), vp.w, vp.h)).toBe(false);
    expect(intersectsViewport(box(0, 100, -200, -100), vp.w, vp.h)).toBe(false);
  });
});
