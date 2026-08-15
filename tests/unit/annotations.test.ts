/**
 * Geometry of the annotation model: measured text bounds and shape-aware hit
 * testing. No canvas exists under bun, so the measuring context is injected here
 * and the real-font path is covered by the Playwright UX suite instead.
 */
import { describe, expect, it } from 'bun:test';
import {
  applyHandle,
  bounds,
  canRotate,
  centerOf,
  handles,
  hitTest,
  localBounds,
  measureText,
  normalizeAngle,
  ROTATE_STEP,
  rotationOf,
  toLocal,
  toWorld,
  type Anno,
} from '../../src/editor/annotations';

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

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

const QUARTER = Math.PI / 2;

/** A 400 x 200 filled rectangle centred on (300, 200), optionally turned. */
const box = (rotation = 0): Anno => ({
  kind: 'rect',
  x: 100,
  y: 100,
  w: 400,
  h: 200,
  color: '#fff',
  width: 6,
  fill: true,
  rotation,
});

describe('rotation model', () => {
  it('treats a missing angle as none, so older captures still load', () => {
    const legacy = { kind: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#fff', width: 6, fill: false } as Anno;
    expect(rotationOf(legacy)).toBe(0);
    expect(rotationOf(box(0.4))).toBeCloseTo(0.4, 10);
  });

  it('offers rotation to shapes with a box, and not to the rest', () => {
    expect(canRotate(box())).toBe(true);
    expect(canRotate({ kind: 'text', x: 0, y: 0, text: 'a', color: '#fff', size: 36 })).toBe(true);
    expect(canRotate({ kind: 'emoji', x: 0, y: 0, char: '✅', size: 40 })).toBe(true);
    expect(canRotate({ kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1, color: '#fff', width: 6 })).toBe(false);
    expect(canRotate({ kind: 'pen', points: [0, 0, 1, 1], color: '#fff', width: 6 })).toBe(false);
  });

  it('turns about the centre of the box, which the angle never moves', () => {
    expect(centerOf(box())).toEqual({ x: 300, y: 200 });
    expect(centerOf(box(QUARTER))).toEqual({ x: 300, y: 200 });
  });

  it('folds a full turn back to nothing', () => {
    expect(normalizeAngle(0)).toBeCloseTo(0, 10);
    expect(normalizeAngle(Math.PI * 2)).toBeCloseTo(0, 10);
    expect(normalizeAngle(Math.PI * 2.5)).toBeCloseTo(QUARTER, 10);
    expect(normalizeAngle(-Math.PI * 1.5)).toBeCloseTo(QUARTER, 10);
    // Half a turn sits on the boundary of the range and comes back as the low end.
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(-Math.PI, 10);
  });

  it('round-trips a point between the image and the shape frame', () => {
    const a = box(0.7);
    const w = toWorld(a, 120, 140);
    expect(w.x).not.toBeCloseTo(120, 3);
    const back = toLocal(a, w.x, w.y);
    expect(back.x).toBeCloseTo(120, 8);
    expect(back.y).toBeCloseTo(140, 8);
  });

  it('leaves points alone when there is no angle', () => {
    expect(toWorld(box(), 12, 34)).toEqual({ x: 12, y: 34 });
    expect(toLocal(box(), 12, 34)).toEqual({ x: 12, y: 34 });
  });
});

describe('bounds under rotation', () => {
  it('keeps localBounds the shape s own upright box', () => {
    expect(localBounds(box(QUARTER))).toEqual({ x: 100, y: 100, w: 400, h: 200 });
  });

  it('swaps width and height in the outer box at a quarter turn', () => {
    const b = bounds(box(QUARTER));
    expect(b.w).toBeCloseTo(200, 6);
    expect(b.h).toBeCloseTo(400, 6);
    expect(b.x + b.w / 2).toBeCloseTo(300, 6);
    expect(b.y + b.h / 2).toBeCloseTo(200, 6);
  });

  it('grows the outer box at an angle between the axes', () => {
    const b = bounds(box(Math.PI / 4));
    expect(b.w).toBeGreaterThan(400);
    expect(b.h).toBeGreaterThan(200);
    expect(b.w).toBeCloseTo((400 + 200) / Math.SQRT2, 6);
  });

  it('returns the upright box untouched with no angle', () => {
    expect(bounds(box())).toEqual(localBounds(box()));
  });
});

describe('hitTest under rotation', () => {
  it('follows the shape round rather than staying axis aligned', () => {
    const upright = box();
    const turned = box(QUARTER);
    // A point off the short end: inside the upright rectangle, outside the turned one.
    expect(hitTest(upright, 480, 200, 6)).toBe(true);
    expect(hitTest(turned, 480, 200, 6)).toBe(false);
    // And a point off the long side, which only the turned rectangle covers.
    expect(hitTest(upright, 300, 380, 6)).toBe(false);
    expect(hitTest(turned, 300, 380, 6)).toBe(true);
  });

  it('still takes the centre whichever way the shape faces', () => {
    expect(hitTest(box(0.9), 300, 200, 6)).toBe(true);
  });

  it('turns a text box with its glyphs', () => {
    const a: Anno = { kind: 'text', x: 100, y: 100, text: 'iiiiiiii', color: '#fff', size: 36 };
    const b = localBounds(a);
    const past = { x: a.x + b.w + b.h, y: a.y + b.h / 2 };
    expect(hitTest(a, past.x, past.y, 2)).toBe(false);
    // Turned a quarter, the same distance now runs down the long axis instead.
    const turned: Anno = { ...a, rotation: QUARTER };
    const c = centerOf(turned);
    expect(hitTest(turned, c.x, c.y + b.w / 2 - 2, 2)).toBe(true);
    expect(hitTest(turned, c.x + b.w / 2, c.y, 2)).toBe(false);
  });
});

describe('handles under rotation', () => {
  it('adds a rotation knob above the top edge, and none to a line or pen', () => {
    const ids = handles(box()).map((h) => h.id);
    expect(ids).toContain('rot');
    expect(handles({ kind: 'line', x1: 0, y1: 0, x2: 9, y2: 9, color: '#fff', width: 6 }).map((h) => h.id))
      .toEqual(['p1', 'p2']);
    expect(handles({ kind: 'pen', points: [0, 0], color: '#fff', width: 6 })).toEqual([]);
  });

  it('scales the knob arm so it stays a constant length on screen', () => {
    const near = handles(box(), 1).find((h) => h.id === 'rot')!;
    const far = handles(box(), 4).find((h) => h.id === 'rot')!;
    expect(near.y).toBeLessThan(100);
    // Four image px per screen px puts the knob four times further out.
    expect(100 - far.y).toBeCloseTo((100 - near.y) * 4, 6);
  });

  it('turns every handle with the shape', () => {
    const turned = handles(box(QUARTER)).find((h) => h.id === 'nw')!;
    // The north-west corner of a box turned a quarter clockwise lands north-east.
    expect(turned.x).toBeCloseTo(400, 6);
    expect(turned.y).toBeCloseTo(0, 6);
  });
});

describe('applyHandle rotation', () => {
  it('points the shape at the pointer, a quarter turn behind it', () => {
    const a = box();
    // Directly right of the centre: the knob normally sits above, so this is +90.
    applyHandle(a, box(), 'rot', 600, 200);
    expect(rotationOf(a)).toBeCloseTo(QUARTER, 6);
  });

  it('snaps to fifteen degree steps with Shift', () => {
    const a = box();
    applyHandle(a, box(), 'rot', 600, 214, { shift: true });
    expect(rotationOf(a) % ROTATE_STEP).toBeCloseTo(0, 6);
    expect(rotationOf(a)).toBeCloseTo(QUARTER, 6);
  });

  it('holds its angle when the pointer sits on the pivot', () => {
    const a = box(0.5);
    applyHandle(a, box(0.5), 'rot', 300, 200);
    expect(rotationOf(a)).toBeCloseTo(0.5, 10);
  });

  it('never turns a line or a pen stroke', () => {
    const line: Anno = { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0, color: '#fff', width: 6 };
    applyHandle(line, { ...line }, 'rot', 50, 50);
    expect(rotationOf(line)).toBe(0);
  });
});

describe('resizing a turned shape', () => {
  it('is unchanged from the upright path when there is no angle', () => {
    const a = box();
    applyHandle(a, box(), 'se', 700, 500);
    expect(a).toMatchObject({ x: 100, y: 100, w: 600, h: 400 });
  });

  it('keeps the opposite corner where the eye left it', () => {
    const start = box(QUARTER);
    const a = box(QUARTER);
    // Pull the south-east corner out along the shape's own axes, so the drag grows
    // the box rather than folding it through itself.
    const target = toWorld(start, 500 + 100, 300 + 80);
    const before = handles(start).find((h) => h.id === 'nw')!;
    applyHandle(a, start, 'se', target.x, target.y);
    const after = handles(a).find((h) => h.id === 'nw')!;
    expect(localBounds(a).w).toBeCloseTo(500, 6);
    expect(localBounds(a).h).toBeCloseTo(280, 6);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(rotationOf(a)).toBeCloseTo(QUARTER, 10);
  });

  it('resizes about the centre with Alt, whatever the angle', () => {
    const a = box(0.8);
    applyHandle(a, box(0.8), 'se', 620, 420, { alt: true });
    expect(centerOf(a).x).toBeCloseTo(300, 6);
    expect(centerOf(a).y).toBeCloseTo(200, 6);
  });

  it('pins the opposite corner when a turned text label is scaled', () => {
    const start: Anno = { kind: 'text', x: 100, y: 100, text: 'scale me', color: '#fff', size: 36, rotation: 0.6 };
    const a: Anno = { ...start };
    const before = handles(start).find((h) => h.id === 'nw')!;
    const se = handles(start).find((h) => h.id === 'se')!;
    applyHandle(a, start, 'se', se.x + 90, se.y + 70);
    const after = handles(a).find((h) => h.id === 'nw')!;
    expect((a as { size: number }).size).toBeGreaterThan(36);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});
