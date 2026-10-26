import { describe, expect, test } from 'vitest';
import {
  CREDIT_CAP,
  SITE_CLEARANCE,
  SITE_RULES,
  TECH_SITES,
  availability,
  findPath,
  joinBattle,
  makeEntity,
  newBattle,
  purchase,
  researchAvailability,
  siteFootprint,
  startingCredits,
  tickBattle,
  type Battle,
  type BuildingKind,
} from '../lib/tactics';
import {
  DEFAULT_SKIRMISH_MODE,
  SKIRMISH_MODES,
  isSkirmishMode,
  skirmishModes,
} from '../lib/skirmish-modes';
import { DIFFICULTIES } from '../lib/tactical-difficulty';
import { MAPS, mapFor, mapIds } from '../lib/maps';
import {
  BUILDING_FOOTPRINTS,
  footprint,
  footprintSamples,
  footprintsOverlap,
} from '../lib/tactical-placement';
import { LocalSector, type SectorClock } from '../lib/local-sector';
import { persistedBattle, sectorView } from '../lib/tactical-sector';
import { parseLaunchSettings } from '../components/game/launch-settings';
import { tutorialFacts, tutorialSteps } from '../lib/tutorial';

const alice = { id: 'alice', name: 'Alice', culture: 'fjordborn' };
function megawealth(
  options: Partial<Parameters<typeof newBattle>[1]> = {},
): Battle {
  const b = newBattle(1000, { seed: 7, skirmish: 'megawealth', ...options });
  joinBattle(b, alice, 1000);
  return b;
}
function run(b: Battle, seconds: number) {
  const end = b.tickAt + seconds * 1000;
  while (b.tickAt < end) tickBattle(b, Math.min(end, b.tickAt + 250));
}
const derricks = (b: Battle) => b.sites!.filter((s) => s.kind === 'derrick');

describe('skirmish mode table', () => {
  test('every mode has a name, tagline, description and rules; standard is the default', () => {
    expect(DEFAULT_SKIRMISH_MODE).toBe('standard');
    expect(skirmishModes).toEqual(['standard', 'megawealth']);
    for (const mode of skirmishModes) {
      const row = SKIRMISH_MODES[mode];
      expect(row.name.length).toBeGreaterThan(2);
      expect(row.tagline.length).toBeGreaterThan(2);
      expect(row.description.length).toBeGreaterThan(20);
      expect(row.rules.derrickIncome).toBeGreaterThan(0);
    }
    expect(SKIRMISH_MODES.standard.rules.derrickIncome).toBe(
      TECH_SITES.derrick.income,
    );
    expect(isSkirmishMode('megawealth')).toBe(true);
    expect(isSkirmishMode('kingofthehill')).toBe(false);
    expect(isSkirmishMode(undefined)).toBe(false);
  });
});

describe('standard rules are unchanged', () => {
  test('naming the standard mode builds the very same battle as leaving it out', () => {
    for (const mapId of mapIds) {
      const plain = newBattle(1000, { seed: 11, mapId });
      const named = newBattle(1000, { seed: 11, mapId, skirmish: 'standard' });
      expect(named).toEqual(plain);
      expect('skirmish' in plain).toBe(false);
      expect('garrisonFunds' in plain).toBe(false);
      // The map's own tech sites, every seam, and a refinery in each stronghold.
      expect(plain.sites!.map((s) => s.name)).toEqual(
        MAPS[mapId].techSites.map((s) => s.name),
      );
      expect(plain.deposits!.length).toBeGreaterThan(MAPS[mapId].ore.length);
      expect(plain.entities.some((e) => e.kind === 'refinery')).toBe(true);
      expect(persistedBattle(plain)).not.toHaveProperty('skirmish');
    }
  });

  test('a standard commander keeps the difficulty credits, refinery, harvester and derrick pay', () => {
    const b = newBattle(1000, { seed: 7 });
    joinBattle(b, alice, 1000);
    expect(b.commanders[0].credits).toBe(DIFFICULTIES.normal.credits);
    expect(startingCredits(b)).toBe(DIFFICULTIES.normal.credits);
    expect(availability(b, 'alice', 'refinery') ?? '').not.toMatch(/Not in/);
    expect(availability(b, 'alice', 'factory')).toBe('Requires Ore refinery');
    expect(researchAvailability(b, 'alice', 'logistics') ?? '').not.toMatch(
      /Not in/,
    );
    expect(b.sites!.every((s) => !s.team)).toBe(true);
  });
});

