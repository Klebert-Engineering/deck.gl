// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, _GlobeView as GlobeView} from '@deck.gl/core';
import {
  SolidPolygonLayer,
  GeoJsonLayer,
  ArcLayer,
  ScatterplotLayer,
  LineLayer
} from '@deck.gl/layers';

// source: Natural Earth http://www.naturalearthdata.com/ via geojson.xyz
const COUNTRIES =
  'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_admin_0_scale_rank.geojson'; //eslint-disable-line
const AIR_PORTS =
  'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_10m_airports.geojson';

const INITIAL_VIEW_STATE = {
  latitude: 20,
  longitude: 30,
  zoom: 0
};

// Opt into the elevated-target demonstration with ?target-navigation.
const targetNavigation = new URLSearchParams(window.location.search).has('target-navigation');
const interactionCoordinate = [30, 20, 100000];
const targetInitialState = {...INITIAL_VIEW_STATE, zoom: 4, pitch: 35};
const controls = document.querySelector('#target-controls');
const enabled = document.querySelector('#enabled');
const acquisition = document.querySelector('#acquisition');
const marker = document.querySelector('#target-marker');
const status = document.querySelector('#status');
controls.hidden = !targetNavigation;
let target;
let targetViewId;
let revision = 0;

function createView() {
  return new GlobeView({
    id: `globe-${revision}`,
    controller: targetNavigation
      ? {
          _targetNavigation: enabled.checked,
          touchRotate: true,
          inertia: 300,
          ...(acquisition.value === 'pick'
            ? {}
            : {
                getInteractionTarget: ({viewport}) => {
                  const information = viewport.getTargetInfo(interactionCoordinate);
                  return acquisition.value === 'provider' && information?.isVisible
                    ? {
                        coordinate: [...interactionCoordinate],
                        screenPosition: information.projectedPosition.slice(0, 2)
                      }
                    : null;
                }
              })
        }
      : true
  });
}

const deck = new Deck({
  views: createView(),
  initialViewState: targetNavigation ? targetInitialState : INITIAL_VIEW_STATE,
  onInteractionStateChange: state => {
    target = state.interactionTargetPosition;
    targetViewId = state.viewId;
    status.textContent = target
      ? `Target owned by ${targetViewId} · elevation ${target[2].toFixed(0)} m`
      : 'No active target';
  },
  onAfterRender: () => {
    const viewport = deck.getViewports().find(v => v.id === targetViewId);
    marker.style.display = target && viewport ? 'block' : 'none';
    if (target && viewport) {
      const pixel = viewport.project(target);
      marker.style.left = `${viewport.x + pixel[0]}px`;
      marker.style.top = `${viewport.y + pixel[1]}px`;
    }
  },
  layers: [
    targetNavigation &&
      new ScatterplotLayer({
        id: 'elevated-target',
        data: [interactionCoordinate],
        getPosition: position => position,
        getRadius: 20000,
        radiusMinPixels: 6,
        getFillColor: [255, 200, 0],
        pickable: '3d'
      }),
    targetNavigation &&
      new LineLayer({
        id: 'target-height',
        data: [interactionCoordinate],
        getSourcePosition: position => [position[0], position[1], 0],
        getTargetPosition: position => position,
        getColor: [255, 200, 0],
        getWidth: 2
      }),
    // A GeoJSON polygon that covers the entire earth
    // See /docs/api-reference/globe-view.md#remarks
    new SolidPolygonLayer({
      id: 'background',
      data: [
        // biome-ignore format: preserve layout
        [[-180, 90], [0, 90], [180, 90], [180, -90], [0, -90], [-180, -90]]
      ],
      opacity: 0.5,
      getPolygon: d => d,
      stroked: false,
      filled: true,
      getFillColor: [5, 10, 40],
      pickable: targetNavigation ? '3d' : false
    }),
    !targetNavigation &&
      new GeoJsonLayer({
        id: 'base-map',
        data: COUNTRIES,
        // Styles
        stroked: true,
        filled: true,
        lineWidthMinPixels: 2,
        getLineColor: [5, 10, 40],
        getFillColor: [15, 40, 80]
      }),
    !targetNavigation &&
      new GeoJsonLayer({
        id: 'airports',
        data: AIR_PORTS,
        // Styles
        filled: true,
        pointRadiusMinPixels: 2,
        pointRadiusScale: 2000,
        getPointRadius: f => 11 - f.properties.scalerank,
        getFillColor: [200, 0, 80, 180],
        // Interactive props
        pickable: true,
        autoHighlight: true,
        onClick: info =>
          // eslint-disable-next-line
          info.object && alert(`${info.object.properties.name} (${info.object.properties.abbrev})`)
      }),
    !targetNavigation &&
      new ArcLayer({
        id: 'arcs',
        data: AIR_PORTS,
        dataTransform: d => d.features.filter(f => f.properties.scalerank < 4),
        // Styles
        getSourcePosition: f => [-0.4531566, 51.4709959], // London
        getTargetPosition: f => f.geometry.coordinates,
        getSourceColor: [0, 128, 200],
        getTargetColor: [200, 0, 80],
        getWidth: 1,
        parameters: {cullMode: 'none'}
      })
  ]
});

function reset() {
  target = null;
  marker.style.display = 'none';
  status.textContent = 'No active target';
  revision++;
  deck.setProps({views: createView(), initialViewState: {...targetInitialState}});
}
enabled.addEventListener('change', reset);
acquisition.addEventListener('change', reset);
document.querySelector('#reset').addEventListener('click', reset);
