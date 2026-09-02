# WebMercatorViewport

The `WebMercatorViewport` class takes map view states (`latitude`, `longitude`, `zoom`, `pitch`, `bearing` etc.), and performs projections between world and screen coordinates. It is tuned to work in synchronization with `mapbox-gl`'s projection matrix.

## Usage

The `WebMercatorViewport` is the default viewport for deck.gl, created under the hood by a [MapView](./map-view.md).

```js
import {WebMercatorViewport} from '@deck.gl/core';

const viewport = new WebMercatorViewport({
  width: 600,
  height: 400,
  longitude: -122.45,
  latitude: 37.78,
  zoom: 12,
  pitch: 30,
  bearing: 15
});

viewport.project([-122.45, 37.78]);
// [300,200]
```


## Constructor

```js
new WebMercatorViewport({width, height, longitude, latitude, zoom, pitch, bearing});
```

Parameters:

* `opts` (object) - Web Mercator viewport options

  + `width` (number) - Width of the viewport.
  + `height` (number) - Height of the viewport.

  web mercator style arguments:

  + `latitude` (number, optional) - Latitude of the viewport center on map. Default to `0`.
  + `longitude` (number, optional) - Longitude of the viewport center on map. Default to `0`.
  + `zoom` (number, optional) - Map zoom (scale is calculated as `2^zoom`). Default to `11`.
  + `pitch` (number, optional) - The pitch (tilt) of the map from the screen, in degrees (0 is straight down). Default to `0`.
  + `bearing` (number, optional) - The bearing (rotation) of the map from north, in degrees counter-clockwise (0 means north is up). Default to `0`.
  + `altitude` (number, optional) - Altitude of camera in screen units. Default to `1.5`.

  projection matrix arguments:

  + `nearZMultiplier` (number, optional) - Scaler for the near plane, 1 unit equals to the height of the viewport. Default to `0.1`.
  + `farZMultiplier` (number, optional) - Scaler for the far plane, 1 unit equals to the distance from the camera to the top edge of the screen. Default to `1.01`.
  + `orthographic` (boolean, optional) - Default `false`.
  + `projectionMatrix` (number[16], optional) - Optional 16-element 4x4 projection matrix, that overrides the matrix created from the parameters above.

Remarks:

