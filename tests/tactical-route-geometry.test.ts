import { expect, test, vi } from 'vitest';
import { TacticalRouteGeometry } from '../lib/tactical-route-geometry';

test('selected troops reuse route buffers and terrain samples across frames and server snapshots', () => {
  const geometry = new TacticalRouteGeometry();
  const heightAt = vi.fn(() => 2);
  const disposed = vi.fn();
  geometry.addEventListener('dispose', disposed);
  const buffer = geometry.getAttribute('position');
  for (let frame = 0; frame < 120; frame++) {
    // Even new route arrays from server snapshots should not rebuild GPU geometry.
    geometry.update(
      { x: frame / 60, y: 2, z: 30 },
      [
        { x: 10, z: 30 },
        { x: 10, z: 40 },
      ],
      heightAt,
    );
    expect(geometry.getAttribute('position')).toBe(buffer);
    expect(buffer.getX(0)).toBeCloseTo(frame / 60);
    expect(geometry.drawRange.count).toBe(3);
  }
  expect(heightAt).toHaveBeenCalledTimes(2);
  expect(disposed).not.toHaveBeenCalled();
  geometry.dispose();
});

test('redirects, longer routes and completed orders update the visible path', () => {
  const geometry = new TacticalRouteGeometry();
  const start = { x: 0, y: 0, z: 0 };
  const heightAt = () => 1;
  const path = Array.from({ length: 40 }, (_, i) => ({ x: i, z: i * 2 }));
  geometry.update(start, path, heightAt);
  expect(geometry.drawRange.count).toBe(41);
  expect(geometry.getAttribute('position').getZ(40)).toBe(78);
  const buffer = geometry.getAttribute('position');
  geometry.update(start, [{ x: -5, z: 3 }], heightAt);
  expect(geometry.getAttribute('position')).toBe(buffer);
  expect(geometry.drawRange.count).toBe(2);
  expect(buffer.getX(1)).toBe(-5);
  geometry.update(start, [], heightAt);
  expect(geometry.drawRange.count).toBe(0);
  geometry.dispose();
});
