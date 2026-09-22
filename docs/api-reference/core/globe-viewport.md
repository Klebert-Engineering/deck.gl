# GlobeViewport (Experimental)

The `GlobeViewport` class takes globe view states (`latitude`, `longitude`, `zoom`, `bearing`, and `pitch`), and performs projections between world and screen coordinates. It is a helper class for visualizing the earth as a 3D globe.

## Usage

A `GlobeViewport` instance is created under the hood by a [GlobeView](./globe-view.md).

```js
import {_GlobeViewport as GlobeViewport} from '@deck.gl/core';

const viewport = new GlobeViewport({
  width: 600,
  height: 400,
  longitude: -122.45,
  latitude: 37.78,
  zoom: 12
});

viewport.project([-122.45, 37.78]);
// [300,200]
```


## Constructor

```js
new GlobeViewport({width, height, longitude, latitude, zoom, bearing, pitch});
```

Parameters:

* `opts` (object) - Globe viewport options

  + `width` (number) - Width of the viewport.
  + `height` (number) - Height of the viewport.

  geospatial arguments:

  + `latitude` (number, optional) - Latitude of the viewport center on map. Default to `0`.
  + `longitude` (number, optional) - Longitude of the viewport center on map. Default to `0`.
  + `zoom` (number, optional) - Map zoom, with latitude-dependent scale compensation. Default to `0`.
  + `bearing` (number, optional) - Bearing angle in degrees. Default to `0`.
  + `pitch` (number, optional) - Pitch angle in degrees. Default to `0`.
  + `altitude` (number, optional) - Altitude of camera, 1 unit equals to the height of the viewport. Default to `1.5`.

  projection matrix arguments:

  + `nearZMultiplier` (number, optional) - Scaler for the near plane, 1 unit equals to the height of the viewport. Default to `0.5`.
  + `farZMultiplier` (number, optional) - Scaler for the far plane, 1 unit equals to the distance from the camera to the top edge of the screen. Default to `1`.

Remarks:

* `width` and `height` are forced to 1 if supplied as 0, to avoid division by zero. This is intended to reduce the burden of apps to check values before instantiating a `Viewport`.
*  Per cartographic tradition, longitudes and latitudes are specified as degrees.

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


### Experimental target operations

These operations are used by [GlobeController](./globe-controller.md#experimental-target-navigation).
They do not acquire targets or own gesture lifetime. Rebuild returned state with the source
viewport's dimensions, lens, padding, and clipping settings, then apply controller constraints
and validate again. `supportsTargetNavigation` identifies standard perspective projection support;
individual candidates can still be invalid.

#### `getTargetInfo(target)`

Accepts `[longitude, latitude, altitude]` and returns `GlobeTargetInfo` or `null`. The result contains
the target, projected CSS pixel/depth, metric `targetDistance`, view-space `cameraDepth`, `near`
and `far`, `isValid`, and `isVisible`. Validity checks clipping and sphere occlusion; visibility
additionally requires a pixel inside the viewport. These are not general scene-occlusion checks.
Unsupported projections, below-surface targets, and malformed inputs return `null`.

#### `getTargetViewState({target, screenPosition, bearing?, pitch?, zoom?, minimumTargetDistance?})`

Constructs a target-relative perspective pose, preserving the pixel and the source geographic
reference frame. At that fixed latitude, physical distance scales by `2 ** (sourceZoom - zoom)`.
The metre floor is analytical; an initially closer camera is not moved outwards. Returns canonical
`GlobeTargetViewState` (`longitude`, `latitude`, `zoom`, `bearing`, `pitch`, `position`) or `null` for
no solution. `position` is a global Globe Cartesian metre offset, not longitude/latitude/altitude
or a Mercator east/north/up offset. No roll state is introduced.

#### `getTargetPanViewState({target, screenPosition})`

Moves the target to a new pixel by a rigid spherical camera-frame rotation. Preserves effective
scale, pitch, and camera distance from the sphere origin; target distance may change. Longitude,
latitude, bearing, zoom compensation, and the Cartesian offset rotate together. Returns canonical
state or `null` when the requested pixel cannot be reached by a valid spherical pan.

The root package exports `GlobeTargetInfo`, `GlobeTargetViewState`,
`GlobeTargetViewStateOptions`, and `GlobeTargetPanViewStateOptions`. Orthographic/custom projections
and custom model matrices are outside this initial target-navigation contract.

## Source

[modules/core/src/viewports/globe-viewport.ts](https://github.com/visgl/deck.gl/blob/master/modules/core/src/viewports/globe-viewport.ts)
