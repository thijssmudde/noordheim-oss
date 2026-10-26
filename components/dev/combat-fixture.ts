import {
  joinBattle,
  makeEntity,
  newBattle,
  type EntityKind,
} from '../../lib/tactics';
import { terrainFor } from '../../lib/tactical-terrain';
import type { MapId } from '../../lib/battlefields';

/** Isolated local skirmish. Uses real tickBattle damage/movement, never a backend mutation. */
export function combatFixture(seed: number, mapId: MapId, startedAt = 1000) {
  const b = newBattle(startedAt, { seed, mapId, enemyCount: 1 });
  joinBattle(
    b,
    { id: 'art', name: 'Art review', culture: 'fjordborn' },
    startedAt,
  );
  b.entities = b.entities.filter((e) => e.kind === 'hq');
  b.hostileTraining = [];
  b.nextWaveAt = 1e12;
  const map = terrainFor(b),
    home = map.baseAt(b.commanders[0].slot);
  const kinds: EntityKind[] = [
    'tank',
    'lynx',
    'ranger',
    'ranger',
    'rocket',
    'ranger',
    'howitzer',
  ];
  for (const team of ['blue', 'red'] as const)
    kinds.forEach((kind, i) => {
      // The skirmish plays out in front of (north of) the landing, clear of the
      // command station's footprint.
      const p = {
        x: home.x + (i - 3) * 4.2,
        z:
          home.z -
          (kind === 'howitzer'
            ? team === 'blue'
              ? 12
              : 44
            : team === 'blue'
              ? 20
              : 33),
      };
      if (!map.groundAt(p.x, p.z)) return;
      const e = makeEntity(
        b,
        kind,
        team === 'blue' ? 'art' : 'hostile',
        team,
        p,
      );
      e.order = 'hold';
      e.angle = team === 'blue' ? Math.PI : 0;
      b.entities.push(e);
    });
  return b;
}
