import * as THREE from 'three';

/**
 * Pooled, GPU-cheap battlefield effects: a handful of instanced draws for any
 * number of flashes, tracers, fireballs, smoke columns, debris, shockwaves and
 * scorch marks. Particles live in preallocated typed arrays (ring buffers), so
 * a frame allocates nothing.
 */

const GLOW = 1024;
const SMOKE = 768;
const TRACERS = 192;
const DEBRIS = 256;
const DECALS = 160;
const RINGS = 48;
const LAMPS = 160;
const ignoreRaycast = () => {};

const glowVertex = /* glsl */ `
attribute vec4 fxColor;
varying vec2 vUv; varying vec4 vColor;
void main(){ vUv=uv; vColor=fxColor; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.); }`;
const glowFragment = /* glsl */ `
varying vec2 vUv; varying vec4 vColor;
void main(){
  vec2 p=vUv*2.-1.; float r=length(p);
  float core=exp(-r*r*9.)*1.6+exp(-r*r*2.4)*.55;
  float a=vColor.a*core*(1.-smoothstep(.85,1.,r));
  if(a<.002) discard;
  gl_FragColor=vec4(vColor.rgb*a,a);
}`;

const smokeVertex = /* glsl */ `
attribute vec4 fxColor;
attribute float fxSeed;
varying vec2 vUv; varying vec4 vColor; varying float vSeed;
void main(){ vUv=uv; vColor=fxColor; vSeed=fxSeed; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.); }`;
const smokeFragment = /* glsl */ `
uniform sampler2D puff;
varying vec2 vUv; varying vec4 vColor; varying float vSeed;
void main(){
  vec2 uv=vUv;
  vec4 t=texture2D(puff, uv*.5+vec2(step(.5,fract(vSeed*7.)),step(.5,fract(vSeed*13.)))*.5);
  float a=t.a*vColor.a;
  if(a<.004) discard;
  // Lit from above: the top of each puff catches the sky.
  vec3 c=vColor.rgb*(.62+.55*t.r)*(.8+.35*uv.y);
  gl_FragColor=vec4(c,a);
}`;

const ringFragment = /* glsl */ `
varying vec2 vUv; varying vec4 vColor; varying float vSeed;
void main(){
  vec2 p=vUv*2.-1.; float r=length(p);
  float ring = vSeed > .5 ? exp(-pow((r-.82)*9.,2.)) : exp(-r*r*3.5);
  float a=vColor.a*ring*(1.-smoothstep(.96,1.,r));
  if(a<.003) discard;
  gl_FragColor=vec4(vColor.rgb*a,a);
}`;

const decalFragment = /* glsl */ `
uniform sampler2D puff;
varying vec2 vUv; varying vec4 vColor; varying float vSeed;
void main(){
  vec2 p=vUv*2.-1.;
  float n=texture2D(puff, vUv*.5+vec2(fract(vSeed*3.1)>.5?.5:0.,fract(vSeed*5.3)>.5?.5:0.)).r;
  float r=length(p)+ (n-.5)*.55;
  float a=vColor.a*(1.-smoothstep(.35,.95,r));
  // Burnt core, sooty rim with a few ember flecks early on.
  vec3 c=mix(vec3(.035,.03,.028), vec3(.12,.1,.08), smoothstep(.2,.8,r));
  if(a<.004) discard;
  gl_FragColor=vec4(c,a*.9);
}`;

