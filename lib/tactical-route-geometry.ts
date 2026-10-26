import {
  BufferGeometry,
  Float32BufferAttribute,
  DynamicDrawUsage,
} from 'three';
import type { Point } from './tactics';

/** Reuses GPU buffers while a selected troop advances along its approved route. */
export class TacticalRouteGeometry extends BufferGeometry {
  private points = new Float32BufferAttribute(
    new Float32Array(16 * 3),
    3,
  ).setUsage(DynamicDrawUsage);
  private path: readonly Point[] = [];

  constructor() {
    super();
    this.setAttribute('position', this.points);
    this.setDrawRange(0, 0);
  }

  update(
    start: Point & { y: number },
    path: readonly Point[],
    heightAt: (x: number, z: number) => number,
  ) {
    const changed =
      path.length !== this.path.length ||
      (path !== this.path &&
        path.some((p, i) => p.x !== this.path[i].x || p.z !== this.path[i].z));
    this.path = path;
    if (!path.length) {
      this.setDrawRange(0, 0);
      return;
    }
    if (path.length + 1 > this.points.count) {
      // Release the old GPU allocation only when capacity actually grows.
      this.dispose();
      this.points = new Float32BufferAttribute(
        new Float32Array(Math.max(this.points.count * 2, path.length + 1) * 3),
        3,
      ).setUsage(DynamicDrawUsage);
      this.setAttribute('position', this.points);
    }
    this.points.clearUpdateRanges();
    this.points.setXYZ(0, start.x, start.y + 0.2, start.z);
    if (changed) {
      path.forEach((p, i) =>
        this.points.setXYZ(i + 1, p.x, heightAt(p.x, p.z) + 0.2, p.z),
      );
      this.points.addUpdateRange(0, (path.length + 1) * 3);
    } else this.points.addUpdateRange(0, 3);
    this.points.needsUpdate = true;
    this.setDrawRange(0, path.length + 1);
  }
}
