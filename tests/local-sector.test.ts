import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import { clean } from '../convex/tactics';
import {
  LocalSector,
  type SectorAction,
  type SectorActions,
  type SectorClock,
  type SectorSave,
} from '../lib/local-sector';
import {
  ORDERS_BUSY,
  persistedBattle,
  sectorView,
  shiftTimers,
} from '../lib/tactical-sector';
import {
  TACTICAL_TICK_MS,
  baseAt,
  joinBattle,
  makeEntity,
  newBattle,
  placementError,
  type Battle,
} from '../lib/tactics';

const modules = import.meta.glob('../convex/**/*.ts');
const token = 'c'.repeat(64);
/** Fake timers drive the Convex scheduler and the local engine alike. */
const clock: SectorClock = {
  now: () => Date.now(),
  schedule: (run, ms) => setTimeout(run, ms),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
/**
 * A hand-cranked clock for the parity test. convex-test's scheduler rounds
 * through float seconds (a 250 ms tick can land at 249.99 ms), so the harness
 * runs each Convex tick explicitly at the moment the local engine ticks and
 * separately checks the Convex scheduler asked for that same moment.
 */
function crankedClock(start: number) {
  let now = start,
    serial = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    clock: {
      now: () => now,
      schedule: (run, ms) => {
        timers.set(++serial, { at: now + ms, run });
        return serial;
      },
      cancel: (handle) => timers.delete(handle as number),
    } satisfies SectorClock,
    next() {
      let first: [number, { at: number; run: () => void }] | undefined;
      for (const entry of timers)
        if (!first || entry[1].at < first[1].at) first = entry;
      return first;
    },
    fire([handle, timer]: [number, { at: number; run: () => void }]) {
      timers.delete(handle);
      now = timer.at;
      timer.run();
    },
    set(at: number) {
      now = at;
    },
  };
}
const viewer = { id: 'p1', name: 'Commander', culture: 'fjordborn' };
const solo = {
  difficulty: 'normal',
  mapId: 'fjordmouth',
  enemyCount: 2,
  seed: 947,
} as const;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const MUTATIONS = {
  produce: api.tactics.produce,
  cancelTroops: api.tactics.cancelTroops,
  research: api.tactics.research,
  abandonResearch: api.tactics.abandonResearch,
  sell: api.tactics.sell,
  rally: api.tactics.rally,
  rallyCategory: api.tactics.rallyCategory,
  command: api.tactics.command,
  launch: api.tactics.launch,
} as const;

/** A free foundation near the commander's headquarters. */
function foundation(b: Battle, owner: string, kind: 'reactor' | 'barracks') {
  const hq = b.entities.find((e) => e.owner === owner && e.kind === 'hq')!;
  for (let r = 14; r < 60; r += 4)
    for (let a = 0; a < 16; a++) {
      const position = {
        x: Math.round(hq.x + Math.cos((a / 8) * Math.PI) * r),
        z: Math.round(hq.z + Math.sin((a / 8) * Math.PI) * r),
      };
      if (!placementError(b, owner, kind, { position, rotation: 0 }))
        return { position, rotation: 0 };
    }
  throw new Error('No foundation found');
}

