// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {_GlobeViewport as GlobeViewport} from '@deck.gl/core';

describe('GlobeViewport target navigation', () => {
  for (const longitude of [10, 179.9, -179.9]) {
    for (const latitude of [0, 45, 80, 89.9, -89.9]) {
      it(`reconstructs an elevated target orbit and spherical pan at ${longitude}, ${latitude}`, () => {
        const options = {
          width: 800,
          height: 600,
          longitude,
          latitude,
          zoom: 5,
          bearing: 20,
          pitch: 35,
          nearZMultiplier: 0.01,
          position: [100, 200, 300]
        };
        const source = new GlobeViewport(options);
        const screenPosition: [number, number] = [370, 280];
        const target = source.unproject(screenPosition, {targetZ: 5000}) as [
          number,
          number,
          number
        ];
        const info = source.getTargetInfo(target)!;
        expect(info.isVisible).toBe(true);
        const orbit = source.getTargetViewState({
          target,
          screenPosition,
          bearing: 40,
          pitch: 45,
          zoom: 5.5
        });
        expect(orbit).not.toBeNull();
        const orbitViewport = new GlobeViewport({...options, ...orbit!});
        const orbitInfo = orbitViewport.getTargetInfo(target)!;
        expect(orbitInfo.isValid).toBe(true);
        expect(
          Math.hypot(
            orbitInfo.projectedPosition[0] - screenPosition[0],
            orbitInfo.projectedPosition[1] - screenPosition[1]
          )
        ).toBeLessThan(0.001);
        expect(
          Math.abs(orbitInfo.targetDistance - info.targetDistance / Math.sqrt(2))
        ).toBeLessThan(info.targetDistance * 1e-8);

        const movedPixel: [number, number] = [400, 310];
        const pan = source.getTargetPanViewState({target, screenPosition: movedPixel});
        expect(pan).not.toBeNull();
        const panViewport = new GlobeViewport({...options, ...pan!});
        const panInfo = panViewport.getTargetInfo(target)!;
        expect(panInfo.isValid).toBe(true);
        expect(
          Math.hypot(
            panInfo.projectedPosition[0] - movedPixel[0],
            panInfo.projectedPosition[1] - movedPixel[1]
          )
        ).toBeLessThan(0.001);
        expect(panViewport.scale).toBeCloseTo(source.scale, 7);
        expect(Math.hypot(...panViewport.cameraPosition)).toBeCloseTo(
          Math.hypot(...source.cameraPosition),
          7
        );
      });
    }
  }

  it('supports a padded lens and enforces a metre floor without moving an inside start outwards', () => {
    const options = {
      width: 800,
      height: 600,
      longitude: 35,
      latitude: -45,
      zoom: 7,
      pitch: 40,
      bearing: -25,
      fovy: 55,
      padding: {top: 80, right: 30},
      nearZMultiplier: 0.001
    };
    const source = new GlobeViewport(options);
    const screenPosition: [number, number] = [420, 350];
    const target = source.unproject(screenPosition, {targetZ: 1000}) as [number, number, number];
    const distance = source.getTargetInfo(target)!.targetDistance;
    for (const floor of [distance / 2, distance * 2]) {
      const result = source.getTargetViewState({
        target,
        screenPosition,
        zoom: 12,
        minimumTargetDistance: floor
      });
      expect(result).not.toBeNull();
      const viewport = new GlobeViewport({...options, ...result!});
      const information = viewport.getTargetInfo(target)!;
      expect(information.targetDistance).toBeCloseTo(Math.min(distance, floor), 4);
      expect(
        Math.hypot(
          information.projectedPosition[0] - screenPosition[0],
          information.projectedPosition[1] - screenPosition[1]
        )
      ).toBeLessThan(0.1);
    }
  });

  it('rejects far-side, clipped, below-surface, nonfinite and unsupported targets', () => {
    const options = {width: 800, height: 600, longitude: 0, latitude: 0, zoom: 3};
    const source = new GlobeViewport(options);
    expect(source.getTargetInfo([180, 0, 100])?.isValid).toBe(false);
    expect(source.getTargetInfo([0, 0, -1])).toBeNull();
    expect(source.getTargetInfo([0, Number.NaN, 100])).toBeNull();
    expect(source.getTargetInfo(null as any)).toBeNull();
    expect(
      source.getTargetPanViewState({target: [0, 0, 0], screenPosition: [100] as any})
    ).toBeNull();
    expect(source.getTargetInfo([0, 0, 1e10])?.isValid).toBe(false);
    for (const projection of [
      {orthographic: true},
      {projectionMatrix: source.projectionMatrix},
      {modelMatrix: source.viewMatrix}
    ]) {
      const viewport = new GlobeViewport({...options, ...projection});
      expect(viewport.supportsTargetNavigation).toBe(false);
      expect(
        viewport.getTargetViewState({target: [0, 0, 0], screenPosition: [400, 300]})
      ).toBeNull();
    }
  });
});
