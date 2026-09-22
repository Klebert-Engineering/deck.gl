// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import MapController from './map-controller';
import {MapState, MapStateProps, type MapControllerOptions} from './map-controller';
import type {ControllerProps, InteractionState} from './controller';
import WebMercatorViewport from '../viewports/web-mercator-viewport';
import {getInteractionTargetStructure} from './interaction-target';
import {deepEqual} from '../utils/deep-equal';

type TerrainRebase = {
  source: Record<string, any>;
  proposed: Record<string, any>;
};

function sameCameraState(a: Record<string, any>, b: Record<string, any>): boolean {
  return ['longitude', 'latitude', 'zoom', 'bearing', 'pitch', 'position'].every(key =>
    deepEqual(a[key], b[key], -1)
  );
}

function getTerrainGeometry(props: Record<string, any>): Record<string, unknown> {
  const {id, x, y, width, height, minZoom, maxZoom, minPitch, maxPitch, maxBounds} = props;
  return {
    id,
    x,
    y,
    width,
    height,
    minZoom,
    maxZoom,
    minPitch,
    maxPitch,
    maxBounds,
    ...getInteractionTargetStructure(props)
  };
}

/**
 * Controller that extends MapController with terrain-aware behavior.
 * The camera smoothly follows terrain elevation during pan/zoom.
 */
export default class TerrainController extends MapController {
  protected declare props: ControllerProps & MapStateProps;
  /** Cached terrain altitude from depth picking at viewport center (smoothed) */
  private _terrainAltitude?: number = undefined;
  /** Raw (unsmoothed) terrain altitude from latest pick */
  private _terrainAltitudeTarget?: number = undefined;
  /** rAF handle for periodic terrain altitude picking */
  private _pickFrameId: number | null = null;
  /** Timestamp of last pick */
  private _lastPickTime: number = 0;
  /** Cold initialization and post-target handoff use the same accepted-pose rebase. */
  private _needsTerrainRebase = true;
  /** A proposal is not terrain initialization until controlled state accepts it. */
  private _terrainRebase: TerrainRebase | null = null;

  setProps(
    props: ControllerProps &
      MapStateProps & {
        rotationPivot?: 'center' | '2d' | '3d';
        getAltitude?: (pos: [number, number]) => number | undefined;
      } & MapControllerOptions
  ) {
    const oldGeometry = this.props && getTerrainGeometry(this.props);
    const terrainProps = {rotationPivot: '3d' as const, ...props};
    const geometry = getTerrainGeometry(terrainProps);
    // Base normalization can emit synchronously. Suspend old altitude writes BEFORE it sees
    // a replacement camera/configuration, not after the normalized camera has been published.
    if (oldGeometry && !deepEqual(oldGeometry, geometry, -1)) {
      this._needsTerrainRebase = true;
      this._terrainRebase = null;
    }
    super.setProps(terrainProps);
    const pending = this._terrainRebase;
    if (pending) {
      const accepted = new this.ControllerState({makeViewport: this.makeViewport, ...this.props});
      const acceptedProps = accepted.getViewportProps();
      if (sameCameraState(pending.proposed, acceptedProps)) {
        // Keep the normalized offset. Its local metre scale may differ from the picked latitude.
        this._terrainAltitude = acceptedProps.position![2];
        this._terrainAltitudeTarget = this._terrainAltitude;
        this._needsTerrainRebase = false;
        this._terrainRebase = null;
      } else if (!sameCameraState(pending.source, acceptedProps)) {
        this._terrainRebase = null;
      }
    }

    // Periodically pick terrain altitude at the viewport center using rAF.
    // Keeps the altitude cache warm so interactions don't need expensive
    // synchronous GPU readbacks. rAF naturally pauses when tab is backgrounded.
    if (this._pickFrameId === null) {
      const loop = () => {
        const now = Date.now();
        if (
          now - this._lastPickTime > 500 &&
          !this.isDragging() &&
          !this.hasActiveInteractionTarget()
        ) {
          this._lastPickTime = now;
          // Do not repeatedly emit a proposal which a controlled application has not accepted.
          if (!this._terrainRebase) {
            const coordinate = this._pickTerrainCenter();
            if (coordinate) {
              if (this._needsTerrainRebase) this._resumeTerrain(coordinate);
              else this._terrainAltitudeTarget = coordinate[2];
            }
          }
        }
        if (this._pickFrameId !== null) this._pickFrameId = requestAnimationFrame(loop);
      };
      this._pickFrameId = requestAnimationFrame(loop);
    }
  }

  finalize() {
    this._terrainRebase = null;
    this._needsTerrainRebase = true;
    if (this._pickFrameId !== null) {
      cancelAnimationFrame(this._pickFrameId);
      this._pickFrameId = null;
    }
    super.finalize();
  }

