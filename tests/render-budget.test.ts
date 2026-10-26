import { expect, test } from 'vitest';
import {
  budgetedDpr,
  BATTLEFIELD_PIXEL_BUDGET,
  COMMAND_POST_PIXEL_BUDGET,
} from '../lib/render-budget';

test('normal battlefield resolution is retained while Retina, 4K and ultrawide buffers stay bounded', () => {
  expect(budgetedDpr(1280, 720, 2)).toBe(1.6);
  expect(budgetedDpr(1280, 720, 1)).toBe(1);
  for (const [width, height, device] of [
    [2560, 1440, 2],
    [3840, 2160, 2],
    [5120, 1440, 2],
    [430, 932, 3],
  ]) {
    const dpr = budgetedDpr(width, height, device);
    expect(
      Math.floor(width * dpr) * Math.floor(height * dpr),
    ).toBeLessThanOrEqual(BATTLEFIELD_PIXEL_BUDGET);
    expect(dpr).toBeLessThanOrEqual(device);
  }
  expect(budgetedDpr(3840, 2160, 1)).toBeLessThan(1);
});

test('menu has a separate smaller budget and zero-sized hidden canvases remain valid', () => {
  const dpr = budgetedDpr(1600, 900, 2, COMMAND_POST_PIXEL_BUDGET, 1.5);
  expect(Math.floor(1600 * dpr) * Math.floor(900 * dpr)).toBeLessThanOrEqual(
    COMMAND_POST_PIXEL_BUDGET,
  );
  expect(budgetedDpr(0, 0, 2)).toBe(1);
  expect(budgetedDpr(NaN, 720, 2)).toBe(1);
  expect(budgetedDpr(1280, 720, NaN)).toBe(1);
  // Shrinking back from fullscreen restores the original detail, not the previous DPR.
  expect(budgetedDpr(1280, 720, 2)).toBe(1.6);
});
