import { BANK_WIDTH } from './compile';
import type {
  CrossingDesign,
  CrossingStyle,
  Point,
  Polygon,
  RiverDesign,
} from './types';

/**
 * Small authoring helpers for the hand-built maps. They run once when a map
 * module loads and round their results, so every runtime reads plain numbers.
 */
const round = (v: number, step: number) => Math.round(v / step) * step;

/** A wobbly ellipse outline, for tarns, islands and hill tops. */
export function ellipse(
  x: number,
  z: number,
  rx: number,
  rz: number,
  points = 12,
  wobble = 0.08,
): Polygon {
  return Array.from({ length: points }, (_, i) => {
    const a = (i / points) * Math.PI * 2;
    const r = 1 + wobble * Math.sin(a * 3 + x * 0.1) + wobble * 0.5 * Math.cos(a * 5);
    return {
      x: round(x + Math.cos(a) * rx * r, 0.1),
      z: round(z + Math.sin(a) * rz * r, 0.1),
    };
  });
}

/** Where a river passes a given x (west-east rivers) or z (north-south rivers). */
export function riverAt(river: RiverDesign, at: { x: number } | { z: number }) {
  const key = 'x' in at ? 'x' : 'z';
  const value = 'x' in at ? at.x : at.z;
  const widths = river.width;
  for (let i = 1; i < river.path.length; i++) {
    const a = river.path[i - 1],
      b = river.path[i];
    const lo = Math.min(a[key], b[key]),
      hi = Math.max(a[key], b[key]);
    if (value < lo || value > hi || hi === lo) continue;
    const t = (value - a[key]) / (b[key] - a[key]);
    const width =
      typeof widths === 'number'
        ? widths
        : widths[i - 1] + (widths[i] - widths[i - 1]) * t;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      tx: (b.x - a.x) / length,
      tz: (b.z - a.z) / length,
      width,
    };
  }
  throw new Error(`River does not pass ${key} = ${value}`);
}

/** A crossing square to the river at that point, spanning water, banks and approaches. */
export function crossing(
  river: RiverDesign,
  at: { x: number } | { z: number },
  props: {
    id: string;
    name: string;
    style: CrossingStyle;
    width: number;
    /** Extra deck beyond each bank, in metres. */
    approach?: number;
  },
): CrossingDesign {
  const p = riverAt(river, at);
  const approach = props.approach ?? 4;
  return {
    id: props.id,
    name: props.name,
    style: props.style,
    width: props.width,
    x: round(p.x, 0.01),
    z: round(p.z, 0.01),
    angle: round(Math.atan2(-p.tz, p.tx), 0.001),
    length: round(p.width + 2 * (BANK_WIDTH + approach), 0.1),
  };
}

export const pt = (x: number, z: number): Point => ({ x, z });
/** Points from a flat list: [x0, z0, x1, z1, ...]. */
export const path = (...coords: number[]): Point[] =>
  Array.from({ length: coords.length / 2 }, (_, i) => ({
    x: coords[i * 2],
    z: coords[i * 2 + 1],
  }));

/**
 * Road waypoints that carry a road straight along a crossing's deck: both deck
 * ends, extended `run` metres onto the approach, the end nearest `from` first.
 * A road that meets a deck at a skew would run off its side.
 */
export function overDeck(c: CrossingDesign, from: Point, run = 3): Point[] {
  const half = c.length / 2 + run;
  const sin = Math.sin(c.angle),
    cos = Math.cos(c.angle);
  const a = { x: round(c.x - sin * half, 0.01), z: round(c.z - cos * half, 0.01) };
  const b = { x: round(c.x + sin * half, 0.01), z: round(c.z + cos * half, 0.01) };
  return Math.hypot(a.x - from.x, a.z - from.z) <= Math.hypot(b.x - from.x, b.z - from.z)
    ? [a, b]
    : [b, a];
}
