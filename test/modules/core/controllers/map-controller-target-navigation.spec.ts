// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  MapController,
  MapView,
  TerrainController,
  WebMercatorViewport,
  type InteractionState,
  type MapInteractionTarget,
  type MapInteractionTargetContext,
  type MapInteractionTargetViewStateContext
} from '@deck.gl/core';
import {Timeline} from '@luma.gl/engine';
import {Matrix4} from '@math.gl/core';
import ViewManager from '@deck.gl/core/lib/view-manager';

const CANVAS_SIZE = {width: 1000, height: 800};
const VIEW_ORIGIN = {x: 40, y: 60};
const VIEW_SIZE = {width: 800, height: 600};
const POINTER: [number, number] = [310, 260];
const INITIAL_VIEW_STATE = {
  longitude: 8.5,
  latitude: 47.3,
  zoom: 13,
  pitch: 48,
  bearing: -30
};

function copyInteractionState(state: InteractionState): InteractionState {
  return {
    ...state,
    interactionTargetPosition: state.interactionTargetPosition && [
      ...state.interactionTargetPosition
    ],
    rotationPivotPosition: state.rotationPivotPosition && [...state.rotationPivotPosition]
  };
}

function createControllerHarness({
  ControllerClass = MapController,
  controllerOptions = {},
  viewOptions = {},
  initialViewState = {},
  pickPosition,
  feedback = 'immediate'
}: {
  ControllerClass?: typeof MapController;
  controllerOptions?: Record<string, any>;
  viewOptions?: Record<string, any>;
  initialViewState?: Record<string, any>;
  pickPosition?: (x: number, y: number) => {coordinate?: number[]} | null;
  feedback?: 'immediate' | 'manual' | 'none';
} = {}) {
  let activeViewOptions = {...viewOptions};
  let view = new MapView({
    id: 'target-map',
    ...VIEW_ORIGIN,
    ...VIEW_SIZE,
    ...viewOptions,
    controller: controllerOptions
  });
  const timeline = new Timeline();
  const interactionStates: InteractionState[] = [];
  const viewStateChanges: Record<string, any>[] = [];
  let canvasSize = {...CANVAS_SIZE};
  const dimensions = view.getDimensions(canvasSize);
  let currentProps: Record<string, any> = {
    ...view.controller,
    ...dimensions,
    _view: view,
    id: view.id,
    ...INITIAL_VIEW_STATE,
    ...initialViewState
  };
  let controller!: MapController;

  controller = new ControllerClass({
    timeline,
    eventManager: null as any,
    pickPosition,
    makeViewport: viewState => view.makeViewport({...canvasSize, viewState}) as WebMercatorViewport,
    onViewStateChange: params => {
      viewStateChanges.push({...params.viewState});
      if (feedback === 'immediate') {
        currentProps = {...currentProps, ...params.viewState};
        controller.setProps(currentProps as any);
      }
    },
    onStateChange: state => interactionStates.push(copyInteractionState(state))
  });
  controller.setProps(currentProps as any);

  return {
    controller,
    timeline,
    interactionStates,
    viewStateChanges,
    getProps: () => currentProps,
    getAcceptedViewport: () =>
      view.makeViewport({...canvasSize, viewState: currentProps}) as WebMercatorViewport,
    getViewportProps: () => controller.controllerState.getViewportProps(),
    getViewport: () =>
      view.makeViewport({
        ...canvasSize,
        viewState: controller.controllerState.getViewportProps()
      }) as WebMercatorViewport,
    getInteractionState: () =>
      copyInteractionState((controller as any)._interactionState as InteractionState),
    replaceProps: (nextProps: Record<string, any>) => {
      currentProps = nextProps;
      controller.setProps(currentProps as any);
    },
    updateProps: (nextProps: Record<string, any>) => {
      currentProps = {...currentProps, ...nextProps};
      controller.setProps(currentProps as any);
    },
    resizeCanvas: (width: number, height: number) => {
      canvasSize = {width, height};
      currentProps = {...currentProps, ...view.getDimensions(canvasSize)};
      controller.setProps(currentProps as any);
    },
    replaceViewOptions: (nextViewOptions: Record<string, any>) => {
      activeViewOptions = {...activeViewOptions, ...nextViewOptions};
      view = new MapView({
        id: 'target-map',
        ...VIEW_ORIGIN,
        ...VIEW_SIZE,
        ...activeViewOptions,
        controller: controllerOptions
      });
      currentProps = {...currentProps, ...view.getDimensions(canvasSize), _view: view};
      controller.setProps(currentProps as any);
    },
    applyLatestViewState: () => {
      if (feedback === 'none') {
        throw new Error('Cannot apply view state when feedback is disabled');
      }
      const latest = viewStateChanges.at(-1);
      if (latest) {
        currentProps = {...currentProps, ...latest};
        controller.setProps(currentProps as any);
      }
    },
    makeTarget: (
      screenPosition: [number, number] = POINTER,
      altitude: number = 125
    ): MapInteractionTarget => {
      const viewport = view.makeViewport({
        ...canvasSize,
        viewState: currentProps
      }) as WebMercatorViewport;
      return {
        coordinate: viewport.unproject(screenPosition, {targetZ: altitude}) as [
          number,
          number,
          number
        ],
        screenPosition: [...screenPosition]
      };
    }
  };
}

function makeGestureEvent(
  type: string,
  screenPosition: [number, number] = POINTER,
  options: Record<string, any> = {}
) {
  const event = {
    type,
    pointerType: 'touch',
    offsetCenter: {
      x: VIEW_ORIGIN.x + screenPosition[0],
      y: VIEW_ORIGIN.y + screenPosition[1]
    },
    deltaX: 0,
    deltaY: 0,
    velocity: 0,
    velocityX: 0,
    velocityY: 0,
    deltaTime: 0,
    scale: 1,
    rotation: 0,
    srcEvent: {
      preventDefault() {},
      ...(options.srcEvent || {})
    },
    stopPropagation() {
      event.handled = true;
    },
    ...options,
    handled: false
  };
  return event;
}

function makeWheelEvent(delta: number = -20) {
  return makeGestureEvent('wheel', POINTER, {
    pointerType: 'mouse',
    device: 'mouse',
    delta
  });
}

function runPan(controller: MapController) {
  const endPosition: [number, number] = [POINTER[0] + 24, POINTER[1] + 12];
  controller.handleEvent(makeGestureEvent('panstart') as any);
  controller.handleEvent(makeGestureEvent('panmove', endPosition, {deltaX: 24, deltaY: 12}) as any);
  controller.handleEvent(makeGestureEvent('panend', endPosition, {deltaX: 24, deltaY: 12}) as any);
}

function runPinch(controller: MapController) {
  controller.handleEvent(makeGestureEvent('pinchstart') as any);
  controller.handleEvent(
    makeGestureEvent('pinchmove', POINTER, {scale: 1.2, rotation: 15, deltaTime: 16}) as any
  );
  controller.handleEvent(
    makeGestureEvent('pinchend', POINTER, {scale: 1.2, rotation: 15, deltaTime: 32}) as any
  );
}

function stripTargetOptions(props: Record<string, any>): Record<string, any> {
  const result = {...props};
  delete result._targetNavigation;
  delete result.getInteractionTarget;
  return result;
}

function expectTargetCleared(state: InteractionState) {
  expect(Object.hasOwn(state, 'interactionTargetPosition')).toBe(true);
  expect(state.interactionTargetPosition).toBeUndefined();
}

function getTargetInfo(
  harness: ReturnType<typeof createControllerHarness>,
  target: MapInteractionTarget
) {
  const info = harness.getViewport().getTargetInfo(target.coordinate);
  expect(info).not.toBeNull();
  return info!;
}

function getCanonicalCameraState(harness: ReturnType<typeof createControllerHarness>) {
  const {longitude, latitude, zoom, bearing, pitch, position} = harness.getViewportProps();
  return {longitude, latitude, zoom, bearing, pitch, position: [...position]};
}

function targetAtCameraDepth(
  viewport: WebMercatorViewport,
  screenPosition: [number, number],
  cameraDepth: number
): MapInteractionTarget {
  const rayTarget = viewport.unproject(screenPosition, {targetZ: 0}) as [number, number, number];
  const rayInfo = viewport.getTargetInfo(rayTarget)!;
  const commonTarget = viewport.projectPosition(rayTarget);
  const scale = cameraDepth / rayInfo.cameraDepth;
  const commonPosition = commonTarget.map(
    (component, index) =>
      viewport.cameraPosition[index] + (component - viewport.cameraPosition[index]) * scale
  );
  return {
    coordinate: viewport.unprojectPosition(commonPosition) as [number, number, number],
    screenPosition
  };
}

function expectTargetInvariant(
  harness: ReturnType<typeof createControllerHarness>,
  target: MapInteractionTarget,
  screenPosition: [number, number],
  expectedRadius?: number
) {
  const info = getTargetInfo(harness, target);
  expect(info.isVisible).toBe(true);
  expect(
    Math.hypot(
      info.projectedPosition[0] - screenPosition[0],
      info.projectedPosition[1] - screenPosition[1]
    )
  ).toBeLessThanOrEqual(0.1);
  expect(info.cameraDepth).toBeGreaterThanOrEqual(info.near * (1 + 1e-6));
  if (expectedRadius !== undefined) {
    expect(Math.abs(info.targetDistance - expectedRadius)).toBeLessThanOrEqual(
      Math.max(0.01, expectedRadius * 1e-7)
    );
  }
}

function mockTerrainFrames() {
  let now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  return {
    frames,
    step(elapsed = 501) {
      now += elapsed;
      const entry = frames.entries().next().value!;
      expect(entry).toBeDefined();
      frames.delete(entry[0]);
      entry[1](now);
    }
  };
}

function expectSameCamera(before: WebMercatorViewport, after: WebMercatorViewport) {
  // Compare both poses in the SOURCE metric, not each viewport's changing latitude scale.
  const meters = before.distanceScales.metersPerUnit;
  const error = Math.hypot(
    ...before.cameraPosition.map((value, i) => (after.cameraPosition[i] - value) * meters[i])
  );
  const distance = Math.hypot(
    ...before.cameraPosition.map((value, i) => (value - before.center[i]) * meters[i])
  );
  expect(error, 'physical camera translation (meters)').toBeLessThanOrEqual(
    Math.max(0.01, distance * 1e-7)
  );
  expect(after.fovy).toBe(before.fovy);
  expect(after.bearing).toBe(before.bearing);
  expect(after.pitch).toBe(before.pitch);
  for (const pixel of [
    [240, 220],
    [400, 300],
    [540, 380]
  ]) {
    for (const altitude of [0, 180]) {
      const coordinate = before.unproject(pixel, {targetZ: altitude});
      const projected = after.project(coordinate);
      expect(Math.hypot(projected[0] - pixel[0], projected[1] - pixel[1])).toBeLessThanOrEqual(0.1);
    }
  }
}

function runTargetOrbit(controller: MapController) {
  const end: [number, number] = [POINTER[0] + 60, POINTER[1] + 40];
  const options = {pointerType: 'mouse', rightButton: true};
  controller.handleEvent(makeGestureEvent('panstart', POINTER, options) as any);
  controller.handleEvent(
    makeGestureEvent('panmove', end, {...options, deltaX: 60, deltaY: 40}) as any
  );
  controller.handleEvent(
    makeGestureEvent('panend', end, {...options, deltaX: 60, deltaY: 40}) as any
  );
}

