// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {test, expect} from 'vitest';
import {equals, config, Vector3} from '@math.gl/core';
import {WebMercatorViewport} from 'deck.gl';
import {Matrix4} from '@math.gl/core';

// Adjust sensitivity of math.gl's equals
const LNGLAT_TOLERANCE = 1e-6;
const ALT_TOLERANCE = 1e-5;
const OFFSET_TOLERANCE = 1e-5;
const TARGET_REPROJECTION_TOLERANCE = 0.1;

const DEGREES_TO_RADIANS = Math.PI / 180;

/* eslint-disable */
const TEST_VIEWPORTS = [
  {
    width: 800,
    height: 600,
    latitude: 38,
    longitude: -122,
    zoom: 11
  },
  {
    width: 800,
    height: 600,
    latitude: 23,
    longitude: 20,
    zoom: 15,
    pich: 30,
    bearing: -85
  },
  {
    width: 800,
    height: 600,
    latitude: 65,
    longitude: 42,
    zoom: 16,
    pitch: 15,
    bearing: 30
  }
];

test('WebMercatorViewport#imports', () => {
  expect(WebMercatorViewport, 'WebMercatorViewport import ok').toBeTruthy();
});

test('WebMercatorViewport#constructor', () => {
  expect(
    new WebMercatorViewport() instanceof WebMercatorViewport,
    'Created new WebMercatorViewport with default args'
  ).toBeTruthy();

  expect(
    new WebMercatorViewport(
      Object.assign({}, TEST_VIEWPORTS[0], {
        width: 0,
        height: 0
      })
    ) instanceof WebMercatorViewport,
    'WebMercatorViewport constructed successfully with 0 width and height'
  ).toBeTruthy();
});

test('WebMercatorViewport#padding', () => {
  const viewport = new WebMercatorViewport({...TEST_VIEWPORTS[0], padding: {left: 100, top: 20}});
  const center = viewport.project([viewport.longitude, viewport.latitude]);
  expect(
    equals(center, [viewport.width / 2 + 50, viewport.height / 2 + 10]),
    'viewport center is offset'
  ).toBeTruthy();
});

test('WebMercatorViewport#getTargetInfo returns view-local camera metrics', () => {
  const viewport = new WebMercatorViewport({
    x: 100,
    y: 200,
    width: 800,
    height: 600,
    longitude: -122,
    latitude: 38,
    zoom: 12,
    pitch: 50,
    bearing: -25
  });
  const target = viewport.unproject([310, 260], {targetZ: 200}) as [number, number, number];
  const targetInfo = viewport.getTargetInfo(target);

  expect(targetInfo).not.toBeNull();
  expect(targetInfo?.target).not.toBe(target);
  expect(
    Math.hypot(targetInfo!.projectedPosition[0] - 310, targetInfo!.projectedPosition[1] - 260)
  ).toBeLessThan(TARGET_REPROJECTION_TOLERANCE);
  expect(targetInfo!.projectedPosition[2]).toBeGreaterThan(0);
  expect(targetInfo!.projectedPosition[2]).toBeLessThan(1);
  expect(targetInfo!.targetDistance).toBeGreaterThan(0);
  expect(targetInfo!.cameraDepth).toBeGreaterThan(0);
  expect(targetInfo!.near).toBeGreaterThan(0);
  expect(targetInfo!.far).toBeGreaterThan(targetInfo!.near);
  expect(targetInfo!.isValid).toBe(true);
  expect(targetInfo!.isVisible).toBe(true);
});

