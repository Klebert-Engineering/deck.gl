# GlobeController (Experimental)

Inherits from [Base Controller](./controller.md).

The `GlobeController` class can be passed to either the `Deck` class's [controller](./deck.md#controller) prop or a `View` class's [controller](./view.md#controller) prop to specify that viewport interaction should be enabled.

`GlobeController` is the default controller for [GlobeView](./globe-view.md).

## Usage

Use with the default view:

```js
import {Deck, _GlobeView as GlobeView} from '@deck.gl/core';

new Deck({
  views: new GlobeView(),
  controller: {keyboard: false, inertia: true},
  initialViewState: viewState
});
```

is equivalent to:

```js
import {Deck, _GlobeView as GlobeView} from '@deck.gl/core';

new Deck({
  views: new GlobeView({
    controller: {keyboard: false, inertia: true}
  }),
  initialViewState: viewState
})
```

## Options

Supports all [Controller options](./controller.md#options) with the following default behavior:

- `dragPan`: default `'pan'` (drag to pan)
- `dragRotate`: shift+drag or right-click drag to change bearing and pitch
- `multiTouchDrag`: two-pointer translation can pan or change bearing and pitch
- `keyboard`: arrow keys to pan, +/- to zoom
- `zoomAround`: default `'pointer'`. Pointer zoom rotates the full camera frame around the sphere, so bearing may change as zoom steers around a pole. Use `'center'` to change scale without steering.
- `inertia`: when set to a number (milliseconds), the globe continues spinning after a fling gesture with exponential decay
- `maxBounds` - constrains the viewport to the specified bounding box `[[minLng, minLat], [maxLng, maxLat]]`
- `maxBoundsPadding` - padding inside the viewport when fitting `maxBounds`, using the same `{left, right, top, bottom}` format as view padding. Numeric values are pixels; strings may be percentages or layout expressions such as `calc(10% - 4px)`. Each side is measured from the projected globe center. Default `0`.

## Experimental target navigation

Enable `_targetNavigation` in `GlobeView.controller` to navigate around numeric elevated targets.
`GlobeControllerOptions` and the shared target types are exported from the package root.

```ts
import {_GlobeView as GlobeView, type InteractionTarget} from '@deck.gl/core';

const coordinate: InteractionTarget['coordinate'] = [30, 20, 100000];
const view = new GlobeView({
  controller: {
    _targetNavigation: true,
    getInteractionTarget: ({viewport}) => {
      const information = viewport.getTargetInfo(coordinate);
      return information?.isVisible ? {
        coordinate,
        screenPosition: information.projectedPosition.slice(0, 2) as [number, number]
      } : null;
    }
  }
});
```

The [shared Controller contract](./controller.md#experimental-target-navigation) defines provider
precedence, synchronous picking, coordinate/pixel units, public state, and cancellation. The
provider's viewport type is `GlobeViewport | WebMercatorViewport`, reflecting GlobeView's actual
projection switch. There is no Globe equivalent of Map's application constraint callback yet.

| Operation on the sphere | Invariant |
| --- | --- |
| Pan | Rigidly rotates the spherical camera frame to move the elevated target to the requested pixel; effective magnification and camera distance from the globe origin are preserved. |
| Rotate | Preserves the target pixel and metric camera-target distance. |
| Zoom | Preserves the pixel and changes camera-target distance at the requested scale, respecting an optional metre floor. |
| Pinch | One frozen target and one combined zoom/rotation solve. |

Each animation frame uses the same geometric validation. Active target pan inertia extrapolates
the target pixel through the spherical pan solver; stock navigation retains its native globe-frame
inertia and limb damping. Invalid/clipped/occluded candidates retain the last valid state, without
damping an exact target invariant. This is not terrain or building collision detection.

The initial supported domain is a standard perspective globe, a target on/above the spherical
surface, and a representable bearing/pitch camera with an optional global Cartesian metre offset
in `position`. Globe's position basis differs from Web Mercator's local east/north/up basis.
Custom projection/model matrices, orthographic projection, rubber banding, and below-surface or
sphere-occluded targets are unsupported. Elevated targets beyond the surface horizon remain
usable if their camera-to-target segment clears the sphere. Ordinary stock controls remain available.

Above zoom 12, GlobeView uses Web Mercator. Crossing that boundary ends the old target session,
converts the existing offset basis, and hands navigation to the stock controller with rebased
gesture state. The next session resolves against the new viewport. This avoids trapping wheel
or pinch input at the boundary; it does **not** promise exact target preservation or a seamless
cross-projection animation. At high zoom, a new target session uses the Mercator solver.

FirstPerson dolly, picked Orbit pivots, orthographic target navigation, and async target acquisition
remain follow-up work; they are not enabled by this option.

The [pure JavaScript Globe example](https://github.com/visgl/deck.gl/tree/master/examples/get-started/pure-js/globe)
includes an offline elevated-target demo enabled by the `?target-navigation` query parameter.
It offers built-in picking, numeric provider/null, enable/reset and public-state target indication.
Build this checkout with `corepack yarn build`, then run `npm install` and `npm run start-local`
in `examples/get-started/pure-js/globe`. A local-fork production check is
`npm run build -- --config ../../../vite.config.local.mjs` in that directory. Ordinary stable
npm dependencies do not yet expose this experimental API. The normal non-target example retains
its remote datasets; target mode does not request them.

## Custom GlobeController

You can further customize the `GlobeController`'s behavior by extending the class:

```js
import {Deck, _GlobeView as GlobeView, _GlobeController as GlobeController} from '@deck.gl/core';

class MyGlobeController extends GlobeController {

  handleEvent(event) {
    if (event.type === 'pan') {
      // do something
    } else {
      super.handleEvent(event);
    }
  }
}

new Deck({
  views: new GlobeView(),
  controller: {type: MyGlobeController},
  initialViewState: viewState
})
```

See the `Controller` class [documentation](./controller.md#methods) for the methods that you can use and/or override.


## Source

[modules/core/src/controllers/globe-controller.ts](https://github.com/visgl/deck.gl/blob/master/modules/core/src/controllers/globe-controller.ts)
