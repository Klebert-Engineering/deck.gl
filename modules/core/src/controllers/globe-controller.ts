// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {clamp, vec3} from '@math.gl/core';
import Controller from './controller';
import type {ControllerOptions} from './controller';
import type {TargetNavigationOptions} from './interaction-target';
import {getMaxBoundsExtents, getMaxBoundsRect} from './utils';

import {MapState, MapStateProps} from './map-controller';
import type {MapStateInternal} from './map-controller';
import {CONSTRAINT_AROUND, type ConstraintAround, type ConstraintContext} from './view-state';
import {mod} from '../utils/math-utils';
import LinearInterpolator from '../transitions/linear-interpolator';
import GlobeViewport, {zoomAdjust, GLOBE_RADIUS} from '../viewports/globe-viewport';
import WebMercatorViewport from '../viewports/web-mercator-viewport';
import {
  Globe,
  type CameraFrame,
  GLOBE_INERTIA_EASING,
  GlobeInertiaInterpolator
} from '../viewports/globe-utils';

import type {MjolnirGestureEvent} from 'mjolnir.js';

const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;

/** Globe controller options. GlobeView uses Web Mercator above its projection threshold. */
export type GlobeControllerOptions = ControllerOptions &
  TargetNavigationOptions<GlobeViewport | WebMercatorViewport>;

function degreesToPixels(angle: number, zoom: number = 0): number {
  const radians = Math.min(180, angle) * DEGREES_TO_RADIANS;
  const size = GLOBE_RADIUS * 2 * Math.sin(radians / 2);
  return size * Math.pow(2, zoom);
}

function pixelsToDegrees(pixels: number, zoom: number = 0): number {
  const size = pixels / Math.pow(2, zoom);
  const radians = Math.asin(Math.min(1, size / GLOBE_RADIUS / 2)) * 2;
  return radians * RADIANS_TO_DEGREES;
}

type GlobeStateInternal = MapStateInternal & {
  startPanPos?: [number, number];
  startPanCameraFrame?: CameraFrame;
  startPanAngularRate?: number;
};

class GlobeState extends MapState {
  constructor(
    options: MapStateProps &
      GlobeStateInternal & {
        makeViewport: (props: Record<string, any>) => any;
      }
  ) {
    const {startPanPos, startPanCameraFrame, startPanAngularRate, ...mapStateOptions} = options;
    mapStateOptions.normalize = false;
    super(mapStateOptions);

    const s = (this as any)._state;
    if (startPanPos !== undefined) s.startPanPos = startPanPos;
    if (startPanCameraFrame !== undefined) s.startPanCameraFrame = startPanCameraFrame;
    if (startPanAngularRate !== undefined) s.startPanAngularRate = startPanAngularRate;
  }

  panStart({pos}: {pos: [number, number]}): GlobeState {
    const {latitude, longitude, zoom, bearing = 0} = this.getViewportProps();
    const cameraFrame = Globe.cameraFrame(longitude, latitude, bearing);

    // Radians of arc per pixel, derived from zoom scale
    const scale = Math.pow(2, zoom - zoomAdjust(latitude, true));
    const angularRate = (0.25 / scale) * DEGREES_TO_RADIANS;

    return this._getUpdatedState({
      startPanPos: pos,
      startPanCameraFrame: cameraFrame,
      startPanAngularRate: angularRate,
      startZoom: zoom
    }) as GlobeState;
  }

  pan({pos, startPos}: {pos: [number, number]; startPos?: [number, number]}): GlobeState {
    const state = this.getState() as GlobeStateInternal;
    if (state.interactionTarget) {
      return super.pan({pos, startPos}) as GlobeState;
    }
    const startPanPos = state.startPanPos || startPos;
    if (!startPanPos) return this;

    const frame = state.startPanCameraFrame;
    const rate = state.startPanAngularRate;
    const startZoom = state.startZoom ?? this.getViewportProps().zoom;
    if (!frame || !rate) {
      return this;
    }

    const dx = startPanPos[0] - pos[0];
    const dy = startPanPos[1] - pos[1];

    const hAngle = dx * rate;
    const vAngle = -dy * rate;
    const rotated = Globe.rotateFrame(frame, hAngle, vAngle);
    const zoom = startZoom + zoomAdjust(rotated.latitude, true) - zoomAdjust(frame.latitude, true);

    return this._getUpdatedState({
      longitude: rotated.longitude,
      latitude: rotated.latitude,
      bearing: rotated.bearing,
      zoom
    }) as GlobeState;
  }

