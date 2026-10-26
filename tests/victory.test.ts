import { describe, expect, test } from 'vitest';
import { BattleAudioDirector } from '../lib/audio-policy';
import { gameOverReason, operationSummary } from '../lib/tactical-sector';
import {
  isUnit,
  joinBattle,
  makeEntity,
  newBattle,
  tickBattle,
} from '../lib/tactics';

function battle() {
  const b = newBattle(1000, { seed: 21 });
  joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
  return b;
}
/** Every hostile structure falls; a hostile squad stays in the field. */
function razeHostileBase(b: ReturnType<typeof battle>) {
  const hq = b.entities.find((e) => e.team === 'red' && e.kind === 'hq')!;
  b.entities = b.entities.filter((e) => e.team !== 'red' || isUnit(e.kind));
  for (let i = 0; i < 3; i++)
    b.entities.push(
      makeEntity(b, 'ranger', hq.owner, 'red', { x: hq.x + i * 3, z: hq.z }),
    );
}

describe('Winning an operation', () => {
  test('without flags, razing every hostile building leaves the operation active while hostile units live', () => {
    const b = battle();
    b.flags = [];
    razeHostileBase(b);
    tickBattle(b, 2000);
    expect(b.entities.some((e) => e.team === 'red' && !isUnit(e.kind))).toBe(
      false,
    );
    expect(b.entities.some((e) => e.team === 'red')).toBe(true);
    expect(b.status).toBe('active');
    expect(gameOverReason(b, 'alice')).toBe(null);
  });

  test('without flags, the last hostile entity destroyed wins the operation', () => {
    const b = battle();
    b.flags = [];
    razeHostileBase(b);
    tickBattle(b, 2000);
    for (const e of b.entities) if (e.team === 'red') e.hp = 0;
    tickBattle(b, 3000);
    expect(b.status).toBe('victory');
    expect(
      b.events.some(
        (e) => e.text === 'All enemy forces destroyed. The fjord is ours.',
      ),
    ).toBe(true);
  });

  test('with flags, razing every hostile building is not a win while the flags stand', () => {
    const b = battle();
    razeHostileBase(b);
    tickBattle(b, 2000);
    expect(b.status).toBe('active');
  });

  test('a won operation reports a victory debrief; a lost one keeps its defeat reasons', () => {
    const b = battle();
    for (const f of b.flags!) if (f.team === 'red') f.capturedAt = 2000;
    tickBattle(b, 2000);
    expect(b.status).toBe('victory');
    expect(gameOverReason(b, 'alice')).toBe('victory');
    expect(operationSummary(b, 'alice')).toMatchObject({
      status: 'victory',
      gameOver: 'victory',
    });
    const lost = battle();
    lost.entities = lost.entities.filter((e) => e.owner !== 'alice');
    tickBattle(lost, 2000);
    expect(lost.status).toBe('defeat');
    expect(gameOverReason(lost, 'alice')).toBe('buildings');
  });

  test('a commander knocked out before the allies win keeps the defeat debrief', () => {
    const b = battle();
    joinBattle(b, { id: 'bob', name: 'Bob', culture: 'neutral' }, 1000);
    b.entities = b.entities.filter((e) => e.owner !== 'alice');
    tickBattle(b, 2000);
    for (const f of b.flags!) if (f.team === 'red') f.capturedAt = 3000;
    tickBattle(b, 3000);
    expect(b.status).toBe('victory');
    expect(gameOverReason(b, 'alice')).toBe('buildings');
    expect(gameOverReason(b, 'bob')).toBe('victory');
  });

  test('the commander calls the victory the moment the operation is won', () => {
    const d = new BattleAudioDirector(),
      b = { ...battle(), id: 'sector-a' };
    d.update(b, 'alice');
    const won = structuredClone(b);
    won.tickAt += 1000;
    won.status = 'victory';
    expect(d.update(won, 'alice').cues).toEqual(['victory']);
  });
});
