# The toon shader

This is the canonical reference for the look. The painter's preview and the game engine must use the same math, so the painted result in the game matches what the artist saw.

The painter's copy lives in [`js/shaders/toon.glsl.js`](../js/shaders/toon.glsl.js). The `lightMask` block below must match the `TOON_CANONICAL` string in that file exactly. `tests/tests.js` fails if the two drift apart, so change them together.

## The idea

Every object is painted twice: once fully lit and once fully in shadow. The shader picks between those two paintings per pixel, based on the lighting. A third texture, the edge map, nudges where the boundary between them falls.

With one white light of intensity 1, the result goes exactly from the shadow pass to the lit pass. That's the core promise: **what you paint is what you get.**

## Inputs

```glsl
uniform sampler2D uLit, uShadow, uEdge;
uniform float uThreshold;     // default 0.5
uniform float uSoftness;      // default 0.04 (half-width of the transition)
uniform float uEdgeStrength;  // default 0.35
uniform vec3  uRimColor;      // default vec3(0.6, 1.0, 0.85)
uniform float uRimPower;      // default 3.0
uniform float uRimStrength;   // default 0.0 (off) in the painter, per-character in the game
```

## The light mask

For each light: direction `L` (toward the light), color `C`, and shadow attenuation `A` (1 means unshadowed).

```glsl
float lightMask(vec3 N, vec3 L, float A, float edge) {
    float ndl = dot(N, L) * 0.5 + 0.5;                  // half-lambert, 0..1
    float t   = ndl * A + (edge - 0.5) * uEdgeStrength; // cast shadows go in BEFORE the step
    return smoothstep(uThreshold - uSoftness, uThreshold + uSoftness, t);
}
```

Cast shadows from the level are multiplied in before the `smoothstep`, so they get the same brushy edge as shape shadows. The edge map adds to `t`, so an edge value above 0.5 stays lit longer and one below 0.5 falls into shadow sooner. Mid gray changes nothing.

## Shading

```glsl
vec3 shade(vec2 uv, vec3 N, vec3 V /* to camera */) {
    vec3 lit    = texture(uLit, uv).rgb;    // decoded from sRGB to linear
    vec3 shadow = texture(uShadow, uv).rgb; // decoded from sRGB to linear
    float edge  = texture(uEdge, uv).r;     // data, not color: never decode this one

    vec3 col = shadow;                      // shadow pass = ambient base
    // for each light i:
    //   float m = lightMask(N, L_i, A_i, edge);
    //   col += (lit - shadow) * m * C_i;   // C_i = 1 for a white key light
    float rim = pow(1.0 - max(dot(N, V), 0.0), uRimPower);
    col += uRimColor * rim * uRimStrength;
    return col;                             // encode to sRGB for display
}
```

There are no outlines, since the style has no lineart.

## Color space

Picker colors are sRGB, and textures store sRGB bytes. The shader decodes Lit and Shadow to linear for the lighting math and encodes the result for display. The edge map is linear data and is read as is.

In your engine, that means marking the Lit and Shadow textures as sRGB and the Edge texture as linear.

## What the painter adds

These are painter plumbing and aren't part of the look:

- **One preview light.** `A` is always 1, because there's no level to cast shadows, and `C` is white.
- **Flat previews.** Lit only, Shadow only and the Auto mode's flat views skip the lighting entirely.
- **Erased texels.** Erasing Lit or Shadow sets alpha to 0 and leaves the old RGB behind. The painter shows those texels as neutral gray with `mix(unpainted, t.rgb, t.a)`. The canonical math above reads only `.rgb`, so if you use erasing for holes or cutouts, your engine has to read the alpha too.
