import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  BattleAudioDirector,
  CUE_RULES,
  RadioQueue,
  commandFailureCue,
  normalizePreferences,
  type AudioBattle,
} from '../lib/audio-policy';
import {
  isUnit,
  joinBattle,
  makeEntity,
  newBattle,
  powerFor,
} from '../lib/tactics';
import commander from '../lib/generated/commander-audio.json';
import soundtrack from '../lib/generated/music-audio.json';
import { cultureKeys } from '../lib/cultures';
import { mapIds } from '../lib/battlefields';
function battle(): AudioBattle {
  const b = { ...newBattle(1000), id: 'sector-a' };
  joinBattle(b, { id: 'alice', name: 'Alice', culture: 'fjordborn' }, 1000);
  return b;
}
function next(b: AudioBattle) {
  const n = structuredClone(b);
  n.tickAt += 1000;
  return n;
}
describe('Commander event direction', () => {
  test('warns when a ready troop needs more power even though the grid is not overloaded', () => {
    const d = new BattleAudioDirector(),
      b = battle();
    b.entities = b.entities.filter(
      (e) => e.owner === 'alice' && e.kind === 'hq',
    );
    for (let i = 0; i < 4; i++)
      b.entities.push(
        makeEntity(b, 'factory', 'alice', 'blue', { x: i * 20, z: 30 }),
      );
    expect(powerFor(b, 'alice')).toEqual({ used: 12, capacity: 12 });
    b.training = [
      {
        id: 'troops',
        owner: 'alice',
        kind: 'lynx',
        remaining: 1,
        total: 1,
        readyAt: 2000,
      },
    ];
    expect(d.update(b, 'alice').cues).toEqual([]);
    const stalled = next(b);
    expect(d.update(stalled, 'alice').cues).toContain('lowPower');
    expect(d.update(next(stalled), 'alice').cues).not.toContain('lowPower');
    const restored = next(next(stalled));
    restored.entities.push(
      makeEntity(restored, 'reactor', 'alice', 'blue', { x: -30, z: 30 }),
    );
    expect(d.update(restored, 'alice').cues).toContain('powerRestored');
    expect(d.update(next(restored), 'alice').cues).not.toContain(
      'powerRestored',
    );
  });
  test('only warns for owned queue heads, not future batches or allied queues', () => {
    const d = new BattleAudioDirector(),
      b = battle();
    b.entities = b.entities.filter(
      (e) => e.owner === 'alice' && e.kind === 'hq',
    );
    for (let i = 0; i < 4; i++)
      b.entities.push(
        makeEntity(b, 'factory', 'alice', 'blue', { x: i * 20, z: 30 }),
      );
    d.update(b, 'alice');
    const n = next(b);
    n.training = [
      {
        id: 'head',
        owner: 'alice',
        kind: 'lynx',
        remaining: 1,
        total: 1,
        readyAt: 10000,
      },
      {
        id: 'next',
        owner: 'alice',
        kind: 'lynx',
        remaining: 1,
        total: 1,
        readyAt: 0,
      },
      {
        id: 'allied',
        owner: 'bob',
        kind: 'lynx',
        remaining: 1,
        total: 1,
        readyAt: 1000,
      },
    ];
    expect(d.update(n, 'alice').cues).not.toContain('lowPower');
  });
  test('still warns when a power plant is lost', () => {
    const d = new BattleAudioDirector(),
      b = battle();
    d.update(b, 'alice');
    const n = next(b);
    n.entities = n.entities.filter((e) => e.kind !== 'hq');
    expect(d.update(n, 'alice').cues).toContain('lowPower');
  });
  test('a reconnection after missed ticks establishes a fresh baseline', () => {
    const d = new BattleAudioDirector(),
      b = battle();
    d.update(b, 'alice');
    const n = next(b);
    n.tickAt += 30000;
    n.wave++;
    n.entities = n.entities.filter((e) => e.kind === 'hq');
    expect(d.update(n, 'alice').cues).toEqual([]);
    expect(d.update(next(n), 'alice').cues).toEqual([]);
  });
  test('initial connections, spectators, and new sectors never replay old alerts', () => {
    const d = new BattleAudioDirector(),
      b = battle();
    expect(d.update(b, 'alice').cues).toEqual([]);
    b.wave = 3;
    expect(d.update(b, 'spectator').cues).toEqual([]);
    expect(d.update(b, 'alice').cues).toEqual([]);
    expect(
      d.update({ ...b, id: 'new-sector', status: 'victory' }, 'alice').cues,
    ).toEqual([]);
  });
  test('any structure hit is the base under attack; troops and harvesters are not', () => {
    const d = new BattleAudioDirector(),
      b = battle();
    b.entities.push(
      makeEntity(b, 'refinery', 'alice', 'blue', { x: 40, z: 40 }),
      makeEntity(b, 'harvester', 'alice', 'blue', { x: 60, z: 40 }),
    );
    d.update(b, 'alice');
    const hit = (s: typeof b, kind: string) => {
      const n = next(s);
      n.entities.find((e) => e.owner === 'alice' && e.kind === kind)!.hp -= 20;
      return n;
    };
    const refinery = hit(b, 'refinery');
    expect(d.update(refinery, 'alice').cues).toEqual(['baseUnderAttack']);
    expect(d.update(hit(refinery, 'harvester'), 'alice').cues).toEqual([
      'underAttack',
    ]);
  });
  test('damage warns once per transition and holds combat music for 20 seconds', () => {
    const d = new BattleAudioDirector(),
      b = battle();
    d.update(b, 'alice');
    const n = next(b);
    n.entities.find((e) => e.owner === 'alice' && e.kind === 'hq')!.hp -= 50;
    expect(d.update(n, 'alice')).toEqual({
      cues: ['baseUnderAttack'],
      mood: 'combat',
    });
    expect(d.update(structuredClone(n), 'alice')).toEqual({
      cues: [],
      mood: 'combat',
    });
    const quiet = next(n);
    quiet.tickAt += 21000;
    expect(d.update(quiet, 'alice')).toEqual({ cues: [], mood: 'exploration' });
  });
  test('fog disappearance is never announced as a lost unit', () => {
    const d = new BattleAudioDirector(),
      b = battle();
    d.update(b, 'alice');
    const n = next(b);
    n.entities = n.entities.filter((e) => e.team !== 'red');
    expect(d.update(n, 'alice').cues).toEqual([]);
    const lost = next(n),
      unit = lost.entities.find((e) => e.owner === 'alice' && isUnit(e.kind))!;
    lost.entities = lost.entities.filter((e) => e.id !== unit.id);
    expect(d.update(lost, 'alice').cues).toContain('unitLost');
  });
  test('reports owned production finishing, not new queued or allied assets', () => {
    const d = new BattleAudioDirector(),
      b = battle();
    const tank = makeEntity(b, 'tank', 'alice', 'blue', { x: 0, z: 30 });
    tank.readyAt = 4000;
    b.entities.push(tank);
    d.update(b, 'alice');
    const n = next(b);
    n.entities.find((e) => e.id === tank.id)!.readyAt = 0;
    expect(d.update(n, 'alice').cues).toContain('armorReady');
    expect(d.update(next(n), 'alice').cues).not.toContain('armorReady');
  });
  test('mission result takes priority over simultaneous losses or other events', () => {
    const d = new BattleAudioDirector(),
      b = battle();
    d.update(b, 'alice');
    const n = next(b);
    n.status = 'defeat';
    n.entities = [];
    n.wave++;
    expect(d.update(n, 'alice')).toEqual({
      cues: ['defeat'],
      mood: 'exploration',
    });
    expect(d.update(next(n), 'alice').cues).toEqual([]);
  });
  test('stale snapshots do not replace the baseline or duplicate warnings', () => {
    const d = new BattleAudioDirector(),
      b = battle();
    d.update(b, 'alice');
    const n = next(b);
    n.wave++;
    expect(d.update(n, 'alice').cues).toContain('wave');
    expect(d.update(b, 'alice').cues).toEqual([]);
    expect(d.update(next(n), 'alice').cues).toEqual([]);
  });
});
describe('Radio priority and repetition control', () => {
  test('power shortages in build controls and server errors use the power warning', () => {
    expect(commandFailureCue('More power required')).toBe('lowPower');
    expect(commandFailureCue('Build a Geothermal plant for more power.')).toBe(
      'lowPower',
    );
    expect(commandFailureCue('Insufficient sector credits.')).toBe(
      'insufficient',
    );
    expect(commandFailureCue('Construction queue full')).toBe('queueFull');
    expect(commandFailureCue('Requires Tier 2 clearance')).toBeNull();
    const q = new RadioQueue();
    expect(q.enqueue('lowPower', 1000)).toBe(true);
    expect(q.enqueue('lowPower', 2000)).toBe(false);
  });
  test('new orders replace pending orders, while emergencies play first', () => {
    const q = new RadioQueue();
    q.enqueue('select', 1000);
    q.enqueue('move', 1100);
    q.enqueue('baseUnderAttack', 1200);
    expect(q.next(1200)).toBe('baseUnderAttack');
    expect(q.next(1200)).toBe('move');
    expect(q.next(1200)).toBeNull();
  });
  test('suppresses repeated warnings and discards expired acknowledgements', () => {
    const q = new RadioQueue();
    expect(q.enqueue('underAttack', 1000)).toBe(true);
    expect(q.enqueue('underAttack', 2000)).toBe(false);
    q.enqueue('move', 1000);
    expect(q.next(7000)).toBe('underAttack');
    expect(q.next(7000)).toBeNull();
    expect(q.enqueue('underAttack', 24000)).toBe(true);
  });
  test('terminal calls clear pending battle chatter, and queue never exceeds four', () => {
    const q = new RadioQueue();
    q.configure('full', 0);
    ['enemySpotted', 'unitReady', 'queued', 'objective', 'lowPower'].forEach(
      (c) => q.enqueue(c as keyof typeof CUE_RULES, 1000),
    );
    expect([
      q.next(1000),
      q.next(1000),
      q.next(1000),
      q.next(1000),
    ]).not.toContain(null);
    expect(q.next(1000)).toBeNull();
    q.enqueue('move', 2000);
    q.enqueue('victory', 2000);
    expect(q.next(2000)).toBe('victory');
    expect(q.next(2000)).toBeNull();
  });
  test('invalid persisted volume values cannot break playback or exceed 100%', () => {
    expect(
      normalizePreferences({ music: Infinity, voice: -10, muted: 'yes' }),
    ).toEqual({
      music: 0.35,
      voice: 0,
      effects: 0.65,
      muted: false,
      chatter: 'adaptive',
    });
    expect(
      normalizePreferences({ music: 500, voice: NaN, muted: true }),
    ).toEqual({
      music: 1,
      voice: 0.85,
      effects: 0.65,
      muted: true,
      chatter: 'adaptive',
    });
    expect(normalizePreferences(null).music).toBe(0.35);
    expect(normalizePreferences({ chatter: 'alerts' }).chatter).toBe('alerts');
    expect(normalizePreferences({ chatter: 'unknown' }).chatter).toBe(
      'adaptive',
    );
  });

  test('adaptive chatter shares a budget across orders and reinforcements and fades out', () => {
    const q = new RadioQueue();
    q.enqueue('move', 1000);
    expect(q.next(1000)).toBe('move');
    q.enqueue('unitReady', 3000);
    q.enqueue('attack', 4000);
    expect(q.next(4000)).toBeNull();
    q.enqueue('armorReady', 16000);
    expect(q.next(16000)).toBe('armorReady');
    q.configure('adaptive', 2 * 60000);
    q.enqueue('queued', 36000);
    expect(q.next(36000)).toBeNull();
    q.enqueue('unitReady', 46000);
    expect(q.next(46000)).toBe('unitReady');
    q.enqueue('constructionReady', 76000);
    q.configure('adaptive', 5 * 60000);
    expect(q.next(76000)).toBeNull();
    expect(q.enqueue('move', 80000)).toBe(false);
    expect(q.enqueue('unitReady', 80000)).toBe(false);
    q.enqueue('baseUnderAttack', 80000);
    expect(q.next(80000)).toBe('baseUnderAttack');
    q.enqueue('victory', 80000);
    expect(q.next(80000)).toBe('victory');
  });

  test('repeated fragments stop after three reports, and only a new operation resets the budget', () => {
    const q = new RadioQueue();
    for (const now of [0, 15000, 30000]) {
      q.enqueue('move', now);
      expect(q.next(now)).toBe('move');
    }
    q.clear();
    q.enqueue('move', 45000);
    expect(q.next(45000)).toBeNull();
    q.reset();
    q.enqueue('move', 45000);
    expect(q.next(45000)).toBe('move');
  });

  test('alerts-only and full radio preferences apply immediately without suppressing warnings', () => {
    const q = new RadioQueue();
    q.enqueue('unitReady', 0);
    q.configure('alerts', 0);
    expect(q.next(0)).toBeNull();
    expect(q.enqueue('select', 0)).toBe(false);
    for (const cue of [
      'underAttack',
      'lowPower',
      'wave',
      'defeat',
      'radioCheck',
    ] as const) {
      expect(q.enqueue(cue, 10000)).toBe(true);
      expect(q.next(10000)).toBe(cue);
    }
    q.configure('full', 20 * 60000);
    q.enqueue('unitReady', 20000);
    expect(q.next(20000)).toBe('unitReady');
    q.enqueue('move', 22000);
    expect(q.next(22000)).toBe('move');
  });
});
describe('Published audio assets', () => {
  test('every commander has real, hash-verified audio with subtitles and sensible duration', () => {
    expect(Object.keys(commander.voices).sort()).toEqual(
      ['ravn', ...cultureKeys].sort(),
    );
    const scores = [
      soundtrack.tracks,
      ...mapIds.map((id) => soundtrack.maps[id]),
    ].flatMap((pair) => Object.values(pair));
    for (const voice of Object.values(commander.voices)) {
      expect(Object.keys(voice.clips).sort()).toEqual(
        Object.keys(CUE_RULES).sort(),
      );
      const clips = Object.values(voice.clips).flat();
      for (const clip of clips) {
        expect(clip.text.length).toBeGreaterThan(5);
        expect(clip.text).not.toMatch(/[[\]]/);
        expect(clip.duration).toBeGreaterThan(0.4);
        expect(clip.duration).toBeLessThan(6);
      }
      expect(clips.reduce((sum, c) => sum + c.bytes, 0)).toBeLessThan(
        1_000_000,
      );
    }
    const clips = Object.values(commander.voices).flatMap((voice) =>
      Object.values(voice.clips).flat(),
    );
    for (const clip of [...clips, ...scores]) {
      const bytes = readFileSync(
        new URL('../public' + clip.file, import.meta.url),
      );
      expect(bytes.length).toBe(clip.bytes);
      expect(clip.file).toContain(
        createHash('sha256').update(bytes).digest('hex').slice(0, 10),
      );
    }
    for (const track of scores) expect(track.duration).toBeGreaterThan(80);
  });
});