describe('Megawealth world', () => {
  test('no seams anywhere and no refinery in any stronghold', () => {
    for (const mapId of mapIds) {
      const b = megawealth({
        mapId,
        enemyCount: MAPS[mapId].capacity.enemies,
      });
      expect(b.deposits).toEqual([]);
      expect(b.entities.some((e) => e.kind === 'refinery')).toBe(false);
      expect(b.entities.some((e) => e.kind === 'harvester')).toBe(false);
    }
  });

  for (const mapId of mapIds)
    test(`${mapId}: every seam becomes a derrick placed like a hand-built site`, () => {
      const map = mapFor(mapId);
      const { landings, strongholds, ore, props, billboards } = map.design;
      const enemyCount = MAPS[mapId].capacity.enemies;
      const b = megawealth({ mapId, enemyCount });
      const sites = b.sites!;
      // The map's own sites stay, plus one per landing, one per army and most seams.
      expect(
        sites.slice(0, MAPS[mapId].techSites.length).map((s) => s.name),
      ).toEqual(MAPS[mapId].techSites.map((s) => s.name));
      const extra = sites.length - MAPS[mapId].techSites.length;
      expect(extra).toBeGreaterThanOrEqual(
        landings.length + enemyCount + Math.ceil(ore.length / 2),
      );
      for (let slot = 0; slot < landings.length; slot++)
        expect(sites.filter((s) => s.home === `landing-${slot}`)).toHaveLength(
          1,
        );
      for (let i = 1; i <= enemyCount; i++)
        expect(sites.filter((s) => s.home === `hostile-${i}`)).toHaveLength(1);
      expect(new Set(sites.map((s) => s.id)).size).toBe(sites.length);
      const obstacles = sites.map(siteFootprint);
      const foundations = b.entities
        .filter((e) => e.kind in BUILDING_FOOTPRINTS)
        .map((e) => footprint(e.kind as BuildingKind, e, e.angle));
      for (const s of sites) {
        const box = siteFootprint(s);
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
            `${s.name} on a crossing`,
          ).not.toContain(map.terrainAt(q.x, q.z));
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
        for (const p of [...props, ...billboards])
          expect(
            footprintsOverlap(
              box,
              { minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z },
              4,
            ),
            `${s.name} prop`,
          ).toBe(false);
        // Hostile foundations keep clear of the structure, like a player's would.
        for (const f of foundations)
          expect(
            footprintsOverlap(box, f, SITE_CLEARANCE),
            `${s.name} under a foundation`,
          ).toBe(false);
        for (const o of sites)
          if (o !== s)
            expect(
              Math.hypot(o.x - s.x, o.z - s.z),
              `${s.name} shares a ring with ${o.name}`,
            ).toBeGreaterThan(SITE_RULES.captureRadius * 2);
        // The first landing and every army can walk up to it from some side.
        const doors = [
          { x: s.x, z: box.maxZ + 4 },
          { x: s.x, z: box.minZ - 4 },
          { x: box.minX - 4, z: s.z },
          { x: box.maxX + 4, z: s.z },
        ].filter((d) => map.groundAt(d.x, d.z));
        expect(doors.length, `${s.name} approach`).toBeGreaterThan(0);
        for (const p of [landings[0], ...strongholds.slice(0, enemyCount)])
          expect(
            doors.some(
              (door) => findPath(p, door, false, obstacles, map).length > 0,
            ),
            `${s.name} from ${p.x},${p.z}`,
          ).toBe(true);
      }
    });

  test('the layout is deterministic per seed and differs from the standard one', () => {
    const a = newBattle(1000, {
      seed: 5,
      mapId: 'ironpass',
      skirmish: 'megawealth',
    });
    const b = newBattle(1000, {
      seed: 5,
      mapId: 'ironpass',
      skirmish: 'megawealth',
    });
    expect(a).toEqual(b);
    expect(a.skirmish).toBe('megawealth');
    const standard = newBattle(1000, { seed: 5, mapId: 'ironpass' });
    expect(standard.sites!.length).toBeLessThan(a.sites!.length);
  });
});