  panEnd(): GlobeState {
    return this._getUpdatedState({
      startPanPos: null,
      startPanCameraFrame: null,
      startPanAngularRate: null,
      startZoom: null
    }) as GlobeState;
  }

  _panFromCenter(offset: [number, number]): GlobeState {
    if (this.getState().interactionTarget) {
      return super._panFromCenter(offset) as GlobeState;
    }
    const {width, height} = this.getViewportProps();
    const center: [number, number] = [width / 2, height / 2];
    return this.panStart({pos: center})
      .pan({pos: [center[0] + offset[0], center[1] + offset[1]]})
      .panEnd();
  }

  applyConstraints(props: Required<MapStateProps>): Required<MapStateProps> {
    const internalProps = props as typeof props & ConstraintAround;
    const constraintAround = internalProps[CONSTRAINT_AROUND];
    delete internalProps[CONSTRAINT_AROUND];
    const {latitude, maxBounds} = props;

    props.zoom = this._constrainZoom(props.zoom, props);

    if (constraintAround) {
      const viewport = this.makeViewport(props);
      // GlobeView switches to Web Mercator at high zoom. Do not call a spherical-only
      // method on that viewport, including during ordinary (non-target) zoom.
      if (viewport instanceof WebMercatorViewport) {
        Object.assign(
          props,
          viewport.panByPosition(constraintAround.position, constraintAround.screenPosition)
        );
      }
      const anchorStrength =
        viewport instanceof GlobeViewport
          ? viewport.getZoomAnchorStrength(constraintAround.screenPosition)
          : 0;
      if (anchorStrength > 0) {
        const currentCoordinates = viewport.unproject(constraintAround.screenPosition);
        const cameraFrame = Globe.cameraFrame(props.longitude, props.latitude, props.bearing || 0);
        const rotatedFrame = Globe.rotateFrameToMatch(
          cameraFrame,
          [currentCoordinates[0], currentCoordinates[1]],
          [constraintAround.position[0], constraintAround.position[1]],
          anchorStrength
        );
        props.longitude = rotatedFrame.longitude;
        props.latitude = rotatedFrame.latitude;
        props.bearing = rotatedFrame.bearing;
      }
    }

    if (props.longitude < -180 || props.longitude > 180) {
      props.longitude = mod(props.longitude + 180, 360) - 180;
    }
    if (props.bearing < -180 || props.bearing > 180) {
      props.bearing = mod(props.bearing + 180, 360) - 180;
    }
    props.latitude = clamp(props.latitude, -90, 90);
    props.pitch = clamp(props.pitch, props.minPitch, props.maxPitch);

    const maxBoundsRect = maxBounds
      ? getMaxBoundsRect(props.width, props.height, props.maxBoundsPadding)
      : null;
    if (maxBounds && maxBoundsRect) {
      // A negative target dimension is inverted and therefore has no legal interval.
      if (maxBoundsRect.width >= 0) {
        props.longitude = clamp(props.longitude, maxBounds[0][0], maxBounds[1][0]);
      }
      if (maxBoundsRect.height >= 0) {
        props.latitude = clamp(props.latitude, maxBounds[0][1], maxBounds[1][1]);
      }
    }

    if (maxBounds && maxBoundsRect) {
      const viewport = this.makeViewport({...props, bearing: 0, pitch: 0});
      const screenExtents = getMaxBoundsExtents(
        viewport,
        [props.longitude, props.latitude],
        maxBoundsRect
      );
      const effectiveZoom = props.zoom - zoomAdjust(latitude);
      const lngSpan = maxBounds[1][0] - maxBounds[0][0];
      const latSpan = maxBounds[1][1] - maxBounds[0][1];
      if (maxBoundsRect.height >= 0 && latSpan > 0 && latSpan < 180) {
        const heightDegrees = Math.min(
          pixelsToDegrees(maxBoundsRect.height, effectiveZoom),
          latSpan
        );
        const bottomDegrees = maxBoundsRect.height
          ? (heightDegrees * screenExtents.bottom) / maxBoundsRect.height
          : pixelsToDegrees(screenExtents.bottom, effectiveZoom);
        const topDegrees = maxBoundsRect.height
          ? (heightDegrees * screenExtents.top) / maxBoundsRect.height
          : pixelsToDegrees(screenExtents.top, effectiveZoom);
        props.latitude = clamp(
          props.latitude,
          maxBounds[0][1] + bottomDegrees,
          maxBounds[1][1] - topDegrees
        );
      }
      if (maxBoundsRect.width >= 0 && lngSpan > 0 && lngSpan < 360) {
        const widthDegrees = Math.min(
          pixelsToDegrees(
            maxBoundsRect.width / Math.cos(props.latitude * DEGREES_TO_RADIANS),
            effectiveZoom
          ),
          lngSpan
        );
        const leftDegrees = maxBoundsRect.width
          ? (widthDegrees * screenExtents.left) / maxBoundsRect.width
          : pixelsToDegrees(
              screenExtents.left / Math.cos(props.latitude * DEGREES_TO_RADIANS),
              effectiveZoom
            );
        const rightDegrees = maxBoundsRect.width
          ? (widthDegrees * screenExtents.right) / maxBoundsRect.width
          : pixelsToDegrees(
              screenExtents.right / Math.cos(props.latitude * DEGREES_TO_RADIANS),
              effectiveZoom
            );
        props.longitude = clamp(
          props.longitude,
          maxBounds[0][0] + leftDegrees,
          maxBounds[1][0] - rightDegrees
        );
      }
    }
    // maxBounds may extend past the globe's coordinate range.
    props.latitude = clamp(props.latitude, -90, 90);
    if (props.latitude !== latitude) {
      props.zoom += zoomAdjust(props.latitude, true) - zoomAdjust(latitude, true);
    }

    return props;
  }

