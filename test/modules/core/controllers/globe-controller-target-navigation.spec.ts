// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  _GlobeController as GlobeController,
  _GlobeView as GlobeView,
  _GlobeViewport as GlobeViewport,
  WebMercatorViewport
} from '@deck.gl/core';
import type {InteractionTarget, InteractionState} from '@deck.gl/core';
import {Timeline} from '@luma.gl/engine';

const SIZE = {width: 800, height: 600};
const PIXEL: [number, number] = [370, 280];
const controllers: GlobeController[] = [];

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.finalize();
  vi.useRealTimers();
});

function event(type: string, options: Record<string, any> = {}) {
  return {
    type,
    pointerType: 'touch',
    offsetCenter: {x: PIXEL[0], y: PIXEL[1]},
    deltaX: 0,
    deltaY: 0,
    scale: 1,
    rotation: 0,
    deltaTime: 0,
    velocity: 0,
    velocityX: 0,
    velocityY: 0,
    srcEvent: {preventDefault() {}},
    stopPropagation() {},
    ...options
  } as any;
}

function harness(
  options: Record<string, any> = {},
  initialState: Record<string, any> = {},
  feedback = true
) {
  const view = new GlobeView({id: 'globe', nearZMultiplier: 0.01});
  const timeline = new Timeline();
  const interaction: InteractionState = {};
  const changes: Record<string, any>[] = [];
  let props: Record<string, any> = {
    id: view.id,
    x: 0,
    y: 0,
    ...SIZE,
    _view: view,
    longitude: 10,
    latitude: 45,
    zoom: 5,
    bearing: 20,
    pitch: 35,
    _targetNavigation: true,
    touchRotate: true,
    ...options,
    ...initialState
  };
  const provider =
    options.getInteractionTarget ||
    vi.fn(context => ({
      coordinate: context.viewport.unproject(context.screenPosition || PIXEL, {targetZ: 100}),
      screenPosition: context.screenPosition || PIXEL
    }));
  props.getInteractionTarget = provider;
  const controller = new GlobeController({
    timeline,
    eventManager: null as any,
    makeViewport: viewState => view.makeViewport({...SIZE, viewState})!,
    onStateChange: state => Object.assign(interaction, state),
    onViewStateChange: ({viewState}) => {
      changes.push(viewState);
      if (feedback) {
        props = {...props, ...viewState};
        controller.setProps(props as any);
      }
    }
  });
  controllers.push(controller);
  controller.setProps(props as any);
  return {
    controller,
    timeline,
    interaction,
    changes,
    provider,
    viewport: () =>
      view.makeViewport({...SIZE, viewState: controller.controllerState.getViewportProps()}) as
        | GlobeViewport
        | WebMercatorViewport,
    accept: () => {
      props = {...props, ...changes.at(-1)};
      controller.setProps(props as any);
    },
    update: (next: Record<string, any>) => {
      props = {...props, ...next};
      controller.setProps(props as any);
    },
    target: () => controller.controllerState.getState().interactionTarget as InteractionTarget
  };
}

function expectPixel(
  viewport: GlobeViewport | WebMercatorViewport,
  target: InteractionTarget,
  pixel = target.screenPosition
) {
  const information = viewport.getTargetInfo(target.coordinate)!;
  expect(information.isValid).toBe(true);
  expect(
    Math.hypot(
      information.projectedPosition[0] - pixel[0],
      information.projectedPosition[1] - pixel[1]
    )
  ).toBeLessThan(0.1);
  return information;
}