describe('Megawealth economy', () => {
  test('each side starts on its own derrick; the commander gets doubled starting credits', () => {
    const b = megawealth({ difficulty: 'hard' });
    const own = derricks(b).filter((s) => s.holder === 'alice');
    expect(own.map((s) => s.home)).toEqual(['landing-0']);
    expect(own[0].team).toBe('blue');
    const hostile = derricks(b).filter((s) => s.team === 'red');
    expect(hostile.map((s) => s.holder)).toEqual(['hostile-1']);
    expect(b.commanders[0].credits).toBe(DIFFICULTIES.hard.credits * 2);
    // The rest are open ground to fight over.
    expect(derricks(b).filter((s) => !s.team).length).toBeGreaterThan(5);
    // The opening log carries no capture lines for the handed-out derricks.
    expect(b.events.some((e) => /captured/.test(e.text))).toBe(false);
  });

  test('refineries, harvesters and harvester research are out; the works needs a hall', () => {
    const b = megawealth();
    for (const kind of ['refinery', 'harvester'] as const) {
      expect(availability(b, 'alice', kind)).toMatch(/^Not in Megawealth/);
      expect(() =>
        purchase(b, 'alice', kind, 1000, {
          position: { x: b.entities[0].x + 20, z: b.entities[0].z },
          rotation: 0,
        }),
      ).toThrow(/Not in Megawealth/);
    }
    for (const key of ['logistics', 'drills'] as const)
      expect(researchAvailability(b, 'alice', key)).toMatch(
        /^Not in Megawealth/,
      );
    expect(availability(b, 'alice', 'factory')).toBe('Requires Jæger hall');
  });

  test('a refinery finished anyway delivers no harvester', () => {
    const b = megawealth();
    const hq = b.entities.find((e) => e.owner === 'alice' && e.kind === 'hq')!;
    const refinery = makeEntity(b, 'refinery', 'alice', 'blue', {
      x: hq.x + 24,
      z: hq.z,
    });
    refinery.readyAt = b.tickAt + 250;
    b.entities.push(refinery);
    run(b, 2);
    expect(b.entities.some((e) => e.kind === 'harvester')).toBe(false);
  });

  test('derricks pay the mode income; that is the only income beside the command station', () => {
    const b = megawealth();
    b.nextWaveAt = Infinity;
    const start = b.commanders[0].credits;
    run(b, TECH_SITES.derrick.pulseSeconds + 0.25);
    const gained = b.commanders[0].credits - start;
    const income = SKIRMISH_MODES.megawealth.rules.derrickIncome;
    expect(gained).toBeGreaterThanOrEqual(income);
    expect(gained).toBeLessThan(income + 15);
    expect(b.commanders[0].credits).toBeLessThanOrEqual(CREDIT_CAP);
    expect(b.events.some((e) => e.text.includes(`+${income} credits`))).toBe(
      false,
    );
  });

  test('the garrison pays for its troops and banks its derricks', () => {
    const b = megawealth();
    b.nextWaveAt = Infinity;
    expect(b.garrisonFunds).toEqual({
      'hostile-1': SKIRMISH_MODES.megawealth.rules.garrison.credits,
    });
    // Broke: production lines wait unstarted.
    b.garrisonFunds!['hostile-1'] = 0;
    b.sites = b.sites!.filter((s) => s.team !== 'red');
    run(b, 1);
    const waiting = (b.hostileTraining ?? []).filter(
      (q) => q.owner === 'hostile-1',
    );
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting.every((q) => q.readyAt === 0)).toBe(true);
    // A held derrick pays the war chest, and the lines start once it can pay.
    const site = derricks(b).find((s) => !s.team)!;
    Object.assign(site, {
      team: 'red',
      holder: 'hostile-1',
      pulseAt: b.tickAt + 250,
    });
    const before = b.garrisonFunds!['hostile-1'];
    run(b, 0.5);
    expect(b.garrisonFunds!['hostile-1'] + 1e-6).toBeGreaterThan(before);
    run(b, 20);
    expect(
      (b.hostileTraining ?? []).some(
        (q) => q.owner === 'hostile-1' && q.readyAt > 0,
      ),
    ).toBe(true);
  });

  test('the garrison sends detachments to derricks first and more often', () => {
    const b = megawealth();
    b.nextWaveAt = Infinity;
    // Let the home guard muster, then watch the first duty.
    run(b, 120);
    const duty = b.sites!.filter((s) => s.squad?.length);
    expect(duty.length).toBeGreaterThan(0);
    expect(duty.every((s) => s.kind === 'derrick')).toBe(true);
    const standard = newBattle(1000, { seed: 7 });
    joinBattle(standard, alice, 1000);
    standard.nextWaveAt = Infinity;
    run(standard, 120);
    expect(b.sites!.filter((s) => s.team === 'red').length).toBeGreaterThan(
      standard.sites!.filter((s) => s.team === 'red').length,
    );
  });

  test('the tutorial asks for a derrick instead of a refinery', () => {
    const b = megawealth();
    const steps = tutorialSteps(b);
    expect(steps[1].title).toBe('Take an oil derrick');
    expect(steps[1].target).toBeUndefined();
    const idle = { trained: false, commanded: false };
    expect(tutorialFacts(b, 'alice', idle).refinery).toBe(false);
    Object.assign(
      derricks(b).find((s) => !s.team)!,
      {
        team: 'blue',
        holder: 'alice',
      },
    );
    expect(tutorialFacts(b, 'alice', idle).refinery).toBe(true);
    expect(tutorialSteps({})[1].title).toBe('Build an ore refinery');
  });
});