test('WebMercatorViewport#getTargetInfo distinguishes offscreen and behind-camera targets', () => {
  const viewport = new WebMercatorViewport({
    width: 800,
    height: 600,
    longitude: 0,
    latitude: 0,
    zoom: 10,
    pitch: 45,
    bearing: 0
  });
  const offscreenTarget = viewport.unproject([-20, 300], {targetZ: 0}) as [number, number, number];
  const offscreenInfo = viewport.getTargetInfo(offscreenTarget)!;
  expect(offscreenInfo.cameraDepth).toBeGreaterThan(0);
  expect(offscreenInfo.projectedPosition[2]).toBeGreaterThan(0);
  expect(offscreenInfo.projectedPosition[2]).toBeLessThan(1);
  expect(offscreenInfo.isValid).toBe(true);
  expect(offscreenInfo.isVisible).toBe(false);

  const forward = new Vector3([400, 300, 0.5])
    .transform(viewport.pixelUnprojectionMatrix)
    .subtract(viewport.cameraPosition);
  const behindCommon = new Vector3(viewport.cameraPosition).subtract(forward);
  const behindTarget = viewport.unprojectPosition(behindCommon) as [number, number, number];
  const behindInfo = viewport.getTargetInfo(behindTarget)!;
  expect(behindInfo.cameraDepth).toBeLessThan(0);
  expect(behindInfo.isValid).toBe(false);
  expect(behindInfo.isVisible).toBe(false);
});

test('WebMercatorViewport#getTargetViewState moves a target pixel while orbiting and zooming', () => {
  const modelMatrix = new Matrix4().rotateZ(0.2).scale([1.2, 0.8, 1.1]);
  const viewportOptions = {
    width: 900,
    height: 700,
    longitude: 8.5,
    latitude: 47.3,
    zoom: 13,
    pitch: 48,
    bearing: -30,
    position: [120, -80, 45],
    modelMatrix,
    padding: {left: 70, right: 10, top: 30, bottom: 90},
    fovy: 42,
    nearZMultiplier: 0.02,
    farZMultiplier: 1.05
  };
  const sourceViewport = new WebMercatorViewport(viewportOptions);
  const screenPosition: [number, number] = [380, 310];
  const target = sourceViewport.unproject(screenPosition, {targetZ: 350}) as [
    number,
    number,
    number
  ];
  const sourceInfo = sourceViewport.getTargetInfo(target)!;
  const orbitScreenPosition: [number, number] = [645, 190];

  const orbitState = sourceViewport.getTargetViewState({
    target,
    screenPosition: orbitScreenPosition,
    bearing: 75,
    pitch: 63
  });
  expect(orbitState).not.toBeNull();
  const orbitViewport = new WebMercatorViewport({...viewportOptions, ...orbitState});
  const orbitInfo = orbitViewport.getTargetInfo(target)!;
  expect(orbitInfo.isVisible).toBe(true);
  expect(
    Math.hypot(
      orbitInfo.projectedPosition[0] - orbitScreenPosition[0],
      orbitInfo.projectedPosition[1] - orbitScreenPosition[1]
    )
  ).toBeLessThan(TARGET_REPROJECTION_TOLERANCE);
  expect(Math.abs(orbitInfo.targetDistance - sourceInfo.targetDistance)).toBeLessThan(0.01);

  const requestedZoom = sourceViewport.zoom + 1.75;
  const zoomScreenPosition: [number, number] = [205, 555];
  const zoomState = sourceViewport.getTargetViewState({
    target,
    screenPosition: zoomScreenPosition,
    bearing: 20,
    pitch: 35,
    zoom: requestedZoom
  });
  expect(zoomState).not.toBeNull();
  const zoomViewport = new WebMercatorViewport({...viewportOptions, ...zoomState});
  const zoomInfo = zoomViewport.getTargetInfo(target)!;
  const expectedDistance =
    sourceInfo.targetDistance * Math.pow(2, sourceViewport.zoom - requestedZoom);
  expect(zoomInfo.isVisible).toBe(true);
  expect(
    Math.hypot(
      zoomInfo.projectedPosition[0] - zoomScreenPosition[0],
      zoomInfo.projectedPosition[1] - zoomScreenPosition[1]
    )
  ).toBeLessThan(TARGET_REPROJECTION_TOLERANCE);
  expect(Math.abs(zoomInfo.targetDistance - expectedDistance)).toBeLessThan(
    Math.max(0.01, expectedDistance * 1e-7)
  );
});

