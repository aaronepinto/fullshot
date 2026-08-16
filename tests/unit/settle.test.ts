import { describe, expect, test } from 'bun:test';
import {
  IMAGE_WAIT,
  SETTLE,
  imageWaitBudgetMs,
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

describe('imageWaitBudgetMs', () => {
  test('a fresh tile gets the per-tile ceiling', () => {
    expect(imageWaitBudgetMs(0, 0)).toBe(IMAGE_WAIT.perTileMs);
  });

  test('waiting that keeps getting its images does not use the run up', () => {
    // The lazy-page failure in CI: every wait worked, every wait was charged, and the
    // last tile had nothing left to spend on the one image that was still on its way.
    expect(imageWaitBudgetMs(20_000, 0)).toBe(IMAGE_WAIT.perTileMs);
  });

  test('waiting that achieves nothing is cut off, so a dead image cannot cost minutes', () => {
    expect(imageWaitBudgetMs(IMAGE_WAIT.fruitlessMs, IMAGE_WAIT.fruitlessMs)).toBe(0);
    expect(imageWaitBudgetMs(3000, IMAGE_WAIT.fruitlessMs - 1)).toBeGreaterThan(0);
  });

  test('the overall ceiling still ends a page whose images all arrive slowly', () => {
    expect(imageWaitBudgetMs(IMAGE_WAIT.totalMs, 0)).toBe(0);
    expect(imageWaitBudgetMs(IMAGE_WAIT.totalMs - 500, 0)).toBe(500);
  });

  test('a wait that works is worth more than one that does not', () => {
    expect(IMAGE_WAIT.totalMs).toBeGreaterThan(IMAGE_WAIT.fruitlessMs);
  });
});
