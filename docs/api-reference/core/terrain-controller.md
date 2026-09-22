# TerrainController

Inherits from [MapController](./map-controller.md).

The `TerrainController` extends `MapController` with terrain-aware navigation. As the user pans and zooms, the controller automatically adjusts the camera's elevation to follow the terrain, providing a natural navigation experience over 3D tilesets and elevated terrain.

## Requirements

`TerrainController` works by picking the terrain elevation at the center of the viewport. For this to work, at least one layer in the scene must use the `pickable: '3d'` option. For example:

```js
import {Tile3DLayer} from '@deck.gl/geo-layers';

new Tile3DLayer({
  // ...
  pickable: '3d'
});
```

Without a `pickable: '3d'` layer, the controller has no elevation data and will behave like a standard `MapController`.

## Usage

Use with the default view:

```js
import {Deck, TerrainController} from '@deck.gl/core';

new Deck({
  controller: {type: TerrainController},
  initialViewState: viewState
});
```

is equivalent to:

```js
import {Deck, MapView, TerrainController} from '@deck.gl/core';

new Deck({
  views: new MapView({
    controller: {type: TerrainController}
  }),
  initialViewState: viewState
});
```

## Options

Supports all [MapController options](./map-controller.md#options) with the following defaults:

- `rotationPivot` - default `'3d'` (rotate around the picked object under the pointer)

## Experimental target navigation

Enable the inherited [`_targetNavigation`](./map-controller.md#experimental-target-navigation)
option to combine elevated target navigation with terrain following:

```js
new MapView({
  controller: {type: TerrainController, _targetNavigation: true}
});
```

Target anchoring owns the camera for the complete gesture, wheel burst and target-aware
transition. During that time TerrainController suspends periodic center picking and altitude
writes. Its default `rotationPivot: '3d'` still applies to stock rotation when no target is acquired.

After all target owners release, the normal animation-frame sampling loop obtains a fresh,
valid center elevation (at most one sampling opportunity per 500 ms, never while dragging).
Cold initialization and resumption of an already warm cache use the same handoff. In supported
perspective Web Mercator views, the controller changes the elevation reference while preserving
the actual XYZ camera pose, orientation, lens and projected scene. Longitude/latitude, zoom and
the normalized `position` may change to represent that same camera. Do not reset `position.z`
to the picked altitude: the new center can have a different local metre scale.

The rebase is checked after ordinary map constraints. Missing/nonfinite or mismatched-view
samples, clipping, a reference above the camera, or constraints preventing an equivalent pose
leave the accepted camera unchanged. While waiting, stock input passes through without stale
terrain-altitude overwrites. A controlled application must accept the proposed equivalent
view state before terrain following initializes; delayed/rejected feedback does not initialize
against an undisplayed proposal or repeatedly emit it every frame. Camera/configuration changes
invalidate pending assumptions. Finalization cancels pending work and sampling.

After a successful handoff, subsequent stock input uses the existing terrain smoothing rate.
This preserves the camera during the reference change; it does not disable intentional terrain
following, define collision avoidance, or supply Erdblick-style selected-object policy.
Orthographic/custom projections and legacy metre sizing retain their stock Terrain behavior,
without the perspective target-handoff guarantee. Invertible Map model transforms remain supported.

The inherited provider contract is unchanged: `getInteractionTarget` supplies a fresh numeric
target synchronously; returning `null` is authoritative stock fallback. It does **not** supply the
separate terrain-center elevation sample. Built-in target and terrain picking require synchronous
GPU picking. In async/WebGPU mode, a synchronous provider can enable target navigation, but
cannot by itself restore terrain-center sampling.

## Runnable example

The [pure JavaScript Map/Terrain example](https://github.com/visgl/deck.gl/tree/master/examples/get-started/pure-js/target-navigation)
uses in-memory pickable geometry, not a remote TerrainLayer or tile service. It includes controller,
acquisition and enable/reset controls and a non-pickable public-state target indicator.

To test this experimental checkout, run `corepack yarn build` at the repository root, then
`npm install` and `npm run start-local` in `examples/get-started/pure-js/target-navigation`.
Check the local-fork production bundle with
`npm run build -- --config ../../../vite.config.local.mjs` from that directory. The example's
ordinary stable-package commands are not a test of the unpublished experimental API.

## Source

[modules/core/src/controllers/terrain-controller.ts](https://github.com/visgl/deck.gl/blob/master/modules/core/src/controllers/terrain-controller.ts)
