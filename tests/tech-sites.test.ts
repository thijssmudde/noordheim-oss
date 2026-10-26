import { describe, expect, test } from 'vitest';
import {
  CREDIT_CAP,
  SITE_CLEARANCE,
  SITE_RULES,
  TECH_SITES,
  findPath,
  issueOrder,
  joinBattle,
  makeEntity,
  movementObstacles,
  newBattle,
  placementError,
  reconPosition,
  siteFootprint,
  tickBattle,
  validateOrder,
  visibleTo,
  type Battle,
  type Entity,
  type TechSite,
  type UnitKind,
} from '../lib/tactics';
import { DIFFICULTIES, type Difficulty } from '../lib/tactical-difficulty';
import { BattleAudioDirector } from '../lib/audio-policy';
import { MAPS, mapFor, mapIds } from '../lib/maps';
import { productionExit } from '../lib/tactical-placement';
import { footprintSamples, footprintsOverlap } from '../lib/tactical-placement';

/** A solo operation on Fjordmouth with the garrison's troops cleared out of the way. */
function setup(difficulty: Difficulty = 'normal') {
  const b = newBattle(1000, { seed: 7, difficulty });
  joinBattle(b, { id: 'alice', name: 'Alice', culture: 'fjordborn' }, 1000);
  // Only structures: troops are placed by each test.
  b.entities = b.entities.filter(
    (e) => !['ranger', 'rocket', 'lynx', 'tank'].includes(e.kind),
  );
  b.nextWaveAt = Infinity;
  return b;
}
const derrick = (b: Battle) => b.sites!.find((s) => s.kind === 'derrick')!;
const hospital = (b: Battle) =>
  b.sites!.find((s) => s.kind === 'fieldHospital')!;
/** Troops standing in a site's ring on 'hold', so they neither wander nor chase. */
function post(
  b: Battle,
  site: TechSite,
  kind: UnitKind,
  owner: string,
  count: number,
  angle = 0,
) {
  const team = owner === 'alice' ? 'blue' : 'red';
  return Array.from({ length: count }, (_, i) => {
    const a = angle + (i * Math.PI * 2) / Math.max(3, count);
    const e = makeEntity(b, kind, owner, team, {
      x: site.x + Math.sin(a) * 9,
      z: site.z + Math.cos(a) * 9,
    });
    e.order = 'hold';
    b.entities.push(e);
    return e;
  });
}
/** Advance the operation in quarter-second updates, like the server. */
function run(b: Battle, seconds: number) {
  const end = b.tickAt + seconds * 1000;
  while (b.tickAt < end) tickBattle(b, Math.min(end, b.tickAt + 250));
}
/** Keep troops alive through a fight so only the capture rules are under test. */
const tough = (list: Entity[]) => {
  for (const e of list) e.hp = 1e7;
  return list;
};

