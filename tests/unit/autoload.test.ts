import { describe, expect, test } from 'bun:test';
import { AUTO_LOAD, shouldContinueAutoLoad } from '../../src/lib/capture-common';

const MAX_H = 40_000;

describe('shouldContinueAutoLoad', () => {
  test('continues while the page keeps growing enough', () => {
    expect(shouldContinueAutoLoad(2000, 2000 + AUTO_LOAD.minGrowth, MAX_H, 1, 600)).toBe(true);
    expect(shouldContinueAutoLoad(2000, 5000, MAX_H, 10, 6000)).toBe(true);
  });

  test('stops when growth falls under the minimum', () => {
    expect(shouldContinueAutoLoad(2000, 2000 + AUTO_LOAD.minGrowth - 1, MAX_H, 1, 600)).toBe(false);
    expect(shouldContinueAutoLoad(2000, 2000, MAX_H, 1, 600)).toBe(false);
  });

  test('stops when the page shrinks', () => {
    expect(shouldContinueAutoLoad(5000, 3000, MAX_H, 1, 600)).toBe(false);
  });

  test('stops at the capture height ceiling', () => {
    expect(shouldContinueAutoLoad(MAX_H - 1000, MAX_H, MAX_H, 1, 600)).toBe(false);
    expect(shouldContinueAutoLoad(MAX_H - 1000, MAX_H - 1, MAX_H, 1, 600)).toBe(true);
  });

  test('stops at the round cap', () => {
    expect(shouldContinueAutoLoad(2000, 3000, MAX_H, AUTO_LOAD.maxRounds, 600)).toBe(false);
    expect(shouldContinueAutoLoad(2000, 3000, MAX_H, AUTO_LOAD.maxRounds - 1, 600)).toBe(true);
  });

  test('stops when the time budget is spent', () => {
    expect(shouldContinueAutoLoad(2000, 3000, MAX_H, 1, AUTO_LOAD.maxTotalMs)).toBe(false);
    expect(shouldContinueAutoLoad(2000, 3000, MAX_H, 1, AUTO_LOAD.maxTotalMs - 1)).toBe(true);
  });
});
