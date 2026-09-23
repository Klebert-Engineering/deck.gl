// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect} from 'vitest';
import {Deck, MapView, TerrainController, _GlobeView as GlobeView} from '@deck.gl/core';
import type {InteractionState, InteractionTargetContext, WebMercatorViewport} from '@deck.gl/core';
import {ScatterplotLayer, SolidPolygonLayer} from '@deck.gl/layers';

/** Small offline scene shared by rendered-picking and canvas-input tests, not a controller mock. */
export async function createTargetScene({
  camera = 'map',
  acquisition = 'pick',
  enabled = true,
  empty = false,
  useDevicePixels = 1,
  offset = 0,
  multiCanvas = false,
  pickAsync = 'sync'
}: {
  camera?: 'map' | 'globe' | 'terrain';
  acquisition?: 'pick' | 'point' | 'null';
  enabled?: boolean;
  empty?: boolean;
  useDevicePixels?: number;
  offset?: number;
  multiCanvas?: boolean;
  pickAsync?: 'sync' | 'async';
} = {}) {
  const globe = camera === 'globe';
  const coordinate: [number, number, number] = globe ? [30, 20, 100000] : [-122.001, 38, 250];
  const width = 720;
  const height = 540;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px`;
  document.body.appendChild(canvas);
  canvas.id = 'target-canvas';
  const secondCanvas = multiCanvas ? document.createElement('canvas') : null;
  const secondCoordinate: [number, number, number] = [-74, 40.7, 500];
  if (secondCanvas) {
    secondCanvas.id = 'second-target-canvas';
    secondCanvas.style.cssText = `position:absolute;left:${width}px;top:20px;width:${width}px;height:${height}px`;
    document.body.appendChild(secondCanvas);
  }
  const states: InteractionState[] = [];
  const frames: {viewport: WebMercatorViewport; interaction: InteractionState}[] = [];
  const errors: Error[] = [];
  let renders = 0;
  const controller = {
    _targetNavigation: enabled,
    inertia: false,
    ...(camera === 'terrain' ? {type: TerrainController} : {}),
    ...(acquisition === 'pick'
      ? {}
      : {
          getInteractionTarget: ({viewport}: InteractionTargetContext) =>
            acquisition === 'null'
              ? null
              : {
                  coordinate: [...coordinate] as [number, number, number],
                  screenPosition: viewport.project(coordinate).slice(0, 2) as [number, number]
                }
        })
  };
  const ViewClass = globe ? GlobeView : MapView;
  const view = new ViewClass({
    id: 'target',
    x: offset,
    y: offset,
    width: width - offset,
    height: height - offset,
    controller
  });
  const layers = empty
    ? []
    : [
        new SolidPolygonLayer({
          id: 'ground',
          data: globe
            ? [
                [
                  [-180, 90],
                  [0, 90],
                  [180, 90],
                  [180, -90],
                  [0, -90],
                  [-180, -90]
                ]
              ]
            : [
                [
                  [-122.05, 37.95, 60],
                  [-121.95, 37.95, 60],
                  [-121.95, 38.05, 60],
                  [-122.05, 38.05, 60]
                ]
              ],
          getPolygon: d => d,
          getFillColor: [20, 45, 80],
          pickable: '3d'
        }),
        new ScatterplotLayer({
          id: 'elevated',
          data: [coordinate],
          getPosition: d => d,
          getRadius: globe ? 40000 : 180,
          getFillColor: [255, 180, 0],
          pickable: '3d'
        })
      ];
  if (secondCanvas) {
    layers.push(
      new ScatterplotLayer({
        id: 'second-elevated',
        data: [secondCoordinate],
        getPosition: d => d,
        getRadius: 180,
        getFillColor: [0, 180, 255],
        // Controller acquisition explicitly requests depth even for ordinary pickable layers.
        pickable: true
      })
    );
  }
  const initialViewState = globe
    ? {longitude: 30, latitude: 20, zoom: 4, pitch: 35}
    : {longitude: -122, latitude: 38, zoom: 14, pitch: 45, bearing: 10};
  const deck = new Deck({
    ...(secondCanvas ? {_canvases: [canvas, secondCanvas]} : {canvas}),
    width,
    height,
    useDevicePixels,
    pickAsync,
    views: secondCanvas
      ? [view, new MapView({...view.props, id: 'second', canvasId: secondCanvas.id})]
      : view,
    initialViewState: secondCanvas
      ? {
          target: initialViewState,
          second: {...initialViewState, longitude: -74, latitude: 40.7}
        }
      : initialViewState,
    layers,
    onInteractionStateChange: state => states.push({...state}),
    onViewStateChange: ({viewState, interactionState}) => {
      frames.push({
        viewport: view.makeViewport({width, height, viewState}) as WebMercatorViewport,
        interaction: {...interactionState}
      });
    },
    onAfterRender: () => renders++,
    onError: error => {
      errors.push(error);
    }
  });
  const dispose = () => {
    deck.finalize();
    // These fixtures own their devices. Deck.finalize intentionally does not destroy devices
    // (applications may share them); release ours so the full suite cannot exhaust GPU contexts.
    deck.device?.destroy();
    deck.device?.loseDevice();
    canvas.remove();
    secondCanvas?.remove();
  };
  try {
    await expect.poll(() => renders, {timeout: 5000}).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    deck,
    canvas,
    secondCanvas,
    secondCoordinate,
    coordinate,
    states,
    frames,
    errors,
    dispose,
    viewport: (id = 'target') =>
      deck.getViewports().find(viewport => viewport.id === id) as WebMercatorViewport,
    pixel: (id = 'target') => {
      const viewport = deck.getViewports().find(v => v.id === id)!;
      const p = viewport.project(id === 'target' ? coordinate : secondCoordinate);
      return [p[0] + viewport.x, p[1] + viewport.y] as [number, number];
    },
    setEnabled: (value: boolean) =>
      deck.setProps({
        views: new ViewClass({...view.props, controller: {...controller, _targetNavigation: value}})
      })
  };
}

export function expectTargetPixel(
  viewport: WebMercatorViewport,
  coordinate: number[],
  pixel: number[]
) {
  const projected = viewport.project(coordinate);
  expect(Math.hypot(projected[0] - pixel[0], projected[1] - pixel[1])).toBeLessThanOrEqual(0.1);
}
