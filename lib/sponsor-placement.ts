import type { BillboardDesign, CompiledMap, Point } from './maps/types';
import { cameraOffset } from './tactical-camera';
import { FLAG_RADIUS, flagSpot } from './tactical-flags';
import { footprintsOverlap, type Footprint } from './tactical-placement';

/** The opening camera (`components/game/tactical-camera.tsx`): focus 8 m north of the landing. */
export const HOME_VIEW = {
  distance: 66,
  yaw: -Math.PI / 5,
  fov: 44,
  groundY: 0.65,
  focusOffset: -8,
};

/**
 * The part of a 1440 × 900 screen that no HUD panel covers: left of the
 * sidebar, right of the objectives column, below the top bar, above the
 * command deck.
 */
export const PLAYFIELD = { width: 1440, height: 900, x0: 240, x1: 1170, y0: 70, y1: 740 };

/** The in-world size of the landing billboard, larger than authored hoardings. */
export const HOME_BOARD_SCALE = 1.45;

type Camera = {
  position: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  forward: [number, number, number];
  focal: number;
  aspect: number;
};

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: number[]): [number, number, number] => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The opening camera for a landing, as plain vectors (the simulation runs without three.js). */
export function homeCamera(landing: Point, aspect = PLAYFIELD.width / PLAYFIELD.height): Camera {
  const focus = [landing.x, HOME_VIEW.groundY, landing.z + HOME_VIEW.focusOffset];
  const o = cameraOffset(HOME_VIEW.distance, HOME_VIEW.yaw);
  const position: [number, number, number] = [focus[0] + o.x, focus[1] + o.y, focus[2] + o.z];
  const forward = unit(sub(focus, position));
  const right = unit(cross(forward, [0, 1, 0]));
  return {
    position,
    forward,
    right,
    up: cross(right, forward),
    focal: 1 / Math.tan(((HOME_VIEW.fov / 2) * Math.PI) / 180),
    aspect,
  };
}

/** Screen pixels (in the 1440 × 900 frame) of a world point, or null when behind the camera. */
export function toScreen(camera: Camera, x: number, y: number, z: number) {
  const d = sub([x, y, z], camera.position);
  const depth = dot(d, camera.forward);
  if (depth <= 0.1) return null;
  const nx = (dot(d, camera.right) * camera.focal) / (depth * camera.aspect);
  const ny = (dot(d, camera.up) * camera.focal) / depth;
  return {
    x: ((nx + 1) / 2) * PLAYFIELD.width,
    y: ((1 - ny) / 2) * PLAYFIELD.height,
  };
}

/** True when a billboard's poster centre is on the uncovered playfield. */
export function inPlayfield(
  camera: Camera,
  map: Pick<CompiledMap, 'heightAt'>,
  b: Point,
) {
  const p = toScreen(camera, b.x, map.heightAt(b.x, b.z) + 5, b.z);
  return (
    !!p &&
    p.x > PLAYFIELD.x0 &&
    p.x < PLAYFIELD.x1 &&
    p.y > PLAYFIELD.y0 &&
    p.y < PLAYFIELD.y1
  );
}

/**
 * One billboard per landing, where the commander sees it the moment the
 * battle opens: in the upper band of the playfield, on dry land at the edge
 * of the base pad, clear of the home ore field, props and other boards.
 * Deterministic, so every player's board stands in the same place.
 */
type PlacementMap = Pick<
  CompiledMap,
  'design' | 'heightAt' | 'groundAt' | 'wetAt' | 'homeOreAt'
>;
const placed = new WeakMap<object, BillboardDesign[][]>();

/** Ranked spots for every landing's billboard, best first (memoized per map). */
export function homeBillboardSpots(map: PlacementMap): BillboardDesign[][] {
  let spots = placed.get(map.design);
  if (!spots) placed.set(map.design, (spots = placeHomeBillboards(map)));
  return spots;
}

/** Each landing's billboard on open ground: its best spot. */
export const homeBillboards = (map: PlacementMap) =>
  homeBillboardSpots(map).flatMap((spots) => spots.slice(0, 1));

