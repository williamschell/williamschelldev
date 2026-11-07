// The GPU passes behind painting. Nothing here decides how a brush looks. That happens on the stroke
// canvas (see paint/brush.js). These only move finished stroke pixels onto the model.

/** Draws the mesh into texture space: each fragment is one texel of the UV layout. */
export const uvSpaceVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;

void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(modelMatrix) * normal;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * Screen-space projection painting. For each texel: find where it lands on screen, drop it if
 * something nearer covers it there, fade it out on grazing surfaces, then read the stroke at that
 * screen spot. Working from the texel rather than the dab is what keeps strokes continuous across
 * UV seams and stops them stretching on angled faces.
 */
export const projectFragment = /* glsl */ `
uniform sampler2D uStroke;
uniform sampler2D uDepth;
uniform mat4 uViewProjection;
uniform vec3 uCameraPos;
uniform float uNear;
uniform float uFar;
uniform float uDoubleSided;

varying vec3 vWorld;
varying vec3 vNormal;

// Depth buffer value back to distance along the view axis.
float viewDepth(float z) {
  float ndc = z * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
}

void main() {
  vec4 clip = uViewProjection * vec4(vWorld, 1.0);
  if (clip.w <= 0.0) discard;
  vec3 ndc = clip.xyz / clip.w;
  vec2 screen = ndc.xy * 0.5 + 0.5;
  if (screen.x < 0.0 || screen.x > 1.0 || screen.y < 0.0 || screen.y > 1.0) discard;

  // Visibility, with a bias that grows with distance like the buffer's own error does.
  float mine = viewDepth(ndc.z * 0.5 + 0.5);
  float nearest = viewDepth(texture2D(uDepth, screen).r);
  if (mine > nearest + mine * 0.004 + uNear * 0.5) discard;

  // Facing falloff: below about 75 degrees the texels smear badly, so paint fades out before that.
  vec3 V = normalize(uCameraPos - vWorld);
  float facing = dot(normalize(vNormal), V);
  if (uDoubleSided > 0.5) facing = abs(facing);
  float fade = smoothstep(0.03, 0.26, facing);
  if (fade <= 0.0) discard;

  // The stroke canvas has y running down the screen.
  gl_FragColor = texture2D(uStroke, vec2(screen.x, 1.0 - screen.y)) * fade;
}
`;

/** A fullscreen triangle: the position already is clip space. */
export const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const copyFragment = /* glsl */ `
uniform sampler2D uSource;
void main() {
  gl_FragColor = texelFetch(uSource, ivec2(gl_FragCoord.xy), 0);
}
`;

/**
 * Lays the stroke over a pass and fills the padding around each island, in one pass.
 * uDilate says, for each empty texel next to an island, which island texel it should copy. So
 * seam dilation costs a single lookup instead of several blur passes, and the live preview during
 * a stroke is exactly what the commit will write.
 *
 * Passes store straight alpha. The stroke is premultiplied because it comes from a filtered read.
 */
export const compositeFragment = /* glsl */ `
uniform sampler2D uPass;
uniform sampler2D uStroke;
uniform sampler2D uDilate;
uniform float uOpacity;
uniform int uErase;
uniform int uIsEdge;

void main() {
  ivec2 here = ivec2(gl_FragCoord.xy);
  vec4 d = texelFetch(uDilate, here, 0);
  ivec2 src = here;
  if (d.b > 0.5) src += ivec2(floor(d.rg * 255.0 + 0.5)) - ivec2(128);

  vec4 under = texelFetch(uPass, src, 0);
  vec4 s = texelFetch(uStroke, src, 0) * uOpacity;

  if (uIsEdge == 1) {
    // Edge is grayscale and always opaque. Erasing heads back to the neutral 50% gray.
    float value = uErase == 1
      ? mix(under.r, 0.5, s.a)
      : under.r * (1.0 - s.a) + dot(s.rgb, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(vec3(value), 1.0);
    return;
  }

  if (uErase == 1) {
    gl_FragColor = vec4(under.rgb, under.a * (1.0 - s.a));
    return;
  }

  float a = s.a + under.a * (1.0 - s.a);
  vec3 rgb = a > 0.0 ? (s.rgb + under.rgb * under.a * (1.0 - s.a)) / a : under.rgb;
  gl_FragColor = vec4(rgb, a);
}
`;

/** Marks island texels. Used once per UV layout. */
export const maskFragment = /* glsl */ `
void main() { gl_FragColor = vec4(1.0); }
`;

/** Starts the dilation map: island texels point at themselves. */
export const dilateInitFragment = /* glsl */ `
uniform sampler2D uMask;
void main() {
  float inside = texelFetch(uMask, ivec2(gl_FragCoord.xy), 0).r;
  gl_FragColor = vec4(128.0 / 255.0, 128.0 / 255.0, inside > 0.5 ? 1.0 : 0.0, 1.0);
}
`;

/**
 * One step of growing the dilation map. An empty texel takes on its closest assigned neighbor's
 * target, with the offset extended by one step. Each run reaches one texel further out.
 */