test('WebMercatorViewport#getTargetPanViewState translates in common XY without orbiting', () => {
  const modelMatrix = new Matrix4().rotateZ(0.2).scale([1.2, 0.8, 1.1]);
  const viewportOptions = {
    width: 900,
    height: 700,
    longitude: 8.5,
    latitude: 47.3,
    zoom: 13,
    pitch: 48,
    bearing: -30,
    position: [120, -80, 45],
    modelMatrix,
    padding: {left: 70, right: 10, top: 30, bottom: 90},
    fovy: 42,
    nearZMultiplier: 0.02,
    farZMultiplier: 1.05
  };
  const sourceViewport = new WebMercatorViewport(viewportOptions);
  const target = sourceViewport.unproject([380, 310], {targetZ: 350}) as [number, number, number];
  const sourceInfo = sourceViewport.getTargetInfo(target)!;
  const screenPosition: [number, number] = [645, 190];

  const state = sourceViewport.getTargetPanViewState({target, screenPosition});
  expect(state).not.toBeNull();
  expect(state?.zoom).toBe(sourceViewport.zoom);
  expect(state?.bearing).toBe(sourceViewport.bearing);
  expect(state?.pitch).toBe(sourceViewport.pitch);

  const candidate = new WebMercatorViewport({...viewportOptions, ...state});
  const candidateInfo = candidate.getTargetInfo(target)!;
  expect(candidateInfo.isValid).toBe(true);
  expect(
    Math.hypot(
      candidateInfo.projectedPosition[0] - screenPosition[0],
      candidateInfo.projectedPosition[1] - screenPosition[1]
    )
  ).toBeLessThan(TARGET_REPROJECTION_TOLERANCE);
  expect(candidate.center[2]).toBeCloseTo(sourceViewport.center[2], 10);
  expect(Math.abs(candidateInfo.targetDistance - sourceInfo.targetDistance)).toBeGreaterThan(1);
});

test('WebMercatorViewport#getTargetPanViewState handles large center offsets and world copies', () => {
  for (const viewportOptions of [
    {
      width: 1600,
      height: 1000,
      longitude: 13.64432155,
      latitude: 47.72654096,
      zoom: 14.85,
      pitch: 0,
      bearing: 0,
      position: [0, 0, 2384835.59976474]
    },
    {
      width: 800,
      height: 400,
      longitude: 0,
      latitude: 0,
      zoom: 0,
      pitch: 30,
      bearing: 20,
      worldOffset: 1
    }
  ]) {
    const sourceViewport = new WebMercatorViewport(viewportOptions);
    const startPosition: [number, number] = [sourceViewport.width / 2, sourceViewport.height / 2];
    const target = sourceViewport.unproject(startPosition, {targetZ: 0}) as [
      number,
      number,
      number
    ];
    const screenPosition: [number, number] = [startPosition[0] + 20, startPosition[1] + 10];
    const state = sourceViewport.getTargetPanViewState({target, screenPosition});

    expect(state).not.toBeNull();
    const candidate = new WebMercatorViewport({...viewportOptions, ...state});
    const targetInfo = candidate.getTargetInfo(target)!;
    expect(
      Math.hypot(
        targetInfo.projectedPosition[0] - screenPosition[0],
        targetInfo.projectedPosition[1] - screenPosition[1]
      )
    ).toBeLessThan(TARGET_REPROJECTION_TOLERANCE);
    expect(candidate.center[2]).toBeCloseTo(sourceViewport.center[2], 8);
  }
});

