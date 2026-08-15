/**
 * Geometry of the annotation model: measured text bounds and shape-aware hit
 * testing. No canvas exists under bun, so the measuring context is injected here
 * and the real-font path is covered by the Playwright UX suite instead.
 */
import { describe, expect, it } from 'bun:test';
import { bounds, hitTest, measureText, type Anno } from '../../src/editor/annotations';

/** Stands in for a 2D context: every glyph is exactly half the font size wide. */
const fakeCtx: Pick<CanvasRenderingContext2D, 'font' | 'measureText'> = {
  font: '',
  measureText(text: string) {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(fakeCtx.font)?.[1] ?? 0);
    return { width: text.length * size * 0.5 } as TextMetrics;
  },
};

describe('measureText', () => {
  it('measures the widest line with the annotation font', () => {
    const m = measureText('WWWW\nWW', 84, fakeCtx as CanvasRenderingContext2D);
    expect(m.w).toBeCloseTo(4 * 84 * 0.5, 5);
    expect(m.h).toBeCloseTo(2 * 84 * 1.25, 5);
  });

  it('falls back to an estimate when there is nothing to measure with', () => {
    const m = measureText('WWWWWWWWWW', 84, null);
    expect(m.w).toBeCloseTo(10 * 84 * 0.62, 5);
    expect(m.h).toBeCloseTo(84 * 1.25, 5);
  });

  it('scales with the font size rather than assuming one', () => {
    const small = measureText('abc', 24, fakeCtx as CanvasRenderingContext2D);
    const large = measureText('abc', 84, fakeCtx as CanvasRenderingContext2D);
    expect(small.w).toBeLessThan(large.w);
  });
});

describe('bounds', () => {
  it('anchors a text run at its own top-left corner', () => {
    const a: Anno = { kind: 'text', x: 30, y: 40, text: 'hello', color: '#fff', size: 36 };
    const b = bounds(a);
    expect(b.x).toBe(30);
    expect(b.y).toBe(40);
    expect(b.w).toBeGreaterThan(0);
    expect(b.h).toBeCloseTo(36 * 1.25, 5);
  });

  it('grows the box when the text grows', () => {
    const short: Anno = { kind: 'text', x: 0, y: 0, text: 'i', color: '#fff', size: 36 };
    const long: Anno = { kind: 'text', x: 0, y: 0, text: 'iiiiiiiiiiii', color: '#fff', size: 36 };
    expect(bounds(long).w).toBeGreaterThan(bounds(short).w);
  });
});

describe('hitTest', () => {
  const rect = (fill: boolean): Anno => ({
    kind: 'rect',
    x: 100,
    y: 100,
    w: 500,
    h: 400,
    color: '#fff',
    width: 6,
    fill,
  });

  it('ignores the empty interior of an unfilled rectangle', () => {
    expect(hitTest(rect(false), 350, 300, 6)).toBe(false);
  });

  it('takes the stroke band of an unfilled rectangle', () => {
    expect(hitTest(rect(false), 350, 100, 6)).toBe(true);
    expect(hitTest(rect(false), 100, 300, 6)).toBe(true);
  });

  it('takes the whole interior once the rectangle is filled', () => {
    expect(hitTest(rect(true), 350, 300, 6)).toBe(true);
  });

  it('misses well outside the rectangle either way', () => {
    expect(hitTest(rect(false), 50, 50, 6)).toBe(false);
    expect(hitTest(rect(true), 50, 50, 6)).toBe(false);
  });

  const line: Anno = { kind: 'line', x1: 100, y1: 100, x2: 500, y2: 500, color: '#fff', width: 6 };

  it('does not claim the whole bounding box of a diagonal line', () => {
    expect(hitTest(line, 100, 500, 6)).toBe(false);
    expect(hitTest(line, 500, 100, 6)).toBe(false);
  });

  it('takes a point on the stroke of a diagonal line', () => {
    expect(hitTest(line, 300, 302, 6)).toBe(true);
    expect(hitTest(line, 300, 300, 6)).toBe(true);
  });

  it('does not extend a line past its endpoints', () => {
    expect(hitTest(line, 560, 560, 6)).toBe(false);
  });

  const ellipse = (fill: boolean): Anno => ({
    kind: 'ellipse',
    x: 100,
    y: 100,
    w: 400,
    h: 300,
    color: '#fff',
    width: 6,
    fill,
  });

  it('ignores the empty interior of an unfilled ellipse', () => {
    expect(hitTest(ellipse(false), 300, 250, 6)).toBe(false);
    expect(hitTest(ellipse(true), 300, 250, 6)).toBe(true);
  });

  it('takes the rim of an unfilled ellipse', () => {
    expect(hitTest(ellipse(false), 500, 250, 6)).toBe(true);
    expect(hitTest(ellipse(false), 300, 100, 6)).toBe(true);
  });

  it('misses the corners of an ellipse bounding box', () => {
    expect(hitTest(ellipse(true), 105, 105, 6)).toBe(false);
  });

  it('treats highlight and redaction as solid regions', () => {
    const hl: Anno = { kind: 'highlight', x: 100, y: 100, w: 300, h: 100, color: '#eab308' };
    const blur: Anno = { kind: 'blur', x: 100, y: 100, w: 300, h: 100, px: 14 };
    expect(hitTest(hl, 250, 150, 6)).toBe(true);
    expect(hitTest(blur, 250, 150, 6)).toBe(true);
    expect(hitTest(hl, 250, 260, 6)).toBe(false);
  });

  it('follows a pen stroke rather than its box', () => {
    const pen: Anno = {
      kind: 'pen',
      points: [100, 100, 300, 100, 300, 300],
      color: '#fff',
      width: 4,
    };
    expect(hitTest(pen, 200, 101, 6)).toBe(true);
    expect(hitTest(pen, 120, 280, 6)).toBe(false);
  });

  it('honours the tolerance it is given', () => {
    expect(hitTest(line, 300, 320, 6)).toBe(false);
    expect(hitTest(line, 300, 320, 30)).toBe(true);
  });
});