describe('Tech site capture', () => {
  test('a new operation plants every site neutral at full strength', () => {
    const b = setup();
    expect(b.sites!.length).toBe(MAPS.fjordmouth.techSites.length);
    for (const s of b.sites!) {
      expect(s.team).toBeUndefined();
      expect(s.hp).toBe(TECH_SITES[s.kind].hp);
      expect(s.progress).toBe(0);
    }
  });

  test('infantry take a site after holding its ring uncontested', () => {
    const b = setup();
    const site = derrick(b);
    post(b, site, 'ranger', 'alice', 2);
    run(b, SITE_RULES.captureSeconds - 1);
    expect(site.team).toBeUndefined();
    expect(site.capturing).toBe('blue');
    expect(site.progress).toBeGreaterThan(SITE_RULES.captureSeconds - 1.5);
    run(b, 1.25);
    expect(site).toMatchObject({ team: 'blue', holder: 'alice', progress: 0 });
    expect(
      b.events.some(
        (e) =>
          e.text === `${site.name} captured by Alice: +240 credits every 10 s.`,
      ),
    ).toBe(true);
  });

  test('only infantry capture: vehicles in the ring take nothing', () => {
    const b = setup();
    const site = derrick(b);
    post(b, site, 'tank', 'alice', 2);
    post(b, site, 'lynx', 'alice', 1, 2);
    run(b, SITE_RULES.captureSeconds * 2);
    expect(site.team).toBeUndefined();
    expect(site.progress).toBe(0);
  });

  test('enemy troops in the ring pause the count; it resumes once they are gone', () => {
    const b = setup();
    const site = derrick(b);
    tough(post(b, site, 'ranger', 'alice', 2));
    run(b, 3);
    const paused = site.progress;
    expect(paused).toBeGreaterThan(2.5);
    // Any ground troop contests, even a vehicle that cannot capture.
    const [intruder] = tough(post(b, site, 'tank', 'hostile-1', 1, 1));
    run(b, 4);
    expect(site.contested).toBe(true);
    expect(site.progress).toBeCloseTo(paused, 5);
    expect(site.team).toBeUndefined();
    b.entities = b.entities.filter((e) => e !== intruder);
    run(b, SITE_RULES.captureSeconds - paused + 0.5);
    expect(site.team).toBe('blue');
    expect(site.contested).toBeUndefined();
  });

  test('abandoned progress drains away', () => {
    const b = setup();
    const site = derrick(b);
    const squad = post(b, site, 'ranger', 'alice', 2);
    run(b, 4);
    b.entities = b.entities.filter((e) => !squad.includes(e));
    run(b, 2);
    expect(site.progress).toBeCloseTo(4 - 2 * SITE_RULES.drainPerSecond, 1);
    run(b, 4);
    expect(site.progress).toBe(0);
    expect(site.capturing).toBeUndefined();
  });

  test('a held site flips straight to the other side, and the log says it was lost', () => {
    const b = setup();
    const site = derrick(b);
    Object.assign(site, { team: 'blue', holder: 'alice' });
    post(b, site, 'ranger', 'hostile-1', 3);
    run(b, 1);
    expect(b.events[0].text).toBe(`${site.name} is being taken by the enemy!`);
    run(b, SITE_RULES.captureSeconds);
    expect(site).toMatchObject({ team: 'red', holder: 'hostile-1' });
    expect(
      b.events.some((e) => e.text === `${site.name} lost to the enemy.`),
    ).toBe(true);
  });

  test("the holder's own troops in the ring do not take what they already hold", () => {
    const b = setup();
    const site = derrick(b);
    Object.assign(site, { team: 'blue', holder: 'alice' });
    post(b, site, 'ranger', 'alice', 3);
    run(b, SITE_RULES.captureSeconds + 1);
    expect(site.capturing).toBeUndefined();
    expect(site.progress).toBe(0);
  });
});

describe('Tech site damage', () => {
  test('a site shot to 0 HP reverts to neutral at full strength', () => {
    const b = setup();
    const site = derrick(b);
    Object.assign(site, { team: 'red', holder: 'hostile-1', hp: 40 });
    const [tank] = post(b, site, 'tank', 'alice', 1);
    // Sent against the site explicitly, as a player's attack order does.
    issueOrder(b, 'alice', [tank.id], 'attack', undefined, site.id, b.tickAt);
    expect(tank.target).toBe(site.id);
    run(b, 3);
    expect(site.team).toBeUndefined();
    expect(site.holder).toBeUndefined();
    expect(site.hp).toBe(TECH_SITES.derrick.hp);
    expect(
      b.events.some(
        (e) => e.text === `${site.name} knocked out. The enemy has lost it.`,
      ),
    ).toBe(true);
    // The attack order stands down: there is nothing left to shoot.
    expect(tank.order).toBe('stop');
    expect(tank.target).toBeUndefined();
  });

  test('columns sweeping past fire on an enemy-held site; idle guards do not', () => {
    const b = setup();
    const site = derrick(b);
    Object.assign(site, { team: 'blue', holder: 'alice' });
    const [guard] = post(b, site, 'tank', 'hostile-1', 1);
    run(b, 2);
    expect(site.hp).toBe(TECH_SITES.derrick.hp);
    guard.order = 'attackMove';
    run(b, 2);
    expect(site.hp).toBeLessThan(TECH_SITES.derrick.hp);
    expect(guard.firedAt).toBeGreaterThan(0);
  });

  test('only enemy-held sites can be targeted', () => {
    const b = setup();
    const site = derrick(b);
    const [tank] = post(b, site, 'tank', 'alice', 1);
    expect(() =>
      validateOrder(b, 'alice', [tank.id], 'attack', undefined, site.id),
    ).toThrow('enemy-held');
    Object.assign(site, { team: 'blue', holder: 'alice' });
    expect(() =>
      validateOrder(b, 'alice', [tank.id], 'attack', undefined, site.id),
    ).toThrow('enemy-held');
    site.team = 'red';
    expect(() =>
      validateOrder(b, 'alice', [tank.id], 'attack', undefined, site.id),
    ).not.toThrow();
  });
});