  _getTargetViewport(
    props: Required<MapStateProps> = this.getViewportProps()
  ): GlobeViewport | WebMercatorViewport | null {
    const viewport = this.makeViewport(props);
    return (viewport instanceof GlobeViewport || viewport instanceof WebMercatorViewport) &&
      viewport.supportsTargetNavigation
      ? viewport
      : null;
  }

  /** Spherical pan preserves the rigid camera frame and effective magnification, not map XY. */
  _getTargetPanUpdatedState(
    screenPosition: [number, number],
    constraintContext?: ConstraintContext
  ): MapState {
    const state = this.getState();
    const sourceViewport = state.targetNavigationStartViewport;
    if (!(sourceViewport instanceof GlobeViewport)) {
      return super._getTargetPanUpdatedState(screenPosition, constraintContext);
    }
    const target = state.interactionTarget;
    if (!target) return this;
    const requested = sourceViewport.getTargetPanViewState({
      target: target.coordinate,
      screenPosition
    });
    if (!requested) return this;
    if (
      this.makeViewport({...this.getViewportProps(), ...requested}).constructor !==
      sourceViewport.constructor
    ) {
      // End this session at the projection seam. Rebase the remaining drag at this sample.
      const viewport = this.makeViewport(this.getViewportProps());
      const previousPixel = viewport.project(target.coordinate).slice(0, 2) as [number, number];
      let candidate = this.withoutInteractionTarget()
        .panStart({pos: previousPixel})
        .pan({pos: screenPosition}) as GlobeState;
      const candidateViewport = candidate._getTargetViewport();
      if (
        candidateViewport &&
        (viewport instanceof GlobeViewport || viewport instanceof WebMercatorViewport)
      ) {
        candidate = candidate._getUpdatedState({
          position: this._getProjectionHandoffPosition(viewport, candidateViewport)
        }) as GlobeState;
      }
      const inputOrigin = state.targetNavigationInputOrigin || target.screenPosition;
      candidate = candidate.panStart({
        pos: [
          inputOrigin[0] + screenPosition[0] - target.screenPosition[0],
          inputOrigin[1] + screenPosition[1] - target.screenPosition[1]
        ]
      });
      return candidate;
    }
    const candidate = this._getTargetUpdatedState(
      requested,
      screenPosition,
      undefined,
      constraintContext
    );
    const viewport = candidate._getTargetViewport();
    if (
      !(viewport instanceof GlobeViewport) ||
      Math.abs(viewport.scale / sourceViewport.scale - 1) > 1e-8 ||
      Math.abs(viewport.pitch - sourceViewport.pitch) > 1e-8 ||
      Math.abs(
        vec3.length(viewport.cameraPosition) / vec3.length(sourceViewport.cameraPosition) - 1
      ) > 1e-8
    ) {
      return this;
    }
    return candidate;
  }

