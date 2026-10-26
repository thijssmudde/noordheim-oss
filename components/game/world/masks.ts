import * as THREE from 'three';
import type { MapDesign, Point } from '@/lib/maps/types';

/**
 * Surface masks rasterised with Canvas 2D in world metres, sampled by the
 * terrain and water shaders in world space.
 *
 * surface: R road, G tyre ruts, B paved, A forest floor
 * water:   RG flow direction (0.5 = still), B river, A lake or sea
 */
export type WorldMasks = {
  surface: THREE.DataTexture;
  water: THREE.DataTexture;
  /** minX, minZ, width, depth of the textured rectangle, in metres. */
  rect: THREE.Vector4;
  dispose(): void;
};

function offsetPath(path: Point[], offset: number): Point[] {
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)],
      b = path[Math.min(path.length - 1, i + 1)];
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: p.x - (dz / l) * offset, z: p.z + (dx / l) * offset };
  });
}

export function buildMasks(design: MapDesign): WorldMasks {
  const { bounds } = design;
  const width = bounds.maxX - bounds.minX,
    depth = bounds.maxZ - bounds.minZ;
  const scale = Math.min(4, 2048 / Math.max(width, depth));
  const w = Math.ceil(width * scale),
    h = Math.ceil(depth * scale);
  /**
   * One mask channel. Soft (heavily blurred) layers are painted at 1/`reduce`
   * resolution and scaled up: a canvas blur costs with its radius in pixels,
   * and a wide blur holds no detail the bilinear upscale would lose.
   */
  const layer = (paint: (ctx: CanvasRenderingContext2D) => void, reduce = 1) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    let target = ctx;
    if (reduce > 1) {
      const small = document.createElement('canvas');
      small.width = Math.ceil(w / reduce);
      small.height = Math.ceil(h / reduce);
      target = small.getContext('2d')!;
      target.fillStyle = '#000';
      target.fillRect(0, 0, small.width, small.height);
    }
    const s = scale / reduce;
    target.setTransform(s, 0, 0, s, -bounds.minX * s, -bounds.minZ * s);
    target.lineCap = 'round';
    target.lineJoin = 'round';
    paint(target);
    if (target !== ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(target.canvas, 0, 0, target.canvas.width * reduce, target.canvas.height * reduce);
    }
    return ctx.getImageData(0, 0, w, h).data;
  };
  const line = (ctx: CanvasRenderingContext2D, path: Point[]) => {
    ctx.beginPath();
    path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z)));
    ctx.stroke();
  };
  const poly = (ctx: CanvasRenderingContext2D, path: Point[]) => {
    ctx.beginPath();
    path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z)));
    ctx.closePath();
    ctx.fill();
  };
  const blur = (ctx: CanvasRenderingContext2D, metres: number) => {
    ctx.filter = `blur(${Math.max(0.5, metres * ctx.getTransform().a).toFixed(2)}px)`;
  };

  const roads = layer((ctx) => {
    for (const road of design.roads) {
      blur(ctx, road.width * 0.22);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = road.width * (road.surface === 'rail' ? 0.62 : 1);
      line(ctx, road.path);
    }
  });
  const ruts = layer((ctx) => {
    blur(ctx, 0.12);
    ctx.strokeStyle = '#fff';
    for (const road of design.roads) {
      if (road.surface === 'rail') continue;
      ctx.lineWidth = road.surface === 'paved' ? 0.55 : 0.42;
      const gauge = road.surface === 'paved' ? road.width * 0.22 : 0.95;
      for (const lane of road.surface === 'paved' ? [-1, 1] : [0])
        for (const side of [-1, 1])
          line(ctx, offsetPath(road.path, lane * road.width * 0.24 + side * gauge * 0.5));
    }
  });
  const paved = layer((ctx) => {
    blur(ctx, 0.3);
    ctx.strokeStyle = '#fff';
    for (const road of design.roads) {
      if (road.surface !== 'paved') continue;
      ctx.lineWidth = road.width * 0.9;
      line(ctx, road.path);
    }
  });
  const forest = layer((ctx) => {
    blur(ctx, 4);
    ctx.fillStyle = '#fff';
    for (const f of design.forests) poly(ctx, f.outline);
  }, 4);
  const surface = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    surface[i * 4] = roads[i * 4];
    surface[i * 4 + 1] = ruts[i * 4];
    surface[i * 4 + 2] = paved[i * 4];
    surface[i * 4 + 3] = forest[i * 4];
  }

  const flow = layer((ctx) => {
    ctx.fillStyle = 'rgb(128,128,0)';
    ctx.fillRect(bounds.minX - 50, bounds.minZ - 50, width + 100, depth + 100);
    for (const river of design.rivers) {
      blur(ctx, 2);
      for (let i = 1; i < river.path.length; i++) {
        const a = river.path[i - 1],
          b = river.path[i];
        const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const r = Math.round(128 + ((b.x - a.x) / l) * 120),
          g = Math.round(128 + ((b.z - a.z) / l) * 120);
        const wide =
          typeof river.width === 'number'
            ? river.width
            : Math.max(river.width[i - 1], river.width[i]);
        ctx.strokeStyle = `rgb(${r},${g},255)`;
        ctx.lineWidth = wide + 8;
        line(ctx, [a, b]);
      }
    }
  }, 2);
  const still = layer((ctx) => {
    blur(ctx, 3);
    ctx.fillStyle = '#fff';
    for (const body of [...design.lakes, ...design.seas]) poly(ctx, body.outline);
  }, 3);
  const water = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    water[i * 4] = flow[i * 4];
    water[i * 4 + 1] = flow[i * 4 + 1];
    water[i * 4 + 2] = flow[i * 4 + 2];
    water[i * 4 + 3] = still[i * 4];
  }
  const texture = (data: Uint8Array) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  const result = {
    surface: texture(surface),
    water: texture(water),
    rect: new THREE.Vector4(bounds.minX, bounds.minZ, width, depth),
    dispose() {
      result.surface.dispose();
      result.water.dispose();
    },
  };
  return result;
}

/** A half-float height texture of the natural ground, for water depth and foam. */
export function heightTexture(grid: {
  width: number;
  depth: number;
  heights: Float32Array;
}) {
  const data = new Uint16Array(grid.width * grid.depth);
  for (let i = 0; i < data.length; i++)
    data[i] = THREE.DataUtils.toHalfFloat(grid.heights[i]);
  const t = new THREE.DataTexture(
    data,
    grid.width,
    grid.depth,
    THREE.RedFormat,
    THREE.HalfFloatType,
  );
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}
