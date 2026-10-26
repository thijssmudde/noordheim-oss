import { expect, test } from 'vitest';
import { mapIds } from '../lib/battlefields';
import { mapFor } from '../lib/maps';
import {
  billboardBounds,
  homeBillboardSpots,
  homeBillboards,
  homeCamera,
  inPlayfield,
  standingBillboards,
} from '../lib/sponsor-placement';
import { joinBattle, newBattle, placementError } from '../lib/tactics';
import { footprint, footprintsOverlap } from '../lib/tactical-placement';

test('from the opening camera, every landing on every map shows a billboard (none did before)', () => {
  for (const id of mapIds) {
    const map = mapFor(id);
    const home = homeBillboards(map);
    expect(home).toHaveLength(map.design.landings.length);
    map.design.landings.forEach((landing) => {
      const camera = homeCamera(landing);
      // The authored boards stand out on the map, away from the bases.
      expect(map.design.billboards.some((b) => inPlayfield(camera, map, b))).toBe(false);
      expect(home.some((b) => inPlayfield(camera, map, b))).toBe(true);
    });
    // Every fallback spot is in view too.
    homeBillboardSpots(map).forEach((spots, i) => {
      expect(spots.length).toBeGreaterThanOrEqual(3);
      const camera = homeCamera(map.design.landings[i]);
      for (const spot of spots) expect(inPlayfield(camera, map, spot)).toBe(true);
    });
    for (const b of home) {
      expect(map.groundAt(b.x, b.z) && !map.wetAt(b.x, b.z)).toBe(true);
      for (const other of [...map.design.billboards, ...home])
        if (other !== b) expect(footprintsOverlap(billboardBounds(b), billboardBounds(other))).toBe(false);
    }
  }
});

test('placement is deterministic, never blocks construction, and a building takes the home board down', () => {
  const battle = newBattle(1000, { seed: 947, mapId: 'fjordmouth' });
  joinBattle(battle, { id: 'p', name: 'P', culture: 'neutral' }, 1000);
  const map = mapFor('fjordmouth');
  const [board] = homeBillboards(map);
  expect(homeBillboards(mapFor('fjordmouth'))[0]).toEqual(board);
  const placement = { position: { x: board.x, z: board.z }, rotation: 0 };
  expect(placementError(battle, 'p', 'refinery', placement) ?? '').not.toMatch(/billboard/i);
  const authored = map.design.billboards.length;
  expect(standingBillboards(map)).toHaveLength(authored + map.design.landings.length);
  // A refinery on the board's ground moves it to the next spot, still in view.
  const onBoard = [footprint('refinery', placement.position, 0)];
  const standing = standingBillboards(map, onBoard);
  expect(standing).toHaveLength(authored + map.design.landings.length);
  const moved = standing.find((s) => s.index === authored)!.board;
  expect(moved).not.toEqual(board);
  expect(footprintsOverlap(onBoard[0], billboardBounds(moved))).toBe(false);
  expect(inPlayfield(homeCamera(map.design.landings[0]), map, moved)).toBe(true);
  // With every spot built over, the board comes down; rotation indices stay stable.
  const everywhere = homeBillboardSpots(map)[0].map((b) => footprint('refinery', b, 0));
  const crowded = standingBillboards(map, everywhere);
  expect(crowded.map((s) => s.index)).not.toContain(authored);
  expect(crowded.at(-1)?.index).toBe(authored + map.design.landings.length - 1);
});
