import * as THREE from 'three';

/** Deterministic pseudo-random sequence so terrain dressing matches across clients. */
export function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export function groundGrain() {
  const size = 128,
    pixels = new Uint8Array(size * size * 4),
    random = seededRandom(918);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const broad =
        Math.sin(x * 0.32 + Math.sin(y * 0.21)) * Math.cos(y * 0.25) * 9;
      const v = Math.round(226 + random() * 22 + broad);
      pixels.set([v, v, Math.max(0, v - 3), 255], i);
    }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(60, 60);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function spruceGeometry() {
  const points: number[] = [],
    colors: number[] = [];
  const shade = new THREE.Color();
  const random = seededRandom(187);
  // Drooping, asymmetric whorls with individual branch tips.
  for (let tier = 0; tier < 9; tier++) {
    const y = tier * 0.3,
      radius = 1.18 * (1 - tier / 10),
      sides = 14;
    const center = new THREE.Vector3(
      Math.sin(tier * 3) * 0.06,
      y + 0.88,
      Math.cos(tier * 4) * 0.06,
    );
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2,
        b = ((i + 1) / sides) * Math.PI * 2;
      const ra = radius * (0.78 + random() * 0.25),
        rb = radius * (0.78 + random() * 0.25);
      points.push(
        center.x,
        center.y,
        center.z,
        Math.cos(a) * ra,
        y + random() * 0.11,
        Math.sin(a) * ra,
        Math.cos(b) * rb,
        y + random() * 0.11,
        Math.sin(b) * rb,
      );
      for (let v = 0; v < 3; v++) {
        shade.setRGB(
          v === 0 ? 0.86 : 0.62,
          v === 0 ? 0.94 : 0.76,
          v === 0 ? 0.78 : 0.6,
        );
        colors.push(shade.r, shade.g, shade.b);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/** A lichen-flecked granite boulder; instances are squashed and rotated individually. */
export function boulderGeometry() {
  const geo = new THREE.DodecahedronGeometry(1, 1);
  const random = seededRandom(271);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const bump = 0.86 + random() * 0.28;
    p.setXYZ(i, p.getX(i) * bump, p.getY(i) * bump * 0.85, p.getZ(i) * bump);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A tuft of sedge: thin leaning blades, pale at the tips and dark at the root. */
export function reedGeometry() {
  const points: number[] = [],
    colors: number[] = [];
  const random = seededRandom(613);
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + random() * 0.6,
      lean = 0.12 + random() * 0.3,
      height = 0.8 + random() * 0.7,
      half = 0.035 + random() * 0.02;
    const bx = Math.cos(a) * 0.08,
      bz = Math.sin(a) * 0.08,
      tx = bx + Math.cos(a) * lean * height,
      tz = bz + Math.sin(a) * lean * height;
    // Two triangles per blade so it reads from both sides without extra faces.
    const nx = -Math.sin(a) * half,
      nz = Math.cos(a) * half;
    points.push(
      bx - nx,
      0,
      bz - nz,
      bx + nx,
      0,
      bz + nz,
      tx,
      height,
      tz,
      bx + nx,
      0,
      bz + nz,
      bx - nx,
      0,
      bz - nz,
      tx,
      height,
      tz,
    );
    for (let v = 0; v < 6; v++) {
      const tip = v === 2 || v === 5;
      colors.push(tip ? 0.78 : 0.42, tip ? 0.7 : 0.4, tip ? 0.45 : 0.22);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}