test('WebMercatorViewport#getTargetViewState supports geometrically valid offscreen targets', () => {
  const viewportOptions = {
    width: 800,
    height: 600,
    longitude: -73.98,
    latitude: 40.75,
    zoom: 14,
    pitch: 55,
    bearing: 25,
    padding: {left: 120, right: 20, top: 35, bottom: 80},
    fovy: 48
  };
  const sourceViewport = new WebMercatorViewport(viewportOptions);
  const target = sourceViewport.unproject([430, 320], {targetZ: 180}) as [number, number, number];
  const sourceInfo = sourceViewport.getTargetInfo(target)!;
  const offscreenPosition: [number, number] = [-65, 690];
  const requestedZoom = sourceViewport.zoom + 0.5;

  const state = sourceViewport.getTargetViewState({
    target,
    screenPosition: offscreenPosition,
    bearing: -40,
    pitch: 60,
    zoom: requestedZoom
  });
  expect(state).not.toBeNull();
  const candidate = new WebMercatorViewport({...viewportOptions, ...state});
  const candidateInfo = candidate.getTargetInfo(target)!;
  const expectedDistance =
    sourceInfo.targetDistance * Math.pow(2, sourceViewport.zoom - requestedZoom);
  expect(candidateInfo.isValid).toBe(true);
  expect(candidateInfo.isVisible).toBe(false);
  expect(
    Math.hypot(
      candidateInfo.projectedPosition[0] - offscreenPosition[0],
      candidateInfo.projectedPosition[1] - offscreenPosition[1]
    )
  ).toBeLessThan(TARGET_REPROJECTION_TOLERANCE);
  expect(Math.abs(candidateInfo.targetDistance - expectedDistance)).toBeLessThan(
    Math.max(0.01, expectedDistance * 1e-7)
  );

  const returnedPosition: [number, number] = [250, 175];
  const returnedState = candidate.getTargetViewState({
    target,
    screenPosition: returnedPosition,
    bearing: 15,
    pitch: 45
  });
  expect(returnedState).not.toBeNull();
  const returnedViewport = new WebMercatorViewport({...viewportOptions, ...returnedState});
  const returnedInfo = returnedViewport.getTargetInfo(target)!;
  expect(returnedInfo.isVisible).toBe(true);
  expect(
    Math.hypot(
      returnedInfo.projectedPosition[0] - returnedPosition[0],
      returnedInfo.projectedPosition[1] - returnedPosition[1]
    )
  ).toBeLessThan(TARGET_REPROJECTION_TOLERANCE);
});