/** 2x2 atlas of soft noise puffs, painted once. */
function puffTexture() {
  const size = 128,
    half = size / 2;
  const data = new Uint8Array(size * size * 4);
  const hash = (x: number, y: number, s: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const noise = (x: number, y: number, s: number) => {
    const ix = Math.floor(x),
      iy = Math.floor(y);
    const fx = x - ix,
      fy = y - iy;
    const u = fx * fx * (3 - 2 * fx),
      v = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, s),
      b = hash(ix + 1, iy, s),
      c = hash(ix, iy + 1, s),
      d = hash(ix + 1, iy + 1, s);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };
  for (let tile = 0; tile < 4; tile++) {
    const ox = (tile % 2) * half,
      oy = Math.floor(tile / 2) * half;
    for (let y = 0; y < half; y++)
      for (let x = 0; x < half; x++) {
        const px = (x / half) * 2 - 1,
          py = (y / half) * 2 - 1;
        const f =
          noise(x / 9, y / 9, tile) * 0.55 +
          noise(x / 4.5, y / 4.5, tile + 9) * 0.3 +
          noise(x / 2.2, y / 2.2, tile + 17) * 0.15;
        const r = Math.hypot(px, py) + (f - 0.5) * 0.6;
        const alpha = Math.max(0, Math.min(1, (1 - r) * 1.6)) ** 1.4;
        const shade = Math.max(0, Math.min(1, 0.5 + (f - 0.5) * 1.4 - py * 0.3));
        const i = ((oy + y) * size + ox + x) * 4;
        data[i] = shade * 255;
        data[i + 1] = shade * 255;
        data[i + 2] = shade * 255;
        data[i + 3] = alpha * 255;
      }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

type Layer = {
  mesh: THREE.InstancedMesh;
  color: THREE.InstancedBufferAttribute;
  seed: THREE.InstancedBufferAttribute;
};
function layer(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  capacity: number,
): Layer {
  const g = geometry.clone();
  const color = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(
    THREE.DynamicDrawUsage,
  );
  const seed = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(
    THREE.DynamicDrawUsage,
  );
  g.setAttribute('fxColor', color);
  g.setAttribute('fxSeed', seed);
  const mesh = new THREE.InstancedMesh(g, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.raycast = ignoreRaycast;
  return { mesh, color, seed };
}

/** Structure-of-arrays particle pool. */
class Pool {
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly born: Float32Array;
  readonly life: Float32Array;
  readonly size: Float32Array;
  readonly grow: Float32Array;
  readonly gravity: Float32Array;
  readonly drag: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  readonly a: Float32Array;
  readonly spin: Float32Array;
  readonly seed: Float32Array;
  next = 0;
  constructor(readonly capacity: number) {
    const f = () => new Float32Array(capacity);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.born = f();
    this.life = f();
    this.size = f();
    this.grow = f();
    this.gravity = f();
    this.drag = f();
    this.r = f();
    this.g = f();
    this.b = f();
    this.a = f();
    this.spin = f();
    this.seed = f();
  }
  /** Claim the oldest slot (ring buffer: the effect budget never grows). */
  claim(now: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.born[i] = now;
    return i;
  }
}

export type Visibility = (x: number, z: number) => boolean;

export class FxEngine {
  readonly group = new THREE.Group();
  private readonly puff = puffTexture();
  private readonly glow = new Pool(GLOW);
  private readonly smoke = new Pool(SMOKE);
  private readonly debris = new Pool(DEBRIS);
  private readonly decals = new Pool(DECALS);
  private readonly rings = new Pool(RINGS);
  private readonly tracers = {
    fx: new Float32Array(TRACERS),
    fy: new Float32Array(TRACERS),
    fz: new Float32Array(TRACERS),
    tx: new Float32Array(TRACERS),
    ty: new Float32Array(TRACERS),
    tz: new Float32Array(TRACERS),
    born: new Float32Array(TRACERS).fill(-1e9),
    duration: new Float32Array(TRACERS),
    width: new Float32Array(TRACERS),
    length: new Float32Array(TRACERS),
    arc: new Float32Array(TRACERS),
    r: new Float32Array(TRACERS),
    g: new Float32Array(TRACERS),
    b: new Float32Array(TRACERS),
    trail: new Float32Array(TRACERS),
    lastTrail: new Float32Array(TRACERS),
    onLand: [] as (((x: number, y: number, z: number) => void) | null)[],
    next: 0,
  };
  private readonly layers: {
    glow: Layer;
    smoke: Layer;
    tracer: Layer;
    rings: Layer;
    decals: Layer;
    lamps: Layer;
    debris: THREE.InstancedMesh;
  };
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qz = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly z = new THREE.Vector3(0, 0, 1);
  private readonly flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  private rng = 1;
  /** Ground height for landing debris and decals. */
  groundAt: (x: number, z: number) => number = () => 0;

  constructor() {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometries.push(quad);
    const glowMaterial = new THREE.ShaderMaterial({
      vertexShader: glowVertex,
      fragmentShader: glowFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    const smokeMaterial = new THREE.ShaderMaterial({
      vertexShader: smokeVertex,
      fragmentShader: smokeFragment,
      uniforms: { puff: { value: this.puff } },
      transparent: true,
      depthWrite: false,
    });
    const ringMaterial = new THREE.ShaderMaterial({
      vertexShader: smokeVertex,
      fragmentShader: ringFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    const decalMaterial = new THREE.ShaderMaterial({
      vertexShader: smokeVertex,
      fragmentShader: decalFragment,
      uniforms: { puff: { value: this.puff } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const debrisGeometry = new THREE.DodecahedronGeometry(0.5, 0);
    this.geometries.push(debrisGeometry);
    const debrisMaterial = new THREE.MeshStandardMaterial({ color: '#3a332d', roughness: 0.9 });
    this.materials.push(glowMaterial, smokeMaterial, ringMaterial, decalMaterial, debrisMaterial);
    const debris = new THREE.InstancedMesh(debrisGeometry, debrisMaterial, DEBRIS);
    debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    debris.frustumCulled = false;
    debris.count = 0;
    debris.castShadow = true;
    debris.raycast = ignoreRaycast;
    this.layers = {
      decals: layer(quad, decalMaterial, DECALS),
      smoke: layer(quad, smokeMaterial, SMOKE),
      glow: layer(quad, glowMaterial, GLOW),
      tracer: layer(quad, glowMaterial, TRACERS),
      rings: layer(quad, ringMaterial, RINGS),
      lamps: layer(quad, glowMaterial, LAMPS),
      debris,
    };
    this.layers.lamps.mesh.renderOrder = 5;
    this.layers.decals.mesh.renderOrder = 2;
    this.layers.smoke.mesh.renderOrder = 4;
    this.layers.glow.mesh.renderOrder = 5;
    this.layers.tracer.mesh.renderOrder = 5;
    this.layers.rings.mesh.renderOrder = 3;
    this.group.add(
      this.layers.decals.mesh,
      this.layers.rings.mesh,
      debris,
      this.layers.smoke.mesh,
      this.layers.glow.mesh,
      this.layers.tracer.mesh,
      this.layers.lamps.mesh,
    );
    this.tracers.onLand = Array.from({ length: TRACERS }, () => null);
  }

  private random() {
    this.rng = (this.rng * 1664525 + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  /** A glowing sprite: flash, spark, fire tongue, ember. Colour is HDR (values above 1 bloom). */
  spark(now: number, x: number, y: number, z: number, o: {
    size: number; life: number; r: number; g: number; b: number;
    vx?: number; vy?: number; vz?: number; grow?: number; gravity?: number; drag?: number;
  }) {
    const p = this.glow,
      i = p.claim(now);
    p.px[i] = x; p.py[i] = y; p.pz[i] = z;
    p.vx[i] = o.vx ?? 0; p.vy[i] = o.vy ?? 0; p.vz[i] = o.vz ?? 0;
    p.life[i] = o.life; p.size[i] = o.size; p.grow[i] = o.grow ?? 0;
    p.gravity[i] = o.gravity ?? 0; p.drag[i] = o.drag ?? 0;
    p.r[i] = o.r; p.g[i] = o.g; p.b[i] = o.b; p.a[i] = 1;
    p.seed[i] = this.random();
  }

  /** A soft smoke or dust puff that grows and fades. */
  puffAt(now: number, x: number, y: number, z: number, o: {
    size: number; life: number; r: number; g: number; b: number; a?: number;
    vx?: number; vy?: number; vz?: number; grow?: number; drag?: number; spin?: number;
  }) {
    const p = this.smoke,
      i = p.claim(now);
    p.px[i] = x; p.py[i] = y; p.pz[i] = z;
    p.vx[i] = o.vx ?? 0; p.vy[i] = o.vy ?? 0; p.vz[i] = o.vz ?? 0;
    p.life[i] = o.life; p.size[i] = o.size; p.grow[i] = o.grow ?? o.size;
    p.drag[i] = o.drag ?? 0.6; p.gravity[i] = 0;
    p.r[i] = o.r; p.g[i] = o.g; p.b[i] = o.b; p.a[i] = o.a ?? 0.7;
    p.spin[i] = o.spin ?? (this.random() - 0.5) * 0.8;
    p.seed[i] = this.random();
  }

  /** A projectile streak from `from` to `to`; optional arc height and smoke trail. */
  tracer(now: number, from: THREE.Vector3, to: THREE.Vector3, o: {
    duration: number; width: number; length: number; r: number; g: number; b: number;
    arc?: number; trail?: number; delay?: number; onLand?: (x: number, y: number, z: number) => void;
  }) {
    const t = this.tracers,
      i = t.next;
    t.next = (t.next + 1) % TRACERS;
    t.fx[i] = from.x; t.fy[i] = from.y; t.fz[i] = from.z;
    t.tx[i] = to.x; t.ty[i] = to.y; t.tz[i] = to.z;
    t.born[i] = now + (o.delay ?? 0);
    t.duration[i] = o.duration; t.width[i] = o.width; t.length[i] = o.length;
    t.arc[i] = o.arc ?? 0; t.trail[i] = o.trail ?? 0; t.lastTrail[i] = 0;
    t.r[i] = o.r; t.g[i] = o.g; t.b[i] = o.b;
    t.onLand[i] = o.onLand ?? null;
  }

  /** A flat ground mark: shockwave ring (ring=true) or flash disc. */
  ring(now: number, x: number, y: number, z: number, o: { size: number; grow: number; life: number; r: number; g: number; b: number; ring: boolean }) {
    const p = this.rings,
      i = p.claim(now);
    p.px[i] = x; p.py[i] = y + 0.12; p.pz[i] = z;
    p.size[i] = o.size; p.grow[i] = o.grow; p.life[i] = o.life;
    p.r[i] = o.r; p.g[i] = o.g; p.b[i] = o.b; p.a[i] = 1;
    p.seed[i] = o.ring ? 1 : 0;
  }

  /** A scorch mark that fades over about a minute. */
  scorch(now: number, x: number, z: number, size: number, life = 60) {
    const p = this.decals,
      i = p.claim(now);
    p.px[i] = x; p.pz[i] = z; p.py[i] = this.groundAt(x, z) + 0.06;
    p.size[i] = size; p.life[i] = life; p.a[i] = 1;
    p.spin[i] = this.random() * Math.PI * 2;
    p.seed[i] = this.random();
  }

  /** Tumbling chunks thrown out of an explosion. */
  chunks(now: number, x: number, y: number, z: number, count: number, power: number) {
    const p = this.debris;
    for (let k = 0; k < count; k++) {
      const i = p.claim(now);
      const a = this.random() * Math.PI * 2,
        out = (2 + this.random() * 5) * power;
      p.px[i] = x; p.py[i] = y + 0.3; p.pz[i] = z;
      p.vx[i] = Math.cos(a) * out; p.vz[i] = Math.sin(a) * out;
      p.vy[i] = (4 + this.random() * 6) * power;
      p.life[i] = 2.2 + this.random() * 1.5;
      p.size[i] = (0.12 + this.random() * 0.22) * Math.sqrt(power);
      p.spin[i] = (this.random() - 0.5) * 14;
      p.seed[i] = this.random() * 6.28;
      p.gravity[i] = 16;
    }
  }

  /** Fireball, smoke column, debris, ground flash, shockwave and scorch. */
  explode(now: number, x: number, y: number, z: number, power: number, dusty = false) {
    const r = () => this.random();
    this.ring(now, x, y, z, { size: 2 * power, grow: 7 * power, life: 0.22, r: 6, g: 3.6, b: 1.4, ring: false });
    this.ring(now, x, y, z, { size: 1.5 * power, grow: 14 * power, life: 0.5, r: 1.6, g: 1.4, b: 1.2, ring: true });
    for (let k = 0; k < 10 + power * 6; k++) {
      const a = r() * Math.PI * 2,
        out = (1 + r() * 3) * power;
      this.spark(now, x + (r() - 0.5) * power, y + 0.5 + r() * power, z + (r() - 0.5) * power, {
        size: (1.2 + r() * 1.6) * power,
        life: 0.28 + r() * 0.4,
        r: 9, g: 3.6 + r() * 2.5, b: 0.8,
        vx: Math.cos(a) * out, vz: Math.sin(a) * out, vy: 1.5 + r() * 3 * power,
        grow: 2.2 * power, drag: 2.5,
      });
    }
    for (let k = 0; k < 8 + power * 5; k++) {
      const a = r() * Math.PI * 2,
        out = (4 + r() * 9) * power;
      this.spark(now, x, y + 0.4, z, {
        size: 0.18 + r() * 0.2, life: 0.5 + r() * 0.7,
        r: 12, g: 7, b: 2.5,
        vx: Math.cos(a) * out, vz: Math.sin(a) * out, vy: 3 + r() * 8 * power, gravity: 14,
      });
    }
    const soot = dusty ? [0.52, 0.47, 0.4] : [0.2, 0.19, 0.18];
    for (let k = 0; k < 6 + power * 5; k++)
      this.puffAt(now, x + (r() - 0.5) * power * 1.5, y + 0.6 + r() * power, z + (r() - 0.5) * power * 1.5, {
        size: (1.4 + r()) * power, grow: (4 + r() * 3) * power,
        life: 2.8 + r() * 3.2,
        r: soot[0], g: soot[1], b: soot[2], a: 0.75,
        vx: (r() - 0.5) * 1.4, vy: 1.4 + r() * 2.4 * power, vz: (r() - 0.5) * 1.4, drag: 0.35,
      });
    this.chunks(now, x, y, z, Math.round(5 + power * 5), power);
    this.scorch(now, x, z, 2.6 * power + 1);
  }

  /** Small impact: a dirt/snow kick and a few sparks. */
  impact(now: number, x: number, y: number, z: number, size: number, snowy: boolean) {
    const r = () => this.random();
    const dust = snowy ? [0.85, 0.87, 0.9] : [0.46, 0.4, 0.32];
    for (let k = 0; k < 2; k++)
      this.puffAt(now, x + (r() - 0.5) * 0.4, y + 0.2, z + (r() - 0.5) * 0.4, {
        size: 0.5 * size, grow: 1.6 * size, life: 0.7 + r() * 0.5,
        r: dust[0], g: dust[1], b: dust[2], a: 0.6, vy: 1 + r() * 1.5, drag: 1.4,
      });
    for (let k = 0; k < 3; k++) {
      const a = r() * Math.PI * 2;
      this.spark(now, x, y + 0.2, z, {
        size: 0.14, life: 0.18 + r() * 0.15, r: 10, g: 6.5, b: 2.4,
        vx: Math.cos(a) * 3, vz: Math.sin(a) * 3, vy: 2 + r() * 3, gravity: 12,
      });
    }
  }

  /** A muzzle flash: hot core plus a short-lived star, and a wisp of smoke. */
  flash(now: number, x: number, y: number, z: number, size: number) {
    const r = () => this.random();
    this.spark(now, x, y, z, { size: size * 1.2, life: 0.07, r: 14, g: 9, b: 3.5, grow: size * 2 });
    this.spark(now, x, y, z, { size: size * 0.6, life: 0.05, r: 18, g: 16, b: 10 });
    this.puffAt(now, x, y, z, {
      size: size * 0.5, grow: size * 1.6, life: 0.6 + r() * 0.4,
      r: 0.62, g: 0.6, b: 0.56, a: 0.45, vy: 0.8, drag: 1.2,
    });
  }

  /** Persistent lamp glows (dusk lighting); positions are read fresh every frame. */
  lamps(positions: readonly THREE.Vector3[], count: number, level: number, now: number, camera: THREE.Camera) {
    const L = this.layers.lamps;
    let n = 0;
    if (level > 0.02)
      for (let i = 0; i < Math.min(count, LAMPS); i++) {
        const p = positions[i];
        const size = 1.5 + 0.12 * Math.sin(now * 3 + i);
        this.m.compose(p, camera.quaternion, this.w.set(size, size, size));
        L.mesh.setMatrixAt(n, this.m);
        L.color.setXYZW(n, 5, 3.2, 1.4, level * (0.85 + 0.15 * Math.sin(now * 7.3 + i * 2.1)));
        n++;
      }
    L.mesh.count = n;
    L.mesh.instanceMatrix.needsUpdate = true;
    L.color.needsUpdate = true;
  }

  clear() {
    for (const p of [this.glow, this.smoke, this.debris, this.decals, this.rings]) p.life.fill(0);
    this.tracers.born.fill(-1e9);
  }

  update(now: number, dt: number, camera: THREE.Camera, visible: Visibility) {
    const L = this.layers;
    const cq = camera.quaternion;
    // Tracers first: they may spawn impacts and trail puffs.
    const t = this.tracers;
    let n = 0;
    for (let i = 0; i < TRACERS; i++) {
      const age = now - t.born[i];
      if (age < 0 || age > t.duration[i]) {
        if (age > t.duration[i] && age < t.duration[i] + 1 && t.onLand[i]) {
          const land = t.onLand[i]!;
          t.onLand[i] = null;
          land(t.tx[i], t.ty[i], t.tz[i]);
        }
        continue;
      }
      const u = age / t.duration[i];
      const x = t.fx[i] + (t.tx[i] - t.fx[i]) * u,
        z = t.fz[i] + (t.tz[i] - t.fz[i]) * u;
      const y = t.fy[i] + (t.ty[i] - t.fy[i]) * u + Math.sin(u * Math.PI) * t.arc[i];
      // Direction along the (possibly arcing) path.
      const du = 0.02;
      const x2 = t.fx[i] + (t.tx[i] - t.fx[i]) * Math.min(1, u + du),
        z2 = t.fz[i] + (t.tz[i] - t.fz[i]) * Math.min(1, u + du);
      const y2 = t.fy[i] + (t.ty[i] - t.fy[i]) * Math.min(1, u + du) + Math.sin(Math.min(1, u + du) * Math.PI) * t.arc[i];
      if (t.trail[i] > 0 && now - t.lastTrail[i] > 1 / t.trail[i]) {
        t.lastTrail[i] = now;
        this.puffAt(now, x, y, z, { size: 0.45, grow: 1.6, life: 1.4, r: 0.72, g: 0.7, b: 0.66, a: 0.55, vy: 0.3, drag: 1 });
        this.spark(now, x, y, z, { size: 0.9, life: 0.08, r: 8, g: 4, b: 1.2 });
      }
      if (!visible(x, z) || n >= TRACERS) continue;
      this.v.set(x2 - x, y2 - y, z2 - z).normalize();
      this.w.setFromMatrixPosition(camera.matrixWorld).sub(this.s.set(x, y, z)).normalize();
      const side = this.s.crossVectors(this.v, this.w).normalize();
      const normal = this.w.crossVectors(side, this.v).normalize();
      // Basis: x = along travel (length), y = side (width), z = toward camera.
      this.m.makeBasis(this.v, side, normal);
      this.m.scale(this.s.set(t.length[i], t.width[i], 1));
      this.m.setPosition(x - this.v.x * t.length[i] * 0.5, y - this.v.y * t.length[i] * 0.5, z - this.v.z * t.length[i] * 0.5);
      L.tracer.mesh.setMatrixAt(n, this.m);
      L.tracer.color.setXYZW(n, t.r[i], t.g[i], t.b[i], 1);
      n++;
    }
    L.tracer.mesh.count = n;
    L.tracer.mesh.instanceMatrix.needsUpdate = true;
    L.tracer.color.needsUpdate = true;

    // Glow sprites.
    const g = this.glow;
    n = 0;
    for (let i = 0; i < GLOW; i++) {
      const age = now - g.born[i];
      if (age < 0 || age >= g.life[i]) continue;
      const damp = Math.exp(-g.drag[i] * age);
      const move = g.drag[i] > 0 ? (1 - damp) / g.drag[i] : age;
      const x = g.px[i] + g.vx[i] * move,
        z = g.pz[i] + g.vz[i] * move;
      const y = g.py[i] + g.vy[i] * move - 0.5 * g.gravity[i] * age * age;
      if (!visible(x, z)) continue;
      const k = age / g.life[i];
      const size = g.size[i] + g.grow[i] * k;
      this.m.compose(this.s.set(x, y, z), cq, this.w.set(size, size, size));
      L.glow.mesh.setMatrixAt(n, this.m);
      const fade = (1 - k) * (1 - k);
      L.glow.color.setXYZW(n, g.r[i], g.g[i] * (1 - k * 0.5), g.b[i] * (1 - k * 0.8), fade);
      n++;
    }
    L.glow.mesh.count = n;
    L.glow.mesh.instanceMatrix.needsUpdate = true;
    L.glow.color.needsUpdate = true;

    // Smoke and dust.
    const s = this.smoke;
    n = 0;
    for (let i = 0; i < SMOKE; i++) {
      const age = now - s.born[i];
      if (age < 0 || age >= s.life[i]) continue;
      const damp = Math.exp(-s.drag[i] * age);
      const move = (1 - damp) / Math.max(0.001, s.drag[i]);
      // Wind leans every column the same way.
      const x = s.px[i] + s.vx[i] * move + age * 0.45,
        z = s.pz[i] + s.vz[i] * move + age * 0.18;
      const y = s.py[i] + s.vy[i] * move + age * 0.35;
      if (!visible(x, z)) continue;
      const k = age / s.life[i];
      const size = s.size[i] + s.grow[i] * Math.sqrt(k);
      this.qz.setFromAxisAngle(this.z, s.spin[i] * age + s.seed[i] * 6.28);
      this.q.copy(cq).multiply(this.qz);
      this.m.compose(this.s.set(x, y, z), this.q, this.w.set(size, size, size));
      L.smoke.mesh.setMatrixAt(n, this.m);
      const alpha = s.a[i] * Math.min(1, age * 6) * (1 - k) * (1 - k * 0.5);
      L.smoke.color.setXYZW(n, s.r[i], s.g[i], s.b[i], alpha);
      L.smoke.seed.setX(n, s.seed[i]);
      n++;
    }
    L.smoke.mesh.count = n;
    L.smoke.mesh.instanceMatrix.needsUpdate = true;
    L.smoke.color.needsUpdate = true;
    L.smoke.seed.needsUpdate = true;

    // Debris: ballistic with a single bounce, then rests and shrinks away.
    const d = this.debris;
    n = 0;
    for (let i = 0; i < DEBRIS; i++) {
      const age = now - d.born[i];
      if (age < 0 || age >= d.life[i]) continue;
      let x = d.px[i] + d.vx[i] * age,
        z = d.pz[i] + d.vz[i] * age;
      let y = d.py[i] + d.vy[i] * age - 0.5 * d.gravity[i] * age * age;
      const ground = this.groundAt(x, z);
      const landed = d.vy[i] / d.gravity[i] + Math.sqrt(Math.max(0, (d.vy[i] * d.vy[i]) / (d.gravity[i] * d.gravity[i]) + (2 * (d.py[i] - ground)) / d.gravity[i]));
      let spinAge = age;
      if (age > landed) {
        x = d.px[i] + d.vx[i] * landed;
        z = d.pz[i] + d.vz[i] * landed;
        y = this.groundAt(x, z) + d.size[i] * 0.3;
        spinAge = landed;
      }
      if (!visible(x, z)) continue;
      const k = Math.max(0, (age - d.life[i] + 0.6) / 0.6);
      const size = d.size[i] * (1 - k);
      this.e.set(d.spin[i] * spinAge + d.seed[i], d.seed[i], d.spin[i] * spinAge * 0.7);
      this.q.setFromEuler(this.e);
      this.m.compose(this.s.set(x, y, z), this.q, this.w.set(size, size * 0.7, size));
      L.debris.setMatrixAt(n++, this.m);
    }
    L.debris.count = n;
    L.debris.instanceMatrix.needsUpdate = true;

    // Ground rings and flashes.
    const r = this.rings;
    n = 0;
    for (let i = 0; i < RINGS; i++) {
      const age = now - r.born[i];
      if (age < 0 || age >= r.life[i]) continue;
      if (!visible(r.px[i], r.pz[i])) continue;
      const k = age / r.life[i];
      const size = r.size[i] + r.grow[i] * (1 - (1 - k) * (1 - k));
      this.m.compose(this.s.set(r.px[i], r.py[i], r.pz[i]), this.flat, this.w.set(size, size, size));
      L.rings.mesh.setMatrixAt(n, this.m);
      L.rings.color.setXYZW(n, r.r[i], r.g[i], r.b[i], (1 - k) * (1 - k));
      L.rings.seed.setX(n, r.seed[i]);
      n++;
    }
    L.rings.mesh.count = n;
    L.rings.mesh.instanceMatrix.needsUpdate = true;
    L.rings.color.needsUpdate = true;
    L.rings.seed.needsUpdate = true;

    // Scorch marks fade over their life; they stay even under fog (the ground remembers).
    const c = this.decals;
    n = 0;
    for (let i = 0; i < DECALS; i++) {
      const age = now - c.born[i];
      if (age < 0 || age >= c.life[i]) continue;
      const k = age / c.life[i];
      this.qz.setFromAxisAngle(this.z, c.spin[i]);
      this.q.copy(this.flat).multiply(this.qz);
      this.m.compose(this.s.set(c.px[i], c.py[i], c.pz[i]), this.q, this.w.set(c.size[i], c.size[i], 1));
      L.decals.mesh.setMatrixAt(n, this.m);
      L.decals.color.setXYZW(n, 0, 0, 0, Math.min(1, age * 8) * (1 - k * k));
      L.decals.seed.setX(n, c.seed[i]);
      n++;
    }
    L.decals.mesh.count = n;
    L.decals.mesh.instanceMatrix.needsUpdate = true;
    L.decals.color.needsUpdate = true;
    L.decals.seed.needsUpdate = true;
    void dt;
  }

  dispose() {
    this.puff.dispose();
    this.materials.forEach((m) => m.dispose());
    this.geometries.forEach((g) => g.dispose());
    for (const l of [this.layers.glow, this.layers.smoke, this.layers.tracer, this.layers.rings, this.layers.decals, this.layers.lamps])
      l.mesh.geometry.dispose();
  }
}
