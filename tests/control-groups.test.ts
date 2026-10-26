import { describe, expect, test } from 'vitest';
import {
  addToGroup,
  assignGroup,
  groupSlot,
  groupStorageKey,
  isDoubleTap,
  parseGroups,
  pruneGroups,
  recallGroup,
} from '../lib/control-groups';

describe('control groups', () => {
  test('reads the slot from the physical digit keys', () => {
    expect(groupSlot('Digit1')).toBe(1);
    expect(groupSlot('Digit9')).toBe(9);
    expect(groupSlot('Numpad4')).toBe(4);
    expect(groupSlot('Digit0')).toBeNull();
    expect(groupSlot('KeyF')).toBeNull();
  });

  test('assigning replaces a group and an empty selection clears it', () => {
    const one = assignGroup({}, 1, ['a', 'b', 'a']);
    expect(one).toEqual({ 1: ['a', 'b'] });
    expect(assignGroup(one, 1, ['c'])).toEqual({ 1: ['c'] });
    expect(assignGroup(one, 1, [])).toEqual({});
    expect(one).toEqual({ 1: ['a', 'b'] });
  });

  test('adding keeps existing members and skips duplicates', () => {
    const groups = assignGroup({}, 2, ['a', 'b']);
    expect(addToGroup(groups, 2, ['b', 'c'])).toEqual({ 2: ['a', 'b', 'c'] });
    expect(addToGroup(groups, 3, ['z'])).toEqual({ 2: ['a', 'b'], 3: ['z'] });
  });

  test('a unit may belong to several groups', () => {
    const groups = assignGroup(assignGroup({}, 1, ['a', 'b']), 2, ['b']);
    expect(groups).toEqual({ 1: ['a', 'b'], 2: ['b'] });
  });

  test('recall returns only members that can take orders', () => {
    const groups = { 1: ['a', 'b', 'c'] };
    const ready = new Set(['a', 'c']);
    expect(recallGroup(groups, 1, (id) => ready.has(id))).toEqual(['a', 'c']);
    expect(recallGroup(groups, 5, () => true)).toEqual([]);
  });

  test('pruning drops dead ids and empty groups', () => {
    const groups = { 1: ['a', 'b'], 2: ['c'] };
    expect(pruneGroups(groups, (id) => id !== 'b' && id !== 'c')).toEqual({
      1: ['a'],
    });
    expect(pruneGroups(groups, () => true)).toBe(groups);
  });

  test('a double tap is the same slot within the window', () => {
    expect(isDoubleTap(null, 1, 100)).toBe(false);
    expect(isDoubleTap({ slot: 1, at: 100 }, 1, 400)).toBe(true);
    expect(isDoubleTap({ slot: 1, at: 100 }, 1, 451)).toBe(false);
    expect(isDoubleTap({ slot: 1, at: 100 }, 2, 200)).toBe(false);
  });

  test('stored groups survive a round trip and junk is ignored', () => {
    const groups = assignGroup(assignGroup({}, 1, ['a']), 4, ['b', 'c']);
    expect(parseGroups(JSON.stringify(groups))).toEqual(groups);
    expect(parseGroups(null)).toEqual({});
    expect(parseGroups('{nope')).toEqual({});
    expect(parseGroups('[1,2]')).toEqual({});
    expect(parseGroups('{"0":["a"],"3":[1,"x"],"12":["y"],"5":"z"}')).toEqual({
      3: ['x'],
    });
    expect(groupStorageKey('s1', 'p1')).toBe('noordheim:control-groups:s1:p1');
  });
});
