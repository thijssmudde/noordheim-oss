import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import {
  RESEARCH,
  cancelResearch,
  joinBattle,
  makeEntity,
  newBattle,
  research,
  researchAvailability,
  researchBlockReason,
  tickBattle,
  type ResearchKey,
} from '../lib/tactics';

const modules = import.meta.glob('../convex/**/*.ts');
/** Project durations in milliseconds, so the timings below follow the balance tables. */
const D = RESEARCH.drills.seconds * 1000,
  T = RESEARCH.turbines.seconds * 1000,
  A = RESEARCH.ammunition.seconds * 1000;
function setup() {
  const b = newBattle(1000);
  joinBattle(b, { id: 'alice', name: 'Alice', culture: 'fjordborn' }, 1000);
  const commander = b.commanders[0];
  commander.credits = 10000;
  commander.research = ['clearance2'];
  const lab = makeEntity(b, 'lab', 'alice', 'blue', { x: -100, z: 60 });
  b.entities.push(lab);
  return { b, commander, lab };
}

describe('Research queue', () => {
  test('unlocked projects are prepaid and complete one at a time in order', () => {
    const { b, commander } = setup();
    research(b, 'alice', 'drills', 1000);
    expect(researchAvailability(b, 'alice', 'turbines')).toBeNull();
    research(b, 'alice', 'turbines', 2000);
    research(b, 'alice', 'ammunition', 3000);
    expect(commander.credits).toBe(
      10000 -
        RESEARCH.drills.cost -
        RESEARCH.turbines.cost -
        RESEARCH.ammunition.cost,
    );
    expect(commander.researching).toEqual({ key: 'drills', readyAt: 1000 + D });
    expect(commander.researchQueue).toEqual(['turbines', 'ammunition']);
    tickBattle(b, 1000 + D);
    expect(commander.research).toEqual(['clearance2', 'drills']);
    expect(commander.researching).toEqual({
      key: 'turbines',
      readyAt: 1000 + D + T,
    });
    expect(commander.researchQueue).toEqual(['ammunition']);
    expect(commander.credits).toBeGreaterThanOrEqual(
      10000 -
        RESEARCH.drills.cost -
        RESEARCH.turbines.cost -
        RESEARCH.ammunition.cost,
    );
    tickBattle(b, 1000 + D + T);
    expect(commander.researching).toEqual({
      key: 'ammunition',
      readyAt: 1000 + D + T + A,
    });
    tickBattle(b, 1000 + D + T + A);
    expect(commander.research).toEqual([
      'clearance2',
      'drills',
      'turbines',
      'ammunition',
    ]);
    expect(commander.researching).toBeUndefined();
    expect(commander.researchQueue).toEqual([]);
  });

  test('duplicate, completed and unaffordable projects cannot change the queue or credits', () => {
    const { b, commander } = setup();
    research(b, 'alice', 'drills', 1000);
    research(b, 'alice', 'turbines', 1000);
    for (const [key, reason] of [
      ['drills', 'in progress'],
      ['turbines', 'Already queued'],
      ['clearance2', 'Researched'],
    ] as const) {
      const before = structuredClone(b);
      expect(() => research(b, 'alice', key, 2000)).toThrow(reason);
      expect(b).toEqual(before);
    }
    commander.credits = RESEARCH.shells.cost - 1;
    const before = structuredClone(b);
    expect(() => research(b, 'alice', 'shells', 2000)).toThrow('credits');
    expect(b).toEqual(before);
  });

  test('cancelling waiting research preserves the timer; cancelling active research starts the next project', () => {
    const { b, commander } = setup();
    for (const key of ['drills', 'turbines', 'ammunition'] as const)
      research(b, 'alice', key, 1000);
    expect(cancelResearch(b, 'alice', 'turbines', 5000)).toBe(
      RESEARCH.turbines.cost,
    );
    expect(commander.researching?.readyAt).toBe(1000 + D);
    expect(commander.researchQueue).toEqual(['ammunition']);
    expect(cancelResearch(b, 'alice', 'drills', 5000)).toBe(
      RESEARCH.drills.cost,
    );
    expect(commander.researching).toEqual({
      key: 'ammunition',
      readyAt: 5000 + A,
    });
    const before = structuredClone(b);
    expect(() => cancelResearch(b, 'alice', 'drills', 5000)).toThrow(
      'no longer',
    );
    expect(b).toEqual(before);
    expect(cancelResearch(b, 'alice', 'ammunition', 5000)).toBe(
      RESEARCH.ammunition.cost,
    );
    expect(commander.credits).toBe(10000);
    expect(commander.researchQueue).toEqual([]);
  });

  test('waiting projects pause after the lab is lost and resume after replacement without charging again', () => {
    const { b, commander, lab } = setup();
    research(b, 'alice', 'drills', 1000);
    research(b, 'alice', 'turbines', 1000);
    research(b, 'alice', 'shells', 1000);
    lab.hp = 0;
    const lost = 1000 + D;
    tickBattle(b, lost);
    expect(commander.researching).toBeUndefined();
    expect(commander.researchQueue).toEqual(['turbines', 'shells']);
    expect(researchBlockReason(b, 'alice', 'turbines')).toContain(
      'Research station',
    );
    expect(cancelResearch(b, 'alice', 'shells', lost + 1000)).toBe(
      RESEARCH.shells.cost,
    );
    const rebuilt = lost + 10000;
    const replacement = makeEntity(
      b,
      'lab',
      'alice',
      'blue',
      { x: -100, z: 60 },
      rebuilt,
    );
    b.entities.push(replacement);
    tickBattle(b, rebuilt - 1000);
    expect(commander.researching).toBeUndefined();
    const credits = commander.credits;
    tickBattle(b, rebuilt);
    expect(commander.researching).toEqual({
      key: 'turbines',
      readyAt: rebuilt + T,
    });
    expect(commander.credits).toBeGreaterThanOrEqual(credits);
  });

  test('research requirements still apply and another commander cannot cancel a paid project', () => {
    const { b, commander, lab } = setup();
    commander.research = [];
    expect(() => research(b, 'alice', 'turbines', 1000)).toThrow('Tier 2');
    commander.research = ['clearance2'];
    lab.readyAt = 10000;
    expect(() => research(b, 'alice', 'turbines', 1000)).toThrow(
      'Research station',
    );
    lab.readyAt = 0;
    research(b, 'alice', 'turbines', 1000);
    const before = structuredClone(b);
    expect(() => cancelResearch(b, 'bob', 'turbines', 2000)).toThrow(
      'your queue',
    );
    expect(b).toEqual(before);
    b.status = 'victory';
    expect(() => research(b, 'alice', 'drills', 2000)).toThrow('ended');
    expect(() => cancelResearch(b, 'alice', 'turbines', 2000)).toThrow('ended');
  });

  test('chained projects wait for their prerequisite and Tier 3 branches for Tier 3 clearance', () => {
    const { b, commander } = setup();
    expect(researchAvailability(b, 'alice', 'uranium')).toContain('Tier 3');
    commander.research = ['clearance2', 'clearance3'];
    expect(researchAvailability(b, 'alice', 'uranium')).toContain(
      RESEARCH.shells.name,
    );
    expect(researchAvailability(b, 'alice', 'avionics')).toBeNull();
    // A queue saved before a project was retired drops the unknown key instead of stalling.
    commander.researchQueue = ['no-such-project', 'ballistics'];
    tickBattle(b, 2000);
    expect(commander.researching?.key).toBe('ballistics');
    expect(commander.researchQueue).toEqual([]);
    delete commander.researching;
    commander.research.push('shells');
    expect(researchAvailability(b, 'alice', 'uranium')).toBeNull();
    // A queued prerequisite counts only once it has completed; the dependant waits behind it.
    commander.research = ['clearance2', 'clearance3'];
    research(b, 'alice', 'shells', 1000);
    expect(() => research(b, 'alice', 'uranium', 1000)).toThrow(
      RESEARCH.shells.name,
    );
  });

  test('existing research timers accept a queue without restarting or charging for the current project', () => {
    const { b, commander } = setup();
    commander.researching = { key: 'drills', readyAt: 16000 };
    expect(commander.researchQueue).toBeUndefined();
    research(b, 'alice', 'turbines', 5000);
    expect(commander.researching.readyAt).toBe(16000);
    expect(commander.credits).toBe(10000 - RESEARCH.turbines.cost);
    tickBattle(b, 16000);
    expect(commander.researching).toEqual({
      key: 'turbines',
      readyAt: 16000 + T,
    });
  });
});

