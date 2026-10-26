import { describe, expect, test } from 'vitest';
import {
  joinBattle,
  makeEntity,
  newBattle,
  type Battle,
  type EntityKind,
} from '../lib/tactics';
import {
  NEW_TUTORIAL,
  TUTORIAL_STEPS,
  parseTutorial,
  progressIn,
  tutorialFacts,
  tutorialStep,
  tutorialVisible,
  type TutorialActions,
} from '../lib/tutorial';

const owner = 'p1';
const idle: TutorialActions = { trained: false, commanded: false };

function firstMatch() {
  const b = newBattle(1000, { seed: 7 });
  joinBattle(b, { id: owner, name: 'Raven', culture: 'fjordborn' }, 1000);
  return b;
}
function build(b: Battle, kind: EntityKind, readyAt = 0) {
  const e = makeEntity(b, kind, owner, 'blue', { x: 0, z: 0 });
  e.readyAt = readyAt;
  b.entities.push(e);
  return e;
}
const stepOf = (b: Battle, actions = idle, floor = 0) =>
  TUTORIAL_STEPS[tutorialStep(tutorialFacts(b, owner, actions), floor)].id;

describe('first-match tutorial', () => {
  test('a fresh match starts at the power plant, despite the starting patrol', () => {
    expect(stepOf(firstMatch())).toBe('power');
  });

  test('a structure still under construction does not complete its step', () => {
    const b = firstMatch();
    build(b, 'reactor', 5000);
    expect(stepOf(b)).toBe('power');
  });

  test('each completed structure advances to the next objective', () => {
    const b = firstMatch();
    build(b, 'reactor');
    expect(stepOf(b)).toBe('refinery');
    build(b, 'refinery');
    expect(stepOf(b)).toBe('barracks');
    build(b, 'barracks');
    expect(stepOf(b)).toBe('train');
  });

  test('any troop-producing building counts as the barracks step', () => {
    const b = firstMatch();
    build(b, 'reactor');
    build(b, 'refinery');
    build(b, 'factory');
    expect(stepOf(b)).toBe('train');
  });

  test('another commander’s or a destroyed plant does not count', () => {
    const b = firstMatch();
    b.entities.push(makeEntity(b, 'reactor', 'p2', 'blue', { x: 0, z: 0 }));
    build(b, 'reactor').hp = 0;
    expect(stepOf(b)).toBe('power');
  });

  test('troops in training complete the training step; harvesters do not', () => {
    const b = firstMatch();
    for (const kind of ['reactor', 'refinery', 'factory'] as const)
      build(b, kind);
    b.training = [
      { id: 'h', owner, kind: 'harvester', remaining: 1, total: 1, readyAt: 0 },
    ];
    expect(stepOf(b)).toBe('train');
    b.training.push({
      id: 't',
      owner,
      kind: 'lynx',
      remaining: 1,
      total: 1,
      readyAt: 0,
    });
    expect(stepOf(b)).toBe('command');
    b.training = [];
    expect(stepOf(b, { trained: true, commanded: false })).toBe('command');
  });

  test('an order completes the command step and leaves the victory goal', () => {
    const b = firstMatch();
    expect(stepOf(b, { trained: true, commanded: true })).toBe('victory');
  });

  test('a later objective met keeps earlier ones done after losses', () => {
    const b = firstMatch();
    build(b, 'barracks');
    expect(stepOf(b)).toBe('train');
  });

  test('Next skips ahead but never past the last step', () => {
    const b = firstMatch();
    expect(stepOf(b, idle, 2)).toBe('barracks');
    expect(stepOf(b, idle, 99)).toBe('victory');
  });

  test('stored progress survives bad data', () => {
    expect(parseTutorial(null)).toEqual(NEW_TUTORIAL);
    expect(parseTutorial('not json')).toEqual(NEW_TUTORIAL);
    expect(parseTutorial('{"status":"weird","floor":-3}')).toEqual(
      NEW_TUTORIAL,
    );
    expect(
      parseTutorial(
        '{"status":"active","sector":"s1","floor":2,"trained":true,"commanded":false}',
      ),
    ).toEqual({
      status: 'active',
      sector: 's1',
      floor: 2,
      trained: true,
      commanded: false,
    });
  });

  test('a new sector starts the steps over', () => {
    const saved = {
      status: 'active' as const,
      sector: 's1',
      floor: 3,
      trained: true,
      commanded: true,
    };
    expect(progressIn(saved, 's1')).toBe(saved);
    expect(progressIn(saved, 's2')).toEqual({
      status: 'active',
      sector: 's2',
      floor: 0,
      trained: false,
      commanded: false,
    });
  });

  test('shows on a first solo match or after a restart, never once done or skipped', () => {
    expect(tutorialVisible(NEW_TUTORIAL, 'solo')).toBe(true);
    expect(tutorialVisible(NEW_TUTORIAL, 'coop')).toBe(false);
    const active = { ...NEW_TUTORIAL, status: 'active' as const };
    expect(tutorialVisible(active, 'coop')).toBe(true);
    for (const status of ['done', 'skipped'] as const)
      expect(tutorialVisible({ ...NEW_TUTORIAL, status }, 'solo')).toBe(false);
  });
});
