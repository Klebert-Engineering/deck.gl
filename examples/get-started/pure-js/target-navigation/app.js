// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, MapController, TerrainController} from '@deck.gl/core';
import {SolidPolygonLayer, ScatterplotLayer, LineLayer} from '@deck.gl/layers';

const INITIAL_VIEW_STATE = {longitude: -122, latitude: 38, zoom: 14, pitch: 48, bearing: -20};
const coordinate = [-122.002, 38.001, 350];
const camera = document.querySelector('#camera');
const enabled = document.querySelector('#enabled');
const acquisition = document.querySelector('#acquisition');
const marker = document.querySelector('#target-marker');
const status = document.querySelector('#status');
let revision = 0;
let target = null;
let targetViewId;

function createView() {
  const mode = acquisition.value;
  return new MapView({
    id: `target-${revision}`,
    controller: {
      type: camera.value === 'terrain' ? TerrainController : MapController,
      _targetNavigation: enabled.checked,
      touchRotate: true,
      // Omit the provider in picking mode: returning null is authoritative stock fallback.
      ...(mode === 'pick'
        ? {}
        : {
            getInteractionTarget: ({viewport}) => {
              const info = viewport.getTargetInfo(coordinate);
              return mode === 'provider' && info?.isVisible
                ? {
                    coordinate: [...coordinate],
                    screenPosition: info.projectedPosition.slice(0, 2)
                  }
                : null;
            }
          })
    }
  });
}

const deck = new Deck({
  views: createView(),
  initialViewState: INITIAL_VIEW_STATE,
  layers: [
    new SolidPolygonLayer({
      id: 'synthetic-slope',
      data: [
        [
          [-122.03, 37.97, 20],
          [-121.97, 37.97, 20],
          [-121.97, 38.03, 180],
          [-122.03, 38.03, 180]
        ]
      ],
      getPolygon: d => d,
      getFillColor: [45, 95, 100],
      pickable: '3d'
    }),
    new ScatterplotLayer({
      id: 'elevated-target',
      data: [coordinate],
      getPosition: d => d,
      getRadius: 160,
      getFillColor: [255, 195, 30],
      pickable: '3d'
    }),
    new LineLayer({
      id: 'height-guide',
      data: [coordinate],
      getSourcePosition: d => [d[0], d[1], 100],
      getTargetPosition: d => d,
      getColor: [255, 195, 30],
      getWidth: 2
    })
  ],
  onInteractionStateChange: state => {
    target = state.interactionTargetPosition;
    targetViewId = state.viewId;
    status.textContent = target
      ? `Target owned by ${targetViewId} · elevation ${target[2].toFixed(1)} m`
      : 'No active target · stock / terrain navigation';
  },
  onAfterRender: () => {
    const viewport = deck.getViewports().find(v => v.id === targetViewId);
    marker.style.display = target && viewport ? 'block' : 'none';
    if (target && viewport) {
      const pixel = viewport.project(target);
      marker.style.left = `${viewport.x + pixel[0]}px`;
      marker.style.top = `${viewport.y + pixel[1]}px`;
    }
  }
});

function reset() {
  target = null;
  marker.style.display = 'none';
  status.textContent = 'No active target';
  revision++;
  // A new public view identity disposes the previous controller and its gesture/terrain timers.
  deck.setProps({views: createView(), initialViewState: {...INITIAL_VIEW_STATE}});
}
for (const control of [camera, enabled, acquisition]) control.addEventListener('change', reset);
document.querySelector('#reset').addEventListener('click', reset);
