# MapController

Inherits from [Base Controller](./controller.md).

The `MapController` class can be passed to either the `Deck` class's [controller](./deck.md#controller) prop or a `View` class's [controller](./view.md#controller) prop to specify that map interaction should be enabled.

`MapController` is the default controller for [MapView](./map-view.md)..

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
- `_targetNavigation` (boolean, experimental) - Keeps one numeric 3D target at its acquired screen position while panning, zooming, rotating, and during controller-generated transitions. Pan translates the camera parallel to the target's common-space plane; rotate and zoom preserve or scale camera-target radius. Default `false`. This option currently supports perspective `MapView` with deck.gl's standard projection matrix. Orthographic views, custom projection matrices, and controllers configured with `rubberBand` use standard `MapController` behavior.
- `getInteractionTarget` (Function, optional) - Synchronously returns a fresh numeric target for `_targetNavigation`, or `null` to use standard behavior. When supplied, this callback is authoritative: returning `null` does not fall through to deck.gl picking. It receives `{viewId, operation, source, screenPosition, viewport}` and returns `{coordinate: [longitude, latitude, altitude], screenPosition: [x, y], minimumTargetDistance?}`. `minimumTargetDistance` is an optional non-negative physical camera-to-target distance in metres; `0` or omission disables the limit. Both screen positions are view-local; the result pixel is the coordinate's honest projected position and may differ from the raw acquisition pixel for snapped geometry. Pointer/touch drags report their reconstructed gesture origin, trackpad gestures report the first recognized sample, and pointerless keyboard interactions pass `screenPosition: null`. Exceptions clear target bookkeeping and propagate to the event caller.
- `constrainInteractionTargetViewState` (Function, optional) - Synchronously applies an application policy to each target-relative camera candidate. It receives `{viewId, operation, source, target, sourceViewport, currentViewState, requestedViewState}` and returns a complete canonical map view state or `null`. `target.screenPosition` is the desired view-local pixel for the current candidate; it moves during drag-pan and pan-inertia frames and may be outside the viewport. `sourceViewport` is the operation-start viewport and is reused for the active target session. `currentViewState` is the last accepted state, while `requestedViewState` is deck.gl's direct camera inverse before ordinary map constraints and final target validation.

The `operation` is one of `'pan'`, `'zoom'`, `'rotate'`, or `'pinch'`, and `source` is one of `'pointer'`, `'touch'`, `'trackpad'`, `'wheel'`, `'doubleClick'`, or `'keyboard'`.

If no `getInteractionTarget` callback is supplied, deck.gl tries its controller-facing synchronous 3D picker. This fallback requires a layer with `pickable: '3d'`. In asynchronous picking mode, including WebGPU, it is unavailable and the controller uses its standard interaction behavior. An application provider may still be used in asynchronous picking mode if it can produce a fresh target synchronously.

The target contract is numeric and application-agnostic. Feature IDs, selected objects, and other application semantics are not retained by the controller. A target (including `minimumTargetDistance`), its provider result, the operation-start viewport, and the constraint callback are frozen at the start of a gesture, wheel burst, or transition. Changing either callback therefore affects the next target session, not one already in progress. A negative or nonfinite minimum rejects target acquisition. If the camera starts inside a positive minimum, that acquisition distance becomes the session floor: deck.gl does not jump the camera outwards, but further zoom-in cannot reduce the distance. Zoom-out remains unrestricted.

For each candidate, deck.gl performs the operation-specific target-relative camera inverse, calls `constrainInteractionTargetViewState`, applies the normal `MapState` constraints, then validates finiteness, clipping, target pixel, the operation's invariant, and the session minimum distance. Pan preserves common-space center Z, zoom, bearing, and pitch while translating in common X/Y. Rotate and zoom preserve or scale physical radius; if the callback changes zoom, the expected radius is recomputed from that accepted zoom. The zoom inverse applies the minimum analytically, so one coarse zoom request and equivalent fine requests converge on the same physical limit. This order also runs on every intermediate controller-transition frame. Returning `null`, an incomplete state, or a nonfinite state rejects that candidate and keeps the last valid camera state. An exception clears the public target lifecycle and propagates from `handleEvent` or `updateTransition`; deck.gl does not silently convert application errors into stock navigation.

Target acquisition requires a visible, valid target. After acquisition, a drag or transition may move the frozen target outside the viewport as long as it remains finite, front-facing, and inside the camera clip volume. If any later candidate is clipped, singular, or cannot be represented by canonical map state, the controller keeps the last valid state.

Both application callbacks are synchronous. They must not synchronously call `Controller.setProps`; doing so throws so that transition and event configuration cannot be partially replaced from inside a camera-state transaction. Schedule application state changes after the callback returns instead. Orthographic `MapView`, custom projection matrices, and `rubberBand` take the complete stock-controller path before either callback is invoked. With asynchronous picking, including WebGPU, only the built-in controller picker is unavailable: a synchronous `getInteractionTarget` provider and constraint callback can still enable target navigation for a supported perspective viewport.

### `resolveInteractionTarget` {#resolveinteractiontarget}

This protected method is the controller-level resolver used by target navigation. It receives the view-local pointer position (or `null` for pointerless input), operation, and source, and returns a numeric `MapInteractionTarget` or `null`. The default implementation invokes `getInteractionTarget` when supplied, otherwise tries deck.gl's synchronous controller picker. Subclasses may override it, but returned targets are still copied and checked against the current perspective viewport before acquisition.

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
