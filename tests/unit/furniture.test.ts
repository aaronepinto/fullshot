import { describe, expect, test } from 'bun:test';
import { fixedEdge, pixelScale, showsOnTile } from '../../src/lib/capture-common';

const box = (top: number, height: number, left = 0, width = 1200) => ({
  top,
  bottom: top + height,
  left,
  right: left + width,
});

describe('fixedEdge', () => {
  test('a bar in the top half of the viewport belongs to the top of the page', () => {
    expect(fixedEdge(box(0, 60), 1200, 800)).toBe('top');
    expect(fixedEdge(box(120, 80), 1200, 800)).toBe('top');
  });

  test('a bar in the bottom half belongs to the foot of the page', () => {
    expect(fixedEdge(box(744, 56), 1200, 800)).toBe('bottom');
    // The floating action button: small, and pinned above the bottom bar.
    expect(fixedEdge(box(664, 56, 1144, 56), 1200, 800)).toBe('bottom');
  });

  test('a tall narrow element is a side rail, which every tile needs', () => {
    expect(fixedEdge(box(0, 800, 0, 72), 1200, 800)).toBe('rail');
    expect(fixedEdge(box(0, 800, 1128, 72), 1200, 800)).toBe('rail');
  });

  test('a full-screen overlay is not a rail: it must not be stamped into every tile', () => {
    expect(fixedEdge(box(0, 800, 0, 1200), 1200, 800)).toBe('top');
  });
});

describe('showsOnTile', () => {
  test('headers ride the first tile, foot furniture the last', () => {
    expect(showsOnTile('top', true, false)).toBe(true);
    expect(showsOnTile('top', false, false)).toBe(false);
    expect(showsOnTile('bottom', true, false)).toBe(false);
    expect(showsOnTile('bottom', false, true)).toBe(true);
  });

  test('a rail runs the whole image', () => {
    expect(showsOnTile('rail', true, false)).toBe(true);
    expect(showsOnTile('rail', false, false)).toBe(true);
  });

  test('a single-tile capture is both first and last, so nothing is hidden', () => {
    for (const edge of ['top', 'bottom', 'rail'] as const) {
      expect(showsOnTile(edge, true, true)).toBe(true);
    }
  });
});

describe('pixelScale', () => {
  test('the ratio the page reports wins when the bitmap agrees with it', () => {
    // 1199 CSS px at 1.25x is 1498.75 device px, and the bitmap comes back 1499 wide.
    expect(pixelScale(1499 / 1199, 1.25)).toBe(1.25);
    expect(pixelScale(1.5, 1.5)).toBe(1.5);
  });

  test('two hundredths of a percent is two pixels down a tall page', () => {
    const measured = 1499 / 1199;
    expect(Math.round(4000 * measured)).toBe(5001);
    expect(Math.round(4000 * pixelScale(measured, 1.25))).toBe(5000);
  });

  test('a screenshot at some other scale entirely is believed over the page', () => {
    expect(pixelScale(1, 2)).toBe(1);
    expect(pixelScale(1.25, 0)).toBe(1.25);
  });
});