  _getTargetPoseUpdatedState(
    pose: {bearing?: number; pitch?: number; zoom?: number},
    constraintContext?: ConstraintContext,
    expectedDistance?: number,
    screenPosition?: readonly [number, number]
  ): MapState {
    const state = this.getState();
    const sourceViewport = state.targetNavigationStartViewport;
    const props = this.getViewportProps();
    const nextViewport = this.makeViewport({...props, ...pose});
    if (sourceViewport && nextViewport.constructor !== sourceViewport.constructor) {
      const currentViewport = this.makeViewport(props);
      if (
        !(
          currentViewport instanceof GlobeViewport || currentViewport instanceof WebMercatorViewport
        ) ||
        !(nextViewport instanceof GlobeViewport || nextViewport instanceof WebMercatorViewport)
      )
        return this;
      const pixel = state.targetNavigationScreenPosition!;
      // This is deliberately a stock handoff, not a cross-projection target animation.
      // Retain accumulated gesture starts so the next pinch sample does not replay its delta.
      return this.withoutInteractionTarget()._getUpdatedState(
        {
          ...pose,
          position: this._getProjectionHandoffPosition(currentViewport, nextViewport),
          startZoom: state.startZoom,
          startZoomLngLat: currentViewport.unproject(pixel),
          startRotatePos: state.startRotatePos,
          startBearing: state.startBearing,
          startPitch: state.startPitch,
          [CONSTRAINT_AROUND]: {position: currentViewport.unproject(pixel), screenPosition: pixel}
        },
        constraintContext
      );
    }
    // At fixed geographic center the spherical distance curve is exponential in zoom.
    // The viewport supplies the spherical inverse; no Mercator inverse is used here.
    return super._getTargetPoseUpdatedState(
      pose,
      constraintContext,
      expectedDistance,
      screenPosition
    );
  }

  /** Convert the existing offset between Globe's global axes and Mercator's local ENU axes. */
  private _getProjectionHandoffPosition(
    source: GlobeViewport | WebMercatorViewport,
    destination: GlobeViewport | WebMercatorViewport
  ): number[] {
    if (source.constructor === destination.constructor) return [...source.position];
    const longitude = source.longitude * DEGREES_TO_RADIANS;
    const latitude = source.latitude * DEGREES_TO_RADIANS;
    const east = [Math.cos(longitude), Math.sin(longitude), 0];
    const north = [
      -Math.sin(longitude) * Math.sin(latitude),
      Math.cos(longitude) * Math.sin(latitude),
      Math.cos(latitude)
    ];
    const up = [
      Math.sin(longitude) * Math.cos(latitude),
      -Math.cos(longitude) * Math.cos(latitude),
      Math.sin(latitude)
    ];
    if (source instanceof GlobeViewport) {
      return [
        vec3.dot(source.position, east),
        vec3.dot(source.position, north),
        vec3.dot(source.position, up)
      ];
    }
    return [0, 1, 2].map(
      index =>
        east[index] * source.position[0] +
        north[index] * source.position[1] +
        up[index] * source.position[2]
    );
  }

  _constrainZoom(zoom: number, props?: Required<MapStateProps>): number {
    props ||= this.getViewportProps();
    const {maxZoom, maxBounds} = props;
    let {minZoom} = props;

    const shouldApplyMaxBounds = maxBounds !== null && props.width > 0 && props.height > 0;
    if (shouldApplyMaxBounds) {
      const maxBoundsRect = getMaxBoundsRect(props.width, props.height, props.maxBoundsPadding);
      const minLatitude = maxBounds[0][1];
      const maxLatitude = maxBounds[1][1];
      const fitLatitude =
        Math.sign(minLatitude) === Math.sign(maxLatitude)
          ? Math.min(Math.abs(minLatitude), Math.abs(maxLatitude))
          : 0;
      const ZOOM0 = zoomAdjust(0);
      const w =
        degreesToPixels(maxBounds[1][0] - maxBounds[0][0]) *
        Math.cos(fitLatitude * DEGREES_TO_RADIANS);
      const h = degreesToPixels(maxBounds[1][1] - maxBounds[0][1]);
      if (maxBoundsRect.width > 0 && w > 0) {
        minZoom = Math.max(minZoom, Math.log2(maxBoundsRect.width / w) + ZOOM0);
      }
      if (maxBoundsRect.height > 0 && h > 0) {
        minZoom = Math.max(minZoom, Math.log2(maxBoundsRect.height / h) + ZOOM0);
      }
      if (minZoom > maxZoom) minZoom = maxZoom;
    }

    const zoomAdjustment = zoomAdjust(props.latitude, true) - zoomAdjust(0, true);
    return clamp(zoom, minZoom + zoomAdjustment, maxZoom + zoomAdjustment);
  }
}

