import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  KernelSize,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  TiltShiftEffect,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { FogGrid } from '@/lib/tactical-fog';
import type { AtmosphereDesign } from '@/lib/maps/types';
import { debugFlag } from './lighting';
import type { RenderTier } from '@/lib/frame-budget';

/**
 * One post chain for the living diorama:
 *
 *   scene (HDR) -> ambient occlusion (half res) -> fog of war + bloom +
 *   exposure + filmic tone mapping -> SMAA -> tilt-shift + grade + vignette + grain
 *
 * Fog of war keeps its gameplay meaning exactly: unseen ground is dark, explored
 * but unwatched ground is a dim, desaturated memory. It reads the depth buffer,
 * so troops, trees and water are all covered without touching their materials.
 */

const fogFragment = /* glsl */ `
uniform sampler2D tFog;
uniform mat4 fogInverse;
uniform vec2 fogMin;
uniform vec2 fogSize;
uniform vec4 fogBounds;
uniform float fogEnabled;
uniform float fogClock;
uniform vec3 airColor;
uniform float airDensity;
uniform vec3 airEye;
float fogHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fogNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(fogHash(i), fogHash(i + vec2(1, 0)), f.x),
    mix(fogHash(i + vec2(0, 1)), fogHash(i + 1.), f.x), f.y);
}
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  outputColor = inputColor;
  if (depth >= .99999) return;
  vec4 world = fogInverse * vec4(uv * 2. - 1., depth * 2. - 1., 1.);
  world /= world.w;
  vec2 g = world.xz;
  // The plinth and backdrop beyond the battlefield are furniture, not ground.
  vec2 inside = step(fogBounds.xy - .75, g) * step(g, fogBounds.zw + .75);
  if (inside.x * inside.y < .5) return;
  // Aerial perspective over the battlefield: distance haze, thicker in the low ground.
  float travel = distance(world.xyz, airEye);
  float haze = (1. - exp(-travel * airDensity)) * mix(1., .55, smoothstep(0., 18., world.y));
  outputColor.rgb = mix(outputColor.rgb, airColor, clamp(haze, 0., .85));
  if (fogEnabled < .5) return;
  vec2 f = texture2D(tFog, (clamp(g, fogBounds.xy, fogBounds.zw) - fogMin) / fogSize).rg;
  float visible = smoothstep(0., 1., f.r);
  float explored = smoothstep(0., 1., f.g);
  vec3 color = outputColor.rgb;
  float grey = dot(color, vec3(.3, .59, .11));
  vec3 memory = mix(color, vec3(grey), .55) * vec3(.2, .24, .3);
  // A slow cloud texture keeps the shroud from reading as a flat hole.
  float cloud = fogNoise(g * .045 + vec2(fogClock * .012, 0.)) * .6 + fogNoise(g * .13 - fogClock * .02) * .4;
  vec3 dark = vec3(.006, .009, .014) * (.55 + cloud * .9);
  vec3 shrouded = mix(dark, memory, explored);
  outputColor = vec4(mix(shrouded, color, visible), inputColor.a);
}`;

class FogOfWarEffect extends Effect {
  constructor() {
    super('FogOfWarEffect', fogFragment, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['tFog', new THREE.Uniform(null)],
        ['fogInverse', new THREE.Uniform(new THREE.Matrix4())],
        ['fogMin', new THREE.Uniform(new THREE.Vector2())],
        ['fogSize', new THREE.Uniform(new THREE.Vector2(1, 1))],
        ['fogBounds', new THREE.Uniform(new THREE.Vector4(-1, -1, 1, 1))],
        ['fogEnabled', new THREE.Uniform(0)],
        ['fogClock', new THREE.Uniform(0)],
        ['airColor', new THREE.Uniform(new THREE.Color('#d8d0c4'))],
        ['airDensity', new THREE.Uniform(0)],
        ['airEye', new THREE.Uniform(new THREE.Vector3())],
      ]),
    });
  }
}

const exposureFragment = /* glsl */ `
uniform float exposure;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(inputColor.rgb * exposure, inputColor.a);
}`;
class ExposureEffect extends Effect {
  constructor() {
    super('ExposureEffect', exposureFragment, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([['exposure', new THREE.Uniform(1)]]),
    });
  }
}