describe('Tech site bonuses', () => {
  test('a derrick pays its holder on every pulse, up to the credit cap', () => {
    const b = setup();
    const site = derrick(b);
    post(b, site, 'ranger', 'alice', 2);
    run(b, SITE_RULES.captureSeconds + 0.25);
    expect(site.team).toBe('blue');
    const alice = b.commanders[0];
    const before = alice.credits;
    run(b, TECH_SITES.derrick.pulseSeconds * 3);
    // Three payouts plus the command station's trickle of 1 credit a second.
    const trickle = TECH_SITES.derrick.pulseSeconds * 3;
    expect(alice.credits - before).toBeCloseTo(
      TECH_SITES.derrick.income * 3 + trickle,
      0,
    );
    alice.credits = CREDIT_CAP - 20;
    run(b, TECH_SITES.derrick.pulseSeconds);
    expect(alice.credits).toBe(CREDIT_CAP);
  });

  test('one derrick is worth roughly one harvester on a home seam', () => {
    // A real harvester's delivery rate over five minutes of work.
    const b = newBattle(1000, { seed: 1 });
    b.entities = b.entities.filter((e) => e.team !== 'red' || e.kind === 'hq');
    joinBattle(b, { id: 'alice', name: 'Alice', culture: 'neutral' }, 1000);
    const home = mapFor('fjordmouth').baseAt(0);
    const refinery = makeEntity(b, 'refinery', 'alice', 'blue', {
      x: home.x - 16,
      z: home.z + 2,
    });
    refinery.angle = Math.PI;
    b.entities.push(refinery);
    b.entities.push(
      makeEntity(b, 'harvester', 'alice', 'blue', productionExit(refinery)),
    );
    b.nextWaveAt = Infinity;
    const start = 60000;
    for (let t = 2000; t <= start; t += 1000) tickBattle(b, t);
    const delivered = b.commanders[0].harvested ?? 0;
    for (let t = start + 1000; t <= start + 300000; t += 1000) tickBattle(b, t);
    const harvester = ((b.commanders[0].harvested ?? 0) - delivered) / 300;
    const derrick = TECH_SITES.derrick.income / TECH_SITES.derrick.pulseSeconds;
    expect(harvester).toBeGreaterThan(0);
    expect(derrick / harvester).toBeGreaterThan(0.7);
    expect(derrick / harvester).toBeLessThan(1.4);
  });

  test("a hostile derrick hastens its holder's production lines instead", () => {
    const b = setup();
    const site = derrick(b);
    Object.assign(site, {
      team: 'red',
      holder: 'hostile-1',
      pulseAt: b.tickAt + 1000,
    });
    const due = b.tickAt + 60000;
    b.hostileTraining = [
      {
        id: 'q',
        owner: 'hostile-1',
        kind: 'tank',
        remaining: 1,
        total: 1,
        readyAt: due,
      },
    ];
    run(b, 1.25);
    expect(b.hostileTraining![0].readyAt).toBe(
      due - TECH_SITES.derrick.hostileHasteSeconds * 1000,
    );
  });

  test("a field hospital heals its holder's infantry in reach, in the fight or not", () => {
    const b = setup();
    const site = hospital(b);
    Object.assign(site, { team: 'blue', holder: 'alice' });
    const near = makeEntity(b, 'ranger', 'alice', 'blue', {
      x: site.x + 18,
      z: site.z,
    });
    const far = makeEntity(b, 'ranger', 'alice', 'blue', {
      x: site.x + TECH_SITES.fieldHospital.healRadius + 6,
      z: site.z,
    });
    const tank = makeEntity(b, 'tank', 'alice', 'blue', {
      x: site.x - 12,
      z: site.z,
    });
    for (const e of [near, far, tank]) {
      e.order = 'hold';
      e.hp = 50;
      // Still firing: the aid station's recovery would not apply.
      e.firedAt = b.tickAt;
      b.entities.push(e);
    }
    run(b, 4);
    const max = 160;
    expect(near.hp).toBeCloseTo(
      Math.min(max, 50 + max * TECH_SITES.fieldHospital.healPerSecond * 4),
      0,
    );
    expect(far.hp).toBe(50);
    expect(tank.hp).toBe(50);
    // Red infantry get nothing from a coalition hospital.
    const foe = makeEntity(b, 'ranger', 'hostile-1', 'red', {
      x: site.x,
      z: site.z + 18,
    });
    foe.hp = 50;
    foe.order = 'hold';
    b.entities.push(foe);
    near.x = foe.x - 40;
    run(b, 1);
    expect(foe.hp).toBeLessThanOrEqual(50);
  });

  test('an airstrip launches a recon plane to the rally point that reveals the fog, then leaves', () => {
    // Easy: no hostile detachment comes for the airstrip within the test.
    const b = newBattle(1000, {
      seed: 7,
      mapId: 'ironpass',
      difficulty: 'easy',
    });
    joinBattle(b, { id: 'alice', name: 'Alice', culture: 'fjordborn' }, 1000);
    b.nextWaveAt = Infinity;
    const site = b.sites!.find((s) => s.kind === 'airstrip')!;
    const hq = b.entities.find((e) => e.owner === 'alice' && e.kind === 'hq')!;
    hq.rally = { x: 40, z: -120 };
    post(b, site, 'ranger', 'alice', 2);
    run(b, SITE_RULES.captureSeconds + 0.25);
    expect(site.team).toBe('blue');
    expect(b.recon ?? []).toEqual([]);
    run(b, TECH_SITES.airstrip.firstPlaneSeconds);
    expect(b.recon).toHaveLength(1);
    const [plane] = b.recon!;
    expect(plane).toMatchObject({
      team: 'blue',
      owner: 'alice',
      toX: 40,
      toZ: -120,
    });
    expect(
      b.events.some((e) => e.text === `Recon plane up from ${site.name}.`),
    ).toBe(true);
    // Over the rally point it sees what no troop of Alice's can.
    const hidden = makeEntity(b, 'tank', 'hostile-1', 'red', {
      x: 40,
      z: -130,
    });
    b.entities.push(hidden);
    expect(visibleTo('alice', hidden, b.entities, b)).toBe(false);
    run(b, (plane.arriveAt - b.tickAt) / 1000 + 5);
    expect(visibleTo('alice', hidden, b.entities, b)).toBe(true);
    // The flight is continuous: no jumps between the legs.
    for (let t = plane.launchedAt; t < plane.goneAt; t += 250) {
      const a = reconPosition(plane, t),
        z = reconPosition(plane, t + 250);
      expect(Math.hypot(z.x - a.x, z.z - a.z)).toBeLessThan(
        TECH_SITES.airstrip.planeSpeed * 0.25 * 1.6,
      );
    }
    // It leaves the sector and is gone; the next one follows on the cadence.
    run(b, (plane.goneAt - b.tickAt) / 1000 + 1);
    expect(b.recon!.some((f) => f.id === plane.id)).toBe(false);
    expect(visibleTo('alice', hidden, b.entities, b)).toBe(false);
    run(b, (site.pulseAt! - b.tickAt) / 1000 + 0.5);
    expect(b.recon).toHaveLength(1);
  });

  test('without a rally point the recon plane circles the map centre', () => {
    const b = newBattle(1000, { seed: 7, mapId: 'ironpass' });
    joinBattle(b, { id: 'alice', name: 'Alice', culture: 'fjordborn' }, 1000);
    const site = b.sites!.find((s) => s.kind === 'airstrip')!;
    Object.assign(site, {
      team: 'blue',
      holder: 'alice',
      pulseAt: b.tickAt + 100,
    });
    run(b, 0.5);
    expect(b.recon![0]).toMatchObject({ toX: 0, toZ: 0 });
  });
});

