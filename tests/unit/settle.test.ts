import { describe, expect, test } from 'bun:test';
import {
  SETTLE,
  intersectsViewport,
  settleWatchMs,
  shouldKeepSettling,
} from '../../src/lib/capture-common';

const quiet = SETTLE.quietFrames;
const window0 = SETTLE.minWatchMs;

describe('shouldKeepSettling', () => {
  test('keeps watching until the window is up, even on a quiet page', () => {
    expect(shouldKeepSettling(quiet, 0, 0, window0)).toBe(true);
    expect(shouldKeepSettling(quiet, window0 - 1, window0 - 1, window0)).toBe(true);
  });

  test('stops once the page has been quiet past the window', () => {
    expect(shouldKeepSettling(quiet, window0, window0, window0)).toBe(false);
  });

  test('keeps waiting while rows are still streaming in', () => {
    // Every row resets the frame count; the gap between two of them does not.
    expect(shouldKeepSettling(0, 0, window0 + 100, window0)).toBe(true);
    expect(shouldKeepSettling(quiet, SETTLE.quietMs - 1, window0 + 100, window0)).toBe(true);
    expect(shouldKeepSettling(quiet, SETTLE.quietMs, window0 + 100, window0)).toBe(false);
  });

  test('gives up at the hard cap so a ticker cannot stall the capture', () => {
    expect(shouldKeepSettling(0, 0, SETTLE.maxWaitMs, SETTLE.maxWaitMs)).toBe(false);
    expect(shouldKeepSettling(quiet, SETTLE.quietMs, SETTLE.maxWaitMs, SETTLE.maxWaitMs)).toBe(false);
  });
});

describe('settleWatchMs', () => {
  test('a page that has never reacted late pays the minimum', () => {
    expect(settleWatchMs(0)).toBe(SETTLE.minWatchMs);
    expect(settleWatchMs(SETTLE.minWatchMs - SETTLE.latencyMargin - 1)).toBe(SETTLE.minWatchMs);
  });

  test('a slow page pulls the window out past its own latency', () => {
    const latency = 500;
    expect(settleWatchMs(latency)).toBe(latency + SETTLE.latencyMargin);
    expect(settleWatchMs(latency)).toBeGreaterThan(latency);
  });

  test('never past the hard cap', () => {
    expect(settleWatchMs(5000)).toBe(SETTLE.maxWaitMs);
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
