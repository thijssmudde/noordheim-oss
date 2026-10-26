/** Shared GLSL helpers for world shaders (terrain, water, edge, sky). */
export const worldNoiseGLSL = /* glsl */ `
float worldHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float worldNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(worldHash(i), worldHash(i + vec2(1., 0.)), f.x),
    mix(worldHash(i + vec2(0., 1.)), worldHash(i + 1.), f.x), f.y);
}
float worldFbm(vec2 p) {
  return worldNoise(p) * .5 + worldNoise(p * 2.07 + 13.1) * .3 + worldNoise(p * 4.13 - 7.7) * .2;
}
`;