test('WebMercatorViewport#getTargetViewState preserves antimeridian and repeated-world copies', () => {
  const viewportOptions = {
    width: 800,
    height: 500,
    longitude: 179.8,
    latitude: 0,
    zoom: 5,
    pitch: 40,
    bearing: 10
  };
  const viewport = new WebMercatorViewport(viewportOptions);
  const target: [number, number, number] = [-179.9, 0.05, 100];
  const targetInfo = viewport.getTargetInfo(target)!;
  expect(target).toEqual([-179.9, 0.05, 100]);
  expect(targetInfo.target[0]).toBeCloseTo(180.1, 12);
  const antimeridianScreenPosition: [number, number] = [610, 125];

  const state = viewport.getTargetViewState({
    target,
    screenPosition: antimeridianScreenPosition,
    bearing: -65,
    pitch: 55
  });
  expect(state).not.toBeNull();
  expect(Math.abs(state!.longitude - viewport.longitude)).toBeLessThan(180);
  const candidate = new WebMercatorViewport({...viewportOptions, ...state});
  const candidateInfo = candidate.getTargetInfo(target)!;
  expect(candidateInfo.target[0]).toBeCloseTo(180.1, 12);
  expect(
    Math.hypot(
      candidateInfo.projectedPosition[0] - antimeridianScreenPosition[0],
      candidateInfo.projectedPosition[1] - antimeridianScreenPosition[1]
    )
  ).toBeLessThan(TARGET_REPROJECTION_TOLERANCE);

  const repeatedViewportOptions = {
    width: 800,
    height: 400,
    longitude: 0,
    latitude: 0,
    zoom: 0,
    pitch: 0,
    bearing: 0,
    worldOffset: 1
  };
  const repeatedViewport = new WebMercatorViewport(repeatedViewportOptions);
  const repeatedTarget: [number, number, number] = [0, 0, 0];
  const repeatedInfo = repeatedViewport.getTargetInfo(repeatedTarget)!;
  expect(repeatedInfo.target[0]).toBe(-360);
  expect(repeatedInfo.projectedPosition.slice(0, 2)).toEqual([400, 200]);
  const repeatedScreenPosition: [number, number] = [570, 130];
  const repeatedState = repeatedViewport.getTargetViewState({
    target: repeatedTarget,
    screenPosition: repeatedScreenPosition,
    bearing: 45,
    pitch: 30
  });
  expect(repeatedState).not.toBeNull();
  const repeatedCandidate = new WebMercatorViewport({
    ...repeatedViewportOptions,
    ...repeatedState
  });
  const repeatedCandidateInfo = repeatedCandidate.getTargetInfo(repeatedTarget)!;
  expect(repeatedCandidateInfo.target[0]).toBe(-360);
  expect(
    Math.hypot(
      repeatedCandidateInfo.projectedPosition[0] - repeatedScreenPosition[0],
      repeatedCandidateInfo.projectedPosition[1] - repeatedScreenPosition[1]
    )
  ).toBeLessThan(TARGET_REPROJECTION_TOLERANCE);

  for (const worldOffset of [-3, 2]) {
    const multipleWrapViewport = new WebMercatorViewport({
      ...repeatedViewportOptions,
      worldOffset
    });
    const wrapInfo = multipleWrapViewport.getTargetInfo(repeatedTarget)!;
    expect(wrapInfo.target[0]).toBe(-360 * worldOffset);
    expect(wrapInfo.projectedPosition[0]).toBeCloseTo(400, 10);
    expect(wrapInfo.projectedPosition[1]).toBeCloseTo(200, 10);
  }

  const tieViewport = new WebMercatorViewport({...repeatedViewportOptions, worldOffset: 0});
  expect(tieViewport.getTargetInfo([180, 0, 0])?.target[0]).toBe(180);
  expect(tieViewport.getTargetInfo([-180, 0, 0])?.target[0]).toBe(180);
});

test('WebMercatorViewport#getTargetViewState rejects unsupported and invalid inputs', () => {
  const viewportOptions = {
    width: 800,
    height: 600,
    longitude: 0,
    latitude: 0,
    zoom: 10,
    pitch: 45,
    bearing: 0
  };
  const viewport = new WebMercatorViewport(viewportOptions);
  const target = viewport.unproject([400, 300], {targetZ: 100}) as [number, number, number];

  expect(
    new WebMercatorViewport({...viewportOptions, orthographic: true}).getTargetViewState({
      target,
      screenPosition: [400, 300]
    })
  ).toBeNull();
  expect(
    new WebMercatorViewport({...viewportOptions, orthographic: true}).getTargetPanViewState({
      target,
      screenPosition: [400, 300]
    })
  ).toBeNull();
  expect(
    new WebMercatorViewport({
      ...viewportOptions,
      projectionMatrix: new Matrix4().perspective({fovy: 0.7, aspect: 4 / 3, near: 0.1, far: 10})
    }).getTargetViewState({target, screenPosition: [400, 300]})
  ).toBeNull();
  expect(
    new WebMercatorViewport({...viewportOptions, width: 0}).getTargetViewState({
      target,
      screenPosition: [400, 300]
    })
  ).toBeNull();
  expect(viewport.getTargetViewState({target, screenPosition: [Number.NaN, 300]})).toBeNull();
  expect(viewport.getTargetPanViewState({target, screenPosition: [Number.NaN, 300]})).toBeNull();
  expect(
    viewport.getTargetViewState({target: [0, Number.NaN, 0], screenPosition: [400, 300]})
  ).toBeNull();
  expect(
    viewport.getTargetViewState({target, screenPosition: [400, 300], zoom: Infinity})
  ).toBeNull();

  const targetAtCamera = viewport.unprojectPosition(viewport.cameraPosition) as [
    number,
    number,
    number
  ];
  expect(
    viewport.getTargetViewState({target: targetAtCamera, screenPosition: [400, 300]})
  ).toBeNull();
  expect(viewport.getTargetInfo([target[0], target[1], 1e9])?.isValid).toBe(false);

  const singularModelViewport = new WebMercatorViewport({
    ...viewportOptions,
    modelMatrix: new Matrix4().scale([1, 1, 0])
  });
  const singularTarget = singularModelViewport.unproject([400, 300], {targetZ: 100}) as [
    number,
    number,
    number
  ];
  expect(
    singularModelViewport.getTargetViewState({
      target: singularTarget,
      screenPosition: [400, 300]
    })
  ).toBeNull();
  expect(
    singularModelViewport.getTargetPanViewState({
      target: singularTarget,
      screenPosition: [400, 300]
    })
  ).toBeNull();
});

