/** Export shared playable terrain for Blender art review without a browser or live mutation. */
import { registerHooks } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier))
        return next(`${specifier}.ts`, context);
      throw error;
    }
  },
});
const { createMapTerrain } = await import('../lib/tactical-terrain.ts');
const { BATTLEFIELDS } = await import('../lib/battlefields.ts');
const { biomeFormations } = await import('../lib/landscape-dressing.ts');
const { operationRandom } = await import('../lib/tactical-difficulty.ts');
const { footprint, footprintSamples } =
  await import('../lib/tactical-placement.ts');
mkdirSync('outputs/biome-review', { recursive: true });
for (const mapId of ['skerry', 'frostgate', 'amberfen', 'cinderreach']) {
  const map = createMapTerrain(947, mapId),
    biome = BATTLEFIELDS[mapId],
    random = operationRandom(947);
  const focus =
    mapId === 'cinderreach'
      ? { x: 104, z: -83 }
      : {
          x: map.bridgeXs.reduce((a, b) => (Math.abs(a) < Math.abs(b) ? a : b)),
          z:
            map.riverZ(
              map.bridgeXs.reduce((a, b) =>
                Math.abs(a) < Math.abs(b) ? a : b,
              ),
            ) + 6,
        };
  const vertices = [];
  for (let z = -174; z <= 174; z += 2)
    for (let x = -194; x <= 194; x += 2) {
      let h = map.heightAt(x, z);
      const kind = map.terrainAt(x, z);
      if (kind === 'void') {
        const edge = map.heightAt(
          Math.max(-150, Math.min(150, x)),
          Math.max(-130, Math.min(130, z)),
        );
        const beyond = Math.max(0, -130 - z, x - 150, -150 - x);
        h =
          z > 130
            ? -0.8 - (z - 130) * 0.04
            : Math.max(
                edge,
                0.8 +
                  Math.min(28, beyond * 0.95) *
                    (0.6 + 0.18 * Math.sin(x * 0.11) * Math.sin(z * 0.08)),
              );
      }
      vertices.push([x, -z, h, kind]);
    }
  const structures = [];
  // A small, coherent field outpost on legal ground, in the same metres as gameplay.
  const center =
    mapId === 'cinderreach'
      ? { x: 80, z: -41 }
      : { x: focus.x - 7, z: mapId === 'amberfen' ? 45 : focus.z + 32 };
  for (const [kind, dx, dz, angle] of [
    ['hq', 0, 0, 0],
    ['refinery', 18, 2, 0],
    ['reactor', -18, -19, 0],
    ['factory', -15, -6, 0],
    ['barracks', 4, -13, 0],
    ['lynx', -6, 10, 0.4],
    ['harvester', 10, 12, -0.2],
    ['ranger', 2, 11, 0],
    ['ranger', 4, 12, 0],
  ]) {
    const unit = ['lynx', 'harvester', 'ranger'].includes(kind);
    const offsets = unit
      ? [[0, 0]]
      : [
          [0, 0],
          [-6, 0],
          [6, 0],
          [0, 6],
          [-6, 6],
          [6, 6],
          [0, 12],
        ];
    for (const [ox, oz] of offsets) {
      const x = center.x + dx + ox,
        z = center.z + dz + oz;
      const samples = unit
        ? [{ x, z }]
        : footprintSamples(footprint(kind, { x, z }, angle));
      const heights = samples.map((p) => map.heightAt(p.x, p.z));
      if (
        !samples.every((p) => map.buildableAt(p.x, p.z)) ||
        Math.max(...heights) - Math.min(...heights) > 0.55
      )
        continue;
      if (!unit && structures.some((p) => Math.hypot(p.x - x, p.z - z) < 10))
        continue;
      structures.push({
        folder: 'tactical',
        name: kind,
        x,
        z,
        y: map.heightAt(x, z),
        scale: 1,
        angle,
      });
      break;
    }
  }
  center.y = map.heightAt(center.x, center.z);
  const clear = (x, z, r = 8) =>
    structures.some((p) => Math.hypot(p.x - x, p.z - z) < r) ||
    map.bridgeXs.some(
      (b) =>
        Math.abs(b - x) < 9 &&
        Math.abs(z - map.riverZ(x)) < map.riverHalfWidth(x) + 10,
    );
  const placements = [];
  for (let i = 0; i < 3000 * biome.treeDensity; i++) {
    const x = -148 + random() * 296,
      z = -128 + random() * 256;
    if (
      !map.buildableAt(x, z) ||
      clear(x, z, 12) ||
      ['shore'].includes(map.terrainAt(x, z))
    )
      continue;
    if (random() > 0.5 + 0.4 * Math.sin(x * 0.065) * Math.sin(z * 0.062))
      continue;
    placements.push({
      name: biome.trees[i % biome.trees.length],
      x,
      z,
      y: map.heightAt(x, z),
      scale: 1.6 + random() * 1.75,
      angle: random() * 6.28,
    });
  }
  for (let i = 0; i < 170; i++) {
    const x = -148 + random() * 296,
      z = -128 + random() * 256;
    if (!map.buildableAt(x, z) || clear(x, z)) continue;
    placements.push({
      name: biome.rocks[i % 2],
      x,
      z,
      y: map.heightAt(x, z) - 0.1,
      scale: 0.8 + random() * 2,
      angle: random() * 6.28,
    });
  }
  if (mapId === 'amberfen')
    for (let x = -145; x < 145; x += 3)
      for (let z = -125; z < 125; z += 3) {
        if (!['marsh', 'bank'].includes(map.terrainAt(x, z)) || clear(x, z, 4))
          continue;
        const px = x + (random() - 0.5) * 2.5,
          pz = z + (random() - 0.5) * 2.5;
        if (
          random() < 0.4 ||
          !['marsh', 'bank'].includes(map.terrainAt(px, pz))
        )
          continue;
        placements.push({
          name: 'fen_reeds',
          x: px,
          z: pz,
          y: map.heightAt(px, pz),
          scale: 0.8 + random() * 0.7,
          angle: random() * 6.28,
        });
      }
  placements.push(...biomeFormations(map));
  const data = {
    mapId,
    biome,
    seed: 947,
    columns: 195,
    rows: 175,
    focus,
    center,
    vertices,
    placements,
    structures,
    bridges: map.riverBridges(),
    pools: map.thermalPools,
  };
  writeFileSync(`outputs/biome-review/${mapId}.json`, JSON.stringify(data));
  console.log(
    mapId,
    vertices.length,
    'terrain vertices',
    placements.length,
    'landscape instances',
  );
}
