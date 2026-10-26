import * as THREE from 'three';

export const SURFACE_ATLAS = '/art/materials/northern-surfaces.webp?v=1';

// Mirrored coordinates keep atlas seams continuous; insets prevent mip bleeding.
export const surfaceGLSL = /* glsl */ `
uniform sampler2D northernAtlas;
float northernTile(vec2 p, vec2 tile) {
  vec2 uv = (tile + .012 + abs(fract(p*.5)*2.-1.) * .976) * .5;
  return dot(texture2D(northernAtlas, uv).rgb, vec3(.3,.59,.11));
}
float northernRock(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.)); w /= max(.001,w.x+w.y+w.z);
  return northernTile(p.zy*.21,vec2(0.,1.))*w.x
    + northernTile(p.xz*.21,vec2(0.,1.))*w.y
    + northernTile(p.xy*.21,vec2(0.,1.))*w.z;
}`;

/** Shared image detail on authored assets; albedo tint and team paint remain intact. */
export function detailMaterial(
  material: THREE.MeshStandardMaterial,
  atlas: THREE.Texture,
  amount = 0.38,
) {
  const previous = material.onBeforeCompile.bind(material);
  const timber = /wood|timber|bark/.test(material.name);
  const delicate = /glass|skin|canvas|cloth|leather|webbing/.test(
    material.name,
  );
  const relief = /glass/.test(material.name)
    ? 0.002
    : delicate
      ? 0.012
      : timber
        ? 0.04
        : material.metalness > 0.08
          ? 0.018
          : 0.17;
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    shader.uniforms.northernAtlas = { value: atlas };
    shader.uniforms.northernAmount = { value: amount };
    shader.uniforms.northernReliefScale = { value: relief };
    shader.vertexShader =
      `varying vec3 vNorthernSurface;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
       vNorthernSurface = position;`,
      );
    shader.fragmentShader = `varying vec3 vNorthernSurface;
      uniform float northernAmount, northernReliefScale;
      ${surfaceGLSL}\n${shader.fragmentShader}`
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
       float grain = ${timber ? 'northernTile(vNorthernSurface.xy*.38,vec2(1.,0.))' : 'northernRock(vNorthernSurface, normalize(cross(dFdx(vNorthernSurface),dFdy(vNorthernSurface))))'};
       diffuseColor.rgb *= mix(1., .64 + grain*.88, northernAmount);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
       roughnessFactor = clamp(roughnessFactor + (grain-.5)*.12, .16, 1.);`,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
       float northernRelief = grain*northernReliefScale*northernAmount*(1.-smoothstep(25.,120.,length(vViewPosition)));
       vec3 nq0=dFdx(-vViewPosition), nq1=dFdy(-vViewPosition);
       vec3 nr1=cross(nq1,normal), nr2=cross(normal,nq0);
       float ndet=dot(nq0,nr1);
       normal=normalize(abs(ndet)*normal-sign(ndet)*(dFdx(northernRelief)*nr1+dFdy(northernRelief)*nr2));`,
    );
  };
  material.customProgramCacheKey = () =>
    `northern-asset-detail-v2-${amount}-${timber}-${relief}`;
}