describe('Hostile tech site tactics', () => {
  /** Stand trained infantry at a hostile army's muster point, as its production would. */
  function muster(b: Battle, owner: string, count: number) {
    const hq = b.entities.find((e) => e.owner === owner && e.kind === 'hq')!;
    const exit = productionExit(hq);
    const { groundAt } = mapFor(b.mapId);
    const placed: Entity[] = [];
    for (let ring = 4; ring <= 40 && placed.length < count; ring += 3)
      for (let i = 0; i < 12 && placed.length < count; i++) {
        const p = {
          x: exit.x + Math.sin((i * Math.PI) / 6) * ring,
          z: exit.z + Math.cos((i * Math.PI) / 6) * ring,
        };
        if (
          !groundAt(p.x, p.z) ||
          b.entities.some(
            (s) => s.team === 'red' && Math.hypot(s.x - p.x, s.z - p.z) < 9,
          )
        )
          continue;
        const e = makeEntity(b, 'ranger', owner, 'red', p);
        b.entities.push(e);
        placed.push(e);
      }
    return placed;
  }

  test('difficulty sets how often and how strongly the garrison contests sites', () => {
    const order: Difficulty[] = ['easy', 'normal', 'hard', 'brutal'];
    for (let i = 1; i < order.length; i++) {
      expect(DIFFICULTIES[order[i]].siteDutyMs).toBeLessThan(
        DIFFICULTIES[order[i - 1]].siteDutyMs,
      );
      expect(DIFFICULTIES[order[i]].siteSquad).toBeGreaterThan(
        DIFFICULTIES[order[i - 1]].siteSquad,
      );
    }
  });

  test('the garrison sends a detachment that retakes a coalition site and stays to hold it', () => {
    const b = setup('brutal');
    b.entities = b.entities.filter(
      (e) => e.owner !== 'alice' || e.kind === 'hq',
    );
    const site = hospital(b);
    Object.assign(site, { team: 'blue', holder: 'alice' });
    const rules = DIFFICULTIES.brutal;
    muster(b, 'hostile-1', 10 + rules.siteSquad + 2);
    run(b, rules.siteDutyMs / 1000 + 0.5);
    expect(site.squad).toHaveLength(rules.siteSquad);
    const squad = site.squad!.map((id) => b.entities.find((e) => e.id === id)!);
    for (const e of squad) expect(e.kind).toBe('ranger');
    for (let s = 0; s < 240 && site.team !== 'red'; s += 2) run(b, 2);
    expect(site).toMatchObject({ team: 'red', holder: 'hostile-1' });
    // The detachment stays on as the site's guard and is never swept into a column.
    run(b, 10);
    expect(site.squad).toHaveLength(rules.siteSquad);
    for (const e of squad)
      expect(Math.hypot(e.x - site.x, e.z - site.z)).toBeLessThan(
        SITE_RULES.captureRadius + 6,
      );
    // No second detachment while the site is held quietly.
    const others = b.sites!.filter((s) => s !== site && s.squad);
    run(b, rules.siteDutyMs / 1000);
    expect(
      b.sites!.filter((s) => s !== site && s.squad).length,
    ).toBeLessThanOrEqual(others.length + 1);
  });

  test('a column about to march is never stripped for a site, and Easy waits far longer', () => {
    const b = setup('normal');
    b.entities = b.entities.filter(
      (e) => e.owner !== 'alice' || e.kind === 'hq',
    );
    const rules = DIFFICULTIES.normal;
    // Exactly the home guard plus a detachment: nothing would be left for the column.
    muster(b, 'hostile-1', 6 + rules.siteSquad);
    b.nextWaveAt = b.tickAt + rules.siteDutyMs + 5000;
    run(b, rules.siteDutyMs / 1000 + 0.5);
    expect(b.sites!.some((s) => s.squad)).toBe(false);
    const easy = setup('easy');
    muster(easy, 'hostile-1', 20);
    run(easy, DIFFICULTIES.normal.siteDutyMs / 1000 + 0.5);
    expect(easy.sites!.some((s) => s.squad)).toBe(false);
    run(
      easy,
      (DIFFICULTIES.easy.siteDutyMs - DIFFICULTIES.normal.siteDutyMs) / 1000,
    );
    expect(easy.sites!.some((s) => s.squad)).toBe(true);
  });
});