/** Painterly grade: split toning, lift/gain, saturation, vignette and grain. */
const gradeFragment = /* glsl */ `
uniform vec3 gradeShadows;
uniform vec3 gradeHighlights;
uniform float gradeSaturation;
uniform float gradeContrast;
uniform float gradeLift;
uniform float gradeVignette;
uniform float gradeGrain;
uniform float gradeClock;
float gradeHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, 0.);
  float l = dot(c, vec3(.2126, .7152, .0722));
  // Split toning in linear light: tint shadows and highlights separately.
  float hi = smoothstep(.05, .7, l);
  c *= mix(gradeShadows, gradeHighlights, hi);
  // Gentle S-curve around mid grey.
  c = mix(c, c * c * (3. - 2. * min(c, 1.)), gradeContrast);
  float grey = dot(c, vec3(.2126, .7152, .0722));
  c = mix(vec3(grey), c, gradeSaturation);
  // Lift the blacks a touch (dusk maps keep dark ground readable).
  c += gradeLift * (1. - c) * gradeShadows;
  vec2 v = uv - .5;
  v.x *= aspect * .8;
  float vignette = 1. - gradeVignette * smoothstep(.25, .95, length(v));
  c *= vignette;
  float n = gradeHash(uv * resolution + fract(gradeClock * 7.13) * 91.7) - .5;
  c += n * gradeGrain * (.25 + 3. * l * (1. - l));
  outputColor = vec4(c, inputColor.a);
}`;
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', gradeFragment, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['gradeShadows', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['gradeHighlights', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['gradeSaturation', new THREE.Uniform(1.12)],
        ['gradeContrast', new THREE.Uniform(0.12)],
        ['gradeLift', new THREE.Uniform(0)],
        ['gradeVignette', new THREE.Uniform(0.28)],
        ['gradeGrain', new THREE.Uniform(0.018)],
        ['gradeClock', new THREE.Uniform(0)],
      ]),
    });
  }
}

export type GradeName = AtmosphereDesign['grade'];
/** Colour grades: split-tone multipliers for shadows and highlights, saturation, contrast. */
export const GRADES: Record<
  GradeName,
  {
    shadows: [number, number, number];
    highlights: [number, number, number];
    saturation: number;
    contrast: number;
    vignette: number;
    lift: number;
  }
> = {
  golden: {
    shadows: [0.86, 0.95, 1.16],
    highlights: [1.14, 1.0, 0.8],
    saturation: 1.26,
    contrast: 0.28,
    vignette: 0.3,
    lift: 0,
  },
  dawn: {
    shadows: [0.88, 0.94, 1.16],
    highlights: [1.1, 0.97, 0.98],
    saturation: 1.18,
    contrast: 0.22,
    vignette: 0.26,
    lift: 0.012,
  },
  dusk: {
    shadows: [0.98, 0.9, 1.14],
    highlights: [1.08, 0.97, 0.9],
    saturation: 1.25,
    contrast: 0.32,
    vignette: 0.36,
    lift: 0.04,
  },
  overcast: {
    shadows: [0.96, 1.02, 1.03],
    highlights: [0.98, 1.0, 1.02],
    saturation: 0.96,
    contrast: 0.2,
    vignette: 0.3,
    lift: 0.01,
  },
  arctic: {
    shadows: [0.84, 0.98, 1.18],
    highlights: [0.99, 1.02, 1.06],
    saturation: 1.08,
    contrast: 0.24,
    vignette: 0.2,
    lift: 0.02,
  },
};

export type PostSettings = {
  /** Which passes the device's render tier affords (lib/frame-budget.ts). */
  passes: Pick<RenderTier, 'ambientOcclusion' | 'antialias' | 'tiltShift'>;
  exposure: number;
  grade: GradeName;
  /** Development tuning multipliers. */
  tune?: { saturation?: number; contrast?: number };
  /** Aerial perspective colour and density (per metre). */
  air?: { color: string; density: number };
  /** 0 disables the tilt-shift miniature blur. */
  tiltShift: number;
};

export type PostChain = ReturnType<typeof createPostChain>;
/** The passes a chain was built with. */
export const postKey = (settings: PostSettings) =>
  `${settings.passes.ambientOcclusion}:${settings.passes.antialias}:${settings.passes.tiltShift}`;