test('WebMercatorViewport#getTargetViewState accepts well-conditioned low zooms and translations', () => {
  for (const zoom of [-20, -10, -6]) {
    const viewport = new WebMercatorViewport({
      width: 800,
      height: 600,
      longitude: 0,
      latitude: 0,
      zoom,
      pitch: 45,
      bearing: 10
    });
    const target = viewport.unproject([400, 300], {targetZ: 0}) as [number, number, number];

    expect(viewport.getTargetInfo(target)?.isValid).toBe(true);
    expect(viewport.getTargetViewState({target, screenPosition: [400, 300]})).not.toBeNull();
  }

  const translatedViewport = new WebMercatorViewport({
    width: 800,
    height: 600,
    longitude: 0,
    latitude: 0,
    zoom: 10,
    pitch: 45,
    modelMatrix: new Matrix4().translate([4000, 0, 0])
  });
  const translatedTarget = translatedViewport.unproject([400, 300], {targetZ: 0}) as [
    number,
    number,
    number
  ];

  expect(
    translatedViewport.getTargetViewState({
      target: translatedTarget,
      screenPosition: [400, 300]
    })
  ).not.toBeNull();
});

test('WebMercatorViewport target operations reject invalid explicit clip ranges', () => {
  const viewportOptions = {
    width: 800,
    height: 600,
    longitude: 0,
    latitude: 0,
    zoom: 10,
    pitch: 45
  };
  for (const clipRange of [
    {nearZ: 0.1, farZ: -10},
    {nearZ: 2, farZ: 1},
    {nearZ: 0, farZ: 10}
  ]) {
    const viewport = new WebMercatorViewport({...viewportOptions, ...clipRange});
    const target: [number, number, number] = [0, 0, 0];

    expect(viewport.getTargetInfo(target)?.isValid ?? false).toBe(false);
    expect(viewport.getTargetViewState({target, screenPosition: [400, 300]})).toBeNull();
  }
});

test('WebMercatorViewport.projectFlat', () => {
  const oldEpsilon = config.EPSILON;
  config.EPSILON = LNGLAT_TOLERANCE;

  for (const vc of TEST_VIEWPORTS) {
    const viewport = new WebMercatorViewport(vc);
    for (const tc of TEST_VIEWPORTS) {
      const lnglatIn = [tc.longitude, tc.latitude];
      const xy = viewport.projectFlat(lnglatIn);
      const lnglat = viewport.unprojectFlat(xy);
      console.log(`Comparing [${lnglatIn}] to [${lnglat}]`);
      expect(equals(lnglatIn, lnglat)).toBeTruthy();
    }
  }
  config.EPSILON = oldEpsilon;
});

