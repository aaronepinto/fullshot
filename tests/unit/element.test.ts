import { describe, expect, test } from 'bun:test';
import { elementLabel, isScrollableTarget } from '../../src/lib/capture-common';

describe('isScrollableTarget', () => {
  test('accepts overflow auto and scroll with enough hidden content', () => {
    expect(
      isScrollableTarget({ overflowY: 'auto', scrollHeight: 900, clientHeight: 400 })
    ).toBe(true);
    expect(
      isScrollableTarget({ overflowY: 'scroll', scrollHeight: 900, clientHeight: 400 })
    ).toBe(true);
  });

  test('rejects overflow visible and hidden even with hidden content', () => {
    expect(
      isScrollableTarget({ overflowY: 'visible', scrollHeight: 900, clientHeight: 400 })
    ).toBe(false);
    expect(
      isScrollableTarget({ overflowY: 'hidden', scrollHeight: 900, clientHeight: 400 })
    ).toBe(false);
  });

  test('requires more than 100px of hidden content', () => {
    expect(
      isScrollableTarget({ overflowY: 'auto', scrollHeight: 500, clientHeight: 400 })
    ).toBe(false);
    expect(
      isScrollableTarget({ overflowY: 'auto', scrollHeight: 501, clientHeight: 400 })
    ).toBe(true);
  });
});

describe('elementLabel', () => {
  test('lowercases the tag and rounds the CSS size', () => {
    expect(elementLabel('DIV', 320.4, 480.6)).toBe('div · 320 × 481');
  });

  test('handles namespaced/custom tags verbatim', () => {
    expect(elementLabel('MY-WIDGET', 100, 50)).toBe('my-widget · 100 × 50');
  });
});
