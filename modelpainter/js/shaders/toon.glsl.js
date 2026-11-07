// The toon shader. This is the source of truth for the look: William's game engine has to use the
// same math. docs/toon-shader.md carries the same canonical block, and tests/tests.js fails if the
// two ever drift apart. Edit them together.

/** The canonical math, exactly as documented. Everything else in this file is painter plumbing. */
export const TOON_CANONICAL = /* glsl */ `
float lightMask(vec3 N, vec3 L, float A, float edge) {
    float ndl = dot(N, L) * 0.5 + 0.5;                  // half-lambert, 0..1
    float t   = ndl * A + (edge - 0.5) * uEdgeStrength; // cast shadows go in BEFORE the step
    return smoothstep(uThreshold - uSoftness, uThreshold + uSoftness, t);
}
`;

export const toonVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
  vUv = uv;
  vNormal = mat3(modelMatrix) * normal;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const toonFragment = /* glsl */ `
uniform sampler2D uLit, uShadow, uEdge;
uniform float uThreshold;
uniform float uSoftness;
uniform float uEdgeStrength;
uniform vec3  uRimColor;
uniform float uRimPower;
uniform float uRimStrength;

// Painter only: one preview light, what to show, and what erased texels look like.
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform int  uPreview;      // 0 toon, 1 lit flat, 2 shadow flat, 3 edge flat
uniform vec3 uUnpainted;    // sRGB

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;

// Textures hold sRGB bytes, and the render target is left raw, so both conversions happen here.
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

${TOON_CANONICAL}

// Erased texels have alpha 0 but keep their old rgb, so the painter shows them as bare clay.
vec3 painted(sampler2D map, vec2 uv) {
  vec4 t = texture2D(map, uv);
  return mix(uUnpainted, t.rgb, t.a);
}

void main() {
  if (uPreview == 1) { gl_FragColor = vec4(painted(uLit, vUv), 1.0); return; }
  if (uPreview == 2) { gl_FragColor = vec4(painted(uShadow, vUv), 1.0); return; }
  if (uPreview == 3) { gl_FragColor = vec4(texture2D(uEdge, vUv).rrr, 1.0); return; }

  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  if (!gl_FrontFacing) N = -N;

  vec3 lit    = toLinear(painted(uLit, vUv));
  vec3 shadow = toLinear(painted(uShadow, vUv));
  float edge  = texture2D(uEdge, vUv).r;

  vec3 col = shadow;                                  // shadow pass = ambient base
  float m = lightMask(N, uLightDir, 1.0, edge);       // A = 1: no level to cast shadows in the painter
  col += (lit - shadow) * m * uLightColor;

  float rim = pow(1.0 - max(dot(N, V), 0.0), uRimPower);
  col += uRimColor * rim * uRimStrength;

  gl_FragColor = vec4(toSrgb(col), 1.0);
}
`;