describe('local solo engine parity with the Convex tick and command flow', () => {
  test('the same seed and orders produce identical battles and views', async () => {
    const t = convexTest(schema, modules);
    const owner = await t.mutation(api.players.connect, {
      token,
      name: 'Commander',
    });
    const sectorId = await t.mutation(api.operations.solo, {
      token,
      difficulty: solo.difficulty,
      mapId: solo.mapId,
      enemyCount: solo.enemyCount,
    });
    const server = async () => (await t.run((ctx) => ctx.db.get(sectorId)))!;
    const initial = await server();
    const player = (await t.run((ctx) => ctx.db.get(owner)))!;
    const cranked = crankedClock(Date.now());
    const local = LocalSector.launch(
      'local',
      { id: owner, name: player.name, culture: player.culture },
      {
        difficulty: solo.difficulty,
        mapId: solo.mapId,
        enemyCount: solo.enemyCount,
        seed: initial.seed!,
      },
      cranked.clock,
    );
    local.play();
    expect(persistedBattle(local.battle)).toEqual(clean(initial));

    const own = initial.entities.filter(
      (e) => e.owner === owner && e.kind !== 'hq',
    );
    const hq = initial.entities.find(
      (e) => e.owner === owner && e.kind === 'hq',
    )!;
    const reactor = foundation(initial, owner, 'reactor');
    const hostileHq = initial.entities
      .filter((e) => e.team === 'red' && e.kind === 'hq')
      .sort(
        (a, b) =>
          Math.hypot(a.x - hq.x, a.z - hq.z) -
          Math.hypot(b.x - hq.x, b.z - hq.z),
      )[0];
    const ownReactor = () =>
      local.battle.entities.find(
        (e) => e.owner === owner && e.kind === 'reactor',
      )?.id ?? 'missing';
    // A hostile patrol close to the landing guarantees combat in both runs.
    const raid = (b: Battle) => {
      for (const dx of [-4, 0, 4])
        b.entities.push(
          makeEntity(b, 'ranger', hostileHq.owner, 'red', {
            x: hq.x + dx,
            z: hq.z - 55,
          }),
        );
      return { entities: b.entities, serial: b.serial };
    };
    await t.run(async (ctx) =>
      ctx.db.patch(sectorId, raid((await ctx.db.get(sectorId))!)),
    );
    raid(local.battle);
    const outcomes: string[] = [];
    const script: [
      number,
      SectorAction,
      Record<string, unknown> | (() => Record<string, unknown>),
    ][] = [
      [
        1200,
        'command',
        {
          ids: own.map((e) => e.id),
          order: 'move',
          point: { x: hq.x + 8, z: hq.z - 40 },
        },
      ],
      // A redirect for the same squad replaces its queued intent.
      [
        1210,
        'command',
        {
          ids: own.map((e) => e.id),
          order: 'move',
          point: { x: hq.x - 10, z: hq.z - 45 },
        },
      ],
      [1500, 'produce', { kind: 'reactor', placement: reactor }],
      [1750, 'research', { key: 'clearance2' }],
      [2000, 'produce', { kind: 'ranger', quantity: 2 }],
      [2250, 'sell', { id: 'missing' }],
      // No superweapon stands yet: both refuse the launch alike.
      [2260, 'launch', { point: { x: hq.x, z: hq.z - 60 } }],
      [
        2500,
        'command',
        {
          ids: [own[0].id],
          order: 'attackMove',
          point: { x: hq.x + 20, z: hq.z - 70 },
        },
      ],
      [2510, 'command', { ids: [own[1].id], order: 'hold' }],
      [4000, 'abandonResearch', { key: 'clearance2' }],
      [
        6000,
        'rallyCategory',
        { category: 'infantry', point: { x: hq.x, z: hq.z - 30 } },
      ],
      [9000, 'command', { ids: own.map((e) => e.id), order: 'stop' }],
      // March on the nearest stronghold so the run includes combat.
      [
        9500,
        'command',
        {
          ids: own.map((e) => e.id),
          order: 'attackMove',
          point: { x: hostileHq.x, z: hostileHq.z },
        },
      ],
      [30000, 'sell', () => ({ id: ownReactor() })],
    ];
    const outcome = async <T>(run: () => Promise<T> | T) => {
      try {
        return { ok: (await run()) ?? null };
      } catch (error) {
        return {
          error:
            error instanceof ConvexError
              ? String(error.data as string)
              : (error as Error).message,
        };
      }
    };
    /** When the Convex scheduler will next run a live tick (stale callbacks no-op). */
    const scheduledTick = async () => {
      const { tickAt } = await server();
      const jobs = await t.run((ctx) =>
        ctx.db.system.query('_scheduled_functions').collect(),
      );
      const live = jobs
        .filter(
          (j) =>
            j.name.includes('tick') &&
            (j.args[0] as { expected: number }).expected === tickAt,
        )
        .map((j) => Math.round(j.scheduledTime));
      return live.length ? Math.min(...live) : undefined;
    };
    let ticks = 0;
    const until = async (ms: number) => {
      for (let next = cranked.next(); next && next[1].at <= ms;) {
        const at = next[1].at;
        expect(await scheduledTick()).toBe(at);
        vi.setSystemTime(at);
        const expected = (await server()).tickAt;
        cranked.fire(next);
        await t.mutation(internal.tactics.tick, { id: sectorId, expected });
        ticks++;
        expect(persistedBattle(local.battle)).toEqual(clean(await server()));
        next = cranked.next();
      }
      cranked.set(ms);
      vi.setSystemTime(ms);
    };
    for (const [at, action, given] of script) {
      await until(at);
      const args = typeof given === 'function' ? given() : given;
      const remote = await outcome(() =>
        t.mutation(MUTATIONS[action] as typeof api.tactics.command, {
          token,
          sectorId,
          ...(args as SectorActions['command']),
        }),
      );
      const mine = await outcome(() =>
        local.act(action, args as SectorActions[typeof action]),
      );
      expect(mine, `${action} at ${at}`).toEqual(remote);
      outcomes.push('error' in mine ? 'error' : 'ok');
      expect(persistedBattle(local.battle)).toEqual(clean(await server()));
    }
    await until(60000);
    const settled = await server();
    expect(ticks).toBeGreaterThan(230);
    expect(settled.tickAt).toBe(local.battle.tickAt);
    expect(settled.tickAt).toBeGreaterThan(59000);
    // Most actions succeed; the rest fail identically.
    expect(outcomes.filter((o) => o === 'ok').length).toBeGreaterThan(8);
    expect(
      settled.events.some((e) => e.kind === 'combat') ||
        settled.entities.some((e) => e.firedAt > 0),
    ).toBe(true);
    expect(persistedBattle(local.battle)).toEqual(clean(settled));
    const { id: _remoteId, ...remoteView } = (await t.query(api.tactics.state, {
      token,
    }))!;
    const { id: _localId, ...localView } = local.view()!;
    expect(localView).toEqual(remoteView);
    expect(local.summary()).toEqual({
      ...(await t.query(api.operations.overview, { token })).battle,
      id: 'local',
    });
  }, 120_000);
});

