// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {test, expect} from 'vitest';
import {MapView, TerrainController} from '@deck.gl/core';
import {createTargetScene, expectTargetPixel} from '../../../utils/target-navigation';

test('Deck disposes an active Terrain target after its view has been removed', async () => {
  const scene = await createTargetScene({camera: 'terrain', acquisition: 'point'});
  try {
    const [x, y] = scene.pixel();
    scene.deck.viewManager!.controllers.target!.handleEvent({
      type: 'wheel',
      pointerType: 'mouse',
      device: 'mouse',
      delta: 20,
      offsetCenter: {x, y},
      srcEvent: {preventDefault() {}},
      stopPropagation() {}
    } as any);
    expect(scene.states.at(-1)?.interactionTargetPosition).toBeDefined();
    expect(() =>
      scene.deck.setProps({
        views: new MapView({id: 'replacement', controller: {type: TerrainController}})
      })
    ).not.toThrow();
    expect(
      scene.states.some(
        state => state.viewId === 'target' && state.interactionTargetPosition === undefined
      )
    ).toBe(true);
    expect(scene.errors).toEqual([]);
  } finally {
    scene.dispose();
  }
});

test.each([1, 2])(
  'Deck acquires rendered 3D targets in an offset view (pixel ratio %s)',
  async useDevicePixels => {
    const scene = await createTargetScene({useDevicePixels, offset: 40});
    try {
      const pixel = scene.pixel().map(Math.round);
      const before = scene.viewport();
      const picked = scene.deck.pickObject({x: pixel[0], y: pixel[1], unproject3D: true});
      expect(picked?.layer?.id).toBe('elevated');
      // Depth acquisition is quantized by rasterization. This is a two-CSS-pixel world budget,
      // separate from the strict 0.1 px / centimetre solver invariants below.
      expect(Math.abs(picked!.coordinate![2] - 250)).toBeLessThanOrEqual(2 * before.metersPerPixel);
      // Exercise the real Deck-created controller/picker, without injecting the picked coordinate.
      const controller = scene.deck.viewManager!.controllers.target!;
      const event = (type: string, dx = 0, dy = 0) => ({
        type,
        pointerType: 'mouse',
        rightButton: true,
        deltaX: dx,
        deltaY: dy,
        offsetCenter: {x: pixel[0] + dx, y: pixel[1] + dy},
        srcEvent: {},
        stopPropagation() {}
      });
      controller.handleEvent(event('panstart') as any);
      const state = scene.states.at(-1)!;
      expect(state.viewId).toBe('target');
      expect(state.interactionTargetPosition).toEqual(picked!.coordinate);
      const target = state.interactionTargetPosition!;
      const localPixel = before.project(target);
      const radius = before.getTargetInfo(target)!.targetDistance;
      for (const delta of [10, 20, 30]) {
        controller.handleEvent(event('panmove', delta, delta / 2) as any);
        const viewport = scene.viewport();
        expectTargetPixel(viewport, target, localPixel);
        expect(
          Math.abs(viewport.getTargetInfo(target)!.targetDistance - radius)
        ).toBeLessThanOrEqual(Math.max(0.01, radius * 1e-7));
      }
      controller.handleEvent(event('panend', 30, 15) as any);
      expect(scene.states.at(-1)?.interactionTargetPosition).toBeUndefined();
      expect(scene.errors).toEqual([]);
    } finally {
      scene.dispose();
    }
  }
);

test.each([
  {acquisition: 'point', pickAsync: 'sync', expected: true},
  {acquisition: 'null', pickAsync: 'sync', expected: false},
  {acquisition: 'pick', pickAsync: 'sync', empty: true, expected: false},
  {acquisition: 'pick', pickAsync: 'async', expected: false},
  {acquisition: 'point', pickAsync: 'async', expected: true}
] as const)('Deck target provider/fallback contract %j', async options => {
  const scene = await createTargetScene(options);
  try {
    const [x, y] = scene.pixel();
    const controller = scene.deck.viewManager!.controllers.target!;
    controller.handleEvent({
      type: 'panstart',
      pointerType: 'mouse',
      offsetCenter: {x, y},
      srcEvent: {},
      stopPropagation() {}
    } as any);
    expect(Boolean(scene.states.at(-1)?.interactionTargetPosition)).toBe(options.expected);
    if (options.expected)
      expect(scene.states.at(-1)?.interactionTargetPosition).toEqual(scene.coordinate);
    controller.handleEvent({type: 'panend', offsetCenter: {x, y}, srcEvent: {}} as any);
    expect(scene.states.at(-1)?.interactionTargetPosition).toBeUndefined();
    expect(scene.errors).toEqual([]);
  } finally {
    scene.dispose();
  }
});
