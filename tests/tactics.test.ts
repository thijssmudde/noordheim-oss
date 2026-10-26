import { terrainFor } from '../lib/tactical-terrain';
import { hasExit, productionExit } from '../lib/tactical-placement';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import {
  MAP_VERSION,
  armorOf,
  availability,
  buildSeconds,
  carrierOf,
  flagHome,
  TACTICAL_BUILDINGS,
  findPath,
  FIRST_WAVE_MS,
  groundAt,
  issueOrder,
  isHarvester,
  isUnit,
  joinBattle,
  makeEntity,
  newBattle,
  OPERATION_MINUTES,
  powerFor,
  placementError,
  purchase,
  research,
  researchAvailability,
  SELECTION_LIMIT,
  STARTING_CREDITS,
  TACTICAL_TICK_MS,
  TACTICAL_UNITS,
  tickBattle,
  tierOf,
  visibleToBlue,
  type Battle,
  type EntityKind,
  type ResearchKey,
  type UnitKind,
} from '../lib/tactics';
const modules = import.meta.glob('../convex/**/*.ts');
const alice = 'a'.repeat(64),
  bob = 'b'.repeat(64);
/** Alice's first landing on the default map; the build order is laid out around it. */
const HOME = terrainFor({}).baseAt(0);
const at = (dx: number, dz: number) => ({
  position: { x: HOME.x + dx, z: HOME.z + dz },
  rotation: 2,
});
const construction = {
  reactor: at(22, -2),
  refinery: at(-16, 2),
  barracks: at(20, 16),
  factory: at(0, 22),
  turret: at(10, -20),
  lab: at(40, 0),
  battery: at(10, -36),
};
function setupBattle() {
  const b = newBattle(1000);
  joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
  return b;
}
describe('Tactical movement and economy', () => {
  test('all eight command stations and their starting patrols are on dry, spaced land', () => {
    const b = newBattle(1000, { mapId: 'nordlys', playerSlots: 8 });
    const { baseAt } = terrainFor(b);
    for (let i = 0; i < 8; i++)
      joinBattle(
        b,
        { id: `p${i}`, name: `Player ${i}`, culture: 'neutral' },
        1000,
      );
    expect(b.commanders).toHaveLength(8);
    for (const e of b.entities)
      expect(terrainFor(b).groundAt(e.x, e.z), e.id).toBe(true);
    for (let i = 0; i < 8; i++)
      for (let j = i + 1; j < 8; j++)
        expect(
          Math.hypot(baseAt(i).x - baseAt(j).x, baseAt(i).z - baseAt(j).z),
        ).toBeGreaterThan(45);
    expect(() =>
      joinBattle(b, { id: 'extra', name: 'extra', culture: 'neutral' }, 1000),
    ).toThrow('Every landing zone');
    expect(b.mapVersion).toBe(MAP_VERSION);
  });
  test('ground paths cross a bridge while aerial units fly directly; invalid destinations are rejected', () => {
    const from = { x: -15, z: 30 },
      to = { x: -15, z: -60 },
      path = findPath(from, to);
    expect(path.length).toBeGreaterThan(2);
    expect(path.length).toBeLessThan(24);
    for (let i = 0; i < path.length; i++) {
      expect(groundAt(path[i].x, path[i].z)).toBe(true);
      if (i) {
        const p = path[i - 1],
          q = path[i];
        for (let t = 0; t <= 1; t += 0.1)
          expect(groundAt(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t)).toBe(
            true,
          );
      }
    }
    expect(findPath(from, to, true)).toEqual([to]);
    expect(findPath(from, { x: -200, z: 0 })).toEqual([]);
    expect(findPath(from, { x: NaN, z: 0 })).toEqual([]);
    // Long routes across the whole sector still resolve within the search budget.
    expect(
      findPath({ x: -140, z: 120 }, { x: 140, z: -120 }).length,
    ).toBeGreaterThan(2);
  });
  test('air and ground routes copy coordinates without retaining a target entity', () => {
    const b = setupBattle();
    const target = b.entities.find(
      (e) => e.owner === 'alice' && e.kind === 'ranger',
    )!;
    const position = { x: target.x, z: target.z };
    for (const air of [false, true]) {
      const path = findPath({ x: target.x, z: target.z - 8 }, target, air);
      expect(path.at(-1)).toEqual(position);
      expect(path.at(-1)).not.toBe(target);
    }
  });
  test('ownership and fog prevent commanding allies or attacking unseen enemies', () => {
    const b = setupBattle();
    joinBattle(b, { id: 'bob', name: 'Bob', culture: 'neutral' }, 1000);
    const a = b.entities.find((e) => e.owner === 'alice' && isUnit(e.kind))!,
      other = b.entities.find((e) => e.owner === 'bob' && isUnit(e.kind))!;
    expect(() =>
      issueOrder(b, 'alice', [other.id], 'move', { x: 0, z: 40 }),
    ).toThrow('your deployed units');
    const enemy = b.entities.find((e) => e.team === 'red')!;
    expect(visibleToBlue(enemy, b.entities)).toBe(false);
    expect(() =>
      issueOrder(b, 'alice', [a.id], 'attack', undefined, enemy.id),
    ).toThrow('visible hostile');
    issueOrder(b, 'alice', [a.id], 'attackMove', { x: -40, z: -30 });
    expect(a.path.length).toBeGreaterThan(0);
    issueOrder(b, 'alice', [a.id], 'hold');
    expect(a.path).toEqual([]);
    expect(() =>
      issueOrder(b, 'alice', [a.id, a.id], 'move', { x: 0, z: 40 }),
    ).toThrow(`up to ${SELECTION_LIMIT}`);
  });
  test('production debits credits once, follows the tech tree, and enforces completed producers and power', () => {
    const b = setupBattle();
    b.commanders[0].credits = 5000;
    expect(() =>
      purchase(b, 'alice', 'refinery', 1000, construction.refinery),
    ).toThrow('Geothermal');
    purchase(b, 'alice', 'reactor', 1000, construction.reactor);
    expect(b.commanders[0].credits).toBe(4840);
    tickBattle(b, 17000);
    expect(powerFor(b, 'alice').capacity).toBe(24);
    // The first foundations rise faster; later ones queue behind them serially.
    const refinerySeconds = buildSeconds(b, 'alice', 'refinery'),
      barracksSeconds = buildSeconds(b, 'alice', 'barracks');
    expect(refinerySeconds).toBeLessThan(TACTICAL_BUILDINGS.refinery.seconds);
    purchase(b, 'alice', 'refinery', 17000, construction.refinery);
    purchase(b, 'alice', 'barracks', 17000, construction.barracks);
    const q = b.entities.filter((e) => e.readyAt);
    expect(q.map((e) => e.readyAt)).toEqual([
      17000 + refinerySeconds * 1000,
      17000 + (refinerySeconds + barracksSeconds) * 1000,
    ]);
    expect(() =>
      purchase(b, 'alice', 'factory', 17000, construction.factory),
    ).toThrow('Ore refinery');
    expect(() => purchase(b, 'alice', 'tank', 17000)).toThrow('Vehicle works');
    tickBattle(b, 38000);
    expect(
      b.entities.some((e) => e.owner === 'alice' && isHarvester(e.kind)),
    ).toBe(true);
    // Three structures stand, so the works takes its full time.
    expect(buildSeconds(b, 'alice', 'factory')).toBe(
      TACTICAL_BUILDINGS.factory.seconds,
    );
    purchase(b, 'alice', 'factory', 38000, construction.factory);
    expect(b.entities.at(-1)!.readyAt).toBe(
      38000 + TACTICAL_BUILDINGS.factory.seconds * 1000,
    );
    expect(b.commanders[0].credits).toBeGreaterThanOrEqual(
      5000 - 160 - 450 - 300 - 600,
    );
    tickBattle(b, 78000);
    expect(() => purchase(b, 'alice', 'tank', 78000)).toThrow('Tier 2');
    purchase(b, 'alice', 'lynx', 78000);
    expect(b.training![0].readyAt).toBe(92000);
    expect(() => purchase(b, 'alice', 'hq', 78000)).toThrow(
      'one command station',
    );
    b.commanders[0].credits = 50;
    expect(() =>
      purchase(b, 'alice', 'turret', 78000, construction.turret),
    ).toThrow('credits');
  });
  test('combat causes permanent unit losses and wave attacks follow navigable paths', () => {
    const b = setupBattle(),
      u = b.entities.find((e) => e.kind === 'ranger' && e.team === 'blue')!;
    b.entities.push(
      makeEntity(b, 'tank', 'hostile', 'red', { x: u.x, z: u.z - 6 }),
    );
    tickBattle(b, 2000);
    expect(u.hp).toBeLessThan(160);
    for (let t = 3000; t <= 8000; t += 1000) tickBattle(b, t);
    expect(b.entities.some((e) => e.id === u.id)).toBe(false);
    // Withdraw the scripted tank so the base survives; the garrison must then
    // train its own column before it can march.
    b.entities = b.entities.filter((e) => e.owner !== 'hostile');
    for (let t = 10000; t <= 1000 + FIRST_WAVE_MS + 1000; t += 2000)
      tickBattle(b, t);
    expect(b.wave).toBe(1);
    const attacking = b.entities.filter(
      (e) => e.team === 'red' && e.order === 'attackMove',
    );
    expect(attacking.length).toBeGreaterThan(0);
    for (const e of attacking)
      for (const p of e.path)
        expect(terrainFor(b).groundAt(p.x, p.z)).toBe(true);
  });
  test('idle hostile columns make for the nearest allied flag to carry it off', () => {
    const b = setupBattle(),
      flag = b.flags!.find((f) => f.owner === 'alice')!,
      tank = makeEntity(b, 'tank', 'hostile', 'red', {
        x: flag.x + 40,
        z: flag.z - 40,
      });
    tank.order = 'attackMove';
    b.entities.push(tank);
    tickBattle(b, 2000);
    expect(tank.order).toBe('attackMove');
    expect(tank.path.length).toBeGreaterThan(0);
    const end = tank.path[tank.path.length - 1];
    expect(Math.hypot(end.x - flag.x, end.z - flag.z)).toBeLessThan(
      flag.radius,
    );
    // Standing at the flag, it stays to pick it up instead of wandering off to hunt.
    Object.assign(tank, { x: flag.x, z: flag.z, path: [] });
    tickBattle(b, 5000);
    expect(tank.path).toEqual([]);
  });
  test('without flags, idle hostile units hunt the nearest allied structure, then the last units', () => {
    const b = setupBattle(),
      hq = b.entities.find((e) => e.owner === 'alice' && e.kind === 'hq')!,
      tank = makeEntity(b, 'tank', 'hostile', 'red', {
        x: hq.x + 40,
        z: hq.z - 40,
      });
    b.flags = [];
    tank.order = 'attackMove';
    b.entities.push(tank);
    tickBattle(b, 2000);
    expect(tank.order).toBe('attackMove');
    expect(tank.path.length).toBeGreaterThan(0);
    const end = tank.path[tank.path.length - 1];
    expect(Math.hypot(end.x - hq.x, end.z - hq.z)).toBeLessThan(20);
    // With every allied structure gone, the survivors are hunted down too.
    b.entities = b.entities.filter((e) => e.team === 'red' || isUnit(e.kind));
    const ranger = b.entities.find(
      (e) => e.owner === 'alice' && e.kind === 'ranger',
    )!;
    tank.path = [];
    tickBattle(b, 5000);
    expect(tank.order).toBe('attackMove');
    expect(tank.path.length).toBeGreaterThan(0);
    const chase = tank.path[tank.path.length - 1];
    expect(Math.hypot(chase.x - ranger.x, chase.z - ranger.z)).toBeLessThan(20);
  });
  test('victory requires capturing every hostile flag, and ended operations stop simulating', () => {
    const b = setupBattle();
    b.entities = b.entities.filter((e) => e.team === 'blue');
    tickBattle(b, 2000);
    expect(b.status).toBe('active');
    for (const f of b.flags!) if (f.team === 'red') f.capturedAt = 2000;
    tickBattle(b, 3000);
    expect(b.status).toBe('victory');
    const copy = structuredClone(b);
    tickBattle(b, 99000);
    expect(b).toEqual(copy);
    expect(() => purchase(b, 'alice', 'reactor', 100000)).toThrow('ended');
    const defeat = setupBattle();
    defeat.entities = defeat.entities.filter((e) => e.team === 'red');
    tickBattle(defeat, 2000);
    expect(defeat.status).toBe('defeat');
  });
});
test(
  'a solo commander can win an operation on the default map by harvesting, climbing the tech tree and carrying the enemy flag home',
  () => {
    const b = setupBattle();
    // The build order is fixed; nudge a foundation that meets ore, a road or a unit.
    const siteFor = (
      kind: Parameters<typeof placementError>[2],
      preferred: { position: { x: number; z: number }; rotation: number },
    ) => {
      if (!placementError(b, 'alice', kind, preferred)) return preferred;
      for (let radius = 2; radius <= 16; radius += 2)
        for (let dx = -radius; dx <= radius; dx += 2)
          for (let dz = -radius; dz <= radius; dz += 2) {
            const candidate = {
              position: {
                x: preferred.position.x + dx,
                z: preferred.position.z + dz,
              },
              rotation: preferred.rotation,
            };
            if (!placementError(b, 'alice', kind, candidate)) return candidate;
          }
      return preferred;
    };
    const structures: (keyof typeof construction)[] = [
      'reactor',
      'refinery',
      'barracks',
      'factory',
      'turret',
      'lab',
      'battery',
    ];
    // Expansion: more power, a second refinery and defenses covering the ore.
    const extraSites: [EntityKind, number, number][] = (
      [
        ['reactor', 30, -16],
        ['turret', -32, -2],
        ['reactor', 30, 10],
        ['turret', -8, -28],
        ['refinery', -26, 18],
        ['reactor', 50, 22],
        ['battery', -2, -40],
        ['reactor', 50, 36],
      ] as [EntityKind, number, number][]
    ).map(([kind, dx, dz]) => [kind, HOME.x + dx, HOME.z + dz]);
    const units: UnitKind[] = [
      'harvester',
      'rocket',
      'rocket',
      'harvester',
      'rocket',
      'rocket',
      'harvester',
      'ranger',
      'ranger',
      'tank',
      'tank',
      'tank',
      'tank',
      'howitzer',
      'howitzer',
      'tank',
      'tank',
      'rocket',
      'rocket',
      'jotun',
      'jotun',
      'jotun',
      'howitzer',
      'jotun',
    ];
    const projects: ResearchKey[] = [
      'clearance2',
      'clearance3',
      'shells',
      'drills',
    ];
    const pending: UnitKind[] = [...units];
    const ownFlag = b.flags!.find((f) => f.owner === 'alice')!;
    let running: string | undefined;
    let nextStructure = 0,
      nextExtra = 0,
      nextUnit = 0,
      nextProject = 0,
      phase = 0;
    const attempt = (fn: () => unknown) => {
      try {
        fn();
        return true;
      } catch {
        return false;
      }
    };
    const army = () =>
      b.entities
        .filter(
          (e) =>
            e.owner === 'alice' &&
            isUnit(e.kind) &&
            !isHarvester(e.kind) &&
            !e.readyAt &&
            e.kind !== 'ranger',
        )
        .map((e) => e.id);
    for (
      let seconds = 1;
      seconds <= OPERATION_MINUTES * 60 && b.status === 'active';
      seconds++
    ) {
      const now = 1000 + seconds * 1000;
      tickBattle(b, now);
      // The operation can end on this update; no orders after it.
      if (b.status !== 'active') break;
      // Keep the build order viable when troop timing changes: expand power before
      // waiting for a powered building, rather than depending on a troop casualty.
      if (
        nextStructure < structures.length &&
        nextExtra < extraSites.length &&
        extraSites[nextExtra][0] === 'reactor' &&
        powerFor(b, 'alice').capacity - powerFor(b, 'alice').used < 6
      ) {
        const [kind, x, z] = extraSites[nextExtra];
        if (
          attempt(() =>
            purchase(
              b,
              'alice',
              kind,
              now,
              siteFor(kind as Parameters<typeof placementError>[2], {
                position: { x, z },
                rotation: 2,
              }),
            ),
          )
        )
          nextExtra++;
      }
      if (nextStructure < structures.length) {
        const kind = structures[nextStructure];
        if (
          attempt(() =>
            purchase(b, 'alice', kind, now, siteFor(kind, construction[kind])),
          )
        )
          nextStructure++;
      } else if (nextExtra < extraSites.length) {
        const [kind, x, z] = extraSites[nextExtra];
        if (
          attempt(() =>
            purchase(
              b,
              'alice',
              kind,
              now,
              siteFor(kind as Parameters<typeof placementError>[2], {
                position: { x, z },
                rotation: 2,
              }),
            ),
          )
        )
          nextExtra++;
      }
      if (
        nextProject < projects.length &&
        !researchAvailability(b, 'alice', projects[nextProject]) &&
        attempt(() => research(b, 'alice', projects[nextProject], now))
      )
        nextProject++;
      // Buy the first blueprint of the build order that is unlocked, as a commander
      // would, then keep spending ore on reinforcements.
      const reinforcements: UnitKind[] = [
        'tank',
        'rocket',
        'jotun',
        'howitzer',
      ];
      const unlocked = pending.findIndex(
        (kind) => !availability(b, 'alice', kind),
      );
      if (unlocked >= 0) {
        if (attempt(() => purchase(b, 'alice', pending[unlocked], now))) {
          pending.splice(unlocked, 1);
          nextUnit++;
        }
      } else if (
        !pending.length &&
        attempt(() =>
          purchase(
            b,
            'alice',
            reinforcements[nextUnit % reinforcements.length],
            now,
          ),
        )
      )
        nextUnit++;
      const ready =
        !pending.length && !b.training?.some((q) => q.owner === 'alice');
      // Push with a viable force while reinforcements train, instead of waiting
      // for every last order while the garrison keeps growing.
      // Push with a full column; when it is spent, regroup at home until the next one stands.
      if (ready || army().length >= 12) phase = 1;
      else if (army().length < 4) phase = 0;
      // Whoever picks up the enemy flag runs it home; the column escorts it.
      const enemyFlag = b.flags!.find(
        (f) => f.team === 'red' && f.capturedAt === undefined,
      );
      const carrier = enemyFlag && carrierOf(enemyFlag);
      if (carrier && carrier !== running) {
        running = carrier;
        attempt(() =>
          issueOrder(b, 'alice', [carrier], 'move', flagHome(ownFlag), undefined, now),
        );
      }
      if (carrier && seconds % 5 === 0) {
        const bearer = b.entities.find((e) => e.id === carrier)!;
        const escort = army().filter((id) => id !== carrier);
        if (escort.length)
          attempt(() => issueOrder(b, 'alice', escort, 'attackMove', bearer, undefined, now));
      } else if (!carrier && phase && seconds % 20 === 0) {
        const lead = b.entities.find((e) => army().includes(e.id));
        // Aim at what the column can actually hurt; a lone hostile drone must not stall a tank push.
        const guns = new Set(
          b.entities.filter((e) => army().includes(e.id)).map((e) => e.kind),
        );
        // The objective is the enemy flag: clear whatever guards it, then grab it.
        const flag = b.flags!.find(
          (f) => f.team === 'red' && f.capturedAt === undefined,
        )!;
        const enemies = b.entities.filter(
          (e) =>
            e.team === 'red' &&
            e.hp > 0 &&
            Math.hypot(e.x - flag.x, e.z - flag.z) < 45 &&
            [...guns].some(
              (kind) =>
                TACTICAL_UNITS[kind as UnitKind].versus[armorOf(e.kind)] > 0,
            ),
        );
        if (lead)
          enemies.sort(
            (a, b) =>
              Math.hypot(a.x - lead.x, a.z - lead.z) -
              Math.hypot(b.x - lead.x, b.z - lead.z),
          );
        const target = enemies[0];
        if (!target && army().length)
          issueOrder(b, 'alice', army(), 'attackMove', { x: flag.x, z: flag.z });
        if (target && army().length) {
          // Explicit attacks approach building footprints and pursue moving survivors.
          if (visibleToBlue(target, b.entities, b))
            issueOrder(b, 'alice', army(), 'attack', undefined, target.id);
          else
            issueOrder(
              b,
              'alice',
              army(),
              'attackMove',
              isUnit(target.kind) || !hasExit(target.kind as 'hq')
                ? target
                : productionExit(target),
            );
        }
      }
    }
    const summary = {
      flags: b.flags!.map((f) => `${f.name}:${f.state}${f.capturedAt ? '!' : ''}`),
      status: b.status,
      phase,
      minutes: Math.round((b.tickAt - b.startedAt) / 60000),
      tier: tierOf(b, 'alice'),
      wave: b.wave,
      structuresBuilt: nextStructure,
      unitsQueued: nextUnit,
      enemies: b.entities.filter((e) => e.team === 'red').length,
      remaining: b.entities
        .filter((e) => e.team === 'red')
        .map((e) => `${e.kind}@${Math.round(e.x)},${Math.round(e.z)}`),
      army: army().length,
      credits: Math.round(b.commanders[0].credits),
      harvested: Math.round(b.commanders[0].harvested ?? 0),
    };
    expect(summary, JSON.stringify(summary)).toMatchObject({
      status: 'victory',
      tier: 3,
    });
    // Won by the flag, not by razing the base.
    expect(b.flags!.filter((f) => f.team === 'red').every((f) => f.capturedAt)).toBe(
      true,
    );
    expect(b.events.some((e) => e.text.startsWith('Flag captured'))).toBe(true);
    expect(b.wave).toBeGreaterThanOrEqual(2);
    expect(b.commanders[0].harvested).toBeGreaterThan(10000);
    expect(b.entities.some((e) => e.owner === 'alice' && e.kind === 'hq')).toBe(
      true,
    );
    expect(b.entities.some((e) => e.team === 'red')).toBe(false);
  },
  60000,
);