describe('local command queue', () => {
  function sector() {
    const b = newBattle(1000, solo);
    joinBattle(b, viewer, 1000);
    const units = b.entities.filter(
      (e) => e.owner === viewer.id && e.kind !== 'hq',
    );
    const ticks = new LocalSector('s', viewer, b, clock);
    return { ticks, units, b };
  }
  test('redirects for the same squad coalesce and keep their place', () => {
    const { ticks, units } = sector();
    ticks.play();
    for (let i = 0; i < 6; i++)
      ticks.act('command', {
        ids: [units[0].id, units[1].id],
        order: 'move',
        point: { x: units[0].x + i, z: units[0].z - 20 },
      });
    ticks.act('command', { ids: [units[2].id], order: 'hold' });
    expect(ticks.orders).toHaveLength(2);
    expect(ticks.orders[0].point?.x).toBe(units[0].x + 5);
    expect(ticks.view()!.pendingCommandUnits).toBe(3);
  });
  test('a fifth squad waits while four orders are routing', () => {
    const { ticks, units, b } = sector();
    const extra = [0, 1].map((i) =>
      makeEntity(b, 'ranger', viewer.id, 'blue', {
        x: units[0].x + 2 + i,
        z: units[0].z,
      }),
    );
    b.entities.push(...extra);
    const squads = [...units, ...extra].map((e) => [e.id]);
    for (const ids of squads.slice(0, 4))
      ticks.act('command', { ids, order: 'hold' });
    expect(() =>
      ticks.act('command', { ids: squads[4], order: 'hold' }),
    ).toThrow(ORDERS_BUSY);
    // A redirect for a queued squad still fits.
    ticks.act('command', { ids: squads[0], order: 'stop' });
    expect(ticks.orders.map((o) => o.order)).toEqual([
      'stop',
      'hold',
      'hold',
      'hold',
    ]);
  });
  test('queued orders route on fast ticks, oldest first, then the chain slows down', () => {
    const { ticks, units } = sector();
    ticks.play();
    ticks.act('command', { ids: [units[0].id], order: 'hold' });
    ticks.act('command', { ids: [units[1].id], order: 'hold' });
    vi.advanceTimersByTime(10);
    expect(ticks.battle.tickAt).toBe(1010);
    expect(ticks.orders.map((o) => o.ids)).toEqual([[units[1].id]]);
    vi.advanceTimersByTime(10);
    expect(ticks.battle.tickAt).toBe(1020);
    expect(ticks.orders).toHaveLength(0);
    vi.advanceTimersByTime(TACTICAL_TICK_MS - 1);
    expect(ticks.battle.tickAt).toBe(1020);
    vi.advanceTimersByTime(1);
    expect(ticks.battle.tickAt).toBe(1020 + TACTICAL_TICK_MS);
  });
  test('a failed action leaves the battle untouched and surfaces its message', () => {
    const { ticks, b } = sector();
    const before = structuredClone(persistedBattle(b));
    expect(() =>
      ticks.act('produce', {
        kind: 'reactor',
        placement: { position: { x: 1e6, z: 1e6 }, rotation: 0 },
      }),
    ).toThrow();
    expect(persistedBattle(ticks.battle)).toEqual(before);
    expect(() => ticks.act('sell', { id: 'nope' })).toThrow();
  });
});

