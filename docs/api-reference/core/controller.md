# Controller

The base class for all viewport controllers.

A controller class can be passed to either the `Deck` class's [controller](./deck.md#controller) prop or a `View` class's [controller](./view.md#controller) prop to specify viewport interactivity.


## Options

The base Controller class supports the following options:

* `scrollZoom` (boolean | object) - enable zooming with mouse wheel. Default `true`. If an object is supplied, it may contain the following fields to customize the zooming behavior:
  + `speed` (number) - scaler that translates wheel delta to the change of viewport scale. Default `0.01`.
  + `smooth` (boolean) - smoothly transition to the new zoom. If enabled, will provide a slightly lagged but smoother experience. Default `false`.
* `dragPan` (boolean) - enable panning with pointer drag. Default `true`
* `zoomAround` (`'pointer' | 'center'`) - use the pointer or the padding-adjusted viewport center for wheel, pinch, and double-click zoom. Default `'pointer'`.
* `dragRotate` (boolean) - enable rotating with pointer drag. Default `true`
* `doubleClickZoom` (boolean) - enable zooming with double click. Default `true`. Adds ~300ms latency to click events due to the tap recognizer waiting to distinguish single clicks from double clicks. Set to `false` for immediate click response. Note: disabling also prevents `onClick` from firing with `tapCount: 2` on double-click.
* `doubleClickDragZoom` (boolean) - enable zooming by double clicking/tapping and dragging. Default `false`. Enabling adds ~300ms latency to click events due to the tap recognizer waiting to distinguish single clicks from double-click-drags.
* `touchZoom` (boolean) - enable zooming with multi-touch pinch. Default `true`
* `multiTouchDrag` ('pan' | 'rotate' | null) - behavior of two-pointer translation gestures. In `pan` mode, two-finger swiping pans the viewport. In `rotate` mode, horizontal swiping changes bearing and vertical swiping changes pitch. Default `null` (disabled).
* `trackpadGesture` (boolean) - treat trackpad similar to a touch screen instead of a mouse. Default `false`.
  + When `true`, two-finger gesture on the trackpad emits multi-touch pinch or drag events.
  + When `false`, two-finger gesture on the trackpad emits wheel scroll events.
* `keyboard` (boolean | object) - enable interaction with keyboard. Default `true`. If an object is supplied, it may contain the following fields to customize the keyboard behavior:
    * `zoomSpeed` (number) - speed of zoom using +/- keys. Default `2`.
    * `moveSpeed` (number) - speed of movement using arrow keys, in pixels.
    * `rotateSpeedX` (number) - speed of rotation using shift + left/right arrow keys, in degrees. Default `15`.
    * `rotateSpeedY` (number) - speed of rotation using shift + up/down arrow keys, in degrees. Default `10`.
* `dragMode` (string) - drag behavior without pressing function keys, one of `pan` and `rotate`.
* `zoomAround` (`'pointer' | 'center'`) - screen position that remains fixed during wheel, pinch, double-click, and double-click-drag zoom. The option is shared by all controllers. Pointer-based controls default to `'pointer'`; use `'center'` to keep the viewport's projected center fixed, including any offset created by view padding. Keyboard zoom remains center-based because it has no pointer position.
* `inertia` (boolean | number) - Enable inertia after panning/pinching. If a number is provided, indicates the duration of time over which the velocity reduces to zero, in milliseconds. Default `false`.
* `maxBounds` (`[min: number[], max: number[]]`) - constrain camera to the specified bounding box. Different type of views may handle this constraint differently.
* `maxBoundsPadding` (`{left, right, top, bottom}`) - padding inside the viewport when fitting `maxBounds`, in the shape of `{left, right, top, bottom}` where each value is either a relative (e.g. `'50%'`) or absolute pixels. These values support the same CSS-style expressions (numbers/percentages/`px` with parentheses and `calc()` addition/subtraction) as view `x`, `y`, `width`, `height`, and `padding`. This can be used to move the target rectangle away from the center of the viewport. A non-positive remaining dimension does not contribute a zoom constraint; a negative remaining dimension also disables target constraints. Default `0`.

> **Mobile users:** See [Optimization for Mobile](../../developer-guide/tips-and-tricks.md#optimization-for-mobile) for CSS and browser event guards that help prevent native selection, tap highlight, and touch callout UI during repeated touch gestures.

## Experimental target navigation

`MapController` and `GlobeController` support the disabled-by-default `_targetNavigation`
option and a synchronous `getInteractionTarget` provider. The base Controller owns acquisition,
gesture/animation lifetime, cancellation, and public interaction state. Each concrete state and
viewport owns its camera transform and validation. Enabling the option does not enable target
navigation in FirstPerson, Orbit, Orthographic, or an unsupported custom controller.

### Numeric contract

The root exports of `@deck.gl/core` and `deck.gl` include `InteractionTarget`,
`InteractionTargetContext<ViewportT>`, `GetInteractionTarget<ViewportT>`, and
`TargetNavigationOptions<ViewportT>`. Do not use deep imports.

```ts
type InteractionTarget = {
  coordinate: [number, number, number];
  screenPosition: [number, number];
  minimumTargetDistance?: number;
};
```

`coordinate` uses the active viewport's world-coordinate convention, as consumed by
`viewport.project`: longitude/latitude/altitude for Map and Globe, not layer-local or common
coordinates. `screenPosition` is its honest projected, top-left, view-local CSS pixel; it may
differ from the input pixel because of application snapping. It is not a canvas-global or device
pixel. The optional distance floor is measured in metres for Map and Globe. A future Cartesian
implementation must define its own world-length units; there is no universal radius contract.

The provider receives `{viewId, operation, source, screenPosition, viewport}`:

- `operation`: `pan`, `zoom`, `rotate`, or `pinch`.
- `source`: `pointer`, `touch`, `trackpad`, `wheel`, `doubleClick`, or `keyboard`.
- `screenPosition`: reconstructed pointer/touch pan or rotation origin, first trackpad sample,
  or `null` for keyboard input. Pinch starts at the recognized center; zoom acquisition honors
  `zoomAround`, including padding.
- `viewport`: the actual immutable viewport, not a viewport inferred from the controller name.

The provider must synchronously return a fresh numeric target or `null`. A configured provider
is authoritative: `null` selects stock navigation without falling through to picking. With no
provider, Controller attempts one synchronous 3D pick and rejects results owned by another view
or projection. This is not deep picking. The built-in path is unavailable in async/WebGPU picking
mode; a fresh synchronous provider can still work there. Promises, stale feature objects, and
asynchronous target acquisition are not supported.

### Lifetime and fallback

The resolver's result is numerically copied and geometrically validated after any subclass
override. Acquisition requires a finite, front-facing, visible, unclipped target. The coordinate
and distance policy are then frozen for one gesture, wheel burst, and its generated animations.
Replacing a provider affects the next acquisition, not the active snapshot. Exceptions clear
ownership and propagate. If a provider synchronously reconfigures the controller, its result is
discarded; providers should not mutate controller configuration.

`InteractionState.interactionTargetPosition` reports the coordinate with `viewId`. Target rotation
also reports the same coordinate as `rotationPivotPosition` for compatibility. Both clear on
completion/cancellation, controller replacement/finalization, structural invalidation, or errors.
Ordinary controlled camera feedback retains the snapshot; changed view dimensions, canvas,
projection family, or lens configuration cancels it. This is not scene collision detection.

An unsupported operation or invalid acquisition takes the complete stock path without provider
calls for unsupported cameras. An invalid candidate during a supported session holds the last
valid state, allowing later input to recover. Every target-aware transition frame is reconstructed
by the concrete camera, constrained, and validated; endpoint-only corrections are insufficient.

A single pinch combines zoom and rotation atomically. Overlapping independent `pinch` and
`multipan` recognizers instead end the target session and rebase both into stock navigation from
the displayed state. Remaining cumulative deltas are not replayed. Target-aware rebound and
cross-projection animation are not implemented.

See [MapController](./map-controller.md#experimental-target-navigation) and
[GlobeController](./globe-controller.md#experimental-target-navigation) for their distinct geometry
and support boundaries. Internal optional state hooks let other controllers participate without
making existing custom controller-state implementations implement new methods. They are not a
new public camera-strategy API.

## Methods

> A controller is not meant to be instantiated by the application. The following methods are documented for creating custom controllers that extend the base Controller class.

##### constructor

```js
import {Controller} from 'deck.gl';

class MyController extends Controller {
  constructor(props) {
    super(props);
  }
}
```

The constructor takes one argument:

* `props` (object) - contains the following options: 
  * `eventManager`- handles events subscriptions
  * `makeViewPort (viewState)` - creates new `Viewport` based on provided `ViewState`, and current view's `width` and `height`
  * `onStateChange` callback function
  * `onViewStateChange` callback function
  * `timeline` - an instance of `luma.gl` [animation timeline class](https://github.com/visgl/luma.gl/blob/d5bd93ef6bd0a0ff4af7880424286bda269e29a8/dev-docs/RFCs/v7.1/animation-timeline-rfc.md)


#### `handleEvent(event)` {#handleevent}

Called by the event manager to handle pointer events.

See [Event object documentation](https://visgl.github.io/mjolnir.js/docs/api-reference/event).


#### `setProps(props)` {#setprops}

Called by the view when the view state updates. This method handles adding/removing event listeners based on user options.

#### `updateViewport(newMapState, extraProps, interactionState)` {#updateviewport}

Called by the event handlers, this method updates internal state, and invokes `onViewStateChange` callback with a new map state.

#### `updateTransition()` {#updatetransition}

Advances an active controller transition to the current timeline time. Deck calls this method from its render loop. Controller-specific camera policies may run synchronously for every intermediate frame; for example, experimental `MapController` target navigation invokes its target-view-state constraint here. Callback exceptions are not swallowed by the controller.

#### `getCenter(event)` {#getcenter}

Utility used by the event handlers, returns pointer position `[x, y]` from any event.

#### `isFunctionKeyPressed(event)` {#isfunctionkeypressed}

Utility used by the event handlers, returns `true` if ctrl/alt/meta key is pressed during any event.

#### `isPointInBounds(pos, [event])` {#ispointinbounds}

Utility used by the event handlers, returns `true` if a pointer position `[x, y]` is inside the current view.

If `event` is provided, returns `false` if the event is already handled, and mark the event as handled if the point is in bounds. This can be used to make sure that certain events are only handled by one controller, when there are overlapping viewports.

#### `isDragging()` {#isdragging}

Returns `true` if the user is dragging the view.

#### `resolveInteractionTarget(screenPosition, operation, source)`

Protected synchronous target resolver used by participating states. The default implementation
uses the provider, otherwise the controller picker. Overrides must return a numeric
`InteractionTarget` or `null`; shared acquisition still copies and validates the result.

#### `hasActiveInteractionTarget()`

Protected lifecycle query for subclasses coordinating their own camera policies, such as
TerrainController. Returns whether the controller currently owns a target, including animation.


## Members

#### `events` (string[]) {#events}

In its constructor, a controller class can optionally specify a list of event names that it subscribes to with the `events` field. 
Supported events are:

* `click`
* `dblclick`
* `pan`
* `pinch`: 2-finger free-form manipulation, used for touch zooming and rotation
* `multipan`: 2-finger translation, used for touch panning or rotation
* `keydown`
* `keyup`
* `pointerdown`
* `pointermove`
* `pointerup`
* `pointerover`
* `pointerout`
* `pointerleave`
* `wheel`
* `contextmenu`

Note that the following events are always toggled on/off by user options:

* `scrollZoom` - `['wheel']`
* `dragPan` and `dragRotate` - `['pan']`
* `touchZoom` - `['pinch']`
* `multiTouchDrag` - `['multipan']`, and `['pinch']` in `rotate` mode
* `doubleClickZoom` - `['dblclick']`
* `doubleClickDragZoom` - `['pointerdown', 'pointermove', 'pointerup', 'pointercancel']`
* `keyboard` - `['keydown']`


## Example: Implementing A Custom Controller

```js
import {Controller} from 'deck.gl';

class MyController extends Controller{
  constructor(props) {
    super(props);
    this.events = ['pointermove'];
  }

  handleEvent(event) {
    if (event.type === 'pointermove') {
      // do something
    } else {
      super.handleEvent(event);
    }
  }
}
```

## Source

[modules/core/src/controllers/controller.ts](https://github.com/visgl/deck.gl/blob/master/modules/core/src/controllers/controller.ts)