describe('Authoritative Convex co-op sectors', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());
  async function setup() {
    const t = convexTest(schema, modules);
    await t.mutation(api.players.connect, { token: alice, name: 'Alice' });
    await t.mutation(api.players.connect, { token: bob, name: 'Bob' });
    return t;
  }
  test('entry is explicit and idempotent, and teammates share a sector', async () => {
    const t = await setup();
    expect(await t.query(api.tactics.state, { token: alice })).toBeNull();
    const id = await t.mutation(api.tactics.deploy, { token: alice });
    expect(await t.mutation(api.tactics.deploy, { token: alice })).toBe(id);
    expect(await t.mutation(api.tactics.deploy, { token: bob })).toBe(id);
    const a = (await t.query(api.tactics.state, { token: alice }))!,
      b = (await t.query(api.tactics.state, { token: bob }))!;
    expect(a.commanders).toHaveLength(2);
    expect(a.entities).toEqual(b.entities);
    expect(a.commanders[0].credits).toBe(STARTING_CREDITS);
    expect(a.entities.some((e) => e.team === 'red')).toBe(false);
    expect(a.deposits!.length).toBeGreaterThan(8);
    expect(JSON.stringify(a)).not.toContain(alice);
    expect(JSON.stringify(a)).not.toContain(bob);
  });
  test('an active sector from an earlier map layout is left alone and a fresh operation begins', async () => {
    const t = await setup();
    const legacy = await t.run(async (ctx) => {
      const battle: Battle = {
        ...newBattle(Date.now()),
        mapVersion: undefined,
      };
      delete battle.deposits;
      return ctx.db.insert('sectors', { worldId: 'legacy-world', ...battle });
    });
    const id = await t.mutation(api.tactics.deploy, { token: alice });
    expect(id).not.toBe(legacy);
    const s = (await t.query(api.tactics.state, { token: alice }))!;
    expect(s.id).toBe(id);
    expect(s.mapVersion).toBe(MAP_VERSION);
    expect((await t.run((ctx) => ctx.db.get(legacy)))!.status).toBe('active');
  });
  test('mutations reject strangers, stolen units, invalid coordinates, and stale completed sectors', async () => {
    const t = await setup(),
      id = await t.mutation(api.tactics.deploy, { token: alice });
    await t.mutation(api.tactics.deploy, { token: bob });
    const s = (await t.query(api.tactics.state, { token: alice }))!,
      unit = s.entities.find((e) => e.owner === s.viewerId && isUnit(e.kind))!;
    await expect(
      t.mutation(api.tactics.command, {
        token: bob,
        sectorId: id,
        ids: [unit.id],
        order: 'move',
        point: { x: 0, z: 40 },
      }),
    ).rejects.toThrow('your deployed');
    await expect(
      t.mutation(api.tactics.command, {
        token: 'bad',
        sectorId: id,
        ids: [unit.id],
        order: 'hold',
      }),
    ).rejects.toThrow('Reconnect');
    await expect(
      t.mutation(api.tactics.command, {
        token: alice,
        sectorId: id,
        ids: [unit.id],
        order: 'move',
        point: { x: 999, z: 0 },
      }),
    ).rejects.toThrow('inside the sector');
    await t.mutation(api.tactics.command, {
      token: alice,
      sectorId: id,
      ids: [unit.id],
      order: 'attackMove',
      // Keep this authorization test inside the guaranteed dry deployment
      // pad. Seed-dependent long-range routing has separate coverage.
      point: { x: unit.x + 3, z: unit.z - 2 },
    });
    vi.setSystemTime(s.tickAt + 250);
    await t.mutation(internal.tactics.tick, { id, expected: s.tickAt });
    expect(
      (await t.query(api.tactics.state, { token: bob }))!.entities.find(
        (e) => e.id === unit.id,
      )!.path.length,
    ).toBeGreaterThan(0);
    await t.run((ctx) => ctx.db.patch(id, { status: 'victory' }));
    await expect(
      t.mutation(api.tactics.produce, {
        token: alice,
        sectorId: id,
        kind: 'reactor',
      }),
    ).rejects.toThrow('ended');
  });
  test('pursuing a moving enemy stores only coordinates and keeps scheduled ticks alive', async () => {
    const t = await setup();
    const id = await t.mutation(api.tactics.deploy, { token: alice });
    const unitId = await t.run(async (ctx) => {
      const b = (await ctx.db.get(id))!;
      const unit = b.entities.find(
        (e) => e.team === 'blue' && e.kind === 'ranger',
      )!;
      const enemy = makeEntity(b, 'ranger', 'hostile', 'red', {
        x: unit.x,
        z: unit.z - 20,
      });
      b.entities.push(enemy);
      await ctx.db.patch(id, { entities: b.entities, serial: b.serial });
      return unit.id;
    });
    const start = Date.now();
    vi.setSystemTime(start + 1000);
    await t.mutation(internal.tactics.tick, { id, expected: start });
    const after = await t.run((ctx) => ctx.db.get(id));
    const path = after!.entities.find((e) => e.id === unitId)!.path;
    expect(path.length).toBeGreaterThan(0);
    for (const point of path)
      expect(Object.keys(point).sort()).toEqual(['x', 'z']);
    vi.setSystemTime(start + 2000);
    await t.mutation(internal.tactics.tick, { id, expected: start + 1000 });
    expect((await t.run((ctx) => ctx.db.get(id)))!.tickAt).toBe(start + 2000);
  });
  test('the watchdog restarts a lost tick chain and ignores healthy or completed matches', async () => {
    const t = await setup();
    const b = setupBattle();
    const ids = await t.run(async (ctx) => ({
      stalled: await ctx.db.insert('sectors', b),
      healthy: await ctx.db.insert('sectors', { ...b, tickAt: 20250 }),
      finished: await ctx.db.insert('sectors', { ...b, status: 'victory' }),
    }));
    vi.setSystemTime(21000);
    // No simulation callback exists: the independent watchdog must restore it.
    await t.mutation(internal.tactics.recoverStalledSectors, {});
    await vi.advanceTimersByTimeAsync(0);
    await t.finishInProgressScheduledFunctions();
    const resumed = (await t.run((ctx) => ctx.db.get(ids.stalled)))!;
    expect(resumed.tickAt).toBe(21000);
    expect(resumed.tickAt - resumed.startedAt).toBe(b.tickAt - b.startedAt);
    expect(resumed.entities).toEqual(b.entities);
    expect((await t.run((ctx) => ctx.db.get(ids.healthy)))!.tickAt).toBe(20250);
    expect((await t.run((ctx) => ctx.db.get(ids.finished)))!.tickAt).toBe(
      b.tickAt,
    );
    await vi.advanceTimersByTimeAsync(TACTICAL_TICK_MS);
    await t.finishInProgressScheduledFunctions();
    expect((await t.run((ctx) => ctx.db.get(ids.stalled)))!.tickAt).toBe(21250);
    await t.run((ctx) => ctx.db.patch(ids.stalled, { status: 'victory' }));
    await vi.advanceTimersByTimeAsync(TACTICAL_TICK_MS);
    await t.finishInProgressScheduledFunctions();
  });
  test('repairing a stalled sector preserves its forces and remaining operation time once', async () => {
    const t = await setup();
    const id = await t.mutation(api.tactics.deploy, { token: alice });
    const before = (await t.run((ctx) => ctx.db.get(id)))!;
    vi.setSystemTime(before.tickAt + 3600000);
    expect(
      await t.mutation(internal.tactics.resumeStalledSector, {
        id,
        expected: before.tickAt,
      }),
    ).toBe(true);
    const after = (await t.run((ctx) => ctx.db.get(id)))!;
    expect(after.entities).toEqual(before.entities);
    expect(after.tickAt - after.startedAt).toBe(
      before.tickAt - before.startedAt,
    );
    expect(after.nextWaveAt - after.tickAt).toBe(
      before.nextWaveAt - before.tickAt,
    );
    expect(
      await t.mutation(internal.tactics.resumeStalledSector, {
        id,
        expected: before.tickAt,
      }),
    ).toBe(false);
    vi.setSystemTime(after.tickAt + 1000);
    await t.mutation(internal.tactics.tick, { id, expected: after.tickAt });
    expect((await t.run((ctx) => ctx.db.get(id)))!.status).toBe('active');
  });
  test('the scheduler moves units while players are offline and ignores duplicate ticks', async () => {
    const t = await setup(),
      id = await t.mutation(api.tactics.deploy, { token: alice }),
      s = (await t.query(api.tactics.state, { token: alice }))!;
    const unit = s.entities.find(
      (e) => e.owner === s.viewerId && isUnit(e.kind),
    )!;
    await t.mutation(api.tactics.command, {
      token: alice,
      sectorId: id,
      ids: [unit.id],
      order: 'move',
      point: { x: -110, z: 30 },
    });
    const expected = Date.now();
    // Commands are accepted immediately and routed by the next authoritative tick.
    await t.mutation(internal.tactics.tick, { id, expected });
    vi.setSystemTime(expected + 1000);
    await t.mutation(internal.tactics.tick, { id, expected });
    const after = (await t.query(api.tactics.state, { token: alice }))!;
    expect(after.entities.find((e) => e.id === unit.id)!.z).toBeLessThan(
      unit.z,
    );
    expect(after.commanders[0].credits).toBe(STARTING_CREDITS + 1);
    await t.mutation(internal.tactics.tick, { id, expected });
    expect(
      (await t.query(api.tactics.state, { token: alice }))!.commanders[0]
        .credits,
    ).toBe(STARTING_CREDITS + 1);
  });
});