describe('solo launches and saves', () => {
  const clock: SectorClock = {
    now: () => 5000,
    schedule: () => 0,
    cancel: () => {},
  };
  const options = {
    difficulty: 'normal' as const,
    mapId: 'fjordmouth' as const,
    enemyCount: 1,
    seed: 3,
  };

  test('a launch without a mode is standard; with one it is saved and restored', () => {
    const plain = LocalSector.launch('s1', alice, options, clock);
    expect(plain.battle.skirmish).toBeUndefined();
    expect(plain.summary()!.skirmish).toBeUndefined();
    const mega = LocalSector.launch(
      's2',
      alice,
      { ...options, mode: 'megawealth' },
      clock,
    );
    expect(mega.battle.skirmish).toBe('megawealth');
    const restored = LocalSector.restore(structuredClone(mega.save()), clock);
    expect(restored.battle.skirmish).toBe('megawealth');
    expect(restored.battle.garrisonFunds).toEqual(mega.battle.garrisonFunds);
    expect(restored.summary()!.skirmish).toBe('megawealth');
    // The commander sees the mode but never the garrison's war chest.
    const view = restored.view()!;
    expect(view.skirmish).toBe('megawealth');
    expect(view).not.toHaveProperty('garrisonFunds');
  });

  test('a save from before modes loads and plays as standard', () => {
    const live = LocalSector.launch('old', alice, options, clock);
    const save = structuredClone(live.save());
    delete (save.battle as Partial<Battle>).skirmish;
    delete (save.battle as Partial<Battle>).garrisonFunds;
    for (const site of save.battle.sites ?? []) delete site.home;
    const restored = LocalSector.restore(save, clock);
    expect(restored.summary()!.skirmish).toBeUndefined();
    expect(
      availability(restored.battle, 'alice', 'refinery') ?? '',
    ).not.toMatch(/Not in/);
    expect(() => tickBattle(restored.battle, 5250)).not.toThrow();
    expect(sectorView(restored.battle, 'alice', 5250, [])).not.toHaveProperty(
      'skirmish',
    );
  });

  test('launch settings remember the mode and default old settings to standard', () => {
    expect(
      parseLaunchSettings(
        JSON.stringify({
          mapId: 'ironpass',
          difficulty: 'hard',
          enemyCount: 2,
        }),
      ),
    ).toEqual({
      mapId: 'ironpass',
      difficulty: 'hard',
      enemyCount: 2,
      mode: 'standard',
    });
    expect(
      parseLaunchSettings(JSON.stringify({ mode: 'megawealth' })).mode,
    ).toBe('megawealth');
    expect(
      parseLaunchSettings(JSON.stringify({ mode: 'gold rush' })).mode,
    ).toBe('standard');
    expect(parseLaunchSettings(null).mode).toBe('standard');
  });
});
