import { describe, expect, test } from 'bun:test';
import { mobileMetrics, segmentRects } from '../../src/lib/capture-common';

describe('mobileMetrics', () => {
  test('default width passes through with phone emulation flags', () => {
    expect(mobileMetrics(390)).toEqual({
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
  });

  test('clamps out-of-range widths to the device range', () => {
    expect(mobileMetrics(100).width).toBe(240);
    expect(mobileMetrics(5000).width).toBe(1200);
  });

  test('invalid widths fall back to 390', () => {
    expect(mobileMetrics(Number.NaN).width).toBe(390);
    expect(mobileMetrics(Infinity).width).toBe(390);
  });

  test('rounds fractional widths', () => {
    expect(mobileMetrics(390.6).width).toBe(391);
  });
});

describe('segmentRects', () => {
  test('clip shorter than a segment yields one segment', () => {
    expect(segmentRects({ x: 0, y: 0, w: 390, h: 1000 }, 4000)).toEqual([
      { x: 0, y: 0, w: 390, h: 1000 },
    ]);
  });

  test('splits into max-height segments plus the remainder', () => {
    expect(segmentRects({ x: 0, y: 0, w: 390, h: 9000 }, 4000)).toEqual([
      { x: 0, y: 0, w: 390, h: 4000 },
      { x: 0, y: 4000, w: 390, h: 4000 },
      { x: 0, y: 8000, w: 390, h: 1000 },
    ]);
  });

  test('preserves a clip offset', () => {
    expect(segmentRects({ x: 10, y: 500, w: 200, h: 4500 }, 4000)).toEqual([
      { x: 10, y: 500, w: 200, h: 4000 },
      { x: 10, y: 4500, w: 200, h: 500 },
    ]);
  });

  test('segments tile the clip exactly, no gaps or overlaps', () => {
    const clip = { x: 0, y: 123, w: 800, h: 13333 };
    const segs = segmentRects(clip, 4000);
    expect(segs[0]!.y).toBe(clip.y);
    expect(segs.reduce((sum, s) => sum + s.h, 0)).toBe(clip.h);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i]!.y).toBe(segs[i - 1]!.y + segs[i - 1]!.h);
    }
  });
});
