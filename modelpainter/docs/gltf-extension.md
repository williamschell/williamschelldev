# The `WSCHELL_toon_paint` glTF extension

Export GLB from the painter writes one mesh with one material. The painted passes and shader settings are stored so that a game engine can read them and any other viewer can still open the file.

## In the file

`WSCHELL_toon_paint` is listed in `extensionsUsed` and **not** in `extensionsRequired`. A viewer that doesn't know it just shows the Lit pass as an ordinary base color.

```json
{
  "extensionsUsed": ["WSCHELL_toon_paint"],
  "materials": [
    {
      "name": "toon",
      "pbrMetallicRoughness": {
        "baseColorTexture": { "index": 0 },
        "metallicFactor": 0,
        "roughnessFactor": 1
      },
      "extensions": {
        "WSCHELL_toon_paint": {
          "shadowTexture": { "index": 1 },
          "edgeTexture": { "index": 2 },
          "threshold": 0.5,
          "softness": 0.04,
          "edgeStrength": 0.35,
          "rimColor": [0.6, 1.0, 0.85],
          "rimPower": 3.0,
          "rimStrength": 0.0
        }
      }
    }
  ]
}
```

## Properties

| Property | Type | Default | Meaning |
|---|---|---|---|
| `shadowTexture` | textureInfo | required | The Shadow pass. RGBA, sRGB. |
| `edgeTexture` | textureInfo | required | The Edge pass. Grayscale in RGB, linear data. 50% gray means no shift. |
| `threshold` | number | 0.5 | `uThreshold` |
| `softness` | number | 0.04 | `uSoftness`: half-width of the transition |
| `edgeStrength` | number | 0.35 | `uEdgeStrength`: how far the edge map can move the boundary |
| `rimColor` | number[3] | [0.6, 1.0, 0.85] | `uRimColor`, linear |
| `rimPower` | number | 3.0 | `uRimPower` |
| `rimStrength` | number | 0.0 | `uRimStrength`. Off in the painter, and usually set per character in the game. |

The Lit pass is the material's `baseColorTexture`. All three textures are PNGs embedded in the file, at the same resolution and using `TEXCOORD_0`.

See [`toon-shader.md`](toon-shader.md) for the math these feed into.

## Reading it in an engine

1. Load the material as normal. `baseColorTexture` is your Lit texture, in sRGB.
2. Read `material.extensions.WSCHELL_toon_paint`. If it's missing, the model wasn't painted here.
3. Look up `shadowTexture.index` and `edgeTexture.index` in the top-level `textures` array. Mark Shadow as sRGB and Edge as linear. Many loaders assume unknown textures are one or the other, so set this explicitly.
4. Set the numbers as shader uniforms.

In three.js, `GLTFLoader` leaves unknown extensions in `material.userData.gltfExtensions`, and `gltf.parser.getDependency('texture', index)` loads the two extra textures. See `readToonExtension` in [`js/mesh/import.js`](../js/mesh/import.js) for working code.

## Round trips

Importing an exported GLB back into the painter restores all three passes and the shader settings.

## What export doesn't carry

An export is a static mesh. Node hierarchy, skins, morph targets and animations from the imported file aren't written out, because the painter merges every mesh into one geometry in world space when it imports. To use paint on a rigged character, keep the rig in your source file and apply the exported textures to it. The UVs have to match, so don't re-unwrap in the painter if the rigged file keeps its original UVs.
