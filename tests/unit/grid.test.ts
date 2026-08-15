import { describe, expect, test } from 'bun:test';
import { gridPositions } from '../../src/lib/capture-common';

/** Every point in [start, start+span) must fall inside some tile [pos, pos+step). */
function covers(positions: number[], start: number, span: number, step: number): boolean {
  for (let p = start; p < start + span; p += 7) {
    if (!positions.some((pos) => p >= pos && p < pos + step)) return false;
  }
  const last = start + span - 1;
  return positions.some((pos) => last >= pos && last < pos + step);
}

describe('gridPositions', () => {
  test('single viewport page needs one stop', () => {
    expect(gridPositions(0, 800, 800, 0)).toEqual([0]);
  });

  test('exact multiple of the viewport', () => {
    expect(gridPositions(0, 2400, 800, 1600)).toEqual([0, 800, 1600]);
  });

  test('last stop clamps to max scroll instead of overshooting', () => {
    const positions = gridPositions(0, 2000, 800, 1200);
    expect(positions).toEqual([0, 800, 1200]);
    expect(covers(positions, 0, 2000, 800)).toBe(true);
  });

  test('selection starting mid-page', () => {
    const positions = gridPositions(500, 1000, 800, 3000);
    expect(positions[0]).toBe(500);
    expect(covers(positions, 500, 1000, 800)).toBe(true);
  });

  test('selection deeper than max scroll still covers via clamped stop', () => {
    // Page 4000 tall, viewport 800 (max scroll 3200), selection at the very bottom.
    const positions = gridPositions(3500, 400, 800, 3200);
    expect(positions).toEqual([3200]);
    expect(covers(positions, 3500, 400, 800)).toBe(true);
  });

  test('never emits negative or duplicate stops', () => {
    for (const [start, span, step, max] of [
      [0, 5000, 733, 4267],
      [0, 100, 800, 0],
      [250, 3333, 900, 2700],
    ] as const) {
      const positions = gridPositions(start, span, step, max);
      expect(positions.every((p) => p >= 0 && p <= Math.max(0, max))).toBe(true);
      expect(new Set(positions).size).toBe(positions.length);
      expect(covers(positions, Math.min(start, max), span, step)).toBe(true);
    }
  });
});
