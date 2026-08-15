import { describe, expect, test } from 'bun:test';
import { HIJACK, HIJACK_NOTICE, makeRecord, movedEnough } from '../../src/lib/capture-common';

describe('movedEnough', () => {
  test('accepts a scroll that reached at least half of what was asked', () => {
    expect(movedEnough(800, 800)).toBe(true);
    expect(movedEnough(800, 400)).toBe(true);
    expect(movedEnough(800, 900)).toBe(true);
  });

  test('rejects a scroll that barely moved or did not move at all', () => {
    expect(movedEnough(800, 0)).toBe(false);
    expect(movedEnough(800, 399)).toBe(false);
    expect(movedEnough(800, -800)).toBe(false);
  });

  test('nothing was asked for, so nothing counts as stuck', () => {
    expect(movedEnough(0, 0)).toBe(true);
    expect(movedEnough(-10, 0)).toBe(true);
  });

  test('anchors are sampled across the viewport, not down one line', () => {
    expect(HIJACK.anchorXs.length * HIJACK.anchorYs.length).toBeGreaterThan(4);
  });
});

describe('makeRecord', () => {
  const base = {
    id: 'a',
    mode: 'full' as const,
    engine: 'stitch' as const,
    title: 't',
    url: 'u',
    tileCount: 1,
    truncated: false,
    clip: { x: 0, y: 0, w: 1200, h: 800 },
  };

  test('carries a capture notice through to the record', () => {
    expect(makeRecord({ ...base, notice: HIJACK_NOTICE }).notice).toBe(HIJACK_NOTICE);
  });

  test('leaves the field off when the capture was what was asked for', () => {
    expect('notice' in makeRecord(base)).toBe(false);
  });
});
