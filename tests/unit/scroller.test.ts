import { describe, expect, test } from 'bun:test';
import { pickDominantScroller, type ScrollerCandidate } from '../../src/lib/capture-common';

const VP_W = 1200;
const VP_H = 800;

function candidate(over: Partial<ScrollerCandidate> = {}): ScrollerCandidate {
  return {
    overflowY: 'auto',
    scrollHeight: 3000,
    clientWidth: 1200,
    clientHeight: 700,
    ...over,
  };
}

describe('pickDominantScroller', () => {
  test('returns null with no candidates', () => {
    expect(pickDominantScroller([], VP_W, VP_H)).toBeNull();
  });

  test('picks a qualifying auto-overflow container', () => {
    const c = candidate();
    expect(pickDominantScroller([c], VP_W, VP_H)).toBe(c);
  });

  test('accepts overflow scroll, rejects visible and hidden', () => {
    expect(pickDominantScroller([candidate({ overflowY: 'scroll' })], VP_W, VP_H)).not.toBeNull();
    expect(pickDominantScroller([candidate({ overflowY: 'visible' })], VP_W, VP_H)).toBeNull();
    expect(pickDominantScroller([candidate({ overflowY: 'hidden' })], VP_W, VP_H)).toBeNull();
  });

  test('rejects containers with less than 100px of hidden content', () => {
    expect(
      pickDominantScroller([candidate({ scrollHeight: 790, clientHeight: 700 })], VP_W, VP_H)
    ).toBeNull();
    expect(
      pickDominantScroller([candidate({ scrollHeight: 801, clientHeight: 700 })], VP_W, VP_H)
    ).not.toBeNull();
  });

  test('rejects containers covering under 40% of the viewport', () => {
    // 300x700 = 210000 < 0.4 * 1200 * 800 = 384000
    expect(pickDominantScroller([candidate({ clientWidth: 300 })], VP_W, VP_H)).toBeNull();
    // 480x800 = 384000 exactly meets the floor
    expect(
      pickDominantScroller([candidate({ clientWidth: 480, clientHeight: 800, scrollHeight: 3000 })], VP_W, VP_H)
    ).not.toBeNull();
  });

  test('largest client area wins among multiple qualifiers', () => {
    const sidebar = candidate({ clientWidth: 500, clientHeight: 800 });
    const main = candidate({ clientWidth: 700, clientHeight: 800 });
    expect(pickDominantScroller([sidebar, main], VP_W, VP_H)).toBe(main);
    expect(pickDominantScroller([main, sidebar], VP_W, VP_H)).toBe(main);
  });

  test('disqualified larger element does not shadow a smaller qualifier', () => {
    const bigButStatic = candidate({ overflowY: 'visible' });
    const scroller = candidate({ clientWidth: 700, clientHeight: 800 });
    expect(pickDominantScroller([bigButStatic, scroller], VP_W, VP_H)).toBe(scroller);
  });

  test('a mail reading pane wins over the folder list beside it', () => {
    // 25/75 split of a 1200px window under a 48px header.
    const folders = candidate({ clientWidth: 300, clientHeight: 752, scrollHeight: 2400 });
    const reading = candidate({ clientWidth: 900, clientHeight: 752, scrollHeight: 2600 });
    expect(pickDominantScroller([folders, reading], VP_W, VP_H)).toBe(reading);
  });

  test('ignoreOverflow admits containers locked with overflow hidden', () => {
    const locked = candidate({ overflowY: 'hidden' });
    expect(pickDominantScroller([locked], VP_W, VP_H, true)).toBe(locked);
    // The other rules still apply: nothing to scroll is still nothing to scroll.
    expect(
      pickDominantScroller([candidate({ overflowY: 'hidden', scrollHeight: 700 })], VP_W, VP_H, true)
    ).toBeNull();
  });
});
