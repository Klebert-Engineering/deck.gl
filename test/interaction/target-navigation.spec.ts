// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {test, expect} from 'vitest';
import {commands} from 'vitest/browser';
import {createTargetScene, expectTargetPixel} from '../utils/target-navigation';

test.each(['map', 'globe'] as const)(
  '%s acquires, orbits, pans and zooms through canvas input',
  async camera => {
    const scene = await createTargetScene({camera});
    try {
      if (camera === 'globe') expect(scene.viewport().constructor.name).toBe('GlobeViewport');
      const [x, y] = scene.pixel();
      const before = scene.viewport();
      const bearing = before.bearing;
      await commands.emulateInput({
        type: 'drag',
        button: 'right',
        startX: x,
        startY: y,
        endX: x + 45,
        endY: y + 20,
        steps: 6
      });
      const frames = scene.frames.filter(frame => frame.interaction.interactionTargetPosition);
      expect(frames.length).toBeGreaterThan(2);
      const target = frames[0].interaction.interactionTargetPosition!;
      // Raster/depth acquisition budget; subsequent solver assertions remain much tighter.
      expect(Math.abs(target[2] - scene.coordinate[2])).toBeLessThanOrEqual(
        2 * before.metersPerPixel
      );
      const pixel = before.project(target);
      const radius = before.getTargetInfo(target)!.targetDistance;
      for (const frame of frames) {
        expect(frame.interaction.viewId).toBe('target');
        expectTargetPixel(frame.viewport, target, pixel);
        expect(
          Math.abs(frame.viewport.getTargetInfo(target)!.targetDistance - radius)
        ).toBeLessThanOrEqual(Math.max(0.01, radius * 1e-7));
      }
      expect(scene.viewport().bearing).not.toBe(bearing);
      expect(scene.states.at(-1)?.interactionTargetPosition).toBeUndefined();

      // Default left-button behavior must stay a pan, not become a rotation.
      scene.frames.length = 0;
      const panStart = scene.pixel();
      const panBearing = scene.viewport().bearing;
      await commands.emulateInput({
        type: 'drag',
        startX: panStart[0],
        startY: panStart[1],
        endX: panStart[0] + 24,
        endY: panStart[1] + 12,
        steps: 4
      });
      expect(scene.frames.some(frame => frame.interaction.interactionTargetPosition)).toBe(true);
      if (camera === 'map') expect(scene.viewport().bearing).toBe(panBearing);
      expect(scene.frames.some(frame => frame.interaction.isPanning)).toBe(true);

      scene.frames.length = 0;
      const [wheelX, wheelY] = scene.pixel();
      const zoom = scene.viewport().zoom;
      const wheels: number[] = [];
      scene.canvas.addEventListener('wheel', event => wheels.push(event.deltaY));
      await commands.emulateInput({type: 'wheel', x: wheelX, y: wheelY, deltaY: -80});
      await expect.poll(() => wheels.length).toBeGreaterThan(0);
      await expect
        .poll(() => scene.frames.some(frame => frame.interaction.interactionTargetPosition))
        .toBe(true);
      await expect.poll(() => scene.states.at(-1)?.interactionTargetPosition).toBeUndefined();
      expect(scene.viewport().zoom).toBeGreaterThan(zoom);

      scene.setEnabled(false);
      scene.frames.length = 0;
      const stockStart = scene.viewport();
      await commands.emulateInput({type: 'drag', startX: 360, startY: 270, endX: 390, endY: 285});
      expect(scene.frames.every(frame => !frame.interaction.interactionTargetPosition)).toBe(true);
      expect(scene.viewport().longitude).not.toBe(stockStart.longitude);
      const stockZoom = scene.viewport().zoom;
      await commands.emulateInput({type: 'keypress', key: 'Equal'});
      await expect.poll(() => scene.viewport().zoom).toBeGreaterThan(stockZoom);
      expect(scene.errors).toEqual([]);
    } finally {
      scene.dispose();
    }
  }
);

test('Terrain resumes after canvas orbit without a physical camera jump', async () => {
  const scene = await createTargetScene({camera: 'terrain'});
  try {
    const [x, y] = scene.pixel();
    await commands.emulateInput({
      type: 'drag',
      button: 'right',
      startX: x,
      startY: y,
      endX: x + 45,
      endY: y + 20,
      steps: 6
    });
    expect(scene.frames.some(frame => frame.interaction.interactionTargetPosition)).toBe(true);
    expect(scene.states.at(-1)?.interactionTargetPosition).toBeUndefined();
    const lastTargetFrame = scene.frames.findLastIndex(
      frame => frame.interaction.interactionTargetPosition
    );
    const before = scene.frames[lastTargetFrame].viewport;
    const count = lastTargetFrame + 1;
    await expect.poll(() => scene.frames.length, {timeout: 3000}).toBeGreaterThan(count);
    const resumed = scene.frames.at(-1)!.viewport;
    const meters = before.distanceScales.metersPerUnit;
    expect(
      Math.hypot(
        ...before.cameraPosition.map((v, i) => (resumed.cameraPosition[i] - v) * meters[i])
      )
    ).toBeLessThanOrEqual(0.01);
    for (const pixel of [
      [280, 230],
      [360, 270],
      [430, 310]
    ]) {
      expectTargetPixel(resumed, before.unproject(pixel, {targetZ: 100}), pixel);
    }
    expect(scene.errors).toEqual([]);
  } finally {
    scene.dispose();
  }
});