test('WebMercatorViewport.project#3D', () => {
  const oldEpsilon = config.EPSILON;
  for (const vc of TEST_VIEWPORTS) {
    const viewport = new WebMercatorViewport(vc);
    for (const offset of [0, 0.5, 1.0, 5.0]) {
      const lnglatIn3 = [vc.longitude + offset, vc.latitude + offset, 0];
      const xyz3 = viewport.project(lnglatIn3);
      const lnglat3 = viewport.unproject(xyz3);
      console.log(`Project/unproject ${lnglatIn3} => ${xyz3} => ${lnglat3}`);
      config.EPSILON = LNGLAT_TOLERANCE;
      expect(
        equals(lnglatIn3.slice(0, 2), lnglat3.slice(0, 2)),
        'LngLat input/output match'
      ).toBeTruthy();
      config.EPSILON = ALT_TOLERANCE;
      expect(equals(lnglatIn3[2], lnglat3[2]), 'Altitude input/output match').toBeTruthy();
    }
  }
  config.EPSILON = oldEpsilon;
});

test('WebMercatorViewport.project#2D', () => {
  const oldEpsilon = config.EPSILON;
  config.EPSILON = LNGLAT_TOLERANCE;
  // Cross check positions
  for (const vc of TEST_VIEWPORTS) {
    const viewport = new WebMercatorViewport(vc);
    for (const tc of TEST_VIEWPORTS) {
      const lnglatIn = [tc.longitude, tc.latitude];
      const xy = viewport.project(lnglatIn);
      const lnglat = viewport.unproject(xy);
      console.log(`Comparing [${lnglatIn}] to [${lnglat}]`);
      expect(equals(lnglatIn, lnglat)).toBeTruthy();
    }
  }
  config.EPSILON = oldEpsilon;
});

test('WebMercatorViewport.getScales', () => {
  const oldEpsilon = config.EPSILON;
  config.EPSILON = OFFSET_TOLERANCE;

  for (const vc of TEST_VIEWPORTS) {
    const viewport = new WebMercatorViewport(vc);
    const distanceScales = viewport.getDistanceScales();
    expect(
      distanceScales.metersPerUnit &&
        distanceScales.unitsPerMeter &&
        distanceScales.degreesPerUnit &&
        distanceScales.unitsPerDegree,
      'distanceScales defined'
    ).toBeTruthy();

    expect(
      equals(
        distanceScales.metersPerUnit.map((d, i) => d * distanceScales.unitsPerMeter[i]),
        [1, 1, 1]
      ),
      'metersPerUnit/unitsPerMeter match'
    ).toBeTruthy();

    expect(
      equals(
        distanceScales.degreesPerUnit.map((d, i) => d * distanceScales.unitsPerDegree[i]),
        [1, 1, 1]
      ),
      'degreesPerUnit/unitsPerDegree match'
    ).toBeTruthy();

    for (const offset of [-0.01, 0.005, 0.01]) {
      const xyz0 = [
        viewport.center[0] + distanceScales.unitsPerDegree[0] * offset,
        viewport.center[1] + distanceScales.unitsPerDegree[1] * offset
      ];
      const xyz1 = viewport.projectFlat([vc.longitude + offset, vc.latitude + offset, 0]);

      expect(equals(xyz0, xyz1), 'unitsPerDegree matches projection').toBeTruthy();
    }
  }
  config.EPSILON = oldEpsilon;
});