* `altitude` has a default value that matches assumptions in mapbox-gl
* `width` and `height` are forced to 1 if supplied as 0, to avoid division by zero. This is intended to reduce the burden of apps to check values before instantiating a `Viewport`.
*  When using Mercator projection, per cartographic tradition, longitudes and latitudes are specified as degrees.
* `latitude` of `90` or `-90` are projected to infinity in [Web Mercator projection](https://en.wikipedia.org/wiki/Web_Mercator_projection). Using pole locations with this viewport may result in `NaN`s. Many base map providers cut off at `85.051129` at which the full world becomes a square.
* When constructing the viewport, a field of view is not specified, but rather is calculated from the `altitude` or (if present) the `projectionMatrix`. The value can be obtained from `this.fovy` (in degrees).

Inherits all [Viewport methods](./viewport.md#methods).

## Methods

Inherits all methods from [Viewport](./viewport.md).

#### `project` {#project}

Projects world coordinates to pixel coordinates on screen.

Parameters:

* `coordinates` (number[]) - `[longitude, latitude, altitude]`. `altitude` is in meters and default to `0` if not supplied.
* `opts` (object)
  + `topLeft` (boolean, optional) - Whether projected coords are top left. Default to `true`.

Returns:

* `[x, y]` or `[x, y, z]` in pixels coordinates. `z` is pixel depth.
  + If input is `[longitude, latitude]`: returns `[x, y]`.
  + If input is `[longitude, latitude: altitude]`: returns `[x, y, z]`.


#### `unproject` {#unproject}

Unproject pixel coordinates on screen into world coordinates.

Parameters:

* `pixels` (number[]) - `[x, y, z]` in pixel coordinates. Passing a `z` is optional.
* `opts` (object)
  + `topLeft` (boolean, optional) - Whether projected coords are top left. Default to `true`.
  + `targetZ` (number, optional) - If pixel depth `z` is not specified in `pixels`, this is used as the elevation plane to unproject onto. Default `0`.

Returns:

* `[longitude, latitude]` or `[longitude, latitude, altitude]` in world coordinates. `altitude` is in meters.
  + If input is `[x, y]` without specifying `opts.targetZ`: returns `[longitude, latitude]`.
  + If input is `[x, y]` with `opts.targetZ`: returns `[longitude, latitude, targetZ]`.
  + If input is `[x, y, z]`: returns `[longitude, latitude, altitude]`.


#### `getDistanceScales` {#getdistancescales}

Returns an object with scale values supporting first order (linear) and second order (quadratic) approximations of the local Web Mercator projection scale around the viewport center. Error increases with distance from viewport center (very roughly 1% per 100km in linear mode, quadratic approximation does significantly better).

Returns:

* An object with precalculated distance scales allowing conversion between lnglat deltas, meters and pixels.


#### `addMetersToLngLat` {#addmeterstolnglat}

Add a meter delta to a base lnglat coordinate using linear approximation. For information on numerical precision, see remarks on [`getDistanceScales`](#getdistancescales).

Parameters:

* `lngLatZ` (number[]) - Base coordinate in `[longitude, latitude, altitude]`. Passing a `altitude` is optional.
* `xyz` (number[]) - Array of `[x, y, z]` in meter deltas. Passing a `z` is optional.

Returns:

* New coordinate array in `[longitude, latitude]` or `[longitude, latitude, altitude]` if `z` is provided.

#### `panByPosition3D` {#panbyposition3d}

Returns an approximate longitude and latitude correction for moving a 3D world coordinate toward a screen pixel. This compatibility helper accounts for the coordinate's altitude in one geographic-coordinate step, but may retain visible error when the viewport has a nonzero `position`. Use [`getTargetPanViewState`](#gettargetpanviewstate) when a complete, exact target-relative planar state is required.

Parameters:

* `coords` (number[]) - `[longitude, latitude, altitude]` world coordinate to keep fixed. `altitude` is in meters and defaults to `0` if not supplied.
* `pixel` (number[]) - `[x, y]` screen pixel position where the coordinate should remain.

Returns:

* An object with `{longitude, latitude}` representing the new viewport center.

#### `getTargetPanViewState` {#gettargetpanviewstate}

Reconstructs a complete canonical map view state after translating the camera parallel to the world plane. The supplied target is placed at the requested view-local `screenPosition` by translating the frozen viewport center in common-space X/Y while preserving common-space center Z, zoom, bearing, and pitch. Camera-target radius is intentionally allowed to change; use [`getTargetViewState`](#gettargetviewstate) for radius-preserving orbit or zoom.

Call this method on the operation-start viewport and rebuild the returned state with the same dimensions, lens, padding, clipping, model transform, and world-copy configuration. It returns `null` for unsupported projection modes, nonfinite or singular input, and parallel, backward, or near/far-clipped pixel-ray intersections. No partial state is returned.

Parameters:

* `options.target` (number[3]) - Numeric `[longitude, latitude, altitude]` target.
* `options.screenPosition` (number[2]) - Desired view-local `[x, y]` pixel. It may be outside the viewport for an already active drag or transition.

Returns:

* A complete `{longitude, latitude, zoom, bearing, pitch, position}` map view state, or `null` when no supported finite representation exists.

#### `getTargetInfo` {#gettargetinfo}

Returns camera-relative information for a numeric `[longitude, latitude, altitude]` target. The result contains the target localized to the rendered world copy, its view-local projected position, physical camera distance, camera depth, near and far distances, and two distinct validity fields:

* `isValid` is `true` when the target is finite, in front of the camera, and strictly inside the near/far clip volume.
* `isVisible` is `true` when the target is valid and its projected x/y position is inside the viewport's pixel bounds.

A target dragged outside the viewport can therefore remain valid even though it is no longer visible. Target acquisition normally requires `isVisible`; an already active target uses `isValid` so offscreen drag and inertia can continue. The method returns `null` when target navigation is unsupported or the input coordinate itself cannot be evaluated. An evaluated coordinate may return a result with both fields set to `false`.

Parameters:

* `target` (number[3]) - Numeric `[longitude, latitude, altitude]` target.

Returns:

* Camera-relative target metrics, or `null` when the projection mode or input coordinate cannot be evaluated.

#### `getTargetViewState` {#gettargetviewstate}

Reconstructs a canonical map view state around a numeric target at the requested view-local `screenPosition`. This pixel is independent of the target's position in the source viewport: it may move between calls and may be outside the viewport. The optional `bearing`, `pitch`, and `zoom` fields default to the source viewport. A zoom change scales the physical camera-to-target radius by `2 ** (sourceZoom - requestedZoom)`; changing only bearing or pitch therefore performs a rigid orbit.

`minimumTargetDistance` optionally sets a non-negative physical camera-to-target floor in metres. `0` or omission disables it. Zoom-in is clamped analytically at that floor, and the returned `zoom` is the effective value after clamping. If the source camera is already closer than the requested minimum, its source distance is used as the floor so the operation does not jump outwards. Zoom-out is unaffected. A negative or nonfinite minimum returns `null`.

Call this method on the operation-start viewport and reuse that viewport for all frames in one interaction. Reconstruct the returned state with the same lens, padding, clipping, model transform, and world-copy configuration before validating it. The method returns `null` when there is no finite supported representation, including a source target behind or outside the clip volume.

The first experimental version supports standard perspective `WebMercatorViewport`. Orthographic mode and custom projection matrices are intentionally unsupported and return `null`. Picking is not performed by this viewport method, so asynchronous/WebGPU picking does not affect the calculation once the application already has a numeric target.

Parameters:

* `options.target` (number[3]) - Numeric `[longitude, latitude, altitude]` target.
* `options.screenPosition` (number[2]) - Desired view-local `[x, y]` pixel. It may be outside the viewport for an already active target.
* `options.bearing` (number, optional) - Requested bearing. Defaults to the source viewport.
* `options.pitch` (number, optional) - Requested pitch. Defaults to the source viewport.
* `options.zoom` (number, optional) - Requested zoom. Defaults to the source viewport.
* `options.minimumTargetDistance` (number, optional) - Non-negative physical camera-to-target floor in metres. `0` disables the floor.

Returns:

* A complete `{longitude, latitude, zoom, bearing, pitch, position}` map view state using the effective (possibly clamped) zoom, or `null` when no supported finite representation exists.

These target operations are the viewport primitives used by experimental [`MapController` target navigation](./map-controller.md#experimental-target-navigation). They do not acquire or retain interaction targets themselves.

#### `fitBounds` {#fitbounds}

Returns a new viewport that fit around the given bounding box. Viewport `width` and `height` must be either set or provided as options. Only supports non-perspective mode.

Parameters:

* `bounds` (number[2][2]) - Bounding box in `[[longitude, latitude], [longitude, latitude]]`.
* `opts` (object) - See additional options in [@math.gl/web-mercator](https://math.gl/modules/web-mercator/docs/api-reference/web-mercator-utils#fitboundsopts)
  + `width` (number) - If not supplied, will use the current width of the viewport (default `1`)
  + `height` (number) - If not supplied, will use the current height of the viewport (default `1`)
  + `minExtent` (number) - In degrees, 0.01 would be about 1000 meters
  + `maxZoom` (number) - Max zoom level
  + `padding` (number) - The amount of padding in pixels to add to the given bounds.
  + `offset` (number[2]) - The center in `[x, y]` of the given bounds relative to the map's center measured in pixels.
  
Returns: 

* New `WebMercatorViewport` fit around the given bounding box.

Example zooming to layer when it's loaded:


import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="language">
  <TabItem value="ts" label="TypeScript">

```ts
import {Deck, WebMercatorViewport} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';

const layer = new ScatterplotLayer({...});

const deckInstance = new Deck({
  initialViewState: {
    longitude: -100,
    latitude: 40,
    zoom: 4
  },
  controller: true,
  layers: [layer],
  onAfterRender
});

let hasLoaded = false;
function onAfterRender() {
  if (!hasLoaded && layer.isLoaded) {
    hasLoaded = true;

    const viewport = layer.context.viewport as WebMercatorViewport;
    const {longitude, latitude, zoom} = viewport.fitBounds(layer.getBounds());
    deckInstance.setProps({
      initialViewState: {longitude, latitude, zoom}
    });
  }
}
```

  </TabItem>
  <TabItem value="react" label="React">

```tsx
import React, {useState, useEffect} from 'react';
import {DeckGL} from '@deck.gl/react';
import {WebMercatorViewport, MapViewState} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';

function App() {
  const [initialViewState, setInitialViewState] = useState<MapViewState>({
    longitude: -100,
    latitude: 40,
    zoom: 4
  });
  const [hasLoaded, setHasLoaded] = useState<boolean>(false);

  const layer = new ScatterplotLayer({...});

  const onAfterRender = () => {
    if (!hasLoaded && layer.isLoaded) {
      setHasLoaded(true);

      const viewport = layer.context.viewport as WebMercatorViewport;
      const {longitude, latitude, zoom} = viewport.fitBounds(layer.getBounds());
      setInitialViewState({longitude, latitude, zoom});
    }
  };

  return <DeckGL
    initialViewState={initialViewState}
    controller
    layers={[layer]}
    onAfterRender
  />;
}
```

  </TabItem>
</Tabs>



## Remarks

* Because `WebMercatorViewport` a subclass of `Viewport`, an application can implement support for generic 3D `Viewport`s and automatically get the ability to accept web mercator style map coordinates.
* A limitation at the moment is that there is no way to extract web mercator parameters from a "generic" viewport, so for map synchronization applications (rendering on top of a typical map component that only accepts web mercator parameters) the `WebMercatorViewport` is necessary.
* Facilitates the necessary mercator projections by breaking them into a minimal non-linear piece followed by a standard projection chain.
* Making deck.gl work with non-mapbox map systems **in perspective mode** might require subclassing `WebMercatorViewport` and adjust the projection so it matches the map's projection.


## Source

[modules/core/src/viewports/web-mercator-viewport.ts](https://github.com/visgl/deck.gl/blob/master/modules/core/src/viewports/web-mercator-viewport.ts)
