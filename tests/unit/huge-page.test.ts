import { describe, expect, test } from 'bun:test';
import { BLANK_TRIM, IMPLAUSIBLE_HEIGHT, formatPx, isUniform } from '../../src/lib/capture-common';
import { DEFAULTS } from '../../src/lib/settings';

/** An RGBA sample of `n` pixels, all the given colour unless a patch is painted in. */
function sample(n: number, [r, g, b]: [number, number, number], patch?: { at: number; rgb: [number, number, number] }) {
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  if (patch) {
    data[patch.at * 4] = patch.rgb[0];
    data[patch.at * 4 + 1] = patch.rgb[1];
    data[patch.at * 4 + 2] = patch.rgb[2];
  }
  return data;
}

describe('formatPx', () => {
  test('writes a pixel count the way a person reads it', () => {
    expect(formatPx(33554432)).toBe('33,554,432 px');
    expect(formatPx(40000)).toBe('40,000 px');
    expect(formatPx(800)).toBe('800 px');
  });

  test('rounds, so a fractional viewport does not leak decimals into the prompt', () => {
    expect(formatPx(713.6)).toBe('714 px');
  });
});

describe('isUniform', () => {
  test('a tile of one flat colour holds nothing', () => {
    expect(isUniform(sample(256, [255, 255, 255]), BLANK_TRIM.tolerance)).toBe(true);
    expect(isUniform(sample(256, [17, 17, 20]), BLANK_TRIM.tolerance)).toBe(true);
  });

  test('a single pixel of content is enough to keep the tile', () => {
    const data = sample(256, [255, 255, 255], { at: 137, rgb: [255, 255, 200] });
    expect(isUniform(data, BLANK_TRIM.tolerance)).toBe(false);
  });

  test('compression noise under the tolerance still counts as blank', () => {
    const data = sample(256, [250, 250, 250], { at: 40, rgb: [252, 248, 250] });
    expect(isUniform(data, BLANK_TRIM.tolerance)).toBe(true);
  });

  test('alpha is ignored: a screenshot is opaque and its alpha says nothing', () => {
    const data = sample(64, [12, 12, 12]);
    data[7] = 0;
    expect(isUniform(data, BLANK_TRIM.tolerance)).toBe(true);
  });

  test('an empty sample cannot disprove blankness', () => {
    expect(isUniform(new Uint8ClampedArray(0), BLANK_TRIM.tolerance)).toBe(true);
  });
});

describe('the impossible-height contract', () => {
  test('asking is the default: the engine does not pick for the user', () => {
    expect(DEFAULTS.hugePageAction).toBe('ask');
  });

  test('the threshold is far above any real page and far below the observed bug', () => {
    expect(IMPLAUSIBLE_HEIGHT).toBeGreaterThan(DEFAULTS.maxCaptureHeight * 10);
    expect(IMPLAUSIBLE_HEIGHT).toBeLessThan(33554432);
  });

  test('a trim needs a run, so one blank screen mid-page cannot end a capture', () => {
    expect(BLANK_TRIM.runTiles).toBeGreaterThan(1);
  });
});
