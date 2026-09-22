# Target navigation: MapController and TerrainController

An offline, synthetic 3D scene using only public package-root APIs. No tokens, map tiles,
backend, or Erdblick assets are needed. TerrainController samples pickable 3D geometry;
it does not require a TerrainLayer.

## Run against this fork

From the deck.gl repository root, run `corepack yarn build`. Then in this directory:

```bash
npm install
npm run start-local
```

For a local-fork production bundle:

```bash
npm run build -- --config ../../../vite.config.local.mjs
```

The local configuration aliases package roots to this checkout. Ordinary `npm start`/`build`
may resolve stable npm packages, which do not contain this experimental API; that is not a
fork validation. Network is needed for dependency setup, but not for the running scene.

## Try it

1. Drag the yellow elevated surface to pan; right-drag to orbit; wheel or pinch to approach it.
2. Compare built-in picking with the numeric provider, which projects the known yellow point
   freshly. A provider returning `null` deliberately uses stock navigation, not picker fallthrough.
3. Switch to TerrainController. Orbit, release, and watch the public target indicator disappear.
   Terrain sampling resumes without changing the physical camera during reference rebasing;
   subsequent stock inputs continue ordinary smoothed terrain following.
4. Disable target navigation for comparison. Reset or change the controller while interacting:
   the previous view/controller is replaced through public configuration.

The marker only reads `interactionTargetPosition` and `viewId`; it never intercepts input or picking.
The sloped ground and elevated disk are pickable; the height guide is not. Cold/warm cache timing,
controlled rejection and exact continuity are tested deterministically in the controller suite.

`_targetNavigation` is experimental. Perspective MapView is supported; orthographic/custom
projection target navigation and asynchronous GPU acquisition are not. Async picking falls back
to stock unless a synchronous provider supplies a fresh target. This is not collision avoidance
or a FirstPerson navigation demo. See also `../globe/?target-navigation` for spherical navigation.