export default class GlobeController extends Controller<MapState> {
  ControllerState = GlobeState;

  transition = {
    transitionDuration: 300,
    transitionInterpolator: new LinearInterpolator({
      transitionProps: {
        compare: ['longitude', 'latitude', 'zoom', 'bearing', 'pitch'],
        required: ['longitude', 'latitude', 'zoom']
      }
    })
  };

  dragMode: 'pan' | 'rotate' = 'pan';

  // Ring buffer tracking globe position during pan for inertia velocity
  private _panHistory: Array<{longitude: number; latitude: number; timestamp: number}> = [];

  protected _onPanStart(event: MjolnirGestureEvent): boolean {
    this._panHistory = [];
    return super._onPanStart(event);
  }

  protected _onMultiPanStart(event: MjolnirGestureEvent): boolean {
    this._panHistory = [];
    return super._onMultiPanStart(event);
  }

  protected _onPanMove(event: MjolnirGestureEvent): boolean {
    if (!this.dragPan) {
      return false;
    }
    const pos = this.getCenter(event);
    const newControllerState = this.controllerState.pan({pos});
    this.updateViewport(
      newControllerState,
      {transitionDuration: 0},
      {
        isDragging: true,
        isPanning: true
      }
    );

    const {longitude, latitude} = newControllerState.getViewportProps();
    this._panHistory.push({longitude, latitude, timestamp: Date.now()});
    if (this._panHistory.length > 5) {
      this._panHistory.shift();
    }

    return true;
  }

  protected _onPanMoveEnd(event: MjolnirGestureEvent): boolean {
    if (this.hasActiveInteractionTarget()) {
      // Target inertia extrapolates the target pixel; every frame uses the spherical solve.
      // The ordinary globe-frame inertia below remains unchanged for stock navigation.
      this._panHistory = [];
      return super._onPanMoveEnd(event);
    }
    const {inertia} = this;
    if (this.dragPan && inertia && this._panHistory.length >= 2) {
      const first = this._panHistory[0];
      const last = this._panHistory[this._panHistory.length - 1];
      const dt = last.timestamp - first.timestamp;

      if (dt > 0) {
        const viewportProps = this.controllerState.getViewportProps();
        // Compute velocity from the actual positions the globe was at
        const angularDistance = Globe.angularDistance(first, last);
        const angularVelocity = angularDistance / dt;

        if (angularVelocity > 1e-6) {
          const totalAngle = (angularVelocity * inertia) / 2;
          // Spin around one fixed axis so position and up stay in the same
          // rigid camera frame through poles and across the antimeridian.
          const axis = Globe.greatCircleAxis(first, last);
          const currentFrame = Globe.cameraFrame(
            viewportProps.longitude,
            viewportProps.latitude,
            viewportProps.bearing || 0
          );
          const endFrame = Globe.rotateFrame(
            {...currentFrame, axisHorizontal: axis},
            totalAngle,
            0
          );
          const endLng = endFrame.longitude;
          const endLat = clamp(endFrame.latitude, -90, 90);
          const interpolator = new GlobeInertiaInterpolator({axis, totalAngle});

          const newControllerState = this.controllerState.panEnd();
          this.updateViewport(
            newControllerState,
            {
              transitionInterpolator: interpolator,
              transitionDuration: inertia,
              transitionEasing: GLOBE_INERTIA_EASING,
              longitude: endLng,
              latitude: endLat
            },
            {
              isDragging: false,
              isPanning: true
            }
          );
          this._panHistory = [];
          return true;
        }
      }
    }

    this._panHistory = [];
    const newControllerState = this.controllerState.panEnd();
    this.updateViewport(newControllerState, null, {
      isDragging: false,
      isPanning: false
    });
    return true;
  }
}
