import { describe, expect, test } from 'bun:test';
import { hasFixedBackground } from '../../src/lib/capture-common';

describe('hasFixedBackground', () => {
  test('detects a single fixed layer', () => {
    expect(hasFixedBackground('fixed')).toBe(true);
  });

  test('ignores scroll and local attachments', () => {
    expect(hasFixedBackground('scroll')).toBe(false);
    expect(hasFixedBackground('local')).toBe(false);
    expect(hasFixedBackground('')).toBe(false);
  });

  test('finds fixed anywhere in a multi-layer list', () => {
    expect(hasFixedBackground('scroll, fixed')).toBe(true);
    expect(hasFixedBackground('fixed, local, scroll')).toBe(true);
    expect(hasFixedBackground('scroll, local')).toBe(false);
  });

  test('does not match substrings of other values', () => {
    // A hypothetical value merely containing the letters must not trip the check.
    expect(hasFixedBackground('not-fixed')).toBe(false);
  });
});