describe('Tech site placement', () => {
  for (const id of mapIds)
    test(`${id} plants 2-4 fair, reachable sites on open ground`, () => {
      const map = mapFor(id);
      const { techSites, landings, strongholds, ore, props, billboards } =
        map.design;
      expect(techSites.length).toBeGreaterThanOrEqual(2);
      expect(techSites.length).toBeLessThanOrEqual(4);
      const sites = techSites.map((d) => ({ ...d, angle: d.angle ?? 0 }));
      const seams = [...ore, ...landings.map((_, i) => map.homeOreAt(i))];
      for (const s of sites) {
        const box = siteFootprint(s);
        // The structure stands on dry, walkable ground, clear of bridges.
        for (const q of footprintSamples(box))
          expect(map.groundAt(q.x, q.z), `${s.name} footing`).toBe(true);
        const apron = {
          minX: box.minX - 2,
          maxX: box.maxX + 2,
          minZ: box.minZ - 2,
          maxZ: box.maxZ + 2,
        };
        for (const q of footprintSamples(apron))
          expect(
            ['bridge', 'ford', 'ramp'],
            `${s.name} on a crossing or ramp`,
          ).not.toContain(map.terrainAt(q.x, q.z));
        // Its capture ring is open ground nearly all the way round.
        let open = 0,
          samples = 0;
        for (let r = 2; r <= SITE_RULES.captureRadius; r += 2)
          for (let a = 0; a < 24; a++) {
            samples++;
            if (
              map.groundAt(
                s.x + Math.sin((a / 24) * Math.PI * 2) * r,
                s.z + Math.cos((a / 24) * Math.PI * 2) * r,
              )
            )
              open++;
          }
        expect(open / samples, `${s.name} ring`).toBeGreaterThan(0.85);
        // Harvesters keep their seams; decoration keeps off the structure.
        for (const d of seams)
          expect(
            Math.hypot(d.x - s.x, d.z - s.z),
            `${s.name} near ore at ${d.x},${d.z}`,
          ).toBeGreaterThan(20);
        for (const p of [...props, ...billboards])
          expect(
            footprintsOverlap(
              box,
              { minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z },
              4,
            ),
            `${s.name} prop`,
          ).toBe(false);
        // Every landing and every stronghold can walk to it.
        const obstacles = sites.map(siteFootprint);
        const door = { x: s.x, z: box.maxZ + 4 };
        for (const p of [...landings, ...strongholds])
          expect(
            findPath(p, door, false, obstacles, map).length,
            `${s.name} from ${p.x},${p.z}`,
          ).toBeGreaterThan(0);
        // Two sites never share a ring.
        for (const o of sites)
          if (o !== s)
            expect(Math.hypot(o.x - s.x, o.z - s.z)).toBeGreaterThan(
              SITE_RULES.captureRadius * 2,
            );
      }
    });

  test('sites mirror across the landings: each has a twin of the same kind', () => {
    for (const id of mapIds) {
      const { techSites, landings } = MAPS[id];
      // Every map's landings are mirrored west-east about x = 0.
      for (const l of landings)
        expect(
          landings.some((o) => o.x === -l.x && o.z === l.z),
          id,
        ).toBe(true);
      for (const s of techSites)
        expect(
          techSites.some(
            (o) =>
              o.kind === s.kind &&
              Math.abs(o.x + s.x) < 0.5 &&
              Math.abs(o.z - s.z) < 0.5,
          ),
          `${id}: ${s.name}`,
        ).toBe(true);
    }
  });

  test('every map offers income and every map but the smallest offers all three kinds', () => {
    for (const id of mapIds) {
      const kinds = new Set(MAPS[id].techSites.map((s) => s.kind));
      expect(kinds.has('derrick'), id).toBe(true);
      expect(kinds.has('fieldHospital'), id).toBe(true);
      if (id !== 'fjordmouth') expect(kinds.size, id).toBe(3);
    }
  });

  test('foundations keep clear of sites and troops walk around them', () => {
    const b = setup();
    const site = derrick(b);
    const box = siteFootprint(site);
    expect(movementObstacles(b)).toContainEqual(box);
    // A foundation just touching the clearance band is refused.
    const hq = b.entities.find((e) => e.owner === 'alice' && e.kind === 'hq')!;
    // An outpost of Alice's beside the site makes it a buildable area.
    const outpost = makeEntity(b, 'outpost', 'alice', 'blue', {
      x: site.x + 30,
      z: site.z + 30,
    });
    b.entities.push(outpost);
    expect(hq).toBeDefined();
    const near = {
      position: { x: site.x, z: box.maxZ + 4.4 + SITE_CLEARANCE - 1 },
      rotation: 0,
    };
    expect(placementError(b, 'alice', 'reactor', near)).toBe(
      'Keep tech sites clear.',
    );
  });

  test('an operation from before tech sites still runs without them', () => {
    const b = setup();
    delete b.sites;
    delete b.recon;
    post(b, { x: 14, z: 24 } as TechSite, 'ranger', 'alice', 2);
    expect(() => run(b, 3)).not.toThrow();
  });
});

