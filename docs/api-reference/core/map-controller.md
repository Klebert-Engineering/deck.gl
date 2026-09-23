# MapController

Inherits from [Base Controller](./controller.md).

The `MapController` class can be passed to either the `Deck` class's [controller](./deck.md#controller) prop or a `View` class's [controller](./view.md#controller) prop to specify that map interaction should be enabled.

`MapController` is the default controller for [MapView](./map-view.md).

## Usage

Use with the default view:

```js
import {Deck} from '@deck.gl/core';

new Deck({
  controller: {doubleClickZoom: false, inertia: true},
  initialViewState: viewState
});
```

is equivalent to:

```js
import {Deck} from '@deck.gl/core';

new Deck({
  views: new MapView({
    controller: {doubleClickZoom: false,  inertia: true}
  }),
  initialViewState: viewState
})
```

## Options

Supports all [Controller options](./controller.md#options) with the following default behavior:

- `dragMode` - default `'pan'` (drag to pan, shift/ctrl + drag to rotate)
- `keyboard` - arrow keys to pan, arrow keys with shift/ctrl down to rotate, +/- to zoom
- `normalize` - normalize viewport props to fit map height into viewport. Default `true`
- `maxBounds` - constrains the viewport to the specified geographic bounding box `[[minLng, minLat], [maxLng, maxLat]]`
- `maxBoundsPadding` - padding inside the viewport when fitting `maxBounds`, using the same `{left, right, top, bottom}` format as view padding. Numeric values are pixels; strings may be percentages or layout expressions such as `calc(10% - 4px)`. Each side is measured from the projected map center. Default `0`.
- `rubberBand` (boolean) - allows continuous pan and zoom interactions to temporarily overshoot `maxBounds`, `minZoom`, and `maxZoom` with increasing resistance. On release, the view returns within constraints using a 300 ms exponential ease-out independently of `inertia`. Default `false`.
- `rotationPivot` (string, optional) - Determines the pivot point used when rotating the map. Default `'center'`. Supported values:
  - `'center'` - Rotate around the center of the viewport.
  - `'2d'` - Rotate around the pointer position projected onto the ground plane (z=0).
  - `'3d'` - Rotate around the picked object under the pointer. Falls back to `'center'` behavior if no pickable object is found. Requires at least one layer with `pickable: '3d'`.
- `_targetNavigation` (boolean, experimental) - Enables target-relative 3D pan, zoom, rotation, and controller-generated transitions. Default `false`. See [Experimental target navigation](#experimental-target-navigation).
- `getInteractionTarget` (Function, optional) - Supplies a synchronous application target for experimental target navigation. A configured provider is authoritative: returning `null` selects standard `MapController` behavior instead of falling through to deck.gl picking.
- `constrainInteractionTargetViewState` (Function, optional) - Applies a synchronous application policy to each target-relative camera candidate before ordinary map constraints and final target validation.

### Experimental target navigation {#experimental-target-navigation}

`_targetNavigation` keeps one numeric 3D coordinate at an acquired view-local pixel for the lifetime of a gesture, wheel burst, or controller-generated transition. The option is disabled by default and currently supports perspective [`MapView`](./map-view.md) with deck.gl's standard projection matrix.

Acquisition and lifecycle are shared with other participating controllers; see the
[base Controller contract](./controller.md#experimental-target-navigation). `MapControllerOptions`
specializes `TargetNavigationOptions<WebMercatorViewport>`. The `MapInteractionTarget*` and
`GetMapInteractionTarget` exports remain compatible aliases; new code may use
`InteractionTarget` and `InteractionTargetContext<WebMercatorViewport>`.

For a runnable offline comparison, see the
[Map/Terrain example](https://github.com/visgl/deck.gl/tree/master/examples/get-started/pure-js/target-navigation)
and its [local-fork run instructions](./terrain-controller.md#runnable-example).
[TerrainController](./terrain-controller.md#experimental-target-navigation) suspends elevation
following throughout target ownership and validates a pose-preserving handoff before resuming it.

The camera invariant depends on the operation:

| Operation | Target-relative behavior |
| --- | --- |
| Pan | Translates the camera and viewport center in Web Mercator common X/Y. Common-space center Z, zoom, bearing, and pitch remain unchanged; camera-target distance may change. |
| Rotate | Keeps the target pixel fixed and preserves physical camera-target distance. |
| Zoom | Keeps the target pixel fixed and scales physical camera-target distance according to the requested zoom, subject to an optional minimum distance. |
| Pinch | Shares one frozen target while applying the combined zoom and rotation contract. |

Controller-generated pan inertia, smooth wheel, double-click, and keyboard transitions enforce the same operation-specific invariant on every frame. If a frame is clipped, singular, nonfinite, or violates the invariant after constraints, the camera remains at the last valid state.

#### Target acquisition

The [shared Controller contract](./controller.md#experimental-target-navigation) defines callback
fields, provider precedence, input origins, numeric snapshots, picking and public-state lifetime.
For Map, the provider receives a `WebMercatorViewport` and returns a geographic target:

```ts
type MapInteractionTarget = {
  coordinate: [longitude: number, latitude: number, altitude: number];
  screenPosition: [x: number, y: number];
  minimumTargetDistance?: number;
};
```

`screenPosition` is the target coordinate's honest projected view-local pixel. It may differ from the raw acquisition pixel when an application snaps from rendered geometry to a source coordinate. `minimumTargetDistance` is a non-negative physical camera-to-target floor in metres; `0` or omission disables it. A negative or nonfinite value rejects acquisition.

Once acquired, the target may move outside the viewport during a drag or transition as long as it remains otherwise valid.

If the camera starts closer than a positive `minimumTargetDistance`, the acquisition distance becomes the session floor. This avoids an outward jump while preventing further zoom-in. Zoom-out remains unrestricted. The viewport applies the floor analytically, so one coarse zoom request and equivalent smaller requests converge on the same physical limit.

Orthographic `MapView`, custom projection matrices, legacy metre sizing, and controllers configured with `rubberBand` take the complete standard-controller path without invoking either target callback. Overlapping independent pinch/multipan recognizers use the rebased stock handoff described in the base Controller contract.

#### Target constraints and lifecycle

`constrainInteractionTargetViewState` receives `{viewId, operation, source, target, sourceViewport, currentViewState, requestedViewState}` for every direct input and intermediate transition frame. `target.screenPosition` is the desired pixel for that candidate; it moves during target pan and pan inertia and may be offscreen. `sourceViewport` is frozen at acquisition, `currentViewState` is the last accepted canonical state, and `requestedViewState` is deck.gl's direct camera inverse.

The callback must return a complete canonical map view state or `null`. Deck then applies ordinary `MapState` constraints and validates finiteness, clipping, target pixel, the operation-specific invariant, and the session minimum distance. A rejected result keeps the last valid state.

The synchronous constraint callback is frozen for an active session; replacements affect the next session. It must not call `Controller.setProps` synchronously; doing so throws to prevent partial controller reconfiguration. Exceptions clear target ownership and propagate from `handleEvent` or `updateTransition`, following the shared lifecycle contract.

### `resolveInteractionTarget` {#resolveinteractiontarget}

Inherited from [Controller](./controller.md#resolveinteractiontarget). Map validates the resolved numeric target against the current perspective `WebMercatorViewport`; subclasses do not bypass that validation.

## Custom MapController

You can further customize the `MapController`'s behavior by extending the class:

```js
import {Deck, MapController} from '@deck.gl/core';

class MyMapController extends MapController {

  handleEvent(event) {
    if (event.type === 'pan') {
      // do something
    } else {
      super.handleEvent(event);
    }
  }
}

new Deck({
  controller: {type: MyMapController},
  initialViewState: viewState
})
```

See the `Controller` class [documentation](./controller.md#methods) for the methods that you can use and/or override.


## Source

[modules/core/src/controllers/map-controller.ts](https://github.com/visgl/deck.gl/blob/master/modules/core/src/controllers/map-controller.ts)
