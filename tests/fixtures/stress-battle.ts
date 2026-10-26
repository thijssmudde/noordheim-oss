import {
  newBattle,
  joinBattle,
  makeEntity,
  commandLimit,
  harvesterLimit,
  HOSTILE_ARMY_BUDGET,
  BATTLE_ENTITY_LIMIT,
  STRUCTURE_LIMIT,
  isUnit,
  type BuildingKind,
  type UnitKind,
  type Battle,
} from '../../lib/tactics';
import {
  footprint,
  footprintsOverlap,
  insideFootprint,
} from '../../lib/tactical-placement';
import { terrainFor } from '../../lib/tactical-terrain';
import type { MapId } from '../../lib/battlefields';

/** Deterministic full-lobby load, containing no player data. */
export function stressBattle(
  mapId: MapId = 'nordlys',
  enemyCount = 8,
  players = 8,
): Battle {
  const b = newBattle(1000, {
    seed: 947,
    difficulty: 'brutal',
    mapId,
    enemyCount,
    playerSlots: players,
  });
  const terrain = terrainFor(b);
  for (let i = 0; i < players; i++)
    joinBattle(
      b,
      { id: `bench${i}`, name: `Benchmark ${i}`, culture: 'neutral' },
      1000,
    );
  const place = (
    owner: string,
    team: 'red' | 'blue',
    kind: UnitKind,
    i: number,
  ) => {
    const hq = b.entities.find((e) => e.owner === owner && e.kind === 'hq')!;
    let x = hq.x,
      z = hq.z;
    for (let attempt = 0; attempt < 100; attempt++) {
      x = hq.x - 30 + ((i + attempt) % 12) * 5;
      z = hq.z + 24 + Math.floor((i + attempt) / 12) * 5;
      if (terrain.groundAt(x, z)) break;
    }
    const e = makeEntity(b, kind, owner, team, { x, z });
    if (team === 'red') e.order = 'attackMove';
    b.entities.push(e);
  };
  for (const c of b.commanders) {
    for (let i = 3; i < commandLimit(b); i++)
      place(
        c.id,
        'blue',
        (['ranger', 'tank', 'howitzer', 'rocket'] as const)[i % 4],
        i,
      );
    for (let i = 0; i < harvesterLimit(b, c.id); i++)
      place(c.id, 'blue', 'harvester', i + 30);
  }
  // Hostile training stops at the battlefield limit, as battleHasRoom enforces.
  const hostiles = Math.min(
    HOSTILE_ARMY_BUDGET(b),
    BATTLE_ENTITY_LIMIT - b.entities.length,
  );
  for (let i = 0; i < hostiles; i++)
    place(
      `hostile-${1 + (i % enemyCount)}`,
      'red',
      (['ranger', 'tank', 'rocket', 'gunship'] as const)[i % 4],
      Math.floor(i / enemyCount),
    );
  // Fill remaining space with completed foundations, spreading them around human bases.
  const target = Math.min(
    BATTLE_ENTITY_LIMIT,
    b.entities.length + (STRUCTURE_LIMIT - 1) * players,
  );
  for (let i = 0; b.entities.length < target; i++) {
    const c = b.commanders[i % players],
      hq = b.entities.find((e) => e.owner === c.id && e.kind === 'hq')!;
    const row = Math.floor(i / players);
    // Larger bases spread inland instead of running out of land at the coast.
    const p = {
      x: hq.x - 126 + (row % 15) * 18,
      z: hq.z + 40 - Math.floor(row / 15) * 18,
    };
    const kind = row % 3 === 0 ? 'refinery' : 'reactor';
    const box = footprint(kind, p, 0);
    // Foundations never wall troops into a pocket: keep a lane around each one.
    if (
      !terrain.buildableAt(p.x, p.z) ||
      b.entities.some((e) =>
        isUnit(e.kind)
          ? insideFootprint(e, box, 4)
          : footprintsOverlap(box, footprint(e.kind as BuildingKind, e, e.angle), 4),
      )
    ) {
      if (i > 3000) throw new Error('Fixture cannot fit');
      continue;
    }
    b.entities.push(makeEntity(b, kind, c.id, 'blue', p));
  }
  return b;
}