describe('GlobeController target navigation', () => {
  it('does not replay pre-overlap translation when multipan recognizes after a pinch', () => {
    const fixture = harness({multiTouchDrag: 'pan'});
    fixture.controller.handleEvent(event('pinchstart'));
    fixture.controller.handleEvent(event('pinchmove', {scale: 1.2}));
    const before = fixture.controller.controllerState.getViewportProps();
    const sample = {deltaX: 40, deltaY: 30, offsetCenter: {x: 410, y: 310}};
    fixture.controller.handleEvent(event('multipanstart', sample));
    fixture.controller.handleEvent(event('multipanmove', sample));
    const after = fixture.controller.controllerState.getViewportProps();
    expect(after.longitude).toBeCloseTo(before.longitude, 7);
    expect(after.latitude).toBeCloseTo(before.latitude, 7);
    expect(after.zoom).toBeCloseTo(before.zoom, 7);
    expect(fixture.provider).toHaveBeenCalledTimes(1);
    expect(fixture.interaction.interactionTargetPosition).toBeUndefined();
  });
  it('uses a spherical pan and releases the shared target after the gesture', () => {
    const fixture = harness();
    const source = fixture.viewport();
    fixture.controller.handleEvent(event('panstart'));
    const target = fixture.target();
    fixture.controller.handleEvent(
      event('panmove', {offsetCenter: {x: 410, y: 310}, deltaX: 40, deltaY: 30})
    );
    expectPixel(fixture.viewport(), target, [410, 310]);
    expect(fixture.viewport().scale).toBeCloseTo(source.scale, 7);
    expect(fixture.interaction.interactionTargetPosition).toEqual(target.coordinate);
    fixture.controller.handleEvent(event('panend'));
    expect(fixture.interaction.interactionTargetPosition).toBeUndefined();
    expect(fixture.provider).toHaveBeenCalledTimes(1);
  });

  it('orbits an elevated target and solves combined pinch atomically', () => {
    const fixture = harness();
    fixture.controller.handleEvent(event('pinchstart'));
    const target = fixture.target();
    const start = expectPixel(fixture.viewport(), target);
    fixture.controller.handleEvent(event('pinchmove', {scale: 1.25, rotation: 15, deltaTime: 16}));
    const next = expectPixel(fixture.viewport(), target);
    expect(next.targetDistance).toBeCloseTo(start.targetDistance / 1.25, 4);
    expect(fixture.controller.controllerState.getViewportProps().bearing).toBeCloseTo(5);
    expect(fixture.interaction.rotationPivotPosition).toEqual(target.coordinate);
    fixture.controller.handleEvent(event('pinchend', {scale: 1.25, rotation: 15}));
    expect(fixture.interaction.interactionTargetPosition).toBeUndefined();
  });

  it('validates intermediate zoom transition frames and retains the target until completion', () => {
    const fixture = harness();
    fixture.controller.handleEvent(event('dblclick'));
    const target = fixture.target();
    const originalDistance = fixture.viewport().getTargetInfo(target.coordinate)!.targetDistance;
    const distances: number[] = [];
    for (const time of [0, 75, 150, 225, 299]) {
      fixture.timeline.setTime(time);
      fixture.controller.updateTransition();
      distances.push(expectPixel(fixture.viewport(), target).targetDistance);
      expect(fixture.interaction.interactionTargetPosition).toEqual(target.coordinate);
    }
    expect(distances[2]).toBeLessThan(originalDistance);
    expect(distances[3]).toBeLessThan(distances[2]);
    fixture.timeline.setTime(301);
    fixture.controller.updateTransition();
    expect(fixture.interaction.interactionTargetPosition).toBeUndefined();
  });

  it('solves target-pan inertia at intermediate frames and cleans up its owners', () => {
    const fixture = harness({inertia: 300});
    fixture.controller.handleEvent(event('panstart'));
    const target = fixture.target();
    fixture.controller.handleEvent(
      event('panmove', {offsetCenter: {x: 390, y: 290}, deltaX: 20, deltaY: 10})
    );
    fixture.controller.handleEvent(
      event('panend', {
        offsetCenter: {x: 390, y: 290},
        deltaX: 20,
        deltaY: 10,
        velocity: 0.2,
        velocityX: 0.1,
        velocityY: 0.05
      })
    );
    const sourceScale = fixture.viewport().scale;
    const pixels: number[] = [];
    for (const time of [0, 75, 150, 225]) {
      fixture.timeline.setTime(time);
      fixture.controller.updateTransition();
      expect(fixture.viewport().getTargetInfo(target.coordinate)?.isValid).toBe(true);
      expect(fixture.viewport().scale).toBeCloseTo(sourceScale, 6);
      pixels.push(fixture.viewport().project(target.coordinate)[0]);
    }
    expect(pixels[2]).toBeGreaterThan(pixels[1]);
    fixture.timeline.setTime(301);
    fixture.controller.updateTransition();
    expect(fixture.interaction.interactionTargetPosition).toBeUndefined();
  });

  it.each([false, true])('keeps stock high-zoom zooming safe (target navigation %s)', enabled => {
    const fixture = harness({_targetNavigation: enabled}, {zoom: 13});
    expect(fixture.viewport()).toBeInstanceOf(WebMercatorViewport);
    expect(() =>
      fixture.controller.handleEvent(
        event('wheel', {pointerType: 'mouse', device: 'mouse', delta: 20})
      )
    ).not.toThrow();
    expect(fixture.controller.controllerState.getViewportProps().zoom).toBeGreaterThan(13);
  });

  it.each([
    [11.99, 20, WebMercatorViewport],
    [12.01, -20, GlobeViewport]
  ] as const)(
    'hands off at the projection boundary from zoom %s without trapping repeated wheel input',
    (zoom, delta, ViewportClass) => {
      const fixture = harness({}, {zoom, pitch: 15});
      fixture.controller.handleEvent(
        event('wheel', {pointerType: 'mouse', device: 'mouse', delta})
      );
      expect(fixture.viewport()).toBeInstanceOf(ViewportClass);
      expect(fixture.interaction.interactionTargetPosition).toBeUndefined();
      const firstZoom = fixture.controller.controllerState.getViewportProps().zoom;
      fixture.controller.handleEvent(
        event('wheel', {pointerType: 'mouse', device: 'mouse', delta})
      );
      const nextZoom = fixture.controller.controllerState.getViewportProps().zoom;
      expect((nextZoom - firstZoom) * delta).toBeGreaterThan(0);
      expect(fixture.provider).toHaveBeenCalledTimes(2);
    }
  );

  it('rebases a cumulative pinch across the projection seam', () => {
    const fixture = harness({}, {zoom: 11.9, pitch: 15});
    fixture.controller.handleEvent(event('pinchstart'));
    fixture.controller.handleEvent(event('pinchmove', {scale: 1.2, rotation: 10}));
    expect(fixture.viewport()).toBeInstanceOf(WebMercatorViewport);
    expect(fixture.interaction.interactionTargetPosition).toBeUndefined();
    fixture.controller.handleEvent(event('pinchmove', {scale: 1.3, rotation: 12}));
    // Globe's ordinary latitude/scale constraint may make a small correction at the seam.
    expect(fixture.controller.controllerState.getViewportProps().zoom).toBeCloseTo(
      11.9 + Math.log2(1.3),
      4
    );
    expect(fixture.provider).toHaveBeenCalledTimes(1);
  });

  it('retains the target through delayed controlled feedback and provider replacement', () => {
    const fixture = harness({}, {}, false);
    fixture.controller.handleEvent(event('panstart'));
    const target = fixture.target();
    fixture.controller.handleEvent(
      event('panmove', {offsetCenter: {x: 390, y: 290}, deltaX: 20, deltaY: 10})
    );
    fixture.accept();
    const replacement = vi.fn(() => null);
    fixture.update({getInteractionTarget: replacement});
    expect(fixture.interaction.interactionTargetPosition).toEqual(target.coordinate);
    fixture.controller.handleEvent(
      event('panmove', {offsetCenter: {x: 400, y: 300}, deltaX: 30, deltaY: 20})
    );
    fixture.accept();
    expectPixel(fixture.viewport(), target, [400, 300]);
    expect(replacement).not.toHaveBeenCalled();
  });

  it('uses complete stock behavior for an authoritative null provider', () => {
    const provider = vi.fn(() => null);
    const fixture = harness({getInteractionTarget: provider});
    fixture.controller.handleEvent(event('panstart'));
    fixture.controller.handleEvent(
      event('panmove', {offsetCenter: {x: 400, y: 300}, deltaX: 30, deltaY: 20})
    );
    expect(fixture.controller.controllerState.getViewportProps().longitude).not.toBe(10);
    expect(fixture.interaction.interactionTargetPosition).toBeUndefined();
  });

  it.each([
    ['pinch', 'multipan'],
    ['multipan', 'pinch']
  ] as const)(
    'hands overlapping %s/%s recognizers to stock without reacquiring or replaying scale',
    (first, second) => {
      const fixture = harness({multiTouchDrag: 'pan'});
      fixture.controller.handleEvent(event(`${first}start`));
      expect(fixture.interaction.interactionTargetPosition).toBeDefined();
      if (first === 'pinch') fixture.controller.handleEvent(event('pinchmove', {scale: 1.2}));
      const before = fixture.controller.controllerState.getViewportProps().zoom;
      fixture.controller.handleEvent(event(`${second}start`));
      expect(fixture.interaction.interactionTargetPosition).toBeUndefined();
      const scale = first === 'pinch' ? 1.2 : 1;
      fixture.controller.handleEvent(event('pinchmove', {scale}));
      expect(fixture.controller.controllerState.getViewportProps().zoom).toBeCloseTo(before, 4);
      fixture.controller.handleEvent(event(`${first}end`, {scale}));
      fixture.controller.handleEvent(
        event(`${second}move`, {
          scale,
          deltaX: 2,
          deltaY: 1,
          offsetCenter: {x: PIXEL[0] + 2, y: PIXEL[1] + 1}
        })
      );
      expect(fixture.interaction.isDragging).toBe(true);
      fixture.controller.handleEvent(event(`${second}end`, {scale}));
      expect(fixture.interaction.isDragging).toBe(false);
      expect(fixture.provider).toHaveBeenCalledTimes(1);
    }
  );
});