describe('state projection', () => {
  test('hides fogged hostiles and strips hostile routes and targets', () => {
    const b = newBattle(1000, solo);
    joinBattle(b, viewer, 1000);
    const base = baseAt(b.commanders[0].slot);
    const near = makeEntity(b, 'ranger', 'garrison', 'red', {
      x: base.x + 6,
      z: base.z - 30,
    });
    near.path = [{ x: 1, z: 2 }];
    near.target = 'someone';
    b.entities.push(near);
    const view = new LocalSector('s', viewer, b, clock).view()!;
    expect(view).toEqual({
      ...sectorView(b, viewer.id, Date.now(), []),
      id: 's',
      mode: 'solo',
      openEnrollment: false,
      maxPlayers: 1,
    });
    expect('hostileTraining' in view).toBe(false);
    const seen = view.entities.find((e) => e.id === near.id)!;
    expect(seen.path).toEqual([]);
    expect(seen.target).toBeUndefined();
    // Distant hostile strongholds stay hidden.
    const hidden = b.entities.filter(
      (e) => e.team === 'red' && !view.entities.some((v) => v.id === e.id),
    );
    expect(hidden.length).toBeGreaterThan(0);
    // The engine's own battle keeps them intact.
    expect(b.entities.find((e) => e.id === near.id)!.target).toBe('someone');
  });
});

describe('save and resume', () => {
  test('shiftTimers matches resumeStalledSector exactly', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.players.connect, { token, name: 'Commander' });
    const sectorId = await t.mutation(api.operations.solo, {
      token,
      difficulty: 'normal',
    });
    await t
      .mutation(api.tactics.produce, {
        token,
        sectorId,
        kind: 'ranger',
        quantity: 1,
      })
      .catch(() => {});
    await t
      .mutation(api.tactics.research, {
        token,
        sectorId,
        key: 'clearance2',
      })
      .catch(() => {});
    const stalled = (await t.run((ctx) => ctx.db.get(sectorId)))!;
    vi.setSystemTime(stalled.tickAt + 60_000);
    await t.mutation(internal.tactics.resumeStalledSector, {
      id: sectorId,
      expected: stalled.tickAt,
    });
    const resumed = (await t.run((ctx) => ctx.db.get(sectorId)))!;
    const local = clean(stalled);
    expect(shiftTimers(local, Date.now())).toBe(60_000);
    expect(local).toEqual(clean(resumed));
  });
  test('a restored sector continues from its save with the closed time removed', () => {
    const live = LocalSector.launch('s', viewer, solo, clock);
    live.play();
    live.act('research', { key: 'clearance2' });
    vi.advanceTimersByTime(2000);
    const save: SectorSave = structuredClone(live.save());
    live.pause();
    const researching = save.battle.commanders[0].researching!;
    const remaining = researching.readyAt - save.battle.tickAt;
    vi.advanceTimersByTime(5 * 60_000);
    const restored = LocalSector.restore(save, clock);
    expect(restored.battle.tickAt).toBe(Date.now());
    expect(
      restored.battle.commanders[0].researching!.readyAt -
        restored.battle.tickAt,
    ).toBe(remaining);
    expect(restored.battle.startedAt - save.battle.startedAt).toBe(
      Date.now() - save.battle.tickAt,
    );
    restored.play();
    vi.advanceTimersByTime(TACTICAL_TICK_MS);
    expect(restored.battle.tickAt).toBe(Date.now());
  });
  test('pausing stops the clock and resuming shifts timers by the pause', () => {
    const live = LocalSector.launch('s', viewer, solo, clock);
    live.play();
    vi.advanceTimersByTime(1000);
    const wave = live.battle.nextWaveAt;
    live.pause();
    vi.advanceTimersByTime(30_000);
    expect(live.battle.tickAt).toBe(2000);
    live.play();
    expect(live.battle.nextWaveAt).toBe(wave + 30_000);
  });
});

describe('withdraw and game over', () => {
  test('withdrawing ends a solo operation in defeat and removes the commander', () => {
    const live = LocalSector.launch('s', viewer, solo, clock);
    live.play();
    live.withdraw();
    expect(live.battle.status).toBe('defeat');
    expect(live.battle.entities.some((e) => e.owner === viewer.id)).toBe(false);
    expect(live.view()).toBeNull();
    expect(live.summary()).toBeNull();
    expect(live.ended).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(live.battle.tickAt).toBe(1000);
    expect(() => live.withdraw()).toThrow(
      'This is not your current operation.',
    );
  });
  test('losing every building reports game over and stops the tick chain', () => {
    const live = LocalSector.launch('s', viewer, solo, clock);
    live.play();
    expect(live.summary()!.gameOver).toBeNull();
    live.battle.entities = live.battle.entities.filter(
      (e) => e.owner !== viewer.id,
    );
    vi.advanceTimersByTime(TACTICAL_TICK_MS);
    expect(live.ended).toBe(true);
    expect(live.summary()).toMatchObject({
      status: 'defeat',
      gameOver: 'buildings',
      mode: 'solo',
    });
    expect(() => live.act('command', { ids: [], order: 'stop' })).toThrow(
      'Your operation is over',
    );
    const at = live.battle.tickAt;
    vi.advanceTimersByTime(5000);
    expect(live.battle.tickAt).toBe(at);
  });
});