export const dilateStepFragment = /* glsl */ `
uniform sampler2D uPrev;
uniform float uSize;
void main() {
  ivec2 here = ivec2(gl_FragCoord.xy);
  vec4 own = texelFetch(uPrev, here, 0);
  if (own.b > 0.5) { gl_FragColor = own; return; }
  float best = 1e9;
  vec4 result = own;
  int last = int(uSize) - 1;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      if (x == 0 && y == 0) continue;
      ivec2 at = here + ivec2(x, y);
      if (at.x < 0 || at.y < 0 || at.x > last || at.y > last) continue;
      vec4 other = texelFetch(uPrev, at, 0);
      if (other.b < 0.5) continue;
      vec2 offset = floor(other.rg * 255.0 + 0.5) - 128.0 + vec2(x, y);
      float dist = dot(offset, offset);
      if (dist < best) {
        best = dist;
        result = vec4((offset + 128.0) / 255.0, 1.0, 1.0);
      }
    }
  }
  gl_FragColor = result;
}
`;

/** First step of finding touched undo tiles: did any texel in this 2x2 block change? */
export const diffFragment = /* glsl */ `
uniform sampler2D uA;
uniform sampler2D uB;
void main() {
  ivec2 here = ivec2(gl_FragCoord.xy) * 2;
  float changed = 0.0;
  for (int y = 0; y < 2; y++) {
    for (int x = 0; x < 2; x++) {
      ivec2 at = here + ivec2(x, y);
      vec4 delta = abs(texelFetch(uA, at, 0) - texelFetch(uB, at, 0));
      if (max(max(delta.r, delta.g), max(delta.b, delta.a)) > 0.0) changed = 1.0;
    }
  }
  gl_FragColor = vec4(changed);
}
`;

/** Later steps: halve the map, keeping any changed flag, until one texel is one 64x64 tile. */
export const reduceFragment = /* glsl */ `
uniform sampler2D uSource;
void main() {
  ivec2 here = ivec2(gl_FragCoord.xy) * 2;
  float any = max(
    max(texelFetch(uSource, here, 0).r, texelFetch(uSource, here + ivec2(1, 0), 0).r),
    max(texelFetch(uSource, here + ivec2(0, 1), 0).r, texelFetch(uSource, here + ivec2(1, 1), 0).r)
  );
  gl_FragColor = vec4(any);
}
`;

/** Generate shadow from lit: an HSV move, with the hue pulled toward a target along the short way. */
export const shadowFromLitFragment = /* glsl */ `
uniform sampler2D uSource;
uniform float uHueShift;      // how far to move, in turns (also sets the tint strength)
uniform float uTargetHue;     // where to move toward, in turns
uniform float uSaturation;    // multiplier
uniform float uValue;         // multiplier

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec4 t = texelFetch(uSource, ivec2(gl_FragCoord.xy), 0);
  vec3 hsv = rgb2hsv(t.rgb);
  float delta = fract(uTargetHue - hsv.x + 0.5) - 0.5;
  // Never overshoot the target hue.
  hsv.x = fract(hsv.x + sign(delta) * min(abs(delta), uHueShift));
  hsv.y = clamp(hsv.y * uSaturation, 0.0, 1.0);
  hsv.z = clamp(hsv.z * uValue, 0.0, 1.0);
  // Hue means little on near-neutral colors, so also tint toward the target at the same brightness.
  // That way grays and creams still cool off in shadow instead of only getting darker.
  vec3 rgb = hsv2rgb(hsv);
  vec3 tint = hsv2rgb(vec3(uTargetHue, 0.6, hsv.z));
  gl_FragColor = vec4(mix(rgb, tint, clamp(uHueShift * 2.5, 0.0, 1.0)), t.a);
}
`;

/** Bakes an imported material into texture space. */
export const bakeFragment = /* glsl */ `
uniform sampler2D uMap;
uniform float uHasMap;
uniform vec3 uColor;   // sRGB
varying vec2 vUv;
void main() {
  vec4 t = uHasMap > 0.5 ? texture2D(uMap, vUv) : vec4(1.0);
  gl_FragColor = vec4(t.rgb * uColor, 1.0);
}
`;

/** Paint transfer: draws the new layout, reading the old textures at the old UVs. */
export const transferVertex = /* glsl */ `
attribute vec2 uvOld;
varying vec2 vUvOld;
void main() {
  vUvOld = uvOld;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const transferFragment = /* glsl */ `
uniform sampler2D uSource;
varying vec2 vUvOld;
void main() {
  gl_FragColor = texture2D(uSource, vUvOld);
}
`;

/** The flat texture in the UV view. Positions come from the UVs and the view's pan and zoom. */
export const uvViewVertex = /* glsl */ `
uniform vec2 uPan;       // CSS pixels from the view's top-left
uniform float uZoom;     // CSS pixels per UV unit
uniform vec2 uViewSize;  // CSS pixels
varying vec2 vUv;
void main() {
  vUv = uv;
  vec2 css = uPan + uv * uZoom;
  vec2 ndc = css / uViewSize * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0); // UV v = 0 is the top of the image, as in glTF
}
`;

export const uvViewFragment = /* glsl */ `
uniform sampler2D uMap;
uniform float uGray;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uMap, vUv);
  // Checkerboard shows what's transparent.
  vec2 cell = floor(vUv * 64.0);
  float check = mod(cell.x + cell.y, 2.0) < 1.0 ? 0.78 : 0.62;
  vec3 color = uGray > 0.5 ? t.rrr : mix(vec3(check), t.rgb, t.a);
  gl_FragColor = vec4(color, 1.0);
}
`;

export const uvWireFragment = /* glsl */ `
uniform vec4 uColor;
void main() { gl_FragColor = uColor; }
`;
