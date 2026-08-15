import { describe, expect, test } from 'bun:test';
import { countdownSteps } from '../../src/lib/capture-common';

describe('countdownSteps', () => {
  test('counts down whole seconds to 1', () => {
    expect(countdownSteps(5)).toEqual([5, 4, 3, 2, 1]);
    expect(countdownSteps(1)).toEqual([1]);
  });

  test('zero delay means no countdown', () => {
    expect(countdownSteps(0)).toEqual([]);
  });

  test('negative and invalid delays are treated as no countdown', () => {
    expect(countdownSteps(-3)).toEqual([]);
    expect(countdownSteps(Number.NaN)).toEqual([]);
    expect(countdownSteps(Number.POSITIVE_INFINITY)).toEqual([]);
  });

  test('fractional delays floor to whole badge steps', () => {
    expect(countdownSteps(3.9)).toEqual([3, 2, 1]);
  });
});