/** Ground a billboard's posts and apron take: kept clear of foundations. */
export function billboardBounds(b: BillboardDesign) {
  const scale = b.scale ?? 1;
  // Half the poster's width and the depth its lean and posts take, in metres.
  const w = (b.size === 'tower' ? 3 : b.size === 'banner' ? 6.3 : 5.3) * scale,
    d = 2 * scale;
  const c = Math.abs(Math.cos(b.angle)),
    s = Math.abs(Math.sin(b.angle));
  const dx = c * w + s * d,
    dz = s * w + c * d;
  return { minX: b.x - dx, maxX: b.x + dx, minZ: b.z - dz, maxZ: b.z + dz };
}

const SPOTS_PER_LANDING = 10;

function placeHomeBillboards(map: PlacementMap): BillboardDesign[][] {
  const taken: Point[] = [...map.design.billboards];
  return map.design.landings.map((landing, slot) => {
    const camera = homeCamera(landing);
    const ore = map.homeOreAt(slot);
    // The commander's flag zone, found by the same rule the battle uses.
    const flag = flagSpot(
      map as CompiledMap,
      landing,
      Math.PI,
      (p) => Math.hypot(p.x - ore.x, p.z - ore.z) >= FLAG_RADIUS + 8,
    );
    const candidates: { p: Point; score: number }[] = [];
    for (let radius = 24; radius <= 58; radius += 2)
      for (let step = 0; step < 72; step++) {
        const a = (step / 72) * Math.PI * 2;
        const p = { x: landing.x + Math.cos(a) * radius, z: landing.z + Math.sin(a) * radius };
        if (!map.groundAt(p.x, p.z) || map.wetAt(p.x, p.z)) continue;
        const clear = (q: Point, d: number) => Math.hypot(q.x - p.x, q.z - p.z) >= d;
        if (!clear(ore, 16) || !taken.every((q) => clear(q, 14))) continue;
        if (flag && !clear(flag, FLAG_RADIUS + 6)) continue;
        if (!map.design.props.every((q) => clear(q, 9))) continue;
        const y = map.heightAt(p.x, p.z);
        const centre = toScreen(camera, p.x, y + 5, p.z);
        const top = toScreen(camera, p.x, y + 12, p.z);
        if (!centre || !top) continue;
        // Upper two-thirds of the playfield, where the board never hides the base.
        if (top.y < PLAYFIELD.y0 + 30 || centre.y > 520) continue;
        if (centre.x < PLAYFIELD.x0 + 90 || centre.x > PLAYFIELD.x1 - 90) continue;
        // Best upper right: clear of the objectives column and of the ore
        // field the harvesters work on the left.
        const score =
          radius * 0.5 - Math.abs(centre.x - 900) * 0.1 - Math.abs(centre.y - 260) * 0.04;
        candidates.push({ p, score });
      }
    // Spread the fallbacks out, so one building never covers two of them.
    const spots: Point[] = [];
    for (const { p } of candidates.sort((a, b) => b.score - a.score)) {
      if (spots.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= 10)) spots.push(p);
      if (spots.length === SPOTS_PER_LANDING) break;
    }
    if (spots[0]) taken.push(...spots);
    return spots.map((p) => ({
      x: Math.round(p.x * 10) / 10,
      z: Math.round(p.z * 10) / 10,
      angle: HOME_VIEW.yaw,
      size: 'hoarding' as const,
      scale: HOME_BOARD_SCALE,
    }));
  });
}

/**
 * Every billboard standing right now, with its rotation index: the authored
 * boards always, and each landing's board on its best spot that no structure
 * stands on. Billboards never block construction; when a commander builds on
 * a board's ground it moves to the next spot in view (or, with none left,
 * comes down).
 */
export function standingBillboards(map: PlacementMap, occupied: readonly Footprint[] = []) {
  const authored = map.design.billboards;
  const free = (b: BillboardDesign) =>
    !occupied.some((box) => footprintsOverlap(box, billboardBounds(b)));
  return [
    ...authored.map((board, index) => ({ board, index })),
    ...homeBillboardSpots(map).flatMap((spots, i) => {
      const board = spots.find(free);
      return board ? [{ board, index: authored.length + i }] : [];
    }),
  ];
}