test('WebMercatorViewport.getFrustumPlanes', () => {
  const CULLING_TEST_CASES = [
    {
      pixels: [400, 300],
      result: null
    },
    {
      pixels: [799, 1],
      result: null
    },
    {
      pixels: [1, 599],
      result: null
    },
    {
      pixels: [799, 599],
      result: null
    },
    {
      pixels: [1, 1],
      result: null
    },
    {
      pixels: [-1, 300],
      result: 'left'
    },
    {
      pixels: [801, 300],
      result: 'right'
    },
    {
      pixels: [400, -1],
      result: 'top'
    },
    {
      pixels: [400, 601],
      result: 'bottom'
    },
    {
      pixels: [400, 300, -1.01],
      result: 'near'
    },
    {
      pixels: [400, 300, 1.01],
      result: 'far'
    }
  ];

  for (const vc of TEST_VIEWPORTS) {
    const viewport = new WebMercatorViewport(vc);
    const planes = viewport.getFrustumPlanes();

    for (const tc of CULLING_TEST_CASES) {
      const lngLat = viewport.unproject(tc.pixels);
      const commonPosition = viewport.projectPosition(lngLat);
      expect(getCulling(commonPosition, planes), 'point culled').toBe(tc.result);
    }
  }
});

test('WebMercatorViewport.subViewports', () => {
  let viewport = new WebMercatorViewport(TEST_VIEWPORTS[0]);
  expect(viewport.subViewports, 'gets correct subViewports').toEqual(null);

  viewport = new WebMercatorViewport({...TEST_VIEWPORTS[0], repeat: true});
  expect(viewport.subViewports, 'gets correct subViewports').toEqual([viewport]);

  viewport = new WebMercatorViewport({
    width: 800,
    height: 400,
    longitude: 0,
    latitude: 0,
    zoom: 0,
    repeat: true
  });
  const {subViewports} = viewport;
  expect(subViewports.length, 'gets correct subViewports').toBe(3);
  expect(subViewports[0].project([0, 0]), 'center offset in subViewports[0]').toEqual([
    400 - 512,
    200
  ]);
  expect(subViewports[1].project([0, 0]), 'center offset in subViewports[1]').toEqual([400, 200]);
  expect(subViewports[2].project([0, 0]), 'center offset in subViewports[2]').toEqual([
    400 + 512,
    200
  ]);

  expect(viewport.subViewports, 'subViewports are cached').toBe(subViewports);
});

test('WebMercatorViewport#constructor#fovy', () => {
  const oldEpsilon = config.EPSILON;
  config.EPSILON = 0.01;

  const fovy = 25;
  const projectionMatrix = new Matrix4().perspective({
    fovy: fovy * DEGREES_TO_RADIANS,
    aspect: 4 / 3,
    near: 0.1,
    far: 10
  });

  let viewport = new WebMercatorViewport({...TEST_VIEWPORTS[0], projectionMatrix});
  expect(viewport.fovy, 'fovy is calculated from projectionMatrix').toBe(fovy);
  expect(
    equals(viewport.altitude, 2.255),
    'altitude is calculated from projectionMatrix'
  ).toBeTruthy();

  viewport = new WebMercatorViewport({...TEST_VIEWPORTS[0], fovy});
  expect(viewport.fovy, 'fovy is passed through').toBe(fovy);
  expect(equals(viewport.altitude, 2.255), 'altitude is calculated from fovy').toBeTruthy();

  viewport = new WebMercatorViewport({...TEST_VIEWPORTS[0], altitude: 2});
  expect(viewport.altitude, 'altitude is passed through').toBe(2);
  expect(equals(viewport.fovy, 28.072), 'fovy is calculated from altitude').toBeTruthy();

  viewport = new WebMercatorViewport(TEST_VIEWPORTS[0]);
  expect(viewport.altitude, 'using default altitude').toBe(1.5);
  expect(equals(viewport.fovy, 36.87), 'fovy is calculated from altitude').toBeTruthy();

  config.EPSILON = oldEpsilon;
});

function getCulling(p, planes) {
  let outDir = null;
  p = new Vector3(p);
  for (const dir in planes) {
    const plane = planes[dir];
    if (p.dot(plane.normal) > plane.distance) {
      outDir = dir;
      break;
    }
  }
  return outDir;
}
