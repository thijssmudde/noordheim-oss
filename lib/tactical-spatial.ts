import type { Entity, Point } from './tactics';

/** Mutable tick-local buckets: units that cross a cell stay discoverable immediately. */
export class TacticalSpatialIndex {
  private buckets = new Map<string, Set<Entity>>();
  private locations = new Map<Entity, string>();
  constructor(entities: Entity[]) {
    for (const e of entities) this.update(e);
  }
  update(e: Entity) {
    const key = `${Math.floor(e.x / 32)},${Math.floor(e.z / 32)}`;
    const previous = this.locations.get(e);
    if (previous === key) return;
    if (previous) this.buckets.get(previous)?.delete(e);
    let bucket = this.buckets.get(key);
    if (!bucket) this.buckets.set(key, (bucket = new Set()));
    bucket.add(e);
    this.locations.set(e, key);
  }
  *near(p: Point, radius: number) {
    for (
      let x = Math.floor((p.x - radius) / 32);
      x <= Math.floor((p.x + radius) / 32);
      x++
    )
      for (
        let z = Math.floor((p.z - radius) / 32);
        z <= Math.floor((p.z + radius) / 32);
        z++
      )
        yield* this.buckets.get(`${x},${z}`) ?? [];
  }
}