describe('Tech site voice cues', () => {
  test('taking a site reuses the objective line; losing one, the under-attack line', () => {
    const director = new BattleAudioDirector();
    const b = setup();
    const snap = () => ({ ...structuredClone(b), id: 'sector' });
    director.update(snap(), 'alice');
    const site = derrick(b);
    b.tickAt += 1000;
    Object.assign(site, { team: 'blue', holder: 'alice' });
    expect(director.update(snap(), 'alice').cues).toContain('objective');
    b.tickAt += 1000;
    Object.assign(site, { capturing: 'red', progress: 1 });
    expect(director.update(snap(), 'alice').cues).toContain('underAttack');
    b.tickAt += 1000;
    Object.assign(site, { team: 'red', holder: 'hostile-1', progress: 0 });
    delete site.capturing;
    expect(director.update(snap(), 'alice').cues).toContain('underAttack');
  });
});

describe('Tech site sight', () => {
  test('a coalition-held site watches its ground for every commander', () => {
    const b = setup();
    const site = derrick(b);
    const foe = makeEntity(b, 'tank', 'hostile-1', 'red', {
      x: site.x + 20,
      z: site.z,
    });
    b.entities.push(foe);
    expect(visibleTo('alice', foe, b.entities, b)).toBe(false);
    Object.assign(site, { team: 'blue', holder: 'alice' });
    expect(visibleTo('alice', foe, b.entities, b)).toBe(true);
    site.team = 'red';
    expect(visibleTo('alice', foe, b.entities, b)).toBe(false);
  });
});
