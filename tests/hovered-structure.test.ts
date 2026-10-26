import { describe, expect, test } from 'vitest';
import { HoveredStructure } from '../lib/hovered-structure';

describe('hovered structure store', () => {
  test('notifies only when the hovered structure changes', () => {
    const hovered = new HoveredStructure();
    let calls = 0;
    hovered.subscribe(() => calls++);
    hovered.set('a');
    hovered.set('a');
    hovered.set('b');
    expect(hovered.get()).toBe('b');
    expect(calls).toBe(2);
  });

  test('a stale pointer-out does not clear a nearer structure', () => {
    const hovered = new HoveredStructure();
    hovered.set('front');
    hovered.release('behind');
    expect(hovered.get()).toBe('front');
    hovered.release('front');
    expect(hovered.get()).toBeNull();
  });

  test('pointer moves reach position listeners without a hover change', () => {
    const hovered = new HoveredStructure();
    let hovers = 0,
      moves = 0;
    hovered.subscribe(() => hovers++);
    const stop = hovered.subscribeMove(() => moves++);
    const bounds = { left: 0, top: 0, right: 800, bottom: 600 };
    hovered.point(10, 20, bounds);
    hovered.point(12, 24, bounds);
    stop();
    hovered.point(14, 28, bounds);
    expect([hovered.x, hovered.y]).toEqual([14, 28]);
    expect(moves).toBe(2);
    expect(hovers).toBe(0);
  });
});