export function createPostChain(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  settings: PostSettings,
) {
  const size = gl.getDrawingBufferSize(new THREE.Vector2());
  const composer = new EffectComposer(gl, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: 0,
  });
  composer.autoRenderToScreen = true;
  const render = new RenderPass(scene, camera);
  composer.addPass(render);
  let ao: N8AOPostPass | null = null;
  const { passes } = settings;
  if (passes.ambientOcclusion && !debugFlag('noao')) {
    ao = new N8AOPostPass(scene, camera, size.x, size.y);
    ao.setQualityMode('Low');
    Object.assign(ao.configuration, {
      halfRes: true,
      aoRadius: 2.2,
      distanceFalloff: 1.2,
      intensity: 2.6,
      transparencyAware: false,
      gammaCorrection: false,
    });
    ao.configuration.color = new THREE.Color('#1b2233');
    composer.addPass(ao);
  }
  const fog = new FogOfWarEffect();
  const bloom = new BloomEffect({
    mipmapBlur: true,
    luminanceThreshold: 1.35,
    luminanceSmoothing: 0.35,
    intensity: 1.15,
    radius: 0.72,
  });
  const exposure = new ExposureEffect();
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  composer.addPass(debugFlag('nobloom') ? new EffectPass(camera, fog, exposure, tone) : new EffectPass(camera, fog, exposure, bloom, tone));
  let tilt: TiltShiftEffect | null = null;
  if (passes.antialias !== 'none' && !debugFlag('nosmaa'))
    composer.addPass(
      new EffectPass(
        camera,
        new SMAAEffect({ preset: passes.antialias === 'high' ? SMAAPreset.HIGH : SMAAPreset.LOW }),
      ),
    );
  if (passes.tiltShift && !debugFlag('notilt')) {
    tilt = new TiltShiftEffect({
      focusArea: 0.46,
      feather: 0.36,
      kernelSize: KernelSize.MEDIUM,
      resolutionScale: 0.5,
    });
  }
  const grade = new GradeEffect();
  composer.addPass(
    tilt ? new EffectPass(camera, tilt, grade) : new EffectPass(camera, grade),
  );

  let fogTexture: THREE.DataTexture | null = null;
  let fogSource: FogGrid | null = null;
  let uploaded = -1;
  const wanted = new THREE.Vector2();
  const eye = new THREE.Vector3();
  const u = (effect: Effect, name: string) => effect.uniforms.get(name)!;
  const configure = (next: PostSettings) => {
    u(exposure, 'exposure').value = next.exposure;
    if (next.air) {
      u(fog, 'airColor').value.set(next.air.color);
      u(fog, 'airDensity').value = next.air.density;
    }
    const g = GRADES[next.grade];
    u(grade, 'gradeShadows').value.set(...g.shadows);
    u(grade, 'gradeHighlights').value.set(...g.highlights);
    u(grade, 'gradeSaturation').value = g.saturation * (next.tune?.saturation ?? 1);
    u(grade, 'gradeContrast').value = g.contrast * (next.tune?.contrast ?? 1);
    u(grade, 'gradeVignette').value = g.vignette;
    u(grade, 'gradeLift').value = g.lift;
  };
  configure(settings);
  let tiltStrength = settings.tiltShift;

  return {
    /** Rebuild the chain when this changes. */
    key: postKey(settings),
    configure(next: PostSettings) {
      configure(next);
      tiltStrength = next.tiltShift;
    },
    /** Point the fog effect at a commander's sight grid (null: everything visible). */
    setFog(grid: FogGrid | null, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) {
      u(fog, 'fogBounds').value.set(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ);
      if (grid === fogSource) return;
      fogSource = grid;
      fogTexture?.dispose();
      fogTexture = null;
      uploaded = -1;
      u(fog, 'fogEnabled').value = grid ? 1 : 0;
      if (!grid) return;
      fogTexture = new THREE.DataTexture(
        grid.data,
        grid.columns,
        grid.rows,
        THREE.RGBAFormat,
      );
      fogTexture.magFilter = fogTexture.minFilter = THREE.LinearFilter;
      fogTexture.wrapS = fogTexture.wrapT = THREE.ClampToEdgeWrapping;
      fogTexture.generateMipmaps = false;
      u(fog, 'tFog').value = fogTexture;
      u(fog, 'fogMin').value.set(grid.bounds.minX, grid.bounds.minZ);
      u(fog, 'fogSize').value.set(grid.bounds.width, grid.bounds.depth);
    },
    render(delta: number, clock: number) {
      gl.getDrawingBufferSize(wanted);
      if (wanted.x !== size.x || wanted.y !== size.y) {
        size.copy(wanted);
        const css = gl.getSize(new THREE.Vector2());
        composer.setSize(css.x, css.y, false);
      }
      if (fogSource && fogTexture && uploaded !== fogSource.version) {
        uploaded = fogSource.version;
        fogTexture.needsUpdate = true;
      }
      u(fog, 'fogInverse').value.multiplyMatrices(
        camera.matrixWorld,
        (camera as THREE.PerspectiveCamera).projectionMatrixInverse,
      );
      u(fog, 'fogClock').value = clock;
      camera.getWorldPosition(u(fog, 'airEye').value);
      u(grade, 'gradeClock').value = clock;
      if (tilt) {
        // Stronger miniature blur the higher the camera flies.
        camera.getWorldPosition(eye);
        const height = THREE.MathUtils.clamp((eye.y - 25) / 110, 0, 1);
        const strength = tiltStrength * (0.15 + 0.85 * height);
        tilt.blendMode.opacity.value = Math.min(1, strength);
        tilt.focusArea = 0.62 - 0.2 * height;
      }
      // Keep every pass in the development frame measurements.
      gl.info.autoReset = false;
      gl.info.reset();
      composer.render(delta);
    },
    dispose() {
      composer.dispose();
      fogTexture?.dispose();
    },
  };
}
