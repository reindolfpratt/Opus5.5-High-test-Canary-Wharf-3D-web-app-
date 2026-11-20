# Third-party notices

## Runtime / build dependencies (installed from npm, not vendored)

| Package | Version | License | Use |
| --- | --- | --- | --- |
| three | 0.187.0 | MIT | WebGL renderer; examples used: `Sky`, `Water`, `PointerLockControls`, `UnrealBloomPass`, `FXAAShader`, `FullScreenQuad`, `RoundedBoxGeometry`, `BufferGeometryUtils` |
| vite | 7.x | MIT | Dev server and bundler |

Their license texts ship inside `node_modules/three/LICENSE` and `node_modules/vite/LICENSE.md` after `npm install`.

## Assets

None. All textures (facades, paving, asphalt and road markings, grass, bark, leaves, water normals, liveries,
signage), all geometry (buildings, vehicles, people, trees, street furniture) and all audio are generated
procedurally at runtime by the code in `src/`. No HDRIs, image files, 3D models or audio files are included,
and the application performs no network requests at runtime.