describe('Convex research queues', () => {
  const alice = 'a'.repeat(64),
    bob = 'b'.repeat(64);
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());
  async function setupSector() {
    const t = convexTest(schema, modules);
    await t.mutation(api.players.connect, { token: alice, name: 'Alice' });
    await t.mutation(api.players.connect, { token: bob, name: 'Bob' });
    const sectorId = await t.mutation(api.tactics.deploy, { token: alice });
    await t.mutation(api.tactics.deploy, { token: bob });
    await t.run(async (ctx) => {
      const b = (await ctx.db.get(sectorId))!;
      b.commanders[0].research = ['clearance2'];
      b.commanders[0].credits = 10000;
      b.entities.push(
        makeEntity(b, 'lab', b.commanders[0].id, 'blue', { x: -100, z: 60 }),
      );
      await ctx.db.patch(sectorId, {
        commanders: b.commanders,
        entities: b.entities,
        serial: b.serial,
      });
    });
    const queue = (key: ResearchKey) =>
      t.mutation(api.tactics.research, { token: alice, sectorId, key });
    return { t, sectorId, queue };
  }

  test('queues persist and cancellation refunds only the authenticated owner once', async () => {
    const { t, sectorId, queue } = await setupSector();
    await queue('drills');
    await queue('turbines');
    const before = (await t.query(api.tactics.state, { token: alice }))!;
    expect(before.commanders[0].researchQueue).toEqual(['turbines']);
    expect(before.commanders[0].credits).toBe(
      10000 - RESEARCH.drills.cost - RESEARCH.turbines.cost,
    );
    await expect(queue('turbines')).rejects.toThrow('Already queued');
    await expect(
      t.mutation(api.tactics.abandonResearch, {
        token: bob,
        sectorId,
        key: 'turbines',
      }),
    ).rejects.toThrow('your queue');
    await expect(
      t.mutation(api.tactics.abandonResearch, {
        token: 'bad',
        sectorId,
        key: 'turbines',
      }),
    ).rejects.toThrow('Reconnect');
    expect(
      await t.mutation(api.tactics.abandonResearch, {
        token: alice,
        sectorId,
        key: 'turbines',
      }),
    ).toBe(RESEARCH.turbines.cost);
    await expect(
      t.mutation(api.tactics.abandonResearch, {
        token: alice,
        sectorId,
        key: 'turbines',
      }),
    ).rejects.toThrow('no longer');
    const after = (await t.query(api.tactics.state, { token: alice }))!;
    expect(after.commanders[0].credits).toBe(10000 - RESEARCH.drills.cost);
    expect(after.commanders[0].researchQueue).toEqual([]);
    expect(after.commanders[0].researching).toEqual(
      before.commanders[0].researching,
    );
    await queue('ammunition');
    vi.setSystemTime(Date.now() + 5000);
    await t.mutation(api.tactics.abandonResearch, {
      token: alice,
      sectorId,
      key: 'drills',
    });
    const resumed = (await t.query(api.tactics.state, { token: alice }))!;
    expect(resumed.commanders[0].researching).toEqual({
      key: 'ammunition',
      readyAt: Date.now() + A,
    });
  });

  test('the scheduler advances the queue once and outage repair preserves active and waiting research', async () => {
    const { t, sectorId, queue } = await setupSector();
    const start = Date.now();
    await queue('drills');
    await queue('turbines');
    vi.setSystemTime(start + 3600000);
    await t.mutation(internal.tactics.resumeStalledSector, {
      id: sectorId,
      expected: start,
    });
    let b = (await t.query(api.tactics.state, { token: alice }))!;
    expect(b.commanders[0].researching!.readyAt - b.tickAt).toBe(D);
    expect(b.commanders[0].researchQueue).toEqual(['turbines']);
    vi.setSystemTime(start + 3600000 + D);
    await t.mutation(internal.tactics.tick, {
      id: sectorId,
      expected: start + 3600000,
    });
    b = (await t.query(api.tactics.state, { token: alice }))!;
    expect(b.commanders[0].research).toEqual(['clearance2', 'drills']);
    expect(b.commanders[0].researching).toEqual({
      key: 'turbines',
      readyAt: start + 3600000 + D + T,
    });
    expect(b.commanders[0].researchQueue).toEqual([]);
    await t.mutation(internal.tactics.tick, {
      id: sectorId,
      expected: start + 3600000,
    });
    expect(
      (await t.query(api.tactics.state, { token: alice }))!.commanders,
    ).toEqual(b.commanders);
  });
});