  protected updateViewport(
    newControllerState: MapState,
    extraProps: Record<string, any> | null = null,
    interactionState: InteractionState = {}
  ): void {
    if (this.hasActiveInteractionTarget()) {
      this._needsTerrainRebase = true;
      this._terrainRebase = null;
    }
    // Pass stock deltas through while waiting; never overwrite the target's offset with a cache.
    if (this._needsTerrainRebase || this._terrainAltitude === undefined) {
      super.updateViewport(newControllerState, extraProps, interactionState);
      return;
    }

    // Smoothly blend toward target altitude
    const SMOOTHING = 0.05;
    this._terrainAltitude += (this._terrainAltitudeTarget! - this._terrainAltitude) * SMOOTHING;

    const viewportProps = newControllerState.getViewportProps();
    const pos = viewportProps.position || [0, 0, 0];
    extraProps = {
      ...extraProps,
      position: [pos[0], pos[1], this._terrainAltitude]
    };

    super.updateViewport(newControllerState, extraProps, interactionState);
  }

  private _pickTerrainCenter(): [number, number, number] | null {
    if (!this.pickPosition) return null;
    const {x, y, width, height} = this.props;
    const pickResult = this.pickPosition(x + width / 2, y + height / 2);
    const coordinate = pickResult?.coordinate;
    const viewport = this.makeViewport(this.props);
    if (
      !coordinate ||
      coordinate.length < 3 ||
      ![...coordinate.slice(0, 3)].every(Number.isFinite) ||
      (pickResult.viewport &&
        (pickResult.viewport.id !== viewport.id ||
          pickResult.viewport.constructor !== viewport.constructor ||
          !pickResult.viewport.equals(viewport)))
    ) {
      return null;
    }
    return coordinate.slice(0, 3) as [number, number, number];
  }

  private _resumeTerrain(coordinate: [number, number, number]): void {
    // Use the displayed state, not a cached controller proposal or a transition endpoint.
    const source = new this.ControllerState({makeViewport: this.makeViewport, ...this.props});
    const sourceProps = source.getViewportProps();
    const viewport = this.makeViewport(sourceProps);
    const exact = viewport instanceof WebMercatorViewport && viewport.supportsTargetNavigation;
    const rebase = exact
      ? viewport._getRebasedViewState(coordinate[2])
      : this._rebaseViewport(coordinate[2], source);
    if (!rebase) return;
    const candidate = new this.ControllerState({
      makeViewport: this.makeViewport,
      ...this.props,
      ...rebase
    });
    const proposed = candidate.getViewportProps();
    if (exact) {
      const nextViewport = this.makeViewport(proposed) as WebMercatorViewport;
      if (
        !viewport.getTargetInfo(coordinate)?.isValid ||
        !nextViewport.getTargetInfo(coordinate)?.isValid ||
        !viewport._isSameCamera(nextViewport)
      )
        return;
    }
    this._terrainRebase = {source: sourceProps, proposed};
    // rAF is the sole proposal point, outside rendering and public interaction-state callbacks.
    super.updateViewport(candidate);
    this._controllerState = undefined;
  }

  /**
   * Compute viewport adjustments to keep the view visually the same
   * when shifting position to [0, 0, altitude].
   */
  private _rebaseViewport(
    altitude: number,
    newControllerState: MapState
  ): Record<string, any> | null {
    const viewportProps = newControllerState.getViewportProps();
    const oldViewport = this.makeViewport({...viewportProps, position: [0, 0, 0]});
    const oldCameraPos = oldViewport.cameraPosition;

    const centerZOffset = altitude * oldViewport.distanceScales.unitsPerMeter[2];
    const cameraHeightAboveOldCenter = oldCameraPos[2];
    const newCameraHeightAboveCenter = cameraHeightAboveOldCenter - centerZOffset;
    if (newCameraHeightAboveCenter <= 0) {
      return null;
    }

    const zoomDelta = Math.log2(cameraHeightAboveOldCenter / newCameraHeightAboveCenter);
    const newZoom = viewportProps.zoom + zoomDelta;

    const newViewport = this.makeViewport({
      ...viewportProps,
      zoom: newZoom,
      position: [0, 0, altitude]
    });
    const {width, height} = viewportProps;
    const screenCenter: [number, number] = [width / 2, height / 2];
    const worldPoint = oldViewport.unproject(screenCenter, {targetZ: altitude});
    if (
      worldPoint &&
      'panByPosition3D' in newViewport &&
      typeof newViewport.panByPosition3D === 'function'
    ) {
      const adjusted = newViewport.panByPosition3D(worldPoint, screenCenter);
      return {position: [0, 0, altitude], zoom: newZoom, ...adjusted};
    }
    return null;
  }
}