afterEach(() => {
  // Restore the stub's saved fake rAF BEFORE restoring real timers. Reversing this order
  // leaves a fake animation-frame scheduler installed for subsequent rendered test files.
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MapController target navigation', () => {
  it.each(['provider', 'picker'])(
    'honors padding-aware zoomAround center for %s acquisition',
    acquisition => {
      const position: [number, number] = [440, 340];
      let target!: MapInteractionTarget;
      let viewport!: WebMercatorViewport;
      const provider = vi.fn(() => target);
      const picker = vi.fn(() => ({coordinate: target.coordinate, viewport}));
      const harness = createControllerHarness({
        viewOptions: {padding: {left: 100, right: 20, top: 80}},
        controllerOptions: {
          _targetNavigation: true,
          zoomAround: 'center',
          getInteractionTarget: acquisition === 'provider' ? provider : undefined
        },
        pickPosition: picker
      });
      target = harness.makeTarget(position);
      viewport = harness.getViewport();
      harness.controller.handleEvent(makeWheelEvent(20) as any);
      if (acquisition === 'provider') {
        expect(provider).toHaveBeenCalledWith(
          expect.objectContaining({
            screenPosition: position.map(component => expect.closeTo(component, 7)),
            operation: 'zoom'
          })
        );
        expect(picker).not.toHaveBeenCalled();
      } else {
        expect(picker).toHaveBeenCalledWith(
          expect.closeTo(VIEW_ORIGIN.x + position[0], 7),
          expect.closeTo(VIEW_ORIGIN.y + position[1], 7)
        );
      }
      expectTargetInvariant(harness, target, position);
      harness.controller.finalize();
    }
  );
  it('is behavior-compatible with stock MapController when disabled', () => {
    const provider = vi.fn(() => null);
    const pickPosition = vi.fn(() => ({coordinate: [8.5, 47.3, 0]}));
    const stock = createControllerHarness();
    const disabled = createControllerHarness({
      controllerOptions: {_targetNavigation: false, getInteractionTarget: provider},
      pickPosition
    });

    runPan(stock.controller);
    runPan(disabled.controller);

    expect(stock.getViewportProps().longitude).not.toBe(INITIAL_VIEW_STATE.longitude);
    expect(disabled.getViewportProps()).toEqual(stock.getViewportProps());
    expect(provider).not.toHaveBeenCalled();
    expect(pickPosition).not.toHaveBeenCalled();
    expect(disabled.interactionStates.some(state => state.interactionTargetPosition)).toBe(false);

    stock.controller.finalize();
    disabled.controller.finalize();
  });

  it('gives the application provider precedence and copies only its numeric target', () => {
    const pickPosition = vi.fn(() => ({coordinate: [0, 0, 0]}));
    let target!: MapInteractionTarget & {featureId: string};
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider},
      pickPosition
    });
    target = {
      ...harness.makeTarget([POINTER[0] + 6, POINTER[1] - 4]),
      minimumTargetDistance: 40,
      featureId: 'road-1'
    };
    const expectedCoordinate = [...target.coordinate];

    harness.controller.handleEvent(makeGestureEvent('panstart') as any);

    expect(provider).toHaveBeenCalledTimes(1);
    expect(pickPosition).not.toHaveBeenCalled();
    expect(provider.mock.calls[0][0]).toMatchObject({
      operation: 'pan',
      screenPosition: POINTER,
      viewId: 'target-map'
    });
    expect(harness.getInteractionState()).toMatchObject({
      viewId: 'target-map',
      interactionTargetPosition: expectedCoordinate
    });
    expect('featureId' in harness.getInteractionState()).toBe(false);
    expect((harness.controller as any)._activeTarget.minimumTargetDistance).toBe(40);

    target.coordinate[0] = 0;
    target.screenPosition[0] = 0;
    target.minimumTargetDistance = 0;
    expect(harness.getInteractionState().interactionTargetPosition).toEqual(expectedCoordinate);
    expect((harness.controller as any)._activeTarget.minimumTargetDistance).toBe(40);

    harness.controller.handleEvent(makeGestureEvent('panend') as any);
    expectTargetCleared(harness.interactionStates.at(-1)!);
    harness.controller.finalize();
  });

  it.each([
    {title: 'provider null', result: null},
    {
      title: 'nonfinite coordinate',
      result: {coordinate: [8.5, 47.3, Number.NaN], screenPosition: POINTER}
    },
    {title: 'short coordinate', result: {coordinate: [8.5, 47.3], screenPosition: POINTER}},
    {title: 'missing screen position', result: {coordinate: [8.5, 47.3, 0]}},
    {
      title: 'nonfinite screen position',
      result: {coordinate: [8.5, 47.3, 0], screenPosition: [Infinity, POINTER[1]]}
    }
  ])('uses stock behavior for $title without falling through to built-in picking', ({result}) => {
    const stock = createControllerHarness();
    const provider = vi.fn(() => result as any);
    const pickPosition = vi.fn(() => ({coordinate: [0, 0, 0]}));
    const fallback = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider},
      pickPosition
    });

    runPan(stock.controller);
    runPan(fallback.controller);

    expect(stock.getViewportProps().longitude).not.toBe(INITIAL_VIEW_STATE.longitude);
    expect(fallback.getViewportProps()).toEqual(stock.getViewportProps());
    expect(provider).toHaveBeenCalledTimes(1);
    expect(pickPosition).not.toHaveBeenCalled();
    expect(fallback.interactionStates.some(state => state.interactionTargetPosition)).toBe(false);

    stock.controller.finalize();
    fallback.controller.finalize();
  });

  it('clears attempted target state and rethrows provider exceptions', () => {
    const error = new Error('application target provider failed');
    const pickPosition = vi.fn(() => ({coordinate: [0, 0, 0]}));
    const provider = vi.fn(() => {
      throw error;
    });
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider},
      pickPosition
    });

    expect(() => harness.controller.handleEvent(makeGestureEvent('panstart') as any)).toThrow(
      error
    );
    expect(provider).toHaveBeenCalledTimes(1);
    expect(pickPosition).not.toHaveBeenCalled();
    expectTargetCleared(harness.interactionStates.at(-1)!);

    harness.controller.finalize();
  });

  it.each([-1, Number.NaN, Infinity, null as unknown as number, '20' as unknown as number])(
    'rejects invalid minimum target distance %s without built-in fallback',
    minimumTargetDistance => {
      const stock = createControllerHarness();
      let target!: MapInteractionTarget;
      const provider = vi.fn(() => ({...target, minimumTargetDistance}));
      const pickPosition = vi.fn(() => ({coordinate: [0, 0, 0]}));
      const harness = createControllerHarness({
        controllerOptions: {_targetNavigation: true, getInteractionTarget: provider},
        pickPosition
      });
      target = harness.makeTarget();

      runPan(stock.controller);
      runPan(harness.controller);

      expect(provider).toHaveBeenCalledTimes(1);
      expect(pickPosition).not.toHaveBeenCalled();
      expect(harness.getViewportProps()).toEqual(stock.getViewportProps());
      expect(harness.interactionStates.some(state => state.interactionTargetPosition)).toBe(false);
      stock.controller.finalize();
      harness.controller.finalize();
    }
  );

  it('discards a provider result when the provider reconfigures the controller', () => {
    let target!: MapInteractionTarget;
    let harness!: ReturnType<typeof createControllerHarness>;
    const provider = vi.fn(() => {
      const nextProps = {...harness.getProps()};
      delete nextProps._targetNavigation;
      delete nextProps.getInteractionTarget;
      harness.replaceProps(nextProps);
      return target;
    });
    harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider}
    });
    target = harness.makeTarget();

    harness.controller.handleEvent(makeGestureEvent('panstart') as any);

    expect(provider).toHaveBeenCalledTimes(1);
    expect(harness.getInteractionState().interactionTargetPosition).toBeUndefined();
    expect(harness.interactionStates.some(state => state.interactionTargetPosition)).toBe(false);
    harness.controller.handleEvent(makeGestureEvent('panend') as any);
    harness.controller.finalize();
  });

  it('uses built-in picking with view-local to canvas coordinate conversion', () => {
    let target!: MapInteractionTarget;
    const pickPosition = vi.fn(() => ({coordinate: target.coordinate}));
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true},
      pickPosition
    });
    target = harness.makeTarget();

    harness.controller.handleEvent(makeGestureEvent('panstart') as any);

    expect(pickPosition).toHaveBeenCalledTimes(1);
    expect(pickPosition).toHaveBeenCalledWith(
      VIEW_ORIGIN.x + POINTER[0],
      VIEW_ORIGIN.y + POINTER[1]
    );
    expect(harness.getInteractionState()).toMatchObject({
      viewId: 'target-map',
      interactionTargetPosition: target.coordinate
    });

    harness.controller.handleEvent(makeGestureEvent('panend') as any);
    expectTargetCleared(harness.interactionStates.at(-1)!);
    harness.controller.finalize();
  });

  it('rejects acquisition inside the near safety margin and accepts beyond it', () => {
    const stock = createControllerHarness();
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider}
    });
    const viewport = harness.getViewport();
    const reference = harness.makeTarget();
    const near = viewport.getTargetInfo(reference.coordinate)!.near;
    target = targetAtCameraDepth(viewport, POINTER, near * (1 + 0.25e-6));
    const nearInfo = viewport.getTargetInfo(target.coordinate)!;
    expect(nearInfo.isVisible, JSON.stringify(nearInfo)).toBe(true);
    expect(nearInfo.cameraDepth).toBeLessThan(nearInfo.near * (1 + 1e-6));

    runPan(stock.controller);
    runPan(harness.controller);

    expect(provider).toHaveBeenCalledTimes(1);
    expect(harness.interactionStates.some(state => state.interactionTargetPosition)).toBe(false);
    expect(harness.getViewportProps()).toEqual(stock.getViewportProps());
    harness.controller.finalize();
    stock.controller.finalize();

    let safeTarget!: MapInteractionTarget;
    const safeHarness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: () => safeTarget
      }
    });
    const safeViewport = safeHarness.getViewport();
    safeTarget = targetAtCameraDepth(safeViewport, POINTER, near * (1 + 4e-6));
    safeHarness.controller.handleEvent(makeGestureEvent('panstart') as any);
    expect(safeHarness.getInteractionState().interactionTargetPosition).toEqual(
      safeTarget.coordinate
    );
    safeHarness.controller.handleEvent(makeGestureEvent('panend') as any);
    safeHarness.controller.finalize();
  });

  it('uses complete stock behavior when the built-in synchronous picker returns null', () => {
    const stock = createControllerHarness();
    const pickPosition = vi.fn(() => null);
    const fallback = createControllerHarness({
      controllerOptions: {_targetNavigation: true},
      pickPosition
    });

    runPan(stock.controller);
    runPan(fallback.controller);

    expect(pickPosition).toHaveBeenCalledTimes(1);
    expect(fallback.getViewportProps()).toEqual(stock.getViewportProps());
    expect(fallback.interactionStates.some(state => state.interactionTargetPosition)).toBe(false);

    stock.controller.finalize();
    fallback.controller.finalize();
  });

  it('uses complete stock behavior when rubber-band constraints are enabled', () => {
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const stock = createControllerHarness({controllerOptions: {rubberBand: true}});
    const fallback = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: provider,
        rubberBand: true
      }
    });
    target = fallback.makeTarget();

    runPan(stock.controller);
    runPan(fallback.controller);

    expect(provider).not.toHaveBeenCalled();
    expect(fallback.getViewportProps()).toEqual(stock.getViewportProps());
    expect(fallback.interactionStates.some(state => state.interactionTargetPosition)).toBe(false);
    stock.controller.finalize();
    fallback.controller.finalize();
  });

  it('acquires once per pointer gesture and once for compound pinch', () => {
    let panTarget!: MapInteractionTarget;
    const panProvider = vi.fn(() => panTarget);
    const panHarness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: panProvider}
    });
    panTarget = panHarness.makeTarget();

    runPan(panHarness.controller);
    expect(panProvider).toHaveBeenCalledTimes(1);
    expectTargetCleared(panHarness.interactionStates.at(-1)!);

    let pinchTarget!: MapInteractionTarget;
    const pinchProvider = vi.fn(() => pinchTarget);
    const pinchHarness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: pinchProvider,
        touchZoom: true,
        touchRotate: true
      }
    });
    pinchTarget = pinchHarness.makeTarget();

    runPinch(pinchHarness.controller);
    expect(pinchProvider).toHaveBeenCalledTimes(1);
    expectTargetCleared(pinchHarness.interactionStates.at(-1)!);

    panHarness.controller.finalize();
    pinchHarness.controller.finalize();
  });

  it('retains one target for a non-smooth wheel burst and re-resolves the next burst', () => {
    vi.useFakeTimers();
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: provider,
        scrollZoom: true
      }
    });
    target = harness.makeTarget();

    harness.controller.handleEvent(makeWheelEvent() as any);
    vi.advanceTimersByTime(100);
    harness.controller.handleEvent(makeWheelEvent() as any);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(harness.getViewportProps().zoom).not.toBe(INITIAL_VIEW_STATE.zoom);
    expect(harness.getInteractionState().interactionTargetPosition).toEqual(target.coordinate);

    vi.advanceTimersByTime(149);
    expect(harness.getInteractionState().interactionTargetPosition).toEqual(target.coordinate);
    vi.advanceTimersByTime(1);
    expectTargetCleared(harness.interactionStates.at(-1)!);

    target = harness.makeTarget();
    harness.controller.handleEvent(makeWheelEvent() as any);
    expect(provider).toHaveBeenCalledTimes(2);

    harness.controller.finalize();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains a smooth-wheel target through transition restarts until both owners finish', () => {
    vi.useFakeTimers();
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: provider,
        scrollZoom: {smooth: true}
      }
    });
    target = harness.makeTarget();

    harness.controller.handleEvent(makeWheelEvent() as any);
    vi.advanceTimersByTime(100);
    harness.controller.handleEvent(makeWheelEvent() as any);

    expect(provider).toHaveBeenCalledTimes(1);
    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(true);
    expect(harness.getInteractionState().interactionTargetPosition).toEqual(target.coordinate);

    vi.advanceTimersByTime(150);
    expect(
      harness.getInteractionState().interactionTargetPosition,
      'burst timeout does not release an active transition target'
    ).toEqual(target.coordinate);

    harness.timeline.setTime(harness.timeline.getTime() + 250);
    harness.controller.updateTransition();
    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(false);
    expectTargetCleared(harness.interactionStates.at(-1)!);

    harness.controller.finalize();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('publishes the target with view attribution, aliases rotation pivot, and clears both', () => {
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider}
    });
    target = harness.makeTarget();
    const rotateEventOptions = {srcEvent: {metaKey: true}};

    harness.controller.handleEvent(
      makeGestureEvent('panstart', POINTER, rotateEventOptions) as any
    );
    harness.controller.handleEvent(
      makeGestureEvent('panmove', [POINTER[0] + 20, POINTER[1] + 10], {
        ...rotateEventOptions,
        deltaX: 20,
        deltaY: 10
      }) as any
    );

    expect(harness.getInteractionState()).toMatchObject({
      viewId: 'target-map',
      interactionTargetPosition: target.coordinate,
      rotationPivotPosition: target.coordinate,
      isDragging: true,
      isRotating: true
    });

    harness.controller.handleEvent(
      makeGestureEvent('panend', [POINTER[0] + 20, POINTER[1] + 10], rotateEventOptions) as any
    );
    const releasedState = harness.interactionStates.at(-1)!;
    expectTargetCleared(releasedState);
    expect(Object.hasOwn(releasedState, 'rotationPivotPosition')).toBe(true);
    expect(releasedState.rotationPivotPosition).toBeUndefined();

    harness.controller.finalize();
  });

  it('does not publish a rotation pivot for a zoom-only target pinch', () => {
    let target!: MapInteractionTarget;
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: () => target,
        touchZoom: true,
        touchRotate: false
      }
    });
    target = harness.makeTarget();

    harness.controller.handleEvent(makeGestureEvent('pinchstart') as any);
    harness.controller.handleEvent(
      makeGestureEvent('pinchmove', POINTER, {scale: 1.2, rotation: 0, deltaTime: 16}) as any
    );

    expect(harness.getInteractionState()).toMatchObject({
      interactionTargetPosition: target.coordinate,
      rotationPivotPosition: undefined,
      isRotating: false
    });
    harness.controller.handleEvent(
      makeGestureEvent('pinchend', POINTER, {scale: 1.2, rotation: 0, deltaTime: 32}) as any
    );
    harness.controller.finalize();
  });

  it('aliases the interaction target while a keyboard rotation transition is active', () => {
    vi.useFakeTimers();
    let target!: MapInteractionTarget;
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: () => target}
    });
    target = harness.makeTarget();

    harness.controller.handleEvent(
      makeGestureEvent('keydown', POINTER, {srcEvent: {code: 'ArrowLeft', metaKey: true}}) as any
    );

    expect(harness.getInteractionState()).toMatchObject({
      interactionTargetPosition: target.coordinate,
      rotationPivotPosition: target.coordinate,
      isRotating: true,
      inTransition: true
    });
    harness.timeline.setTime(harness.timeline.getTime() + 301);
    harness.controller.updateTransition();
    expectTargetCleared(harness.interactionStates.at(-1)!);
    expect(harness.interactionStates.at(-1)?.rotationPivotPosition).toBeUndefined();
    harness.controller.finalize();
  });

  it('attributes targets in multiview and resets omitted options on a reused controller', () => {
    const interactionStates: InteractionState[] = [];
    const provider = vi.fn((context: MapInteractionTargetContext) => {
      const screenPosition = context.screenPosition!;
      return {
        coordinate: context.viewport.unproject(screenPosition, {targetZ: 100}) as [
          number,
          number,
          number
        ],
        screenPosition
      };
    });
    const createViews = (
      leftController: Record<string, any> | boolean = {
        _targetNavigation: true,
        getInteractionTarget: provider
      }
    ) => [
      new MapView({
        id: 'left-map',
        x: 0,
        width: '50%',
        controller: leftController
      }),
      new MapView({
        id: 'right-map',
        x: '50%',
        width: '50%',
        controller: {_targetNavigation: true, getInteractionTarget: provider}
      })
    ];
    const viewManager = new ViewManager({
      views: createViews(),
      viewState: {
        'left-map': INITIAL_VIEW_STATE,
        'right-map': {...INITIAL_VIEW_STATE, longitude: 9}
      },
      width: 1000,
      height: 600,
      timeline: new Timeline(),
      eventManager: null as any,
      onInteractionStateChange: state => interactionStates.push(copyInteractionState(state))
    });
    const leftController = viewManager.controllers['left-map']!;
    const rightController = viewManager.controllers['right-map']!;

    leftController.handleEvent(
      makeGestureEvent('panstart', [100, 100], {offsetCenter: {x: 100, y: 100}}) as any
    );
    leftController.handleEvent(
      makeGestureEvent('panend', [100, 100], {offsetCenter: {x: 100, y: 100}}) as any
    );
    rightController.handleEvent(
      makeGestureEvent('panstart', [100, 100], {offsetCenter: {x: 600, y: 100}}) as any
    );
    rightController.handleEvent(
      makeGestureEvent('panend', [100, 100], {offsetCenter: {x: 600, y: 100}}) as any
    );

    expect(provider.mock.calls.map(call => call[0].viewId)).toEqual(['left-map', 'right-map']);
    expect(provider.mock.calls.map(call => call[0].screenPosition)).toEqual([
      [100, 100],
      [100, 100]
    ]);
    expect(
      interactionStates.filter(state => state.interactionTargetPosition).map(state => state.viewId)
    ).toEqual(expect.arrayContaining(['left-map', 'right-map']));

    leftController.handleEvent(
      makeGestureEvent('panstart', [100, 100], {offsetCenter: {x: 100, y: 100}}) as any
    );
    expect((leftController as any)._interactionState.interactionTargetPosition).toBeDefined();

    viewManager.setProps({views: createViews(true)});

    expect(viewManager.controllers['left-map']).toBe(leftController);
    expect((leftController as any)._interactionState).toMatchObject({
      viewId: 'left-map',
      interactionTargetPosition: undefined
    });
    viewManager.finalize();
  });

  it('retains a target across equivalent recreated MapViews and clears on projection changes', () => {
    let viewManager: ViewManager<any> | undefined;
    const interactionStates: InteractionState[] = [];
    const provider = vi.fn((context: MapInteractionTargetContext) => ({
      coordinate: context.viewport.unproject(context.screenPosition!, {targetZ: 120}) as [
        number,
        number,
        number
      ],
      screenPosition: context.screenPosition!
    }));
    const createView = (extra: Record<string, any> = {}) =>
      new MapView({
        id: 'map',
        controller: {_targetNavigation: true, getInteractionTarget: provider},
        ...extra
      });
    const acceptedViewState = {...INITIAL_VIEW_STATE};
    viewManager = new ViewManager({
      views: [createView()],
      viewState: acceptedViewState,
      width: VIEW_SIZE.width,
      height: VIEW_SIZE.height,
      timeline: new Timeline(),
      eventManager: null as any,
      onViewStateChange: ({viewState}) => {
        Object.assign(acceptedViewState, viewState);
        viewManager?.setProps({views: [createView()], viewState: acceptedViewState});
      },
      onInteractionStateChange: state => interactionStates.push(copyInteractionState(state))
    });
    const controller = viewManager.controllers.map!;

    controller.handleEvent(
      makeGestureEvent('panstart', POINTER, {
        offsetCenter: {x: POINTER[0], y: POINTER[1]}
      }) as any
    );
    controller.handleEvent(
      makeGestureEvent('panmove', [POINTER[0] + 20, POINTER[1] + 10], {
        offsetCenter: {x: POINTER[0] + 20, y: POINTER[1] + 10},
        deltaX: 20,
        deltaY: 10
      }) as any
    );

    expect(viewManager.controllers.map).toBe(controller);
    expect(provider).toHaveBeenCalledTimes(1);
    expect((controller as any)._interactionState.interactionTargetPosition).toBeDefined();

    viewManager.setProps({views: [createView({padding: {left: 20}})]});

    expect((controller as any)._interactionState).toMatchObject({
      interactionTargetPosition: undefined,
      isDragging: false
    });
    expect(interactionStates.at(-1)?.rotationPivotPosition).toBeUndefined();
    viewManager.finalize();
  });

  it('uses complete stock fallback in orthographic MapView without acquiring', () => {
    const stock = createControllerHarness({viewOptions: {orthographic: true}});
    const provider = vi.fn(() => ({coordinate: [8.5, 47.3, 0], screenPosition: POINTER}));
    const providerPick = vi.fn(() => ({coordinate: [8.5, 47.3, 0]}));
    const withProvider = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider},
      viewOptions: {orthographic: true},
      pickPosition: providerPick
    });
    const builtInPick = vi.fn(() => ({coordinate: [8.5, 47.3, 0]}));
    const withBuiltIn = createControllerHarness({
      controllerOptions: {_targetNavigation: true},
      viewOptions: {orthographic: true},
      pickPosition: builtInPick
    });

    runPan(stock.controller);
    runPan(withProvider.controller);
    runPan(withBuiltIn.controller);

    expect(stock.getViewportProps().longitude).not.toBe(INITIAL_VIEW_STATE.longitude);
    expect(withProvider.getViewportProps()).toEqual(stock.getViewportProps());
    expect(withBuiltIn.getViewportProps()).toEqual(stock.getViewportProps());
    expect(provider).not.toHaveBeenCalled();
    expect(providerPick).not.toHaveBeenCalled();
    expect(builtInPick).not.toHaveBeenCalled();

    stock.controller.finalize();
    withProvider.controller.finalize();
    withBuiltIn.controller.finalize();
  });

  it('uses complete stock fallback with a custom projection matrix without acquiring', () => {
    const projectionMatrix = new Matrix4().perspective({
      fovy: Math.PI / 3,
      aspect: VIEW_SIZE.width / VIEW_SIZE.height,
      near: 0.1,
      far: 100
    });
    const stock = createControllerHarness({viewOptions: {projectionMatrix}});
    const provider = vi.fn(() => ({coordinate: [8.5, 47.3, 0], screenPosition: POINTER}));
    const providerPick = vi.fn(() => ({coordinate: [8.5, 47.3, 0]}));
    const withProvider = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider},
      viewOptions: {projectionMatrix},
      pickPosition: providerPick
    });
    const builtInPick = vi.fn(() => ({coordinate: [8.5, 47.3, 0]}));
    const withBuiltIn = createControllerHarness({
      controllerOptions: {_targetNavigation: true},
      viewOptions: {projectionMatrix},
      pickPosition: builtInPick
    });

    runPan(stock.controller);
    runPan(withProvider.controller);
    runPan(withBuiltIn.controller);

    expect(withProvider.getViewportProps()).toEqual(stock.getViewportProps());
    expect(withBuiltIn.getViewportProps()).toEqual(stock.getViewportProps());
    expect(provider).not.toHaveBeenCalled();
    expect(providerPick).not.toHaveBeenCalled();
    expect(builtInPick).not.toHaveBeenCalled();

    stock.controller.finalize();
    withProvider.controller.finalize();
    withBuiltIn.controller.finalize();
  });

  it.each([
    {
      title: 'dragPan',
      controllerOptions: {dragPan: false},
      event: () => makeGestureEvent('panstart')
    },
    {
      title: 'dragRotate',
      controllerOptions: {dragRotate: false},
      event: () => makeGestureEvent('panstart', POINTER, {srcEvent: {metaKey: true}})
    },
    {
      title: 'scrollZoom',
      controllerOptions: {scrollZoom: false},
      event: () => makeWheelEvent()
    },
    {
      title: 'doubleClickZoom',
      controllerOptions: {doubleClickZoom: false},
      event: () => makeGestureEvent('dblclick', POINTER, {pointerType: 'mouse'})
    },
    {
      title: 'doubleClickDragZoom',
      controllerOptions: {doubleClickDragZoom: false},
      event: () => makeGestureEvent('dblclickdragstart', POINTER, {pointerType: 'mouse'})
    },
    {
      title: 'touch zoom and rotate',
      controllerOptions: {touchZoom: false, touchRotate: false, multiTouchDrag: null},
      event: () => makeGestureEvent('pinchstart')
    },
    {
      title: 'keyboard',
      controllerOptions: {keyboard: false},
      event: () => makeGestureEvent('keydown', POINTER, {srcEvent: {code: 'Equal'}})
    }
  ])('does not acquire when $title interaction is disabled', ({controllerOptions, event}) => {
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: provider,
        ...controllerOptions
      }
    });
    target = harness.makeTarget();

    harness.controller.handleEvent(event() as any);

    expect(provider).not.toHaveBeenCalled();
    expect(harness.getInteractionState().interactionTargetPosition).toBeUndefined();
    harness.controller.finalize();
  });

  it('does not acquire for a synthesized multi-pan gesture when trackpad gestures are disabled', () => {
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: provider,
        multiTouchDrag: 'pan',
        trackpadGesture: false
      }
    });
    target = harness.makeTarget();

    harness.controller.handleEvent(
      makeGestureEvent('multipanstart', POINTER, {pointerType: 'trackpad'}) as any
    );

    expect(provider).not.toHaveBeenCalled();
    expect(harness.getInteractionState().interactionTargetPosition).toBeUndefined();
    harness.controller.finalize();
  });

  it('does not leak a target when the first multi-pan center is already outside the view', () => {
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: provider,
        multiTouchDrag: 'pan'
      }
    });
    target = harness.makeTarget();

    harness.controller.handleEvent(
      makeGestureEvent('multipanstart', [VIEW_SIZE.width + 10, 100], {
        pointerType: 'touch',
        deltaX: 30,
        offsetCenter: {x: VIEW_ORIGIN.x + VIEW_SIZE.width + 10, y: VIEW_ORIGIN.y + 100}
      }) as any
    );

    expect(provider).not.toHaveBeenCalled();
    expect(harness.getInteractionState().interactionTargetPosition).toBeUndefined();
    expect(harness.getInteractionState().isDragging).toBe(false);
    harness.controller.finalize();
  });

  it('does not acquire for an unsupported keyboard key', () => {
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider}
    });
    target = harness.makeTarget();

    harness.controller.handleEvent(
      makeGestureEvent('keydown', POINTER, {srcEvent: {code: 'KeyA'}}) as any
    );

    expect(provider).not.toHaveBeenCalled();
    expect(harness.getInteractionState().interactionTargetPosition).toBeUndefined();
    harness.controller.finalize();
  });

  it('freezes an active snapshot across provider replacement and resets omitted options', () => {
    let targetA!: MapInteractionTarget;
    let targetB!: MapInteractionTarget;
    const providerA = vi.fn(() => targetA);
    const providerB = vi.fn(() => targetB);
    const pickPosition = vi.fn(() => ({coordinate: [0, 0, 0]}));
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: providerA},
      pickPosition
    });
    targetA = harness.makeTarget(POINTER, 100);

    harness.controller.handleEvent(makeGestureEvent('panstart') as any);
    harness.updateProps({_targetNavigation: true, getInteractionTarget: providerB});
    expect(harness.getInteractionState().interactionTargetPosition).toEqual(targetA.coordinate);
    expect(providerB).not.toHaveBeenCalled();

    harness.controller.handleEvent(makeGestureEvent('panend') as any);
    targetB = harness.makeTarget(POINTER, 200);
    harness.controller.handleEvent(makeGestureEvent('panstart') as any);
    expect(providerA).toHaveBeenCalledTimes(1);
    expect(providerB).toHaveBeenCalledTimes(1);
    expect(harness.getInteractionState().interactionTargetPosition).toEqual(targetB.coordinate);

    harness.replaceProps(stripTargetOptions(harness.getProps()));
    expectTargetCleared(harness.interactionStates.at(-1)!);
    harness.controller.handleEvent(makeGestureEvent('panend') as any);

    const providerCalls = providerB.mock.calls.length;
    runPan(harness.controller);
    expect(providerB).toHaveBeenCalledTimes(providerCalls);
    expect(pickPosition).not.toHaveBeenCalled();
    expect(harness.interactionStates.at(-1)?.interactionTargetPosition).toBeUndefined();

    harness.controller.finalize();
  });

  it('keeps a panned target under the moving pointer', () => {
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider}
    });
    target = harness.makeTarget();
    const endPosition: [number, number] = [POINTER[0] + 120, POINTER[1] - 80];

    harness.controller.handleEvent(makeGestureEvent('panstart') as any);
    harness.controller.handleEvent(
      makeGestureEvent('panmove', endPosition, {deltaX: 120, deltaY: -80}) as any
    );

    expect(provider).toHaveBeenCalledTimes(1);
    expectTargetInvariant(harness, target, endPosition);

    harness.controller.handleEvent(
      makeGestureEvent('panend', endPosition, {deltaX: 120, deltaY: -80}) as any
    );
    expectTargetCleared(harness.interactionStates.at(-1)!);
    harness.controller.finalize();
  });

  it('translates a snapped elevated target in the world plane without a first-move jump or drift', () => {
    const snappedPosition: [number, number] = [POINTER[0] + 18, POINTER[1] - 11];
    let target!: MapInteractionTarget;
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: () => target},
      initialViewState: {position: [250, -180, 400]}
    });
    target = harness.makeTarget(snappedPosition, 275);
    const startViewport = harness.getViewport();
    const startRadius = getTargetInfo(harness, target).targetDistance;
    const delta: [number, number] = [120, -80];
    const pointerPosition: [number, number] = [POINTER[0] + delta[0], POINTER[1] + delta[1]];
    const targetPosition: [number, number] = [
      snappedPosition[0] + delta[0],
      snappedPosition[1] + delta[1]
    ];

    harness.controller.handleEvent(makeGestureEvent('panstart') as any);
    harness.controller.handleEvent(
      makeGestureEvent('panmove', pointerPosition, {deltaX: delta[0], deltaY: delta[1]}) as any
    );

    expectTargetInvariant(harness, target, targetPosition);
    const movedViewport = harness.getViewport();
    expect(movedViewport.center[2]).toBeCloseTo(startViewport.center[2], 10);
    expect(movedViewport.zoom).toBe(startViewport.zoom);
    expect(movedViewport.bearing).toBe(startViewport.bearing);
    expect(movedViewport.pitch).toBe(startViewport.pitch);
    expect(getTargetInfo(harness, target).targetDistance).not.toBeCloseTo(startRadius, 4);

    harness.controller.handleEvent(
      makeGestureEvent('panmove', POINTER, {deltaX: 0, deltaY: 0}) as any
    );
    const reversedViewport = harness.getViewport();
    for (let index = 0; index < 3; index++) {
      expect(reversedViewport.center[index]).toBeCloseTo(startViewport.center[index], 6);
      expect(reversedViewport.cameraPosition[index]).toBeCloseTo(
        startViewport.cameraPosition[index],
        6
      );
    }
    expect(reversedViewport.zoom).toBe(startViewport.zoom);
    expect(reversedViewport.bearing).toBe(startViewport.bearing);
    expect(reversedViewport.pitch).toBe(startViewport.pitch);

    harness.controller.handleEvent(makeGestureEvent('panend') as any);
    harness.controller.finalize();
  });

  it('reports the reconstructed pointer origin and the first recognized trackpad sample', () => {
    let pointerTarget!: MapInteractionTarget;
    const pointerProvider = vi.fn(() => pointerTarget);
    const pointerHarness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: pointerProvider}
    });
    pointerTarget = pointerHarness.makeTarget();
    const recognizedPosition: [number, number] = [POINTER[0] + 12, POINTER[1] - 7];
    pointerHarness.controller.handleEvent(
      makeGestureEvent('panstart', recognizedPosition, {deltaX: 12, deltaY: -7}) as any
    );
    expect(pointerProvider).toHaveBeenCalledWith(
      expect.objectContaining({source: 'touch', screenPosition: POINTER})
    );
    pointerHarness.controller.handleEvent(makeGestureEvent('panend', recognizedPosition) as any);
    pointerHarness.controller.finalize();

    let trackpadTarget!: MapInteractionTarget;
    const trackpadProvider = vi.fn(() => trackpadTarget);
    const trackpadHarness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: trackpadProvider,
        trackpadGesture: true
      }
    });
    trackpadTarget = trackpadHarness.makeTarget(recognizedPosition);
    trackpadHarness.controller.handleEvent(
      makeGestureEvent('panstart', recognizedPosition, {
        pointerType: 'trackpad',
        deltaX: 12,
        deltaY: -7
      }) as any
    );
    expect(trackpadProvider).toHaveBeenCalledWith(
      expect.objectContaining({source: 'trackpad', screenPosition: recognizedPosition})
    );
    trackpadHarness.controller.handleEvent(
      makeGestureEvent('panend', recognizedPosition, {pointerType: 'trackpad'}) as any
    );
    trackpadHarness.controller.finalize();
  });

  it('does not acquire a regular trackpad pan when trackpad gestures are disabled', () => {
    const provider = vi.fn(() => null);
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: provider,
        trackpadGesture: false
      }
    });

    harness.controller.handleEvent(
      makeGestureEvent('panstart', POINTER, {pointerType: 'trackpad'}) as any
    );

    expect(provider).not.toHaveBeenCalled();
    harness.controller.handleEvent(
      makeGestureEvent('panend', POINTER, {pointerType: 'trackpad'}) as any
    );
    harness.controller.finalize();
  });

  it('keeps a captured target under the pointer outside the viewport', () => {
    let target!: MapInteractionTarget;
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: () => target}
    });
    target = harness.makeTarget();
    const offscreenPosition: [number, number] = [-80, VIEW_SIZE.height + 45];

    harness.controller.handleEvent(makeGestureEvent('panstart') as any);
    harness.controller.handleEvent(
      makeGestureEvent('panmove', offscreenPosition, {
        deltaX: offscreenPosition[0] - POINTER[0],
        deltaY: offscreenPosition[1] - POINTER[1]
      }) as any
    );

    const info = getTargetInfo(harness, target);
    expect(info.isValid).toBe(true);
    expect(info.isVisible).toBe(false);
    expect(info.projectedPosition.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.closeTo(offscreenPosition[0]),
        expect.closeTo(offscreenPosition[1])
      ])
    );

    harness.controller.handleEvent(
      makeGestureEvent('panend', offscreenPosition, {
        deltaX: offscreenPosition[0] - POINTER[0],
        deltaY: offscreenPosition[1] - POINTER[1]
      }) as any
    );
    harness.controller.finalize();
  });

  it('preserves a snapped target pixel and physical radius while rotating', () => {
    const snappedPosition: [number, number] = [POINTER[0] + 18, POINTER[1] - 11];
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider}
    });
    target = harness.makeTarget(snappedPosition, 275);
    const startRadius = getTargetInfo(harness, target).targetDistance;
    const rotateOptions = {srcEvent: {metaKey: true}};

    harness.controller.handleEvent(makeGestureEvent('panstart', POINTER, rotateOptions) as any);
    harness.controller.handleEvent(
      makeGestureEvent('panmove', [POINTER[0] + 180, POINTER[1] - 90], {
        ...rotateOptions,
        deltaX: 180,
        deltaY: -90
      }) as any
    );

    expect(harness.getViewportProps().bearing).not.toBe(INITIAL_VIEW_STATE.bearing);
    expectTargetInvariant(harness, target, snappedPosition, startRadius);

    harness.controller.handleEvent(
      makeGestureEvent('panend', [POINTER[0] + 180, POINTER[1] - 90], rotateOptions) as any
    );
    harness.controller.finalize();
  });

  it('preserves target pixel and deterministic radius while zooming', () => {
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider}
    });
    target = harness.makeTarget(POINTER, 210);
    const startInfo = getTargetInfo(harness, target);
    const startZoom = harness.getViewportProps().zoom;

    harness.controller.handleEvent(makeWheelEvent(80) as any);

    const zoom = harness.getViewportProps().zoom;
    expect(zoom).toBeGreaterThan(startZoom);
    expectTargetInvariant(
      harness,
      target,
      POINTER,
      startInfo.targetDistance * 2 ** (startZoom - zoom)
    );

    harness.controller.finalize();
  });

  it('stops target-relative wheel zoom at the metric target-distance floor', () => {
    let target!: MapInteractionTarget;
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: () => target}
    });
    const baseTarget = harness.makeTarget(POINTER, 210);
    const startInfo = getTargetInfo(harness, baseTarget);
    const startZoom = harness.getViewportProps().zoom;
    const minimumTargetDistance = startInfo.targetDistance / 2;
    target = {...baseTarget, minimumTargetDistance};

    harness.controller.handleEvent(makeWheelEvent(1000) as any);

    expect(harness.getViewportProps().zoom).toBeCloseTo(startZoom + 1, 3);
    expectTargetInvariant(harness, target, POINTER);
    const stoppedDistance = getTargetInfo(harness, target).targetDistance;
    expect(stoppedDistance).toBeGreaterThanOrEqual(minimumTargetDistance - 0.01);
    expect(stoppedDistance - minimumTargetDistance).toBeLessThan(minimumTargetDistance * 1e-3);
    harness.controller.finalize();
  });

  it('preserves an inside acquisition distance on zoom-in and still permits zoom-out', () => {
    let target!: MapInteractionTarget;
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: () => target}
    });
    const baseTarget = harness.makeTarget(POINTER, 210);
    const startInfo = getTargetInfo(harness, baseTarget);
    const startZoom = harness.getViewportProps().zoom;
    target = {...baseTarget, minimumTargetDistance: startInfo.targetDistance * 2};

    harness.controller.handleEvent(makeWheelEvent(1000) as any);
    expect(harness.getViewportProps().zoom).toBeCloseTo(startZoom, 10);
    expectTargetInvariant(harness, target, POINTER, startInfo.targetDistance);

    harness.controller.handleEvent(makeWheelEvent(-1000) as any);
    expect(harness.getViewportProps().zoom).toBeLessThan(startZoom);
    expect(getTargetInfo(harness, target).targetDistance).toBeGreaterThan(startInfo.targetDistance);
    harness.controller.finalize();
  });

  it('shares one target through compound pinch zoom and rotation', () => {
    const snappedPosition: [number, number] = [POINTER[0] - 9, POINTER[1] + 13];
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: provider,
        touchZoom: true,
        touchRotate: true
      }
    });
    target = harness.makeTarget(snappedPosition, 180);
    const startInfo = getTargetInfo(harness, target);
    const startZoom = harness.getViewportProps().zoom;

    harness.controller.handleEvent(makeGestureEvent('pinchstart') as any);
    harness.controller.handleEvent(
      makeGestureEvent('pinchmove', POINTER, {scale: 1.4, rotation: 24, deltaTime: 16}) as any
    );

    const currentProps = harness.getViewportProps();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(currentProps.zoom).toBeGreaterThan(startZoom);
    expect(currentProps.bearing).not.toBe(INITIAL_VIEW_STATE.bearing);
    expectTargetInvariant(
      harness,
      target,
      snappedPosition,
      startInfo.targetDistance * 2 ** (startZoom - currentProps.zoom)
    );

    harness.controller.handleEvent(
      makeGestureEvent('pinchend', POINTER, {scale: 1.4, rotation: 24, deltaTime: 32}) as any
    );
    expectTargetCleared(harness.interactionStates.at(-1)!);
    harness.controller.finalize();
  });

  it('uses one camera inverse and one application constraint per compound input frame', () => {
    let target!: MapInteractionTarget;
    const constraint = vi.fn(
      (context: Readonly<MapInteractionTargetViewStateContext>) => context.requestedViewState
    );
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: () => target,
        constrainInteractionTargetViewState: constraint,
        touchZoom: true,
        touchRotate: true
      }
    });
    target = harness.makeTarget(POINTER, 180);
    harness.controller.handleEvent(makeGestureEvent('pinchstart') as any);
    const inverse = vi.spyOn(WebMercatorViewport.prototype, 'getTargetViewState');

    harness.controller.handleEvent(
      makeGestureEvent('pinchmove', POINTER, {scale: 1.3, rotation: 20, deltaTime: 16}) as any
    );

    expect(inverse).toHaveBeenCalledTimes(1);
    expect(constraint).toHaveBeenCalledTimes(1);
    harness.controller.handleEvent(
      makeGestureEvent('pinchend', POINTER, {scale: 1.3, rotation: 20, deltaTime: 32}) as any
    );
    harness.controller.finalize();

    let keyTarget!: MapInteractionTarget;
    const keyConstraint = vi.fn(
      (context: Readonly<MapInteractionTargetViewStateContext>) => context.requestedViewState
    );
    const keyHarness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: () => keyTarget,
        constrainInteractionTargetViewState: keyConstraint
      }
    });
    keyTarget = keyHarness.makeTarget();
    inverse.mockClear();

    keyHarness.controller.handleEvent(
      makeGestureEvent('keydown', POINTER, {srcEvent: {code: 'Equal', metaKey: true}}) as any
    );

    expect(inverse).toHaveBeenCalledTimes(1);
    // One initial target-aware transition frame is evaluated synchronously.
    expect(keyConstraint).toHaveBeenCalledTimes(1);
    keyHarness.controller.finalize();
  });

  it('preserves target invariants on every sampled smooth-transition frame', () => {
    vi.useFakeTimers();
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: provider,
        scrollZoom: {smooth: true}
      }
    });
    target = harness.makeTarget(POINTER, 240);
    const startInfo = getTargetInfo(harness, target);
    const startZoom = harness.getViewportProps().zoom;
    const startTime = harness.timeline.getTime();

    harness.controller.handleEvent(makeWheelEvent(100) as any);
    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(true);

    for (const progress of [0.1, 0.25, 0.5, 0.75, 1]) {
      harness.timeline.setTime(startTime + 250 * progress);
      harness.controller.updateTransition();
      const zoom = harness.getViewportProps().zoom;
      expectTargetInvariant(
        harness,
        target,
        POINTER,
        startInfo.targetDistance * 2 ** (startZoom - zoom)
      );
    }

    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(false);
    vi.advanceTimersByTime(150);
    expectTargetCleared(harness.interactionStates.at(-1)!);
    harness.controller.finalize();
  });

  it.each([
    {
      title: 'double-click',
      makeEvent: () => makeGestureEvent('dblclick', POINTER, {pointerType: 'mouse'})
    },
    {
      title: 'keyboard',
      makeEvent: () => makeGestureEvent('keydown', POINTER, {srcEvent: {code: 'Equal'}})
    }
  ])('clears the target when a $title transition ends', ({makeEvent}) => {
    vi.useFakeTimers();
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider}
    });
    target = harness.makeTarget(POINTER, 190);
    const startTime = harness.timeline.getTime();

    harness.controller.handleEvent(makeEvent() as any);

    expect(provider).toHaveBeenCalledTimes(1);
    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(true);
    expect(harness.getInteractionState().interactionTargetPosition).toEqual(target.coordinate);

    harness.timeline.setTime(startTime + 301);
    harness.controller.updateTransition();

    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(false);
    expectTargetCleared(harness.interactionStates.at(-1)!);
    harness.controller.finalize();
  });

  it('clears a double-click target when its transition is interrupted externally', () => {
    vi.useFakeTimers();
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider}
    });
    target = harness.makeTarget(POINTER, 190);

    harness.controller.handleEvent(
      makeGestureEvent('dblclick', POINTER, {pointerType: 'mouse'}) as any
    );
    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(true);

    harness.updateProps({
      longitude: harness.getProps().longitude + 0.01,
      transitionDuration: 0
    });

    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(false);
    expectTargetCleared(harness.interactionStates.at(-1)!);
    harness.controller.finalize();
  });

  it('retains the target through pan inertia and clears it when inertia ends', () => {
    vi.useFakeTimers();
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: provider,
        inertia: 300
      }
    });
    target = harness.makeTarget(POINTER, 160);
    const sourceViewport = harness.getViewport();
    const endPosition: [number, number] = [POINTER[0] + 24, POINTER[1] + 12];

    harness.controller.handleEvent(makeGestureEvent('panstart') as any);
    harness.controller.handleEvent(
      makeGestureEvent('panmove', endPosition, {deltaX: 24, deltaY: 12}) as any
    );
    const transitionStart = harness.timeline.getTime();
    harness.controller.handleEvent(
      makeGestureEvent('panend', endPosition, {
        deltaX: 24,
        deltaY: 12,
        velocity: 0.5,
        velocityX: 0.4,
        velocityY: 0.2
      }) as any
    );

    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(true);
    expect(harness.getInteractionState().interactionTargetPosition).toEqual(target.coordinate);

    harness.timeline.setTime(transitionStart + 150);
    harness.controller.updateTransition();
    const halfInfo = getTargetInfo(harness, target);
    const expectedEndPosition: [number, number] = [
      endPosition[0] + (0.4 * 300) / 2,
      endPosition[1] + (0.2 * 300) / 2
    ];
    expect(halfInfo.projectedPosition[0]).toBeGreaterThan(endPosition[0]);
    expect(halfInfo.projectedPosition[0]).toBeLessThan(expectedEndPosition[0]);
    expect(halfInfo.projectedPosition[1]).toBeGreaterThan(endPosition[1]);
    expect(halfInfo.projectedPosition[1]).toBeLessThan(expectedEndPosition[1]);
    const halfViewport = harness.getViewport();
    expect(halfViewport.center[2]).toBeCloseTo(sourceViewport.center[2], 10);
    expect(halfViewport.zoom).toBe(sourceViewport.zoom);
    expect(halfViewport.bearing).toBe(sourceViewport.bearing);
    expect(halfViewport.pitch).toBe(sourceViewport.pitch);

    harness.timeline.setTime(transitionStart + 301);
    harness.controller.updateTransition();

    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(false);
    expectTargetCleared(harness.interactionStates.at(-1)!);
    harness.controller.finalize();
  });

  it('does not leak a transition owner from provider-null stock pan inertia', () => {
    let currentTarget: MapInteractionTarget | null = null;
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: () => currentTarget,
        inertia: 100
      }
    });
    const endPosition: [number, number] = [POINTER[0] + 24, POINTER[1] + 12];

    harness.controller.handleEvent(makeGestureEvent('panstart') as any);
    harness.controller.handleEvent(
      makeGestureEvent('panmove', endPosition, {deltaX: 24, deltaY: 12}) as any
    );
    const transitionStart = harness.timeline.getTime();
    harness.controller.handleEvent(
      makeGestureEvent('panend', endPosition, {
        deltaX: 24,
        deltaY: 12,
        velocity: 0.5,
        velocityX: 0.4,
        velocityY: 0.2
      }) as any
    );
    expect((harness.controller as any)._activeTargetOwners.size).toBe(0);

    harness.timeline.setTime(transitionStart + 101);
    harness.controller.updateTransition();
    currentTarget = harness.makeTarget();
    const rotateOptions = {srcEvent: {metaKey: true}};
    harness.controller.handleEvent(makeGestureEvent('panstart', POINTER, rotateOptions) as any);
    harness.controller.handleEvent(makeGestureEvent('panend', POINTER, rotateOptions) as any);

    expect((harness.controller as any)._activeTargetOwners.size).toBe(0);
    expectTargetCleared(harness.interactionStates.at(-1)!);
    harness.controller.finalize();
  });

  it('acquires a fresh target when a new gesture interrupts a target transition', () => {
    vi.useFakeTimers();
    let currentTarget!: MapInteractionTarget;
    const provider = vi.fn(() => currentTarget);
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: provider,
        scrollZoom: {smooth: true}
      }
    });
    const wheelTarget = harness.makeTarget(POINTER, 100);
    currentTarget = wheelTarget;
    harness.controller.handleEvent(makeWheelEvent(100) as any);
    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(true);

    const panTarget = harness.makeTarget(POINTER, 260);
    currentTarget = panTarget;
    harness.controller.handleEvent(makeGestureEvent('panstart') as any);

    expect(provider).toHaveBeenCalledTimes(2);
    expect(harness.getInteractionState().interactionTargetPosition).toEqual(panTarget.coordinate);
    expect(harness.getInteractionState().interactionTargetPosition).not.toEqual(
      wheelTarget.coordinate
    );
    harness.controller.handleEvent(makeGestureEvent('panend') as any);
    harness.controller.finalize();
  });

  it('does not let an interrupted transition release the replacement target session', () => {
    vi.useFakeTimers();
    let currentTarget!: MapInteractionTarget;
    const provider = vi.fn(() => currentTarget);
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider}
    });
    const doubleClickTarget = harness.makeTarget(POINTER, 100);
    currentTarget = doubleClickTarget;
    harness.controller.handleEvent(
      makeGestureEvent('dblclick', POINTER, {pointerType: 'mouse'}) as any
    );
    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(true);

    const keyboardTarget = harness.makeTarget([VIEW_SIZE.width / 2, VIEW_SIZE.height / 2], 260);
    currentTarget = keyboardTarget;
    harness.controller.handleEvent(
      makeGestureEvent('keydown', POINTER, {srcEvent: {code: 'Equal'}}) as any
    );

    expect(provider).toHaveBeenCalledTimes(2);
    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(true);
    expect(harness.getInteractionState().interactionTargetPosition).toEqual(
      keyboardTarget.coordinate
    );
    harness.controller.finalize();
  });

  it('cancels an active target transition when target navigation is disabled', () => {
    vi.useFakeTimers();
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider}
    });
    target = harness.makeTarget(POINTER, 190);
    harness.controller.handleEvent(
      makeGestureEvent('dblclick', POINTER, {pointerType: 'mouse'}) as any
    );
    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(true);

    const nextProps = {...harness.getProps()};
    delete nextProps._targetNavigation;
    harness.replaceProps(nextProps);

    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(false);
    expectTargetCleared(harness.interactionStates.at(-1)!);
    harness.controller.finalize();
  });

  it('applies an application target-view-state constraint before core validation', () => {
    let target!: MapInteractionTarget;
    const contexts: MapInteractionTargetViewStateContext[] = [];
    const constrainInteractionTargetViewState = vi.fn(
      (context: Readonly<MapInteractionTargetViewStateContext>) => {
        contexts.push(context as MapInteractionTargetViewStateContext);
        const zoom = Math.min(
          context.requestedViewState.zoom,
          context.currentViewState.zoom + 0.125
        );
        return context.sourceViewport.getTargetViewState({
          target: context.target.coordinate,
          screenPosition: context.target.screenPosition,
          bearing: context.requestedViewState.bearing,
          pitch: context.requestedViewState.pitch,
          zoom
        });
      }
    );
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: () => target,
        constrainInteractionTargetViewState
      }
    });
    target = harness.makeTarget(POINTER, 140);
    const startZoom = harness.getViewportProps().zoom;

    harness.controller.handleEvent(makeWheelEvent(1000) as any);

    expect(constrainInteractionTargetViewState).toHaveBeenCalledTimes(1);
    expect(harness.getViewportProps().zoom).toBeCloseTo(startZoom + 0.125);
    expect(contexts[0]).toMatchObject({
      viewId: 'target-map',
      operation: 'zoom',
      source: 'wheel'
    });
    expect(Object.isFrozen(contexts[0])).toBe(true);
    expect(Object.isFrozen(contexts[0].target)).toBe(true);
    expect(Object.isFrozen(contexts[0].target.coordinate)).toBe(true);
    expect(Object.isFrozen(contexts[0].target.screenPosition)).toBe(true);
    expect(Object.isFrozen(contexts[0].currentViewState)).toBe(true);
    expect(Object.isFrozen(contexts[0].requestedViewState)).toBe(true);
    expectTargetInvariant(harness, target, POINTER);
    harness.controller.finalize();
  });

  it('accepts constraint-adjusted zoom and radius on intermediate transition frames', () => {
    vi.useFakeTimers();
    let target!: MapInteractionTarget;
    let capTransitionFrames = false;
    const contexts: Readonly<MapInteractionTargetViewStateContext>[] = [];
    const acceptedZooms: number[] = [];
    const constrainInteractionTargetViewState = vi.fn(
      (context: Readonly<MapInteractionTargetViewStateContext>) => {
        contexts.push(context);
        const zoom = capTransitionFrames
          ? Math.min(context.requestedViewState.zoom, context.currentViewState.zoom + 0.125)
          : context.requestedViewState.zoom;
        acceptedZooms.push(zoom);
        return context.sourceViewport.getTargetViewState({
          target: context.target.coordinate,
          screenPosition: context.target.screenPosition,
          bearing: context.requestedViewState.bearing,
          pitch: context.requestedViewState.pitch,
          zoom
        });
      }
    );
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: () => target,
        constrainInteractionTargetViewState,
        scrollZoom: {smooth: true}
      }
    });
    target = harness.makeTarget(POINTER, 220);
    const startInfo = getTargetInfo(harness, target);
    const startZoom = harness.getViewportProps().zoom;
    const transitionStart = harness.timeline.getTime();

    harness.controller.handleEvent(makeWheelEvent(100) as any);
    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(true);
    capTransitionFrames = true;

    for (const progress of [0.5, 0.75]) {
      const previousZoom = harness.getViewportProps().zoom;
      const callsBeforeFrame = contexts.length;
      harness.timeline.setTime(transitionStart + 250 * progress);
      harness.controller.updateTransition();

      expect(contexts.length).toBeGreaterThan(callsBeforeFrame);
      const context = contexts.at(-1)!;
      const zoom = harness.getViewportProps().zoom;
      expect(zoom).toBeCloseTo(acceptedZooms.at(-1)!);
      expect(zoom).toBeLessThanOrEqual(previousZoom + 0.125 + 1e-10);
      expect(zoom).toBeLessThan(context.requestedViewState.zoom);
      expectTargetInvariant(
        harness,
        target,
        context.target.screenPosition as [number, number],
        startInfo.targetDistance * 2 ** (startZoom - zoom)
      );
    }

    harness.controller.finalize();
  });

  it('supplies each moved candidate pixel and reuses the operation-start viewport through inertia', () => {
    vi.useFakeTimers();
    let target!: MapInteractionTarget;
    const contexts: Readonly<MapInteractionTargetViewStateContext>[] = [];
    const constrainInteractionTargetViewState = vi.fn(
      (context: Readonly<MapInteractionTargetViewStateContext>) => {
        contexts.push(context);
        return context.requestedViewState;
      }
    );
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: () => target,
        constrainInteractionTargetViewState,
        inertia: 300
      }
    });
    target = harness.makeTarget(POINTER, 160);
    const firstPosition: [number, number] = [POINTER[0] + 18, POINTER[1] + 9];
    const endPosition: [number, number] = [POINTER[0] + 24, POINTER[1] + 12];

    harness.controller.handleEvent(makeGestureEvent('panstart') as any);
    harness.controller.handleEvent(
      makeGestureEvent('panmove', firstPosition, {deltaX: 18, deltaY: 9}) as any
    );
    expect(contexts.at(-1)?.target.screenPosition).toEqual(firstPosition);
    const sourceViewport = contexts.at(-1)?.sourceViewport;

    harness.controller.handleEvent(
      makeGestureEvent('panmove', endPosition, {deltaX: 24, deltaY: 12}) as any
    );
    expect(contexts.at(-1)?.target.screenPosition).toEqual(endPosition);
    expect(contexts.at(-1)?.sourceViewport).toBe(sourceViewport);

    const transitionStart = harness.timeline.getTime();
    harness.controller.handleEvent(
      makeGestureEvent('panend', endPosition, {
        deltaX: 24,
        deltaY: 12,
        velocity: 0.5,
        velocityX: 0.4,
        velocityY: 0.2
      }) as any
    );
    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(true);
    const callsBeforeIntermediateFrame = contexts.length;

    harness.timeline.setTime(transitionStart + 150);
    harness.controller.updateTransition();

    expect(contexts.length).toBeGreaterThan(callsBeforeIntermediateFrame);
    const intermediateContext = contexts.at(-1)!;
    const expectedEndPosition: [number, number] = [
      endPosition[0] + (0.4 * 300) / 2,
      endPosition[1] + (0.2 * 300) / 2
    ];
    expect(intermediateContext.target.screenPosition[0]).toBeGreaterThan(endPosition[0]);
    expect(intermediateContext.target.screenPosition[0]).toBeLessThan(expectedEndPosition[0]);
    expect(intermediateContext.target.screenPosition[1]).toBeGreaterThan(endPosition[1]);
    expect(intermediateContext.target.screenPosition[1]).toBeLessThan(expectedEndPosition[1]);
    expect(intermediateContext.sourceViewport).toBe(sourceViewport);
    expect(new Set(contexts.map(context => context.sourceViewport))).toEqual(
      new Set([sourceViewport])
    );

    harness.timeline.setTime(transitionStart + 301);
    harness.controller.updateTransition();
    harness.controller.finalize();
  });

  it('freezes the constraint callback for an active target session', () => {
    let target!: MapInteractionTarget;
    const firstConstraint = vi.fn(
      (context: Readonly<MapInteractionTargetViewStateContext>) => context.requestedViewState
    );
    const replacementConstraint = vi.fn(
      (context: Readonly<MapInteractionTargetViewStateContext>) => context.requestedViewState
    );
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: () => target,
        constrainInteractionTargetViewState: firstConstraint
      }
    });
    target = harness.makeTarget();

    harness.controller.handleEvent(makeGestureEvent('panstart') as any);
    harness.updateProps({constrainInteractionTargetViewState: replacementConstraint});
    harness.controller.handleEvent(
      makeGestureEvent('panmove', [POINTER[0] + 20, POINTER[1] + 10], {
        deltaX: 20,
        deltaY: 10
      }) as any
    );
    expect(firstConstraint).toHaveBeenCalledTimes(1);
    expect(replacementConstraint).not.toHaveBeenCalled();
    harness.controller.handleEvent(
      makeGestureEvent('panend', [POINTER[0] + 20, POINTER[1] + 10], {
        deltaX: 20,
        deltaY: 10
      }) as any
    );

    target = harness.makeTarget();
    harness.controller.handleEvent(makeGestureEvent('panstart') as any);
    harness.controller.handleEvent(
      makeGestureEvent('panmove', [POINTER[0] + 10, POINTER[1] - 5], {
        deltaX: 10,
        deltaY: -5
      }) as any
    );
    expect(firstConstraint).toHaveBeenCalledTimes(1);
    expect(replacementConstraint).toHaveBeenCalledTimes(1);
    harness.controller.handleEvent(makeGestureEvent('panend') as any);
    harness.controller.finalize();
  });

  it.each([
    {
      title: 'null',
      constrain: () => null
    },
    {
      title: 'a nonfinite map state',
      constrain: (context: Readonly<MapInteractionTargetViewStateContext>) => ({
        ...context.requestedViewState,
        longitude: Number.NaN
      })
    },
    {
      title: 'a malformed position',
      constrain: (context: Readonly<MapInteractionTargetViewStateContext>) =>
        ({...context.requestedViewState, position: [0, 0]}) as any
    }
  ])('keeps the last valid state when the application constraint returns $title', ({constrain}) => {
    let target!: MapInteractionTarget;
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: () => target,
        constrainInteractionTargetViewState: constrain
      }
    });
    target = harness.makeTarget();
    const before = getCanonicalCameraState(harness);

    harness.controller.handleEvent(makeWheelEvent(1000) as any);

    expect(getCanonicalCameraState(harness)).toEqual(before);
    expect(harness.getInteractionState().interactionTargetPosition).toEqual(target.coordinate);
    harness.controller.finalize();
  });

  it('propagates an event-frame constraint exception after clearing the target lifecycle', () => {
    let target!: MapInteractionTarget;
    const expectedError = new Error('event constraint failed');
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: () => target,
        constrainInteractionTargetViewState: () => {
          throw expectedError;
        }
      }
    });
    target = harness.makeTarget();
    const before = getCanonicalCameraState(harness);

    expect(() => harness.controller.handleEvent(makeWheelEvent(100) as any)).toThrow(expectedError);

    expect(getCanonicalCameraState(harness)).toEqual(before);
    expect(harness.interactionStates.some(state => state.interactionTargetPosition)).toBe(true);
    expectTargetCleared(harness.interactionStates.at(-1)!);
    harness.controller.finalize();
  });

  it('rejects synchronous controller reconfiguration from an event-frame constraint callback', () => {
    let target!: MapInteractionTarget;
    let harness!: ReturnType<typeof createControllerHarness>;
    const constrainInteractionTargetViewState = vi.fn(
      (context: Readonly<MapInteractionTargetViewStateContext>) => {
        harness.updateProps({_targetNavigation: false, keyboard: false, dragPan: false});
        return context.requestedViewState;
      }
    );
    harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: () => target,
        constrainInteractionTargetViewState
      }
    });
    target = harness.makeTarget();
    harness.controller.handleEvent(makeGestureEvent('panstart') as any);

    expect(() =>
      harness.controller.handleEvent(
        makeGestureEvent('panmove', [POINTER[0] + 20, POINTER[1] + 10], {
          deltaX: 20,
          deltaY: 10
        }) as any
      )
    ).toThrow(
      'MapController.setProps cannot be called synchronously from constrainInteractionTargetViewState'
    );

    expect(constrainInteractionTargetViewState).toHaveBeenCalledTimes(1);
    expect(harness.getInteractionState().interactionTargetPosition).toBeUndefined();
    expectTargetCleared(harness.interactionStates.at(-1)!);
    expect((harness.controller as any).targetNavigation).toBe(true);
    expect((harness.controller as any).keyboard).toBe(true);
    expect((harness.controller as any).dragPan).toBe(true);
    harness.controller.finalize();
  });

  it('propagates an intermediate-transition constraint exception after clearing the target lifecycle', () => {
    vi.useFakeTimers();
    let target!: MapInteractionTarget;
    let failTransitionFrame = false;
    const expectedError = new Error('transition constraint failed');
    const constrainInteractionTargetViewState = vi.fn(
      (context: Readonly<MapInteractionTargetViewStateContext>) => {
        if (failTransitionFrame) {
          throw expectedError;
        }
        return context.requestedViewState;
      }
    );
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: () => target,
        constrainInteractionTargetViewState,
        scrollZoom: {smooth: true}
      }
    });
    target = harness.makeTarget();
    const transitionStart = harness.timeline.getTime();

    harness.controller.handleEvent(makeWheelEvent(100) as any);
    expect((harness.controller as any).transitionManager.transition.inProgress).toBe(true);
    expect(harness.getInteractionState().interactionTargetPosition).toEqual(target.coordinate);
    const callsBeforeIntermediateFrame = constrainInteractionTargetViewState.mock.calls.length;
    failTransitionFrame = true;
    harness.timeline.setTime(transitionStart + 125);

    expect(() => harness.controller.updateTransition()).toThrow(expectedError);

    expect(constrainInteractionTargetViewState.mock.calls.length).toBeGreaterThan(
      callsBeforeIntermediateFrame
    );
    expectTargetCleared(harness.interactionStates.at(-1)!);
    harness.controller.finalize();
  });

  it('constrains target rotation and zoom without violating the target invariant', () => {
    let rotationTarget!: MapInteractionTarget;
    const rotationHarness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: () => rotationTarget
      },
      initialViewState: {maxPitch: 50}
    });
    rotationTarget = rotationHarness.makeTarget(POINTER, 150);
    const rotationRadius = getTargetInfo(rotationHarness, rotationTarget).targetDistance;
    const rotateOptions = {srcEvent: {metaKey: true}};
    rotationHarness.controller.handleEvent(
      makeGestureEvent('panstart', POINTER, rotateOptions) as any
    );
    rotationHarness.controller.handleEvent(
      makeGestureEvent('panmove', [POINTER[0], 0], {
        ...rotateOptions,
        deltaY: -POINTER[1]
      }) as any
    );
    expect(rotationHarness.getViewportProps().pitch).toBeLessThanOrEqual(50);
    expectTargetInvariant(rotationHarness, rotationTarget, POINTER, rotationRadius);

    let zoomTarget!: MapInteractionTarget;
    const zoomHarness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: () => zoomTarget
      },
      initialViewState: {maxZoom: 13.25}
    });
    zoomTarget = zoomHarness.makeTarget(POINTER, 150);
    const zoomStartInfo = getTargetInfo(zoomHarness, zoomTarget);
    const zoomStart = zoomHarness.getViewportProps().zoom;
    zoomHarness.controller.handleEvent(makeWheelEvent(1000) as any);
    const constrainedZoom = zoomHarness.getViewportProps().zoom;
    expect(constrainedZoom).toBeCloseTo(13.25);
    expectTargetInvariant(
      zoomHarness,
      zoomTarget,
      POINTER,
      zoomStartInfo.targetDistance * 2 ** (zoomStart - constrainedZoom)
    );

    rotationHarness.controller.finalize();
    zoomHarness.controller.finalize();
  });

  it('returns the last valid map state when maxBounds breaks the target invariant', () => {
    let target!: MapInteractionTarget;
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: () => target},
      initialViewState: {
        maxBounds: [
          [8.42, 47.22],
          [8.58, 47.38]
        ]
      }
    });
    target = harness.makeTarget(POINTER, 150);
    const before = harness.getViewportProps();
    const farPosition: [number, number] = [760, 560];

    harness.controller.handleEvent(makeGestureEvent('panstart') as any);
    harness.controller.handleEvent(
      makeGestureEvent('panmove', farPosition, {deltaX: 450, deltaY: 300}) as any
    );

    const after = harness.getViewportProps();
    if (
      after.longitude === before.longitude &&
      after.latitude === before.latitude &&
      after.zoom === before.zoom
    ) {
      expect(after).toEqual(before);
    } else {
      expectTargetInvariant(harness, target, farPosition);
    }

    harness.controller.handleEvent(
      makeGestureEvent('panend', farPosition, {deltaX: 450, deltaY: 300}) as any
    );
    harness.controller.finalize();
  });

  it('clears target ownership when a controlled consumer provides no view-state feedback', () => {
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider},
      feedback: 'none'
    });
    target = harness.makeTarget();
    const controlledProps = {...harness.getProps()};

    runPan(harness.controller);

    expect(provider).toHaveBeenCalledTimes(1);
    expect(harness.getProps()).toEqual(controlledProps);
    expectTargetCleared(harness.interactionStates.at(-1)!);
    harness.controller.finalize();
  });

  it('keeps the target snapshot through delayed controlled feedback', () => {
    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider},
      feedback: 'manual'
    });
    target = harness.makeTarget();
    const firstPosition: [number, number] = [POINTER[0] + 30, POINTER[1] + 20];
    const secondPosition: [number, number] = [POINTER[0] + 60, POINTER[1] + 40];

    harness.controller.handleEvent(makeGestureEvent('panstart') as any);
    harness.controller.handleEvent(
      makeGestureEvent('panmove', firstPosition, {deltaX: 30, deltaY: 20}) as any
    );
    harness.applyLatestViewState();
    expect(harness.getInteractionState().interactionTargetPosition).toEqual(target.coordinate);
    harness.controller.handleEvent(
      makeGestureEvent('panmove', secondPosition, {deltaX: 60, deltaY: 40}) as any
    );

    expect(provider).toHaveBeenCalledTimes(1);
    expectTargetInvariant(harness, target, secondPosition);

    harness.controller.handleEvent(
      makeGestureEvent('panend', secondPosition, {deltaX: 60, deltaY: 40}) as any
    );
    expectTargetCleared(harness.interactionStates.at(-1)!);
    harness.controller.finalize();
  });

  it('retains the active numeric snapshot across external controlled-state replacement', () => {
    let target!: MapInteractionTarget;
    const originalProvider = vi.fn(() => target);
    const replacementProvider = vi.fn(() => null);
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: originalProvider}
    });
    target = harness.makeTarget();

    harness.controller.handleEvent(makeGestureEvent('panstart') as any);
    harness.updateProps({
      longitude: harness.getProps().longitude + 0.002,
      getInteractionTarget: replacementProvider
    });
    expect(harness.getInteractionState().interactionTargetPosition).toEqual(target.coordinate);

    const endPosition: [number, number] = [POINTER[0] + 40, POINTER[1] - 25];
    harness.controller.handleEvent(
      makeGestureEvent('panmove', endPosition, {deltaX: 40, deltaY: -25}) as any
    );

    expect(originalProvider).toHaveBeenCalledTimes(1);
    expect(replacementProvider).not.toHaveBeenCalled();
    expectTargetInvariant(harness, target, endPosition);

    harness.controller.handleEvent(
      makeGestureEvent('panend', endPosition, {deltaX: 40, deltaY: -25}) as any
    );
    expectTargetCleared(harness.interactionStates.at(-1)!);
    harness.controller.finalize();
  });

  it('fully cancels target-derived gesture starts when target navigation is disabled', () => {
    let target!: MapInteractionTarget;
    const harness = createControllerHarness({
      controllerOptions: {_targetNavigation: true, getInteractionTarget: () => target}
    });
    target = harness.makeTarget(POINTER, 180);
    const rotateOptions = {srcEvent: {metaKey: true}};

    harness.controller.handleEvent(makeGestureEvent('panstart', POINTER, rotateOptions) as any);
    harness.controller.handleEvent(
      makeGestureEvent('panmove', [POINTER[0] + 15, POINTER[1] + 8], {
        ...rotateOptions,
        deltaX: 15,
        deltaY: 8
      }) as any
    );
    harness.updateProps({_targetNavigation: false, getInteractionTarget: undefined});

    const state = harness.controller.controllerState.getState();
    expect(state).toMatchObject({
      interactionTarget: null,
      startPanLngLat: null,
      startZoomLngLat: null,
      startRotateLngLat: null,
      startRotatePos: null
    });
    expect(harness.getInteractionState()).toMatchObject({
      interactionTargetPosition: undefined,
      rotationPivotPosition: undefined,
      isDragging: false,
      isRotating: false
    });
    const beforeIgnoredMove = getCanonicalCameraState(harness);

    harness.controller.handleEvent(
      makeGestureEvent('panmove', [POINTER[0] + 40, POINTER[1] + 25], {
        ...rotateOptions,
        deltaX: 40,
        deltaY: 25
      }) as any
    );

    expect(getCanonicalCameraState(harness)).toEqual(beforeIgnoredMove);
    harness.controller.finalize();
  });

  it('cancels a target pinch when the viewport structure changes', () => {
    let target!: MapInteractionTarget;
    const harness = createControllerHarness({
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: () => target,
        touchZoom: true,
        touchRotate: true
      }
    });
    target = harness.makeTarget();
    harness.controller.handleEvent(makeGestureEvent('pinchstart') as any);

    harness.replaceViewOptions({fovy: 50});

    expect(harness.getInteractionState()).toMatchObject({
      interactionTargetPosition: undefined,
      isDragging: false,
      isZooming: false,
      isRotating: false
    });
    const beforeIgnoredMove = getCanonicalCameraState(harness);
    harness.controller.handleEvent(
      makeGestureEvent('pinchmove', POINTER, {scale: 1.3, rotation: 20, deltaTime: 16}) as any
    );
    expect(getCanonicalCameraState(harness)).toEqual(beforeIgnoredMove);
    harness.controller.finalize();
  });

  it.each(['cold', 'warm'])(
    'preserves the complete camera on %s Terrain handoff after elevated orbit',
    cache => {
      const clock = mockTerrainFrames();
      let target: MapInteractionTarget | null = null;
      const picker = vi.fn(() => ({coordinate: [8.5, 47.3, 300]}));
      const harness = createControllerHarness({
        ControllerClass: TerrainController,
        controllerOptions: {_targetNavigation: true, getInteractionTarget: () => target},
        pickPosition: picker
      });
      try {
        if (cache === 'warm') clock.step();
        target = harness.makeTarget(POINTER, 180);
        runTargetOrbit(harness.controller);
        const before = harness.getAcceptedViewport();
        expect(Math.abs(before.center[2])).toBeGreaterThan(0);
        expectTargetCleared(harness.getInteractionState());
        clock.step();
        expect(picker).toHaveBeenCalledTimes(cache === 'warm' ? 2 : 1);
        expectSameCamera(before, harness.getAcceptedViewport());

        // A provider miss must not let the warm, pre-orbit elevation overwrite the pose.
        target = null;
        harness.controller.handleEvent(makeGestureEvent('panstart') as any);
        expectSameCamera(before, harness.getAcceptedViewport());
        harness.controller.handleEvent(makeGestureEvent('panend') as any);
      } finally {
        harness.controller.finalize();
      }
      expect(clock.frames.size).toBe(0);
    }
  );

  it.each([false, true])(
    'preserves an initial XYZ camera when Terrain initializes (target option %s, provider null)',
    enabled => {
      const clock = mockTerrainFrames();
      const harness = createControllerHarness({
        ControllerClass: TerrainController,
        initialViewState: {position: [120, -70, 90]},
        controllerOptions: {_targetNavigation: enabled, getInteractionTarget: () => null},
        pickPosition: () => ({coordinate: [8.5, 47.3, 300]})
      });
      try {
        const before = harness.getAcceptedViewport();
        clock.step();
        expectSameCamera(before, harness.getAcceptedViewport());
        harness.controller.handleEvent(makeGestureEvent('panstart') as any);
        expectSameCamera(before, harness.getAcceptedViewport());
        harness.controller.handleEvent(makeGestureEvent('panend') as any);
      } finally {
        harness.controller.finalize();
      }
      expect(clock.frames.size).toBe(0);
    }
  );

  it.each([
    {name: 'padding and lens', viewOptions: {padding: {left: 130, top: 70}, fovy: 55}},
    {
      name: 'invertible model matrix',
      viewOptions: {modelMatrix: new Matrix4().rotateX(0.2).scale([2, 3, 4])}
    },
    {name: 'high latitude', initialViewState: {latitude: 75}},
    {name: 'wrapped longitude', initialViewState: {longitude: 368.5}},
    {name: 'rendered world copy', viewOptions: {worldOffset: 1}}
  ])('rebases Terrain with $name without changing its camera', options => {
    const clock = mockTerrainFrames();
    const latitude = options.initialViewState?.latitude ?? INITIAL_VIEW_STATE.latitude;
    const harness = createControllerHarness({
      ...options,
      ControllerClass: TerrainController,
      initialViewState: {position: [120, -70, 90], ...options.initialViewState},
      pickPosition: () => ({coordinate: [8.5, latitude, 150]})
    });
    harness.viewStateChanges.length = 0;
    try {
      const before = harness.getAcceptedViewport();
      clock.step();
      expect(harness.viewStateChanges).toHaveLength(1);
      expectSameCamera(before, harness.getAcceptedViewport());
    } finally {
      harness.controller.finalize();
    }
  });

  it.each([
    'miss',
    'nonfinite',
    'other view',
    'other projection',
    'stale camera',
    'above camera',
    'zoom constraint'
  ])('leaves a failed Terrain handoff atomic (%s), then accepts a fresh valid sample', failure => {
    const clock = mockTerrainFrames();
    let sample: {coordinate?: number[]; viewport?: WebMercatorViewport} | null = null;
    const harness = createControllerHarness({
      ControllerClass: TerrainController,
      initialViewState: {position: [100, -40, 90]},
      pickPosition: () => sample
    });
    harness.viewStateChanges.length = 0;
    try {
      const before = harness.getAcceptedViewport();
      const coordinate = [8.5, 47.3, 300];
      sample = failure === 'miss' ? null : {coordinate};
      if (failure === 'nonfinite') sample = {coordinate: [8.5, 47.3, NaN]};
      if (failure === 'above camera') sample = {coordinate: [8.5, 47.3, 1e9]};
      if (failure === 'other view')
        sample = {coordinate, viewport: new WebMercatorViewport({id: 'other'})};
      if (failure === 'other projection')
        sample = {
          coordinate,
          viewport: new WebMercatorViewport({id: 'target-map', orthographic: true})
        };
      if (failure === 'stale camera')
        sample = {coordinate, viewport: new WebMercatorViewport({...harness.getProps(), zoom: 14})};
      if (failure === 'zoom constraint') harness.updateProps({maxZoom: 13});
      clock.step();
      expect(harness.viewStateChanges).toHaveLength(0);
      harness.controller.handleEvent(makeGestureEvent('panstart') as any);
      expectSameCamera(before, harness.getAcceptedViewport());
      harness.controller.handleEvent(makeGestureEvent('panend') as any);
      harness.updateProps({maxZoom: 20});
      sample = {coordinate};
      const count = harness.viewStateChanges.length;
      clock.step();
      expect(harness.viewStateChanges).toHaveLength(count + 1);
      expectSameCamera(before, harness.getAcceptedViewport());
    } finally {
      harness.controller.finalize();
    }
  });

  it.each(['manual', 'none'] as const)(
    'waits for %s controlled feedback without repeated Terrain proposals',
    feedback => {
      const clock = mockTerrainFrames();
      const harness = createControllerHarness({
        ControllerClass: TerrainController,
        feedback,
        initialViewState: {position: [120, -70, 90]},
        pickPosition: () => ({coordinate: [8.5, 47.3, 300]})
      });
      harness.viewStateChanges.length = 0;
      try {
        const before = harness.getAcceptedViewport();
        clock.step();
        const proposal = harness.viewStateChanges[0];
        expect(proposal).toBeDefined();
        for (let i = 0; i < 4; i++) clock.step();
        expect(harness.viewStateChanges).toHaveLength(1);
        expect(harness.getViewportProps().position).toEqual([120, -70, 90]);
        expectSameCamera(before, harness.getAcceptedViewport());
        if (feedback === 'manual') harness.applyLatestViewState();
        harness.controller.handleEvent(makeGestureEvent('panstart') as any);
        expectSameCamera(before, harness.getViewport());
        if (feedback === 'manual')
          expect(harness.getViewportProps().position).toEqual(proposal.position);
        harness.controller.handleEvent(makeGestureEvent('panend') as any);
        // An external replacement invalidates the old proposal and gets its own fresh solve.
        harness.updateProps({longitude: 8.501, position: [40, 20, 80]});
        const replacement = harness.getAcceptedViewport();
        const count = harness.viewStateChanges.length;
        clock.step();
        if (feedback === 'none') expect(harness.viewStateChanges).toHaveLength(count + 1);
        expectSameCamera(replacement, harness.getAcceptedViewport());
      } finally {
        harness.controller.finalize();
      }
      expect(clock.frames.size).toBe(0);
    }
  );

  it('does not poison a warm Terrain cache with a sparse or nonfinite pick', () => {
    const clock = mockTerrainFrames();
    let coordinate: number[] = [8.5, 47.3, 300];
    const harness = createControllerHarness({
      ControllerClass: TerrainController,
      pickPosition: () => ({coordinate})
    });
    try {
      clock.step();
      const before = harness.getAcceptedViewport();
      for (const invalid of [[8.5, 47.3, NaN], new Array(3)]) {
        coordinate = invalid;
        clock.step();
        harness.controller.handleEvent(makeGestureEvent('panstart') as any);
        expectSameCamera(before, harness.getAcceptedViewport());
        harness.controller.handleEvent(makeGestureEvent('panend') as any);
      }
    } finally {
      harness.controller.finalize();
    }
  });

  it('invalidates warm Terrain before constraints normalize an externally replaced camera', () => {
    const clock = mockTerrainFrames();
    const harness = createControllerHarness({
      ControllerClass: TerrainController,
      pickPosition: () => ({coordinate: [8.5, 47.3, 300]})
    });
    clock.step();
    const replacement = {
      position: [100, -40, 90],
      maxBounds: [
        [8.49, 47.29],
        [8.51, 47.31]
      ]
    };
    const control = createControllerHarness({
      initialViewState: {...harness.getProps(), ...replacement}
    });
    try {
      harness.updateProps(replacement);
      expectSameCamera(control.getAcceptedViewport(), harness.getAcceptedViewport());
    } finally {
      harness.controller.finalize();
      control.controller.finalize();
    }
  });

  it('suspends Terrain sampling through smooth target frames and resumes from the accepted final frame', () => {
    vi.useFakeTimers();
    const clock = mockTerrainFrames();
    let target!: MapInteractionTarget;
    const picker = vi.fn(() => ({coordinate: [8.5, 47.3, 300]}));
    const harness = createControllerHarness({
      ControllerClass: TerrainController,
      controllerOptions: {
        _targetNavigation: true,
        getInteractionTarget: () => target,
        scrollZoom: {smooth: true}
      },
      pickPosition: picker
    });
    try {
      clock.step();
      target = harness.makeTarget(POINTER, 180);
      harness.controller.handleEvent(makeWheelEvent(30) as any);
      const start = harness.timeline.getTime();
      for (const elapsed of [50, 125, 200]) {
        harness.timeline.setTime(start + elapsed);
        harness.controller.updateTransition();
        const frame = harness.getAcceptedViewport();
        clock.step();
        expect(picker).toHaveBeenCalledTimes(1);
        expectSameCamera(frame, harness.getAcceptedViewport());
      }
      vi.advanceTimersByTime(301);
      harness.timeline.setTime(start + 301);
      harness.controller.updateTransition();
      expectTargetCleared(harness.getInteractionState());
      const before = harness.getAcceptedViewport();
      clock.step();
      expect(picker).toHaveBeenCalledTimes(2);
      expectSameCamera(before, harness.getAcceptedViewport());
    } finally {
      harness.controller.finalize();
    }
    expect(clock.frames.size).toBe(0);
  });

  it.each(['lens', 'dimensions', 'replacement'])(
    'discards a pending Terrain proposal on %s change',
    change => {
      const clock = mockTerrainFrames();
      const harness = createControllerHarness({
        ControllerClass: TerrainController,
        feedback: 'manual',
        pickPosition: () => ({coordinate: [8.5, 47.3, 150]})
      });
      try {
        clock.step();
        if (change === 'lens') harness.replaceViewOptions({fovy: 50});
        if (change === 'dimensions') harness.replaceViewOptions({width: 760, height: 560});
        if (change === 'replacement') harness.updateProps({zoom: 12, position: [20, 30, 40]});
        const before = harness.getAcceptedViewport();
        const count = harness.viewStateChanges.length;
        clock.step();
        expect(harness.viewStateChanges).toHaveLength(count + 1);
        harness.applyLatestViewState();
        expectSameCamera(before, harness.getAcceptedViewport());
      } finally {
        harness.controller.finalize();
      }
    }
  );

  it.each([{orthographic: true}, {legacyMeterSizes: true}])(
    'retains stock Terrain behavior for unsupported target projection %j',
    viewOptions => {
      const clock = mockTerrainFrames();
      const provider = vi.fn(() => ({coordinate: [8.5, 47.3, 180], screenPosition: POINTER}));
      const options = {
        ControllerClass: TerrainController,
        viewOptions,
        pickPosition: () => ({coordinate: [8.5, 47.3, 150]})
      };
      const enabled = createControllerHarness({
        ...options,
        controllerOptions: {_targetNavigation: true, getInteractionTarget: provider}
      });
      const stock = createControllerHarness(options);
      try {
        clock.step();
        clock.step();
        runPan(enabled.controller);
        runPan(stock.controller);
        expect(getCanonicalCameraState(enabled)).toEqual(getCanonicalCameraState(stock));
        expect(provider).not.toHaveBeenCalled();
        expectTargetCleared(enabled.getInteractionState());
      } finally {
        enabled.controller.finalize();
        stock.controller.finalize();
      }
      expect(clock.frames.size).toBe(0);
    }
  );

  it('passes stock input deltas through before a warm Terrain handoff gets its next sample', () => {
    const clock = mockTerrainFrames();
    let target: MapInteractionTarget | null = null;
    const harness = createControllerHarness({
      ControllerClass: TerrainController,
      controllerOptions: {_targetNavigation: true, getInteractionTarget: () => target},
      pickPosition: () => ({coordinate: [8.5, 47.3, 300]})
    });
    try {
      clock.step();
      target = harness.makeTarget(POINTER, 180);
      runTargetOrbit(harness.controller);
      target = null;
      const before = harness.getAcceptedViewport();
      const control = createControllerHarness({
        initialViewState: harness.getProps(),
        controllerOptions: {getInteractionTarget: () => null}
      });
      try {
        harness.controller.handleEvent(makeGestureEvent('panstart') as any);
        expectSameCamera(before, harness.getAcceptedViewport());
        harness.controller.handleEvent(makeGestureEvent('panend') as any);
        runPan(harness.controller);
        runPan(control.controller);
        expectSameCamera(control.getAcceptedViewport(), harness.getAcceptedViewport());
        const after = harness.getAcceptedViewport();
        clock.step();
        expectSameCamera(after, harness.getAcceptedViewport());
      } finally {
        control.controller.finalize();
      }
    } finally {
      harness.controller.finalize();
    }
  });

  it('gives active target navigation precedence over terrain picking and rebasing, then resumes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const animationFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const frameId = nextFrameId++;
      animationFrames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => {
      animationFrames.delete(frameId);
    });
    const runNextAnimationFrame = () => {
      const next = animationFrames.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined;
      expect(next).toBeDefined();
      animationFrames.delete(next![0]);
      next![1](performance.now());
    };

    let target!: MapInteractionTarget;
    const provider = vi.fn(() => target);
    const pickPosition = vi.fn(() => ({coordinate: [8.5, 47.3, 300]}));
    const harness = createControllerHarness({
      ControllerClass: TerrainController,
      controllerOptions: {_targetNavigation: true, getInteractionTarget: provider},
      pickPosition
    });
    target = harness.makeTarget(POINTER, 180);
    const terrainController = harness.controller as TerrainController;

    harness.controller.handleEvent(makeGestureEvent('panstart') as any);
    harness.controller.handleEvent(
      makeGestureEvent('panmove', [POINTER[0] + 20, POINTER[1] + 10], {
        deltaX: 20,
        deltaY: 10
      }) as any
    );

    runNextAnimationFrame();
    expect(
      pickPosition,
      'periodic terrain picking is suppressed while target is active'
    ).not.toHaveBeenCalled();

    harness.controller.handleEvent(
      makeGestureEvent('panend', [POINTER[0] + 20, POINTER[1] + 10], {
        deltaX: 20,
        deltaY: 10
      }) as any
    );
    expect(harness.getInteractionState().interactionTargetPosition).toBeUndefined();
    runNextAnimationFrame();
    expect(pickPosition).toHaveBeenCalledTimes(1);
    expect(pickPosition).toHaveBeenCalledWith(
      VIEW_ORIGIN.x + VIEW_SIZE.width / 2,
      VIEW_ORIGIN.y + VIEW_SIZE.height / 2
    );

    (terrainController as any)._terrainAltitude = 50;
    (terrainController as any)._terrainAltitudeTarget = 150;
    harness.updateProps({_targetNavigation: false, getInteractionTarget: undefined});
    harness.controller.handleEvent(makeGestureEvent('panstart') as any);
    expect((terrainController as any)._terrainAltitude).toBeGreaterThan(50);

    harness.controller.handleEvent(makeGestureEvent('panend') as any);
    harness.controller.finalize();
    expect(animationFrames.size).toBe(0);
  });
});
