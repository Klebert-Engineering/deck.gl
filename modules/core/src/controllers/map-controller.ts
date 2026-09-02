// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {clamp} from '@math.gl/core';
import Controller, {
  type ControllerOptions,
  type ControllerProps,
  type InteractionState
} from './controller';
import ViewState, {
  CONSTRAINT_AROUND,
  type ConstraintAround,
  type ConstraintContext
} from './view-state';
import {applyRubberBand, getMaxBoundsExtents, getMaxBoundsRect} from './utils';
import {worldToLngLat, lngLatToWorld as _lngLatToWorld} from '@math.gl/web-mercator';
import assert from '../utils/assert';
import {mod} from '../utils/math-utils';
import {deepEqual} from '../utils/deep-equal';
import type {MjolnirEvent} from 'mjolnir.js';

import LinearInterpolator from '../transitions/linear-interpolator';
import TargetNavigationInterpolator, {
  type TargetNavigationTransitionContext
} from '../transitions/target-navigation-interpolator';
import type Viewport from '../viewports/viewport';
import WebMercatorViewport, {
  type WebMercatorTargetInfo,
  type WebMercatorTargetViewState
} from '../viewports/web-mercator-viewport';

const PITCH_MOUSE_THRESHOLD = 5;
const PITCH_ACCEL = 1.2;
const WEB_MERCATOR_TILE_SIZE = 512;
const WEB_MERCATOR_MAX_BOUNDS = [
  [-Infinity, -90],
  [Infinity, 90]
] satisfies ControllerProps['maxBounds'];
const ZOOM_RUBBER_BAND_RANGE = 1;
const TARGET_PIXEL_TOLERANCE = 0.1;
const TARGET_RADIUS_ABSOLUTE_TOLERANCE = 0.01;
const TARGET_RADIUS_RELATIVE_TOLERANCE = 1e-7;
const TARGET_NEAR_RELATIVE_EPSILON = 1e-6;
const TARGET_CENTER_Z_RELATIVE_TOLERANCE = 1e-10;
const TARGET_WHEEL_RELEASE_MS = 150;

type InternalMapControllerProps = ControllerProps &
  MapStateProps & {
    rotationPivot?: 'center' | '2d' | '3d';
    getAltitude?: (pos: [number, number]) => number | undefined;
    _targetNavigation?: boolean;
    getInteractionTarget?: GetMapInteractionTarget;
    constrainInteractionTargetViewState?: ConstrainMapInteractionTargetViewState;
    /** ViewManager-owned definition. Kept out of the exported controller contract. */
    _view?: {constructor: unknown; props?: Record<string, any>};
  };

type TargetViewStructure = {
  type: unknown;
  padding: unknown;
  repeat: unknown;
  nearZMultiplier: unknown;
  farZMultiplier: unknown;
  nearZ: unknown;
  farZ: unknown;
  projectionMatrix: number[] | null;
  fovy: unknown;
  altitude: unknown;
  orthographic: unknown;
  modelMatrix: number[] | null;
  worldOffset: unknown;
};

function getTargetViewStructure(props: InternalMapControllerProps): TargetViewStructure | null {
  const view = props._view;
  if (!view) {
    return null;
  }
  const viewProps = view.props || {};
  const projectionMatrix = viewProps.projectionMatrix;
  const modelMatrix = viewProps.modelMatrix ?? props['modelMatrix'];
  return {
    type: view.constructor,
    padding: viewProps.padding ? {...viewProps.padding} : null,
    repeat: viewProps.repeat ?? false,
    nearZMultiplier: viewProps.nearZMultiplier ?? props['nearZMultiplier'] ?? 0.1,
    farZMultiplier: viewProps.farZMultiplier ?? props['farZMultiplier'] ?? 1.01,
    nearZ: viewProps.nearZ ?? props['nearZ'] ?? null,
    farZ: viewProps.farZ ?? props['farZ'] ?? null,
    projectionMatrix: projectionMatrix ? Array.from(projectionMatrix) : null,
    fovy: viewProps.fovy ?? props['fovy'] ?? null,
    altitude: viewProps.altitude ?? props.altitude ?? 1.5,
    orthographic: viewProps.orthographic ?? false,
    modelMatrix: modelMatrix ? Array.from(modelMatrix) : null,
    worldOffset: viewProps.worldOffset ?? props['worldOffset'] ?? 0
  };
}

/** A numeric world coordinate and its view-local screen position. */
export type MapInteractionTarget = {
  coordinate: [longitude: number, latitude: number, altitude: number];
  screenPosition: [x: number, y: number];
  /**
   * Optional minimum physical camera-to-target distance in metres.
   *
   * The value is frozen for the target-navigation session. `0` disables the limit. If the
   * camera starts closer than the requested distance, zooming in cannot reduce the current
   * distance but does not move the camera outwards.
   */
  minimumTargetDistance?: number;
};

/** Target-anchored map operation being acquired. */
export type MapInteractionTargetOperation = 'pan' | 'zoom' | 'rotate' | 'pinch';

/** Input source that initiated target acquisition. */
export type MapInteractionTargetSource =
  | 'pointer'
  | 'touch'
  | 'trackpad'
  | 'wheel'
  | 'doubleClick'
  | 'keyboard';

/** Context supplied to an application's synchronous target provider. */
export type MapInteractionTargetContext = {
  /** Identifier of the view/controller that owns the interaction. */
  viewId: string;
  /** Camera operation being initiated. */
  operation: MapInteractionTargetOperation;
  /** Input source that initiated the operation. */
  source: MapInteractionTargetSource;
  /**
   * View-local acquisition pixel, or `null` for pointerless input. Pointer/touch drags report the
   * gesture origin; trackpad gestures report their first recognized sample.
   */
  screenPosition: [number, number] | null;
  /** Active immutable Web Mercator viewport. */
  viewport: WebMercatorViewport;
};

/** Synchronously resolves a fresh numeric target for the current rendered scene. */
export type GetMapInteractionTarget = (
  context: Readonly<MapInteractionTargetContext>
) => MapInteractionTarget | null;

/** Context supplied before core validates a target-relative camera candidate. */
export type MapInteractionTargetViewStateContext = {
  /** Identifier of the view/controller that owns the frozen target. */
  viewId: string;
  /** Operation that acquired the frozen target. */
  operation: MapInteractionTargetOperation;
  /** Input source that acquired the frozen target. */
  source: MapInteractionTargetSource;
  /** Frozen coordinate and desired view-local pixel for this candidate. */
  target: Readonly<MapInteractionTarget>;
  /** Frozen viewport from which this target-relative operation is measured. */
  sourceViewport: WebMercatorViewport;
  /** Last accepted canonical camera state. */
  currentViewState: Readonly<WebMercatorTargetViewState>;
  /** Direct-inverse candidate before ordinary map constraints and final validation. */
  requestedViewState: Readonly<WebMercatorTargetViewState>;
};

/** Optionally replaces a direct target-relative camera candidate before core validation. */
export type ConstrainMapInteractionTargetViewState = (
  context: Readonly<MapInteractionTargetViewStateContext>
) => WebMercatorTargetViewState | null;

/** Options understood by {@link MapController}. */
export type MapControllerOptions = ControllerOptions & {
  /** Rotation pivot behavior. Default `'center'`. */
  rotationPivot?: 'center' | '2d' | '3d';
  /** Enable experimental target-relative 3D navigation. Default `false`. */
  _targetNavigation?: boolean;
  /** Resolve an application-defined numeric interaction target synchronously. */
  getInteractionTarget?: GetMapInteractionTarget;
  /** Apply an application policy before core constraints and target validation. */
  constrainInteractionTargetViewState?: ConstrainMapInteractionTargetViewState;
};

/** The web mercator utility `lngLatToWorld` throws if invalid coordinates are provided.
 * This wrapper clamps user input to calculate common positions safely. */
function lngLatToWorld([lng, lat]: number[]): number[] {
  if (Math.abs(lat) > 90) {
    lat = Math.sign(lat) * 90;
  }
  if (Number.isFinite(lng)) {
    const [x, y] = _lngLatToWorld([lng, lat]);
    return [x, clamp(y, 0, WEB_MERCATOR_TILE_SIZE)];
  }
  const [, y] = _lngLatToWorld([0, lat]);
  return [lng, clamp(y, 0, WEB_MERCATOR_TILE_SIZE)];
}

function copyTargetViewState(value: WebMercatorTargetViewState): WebMercatorTargetViewState | null {
  if (
    !value ||
    !Number.isFinite(value.longitude) ||
    !Number.isFinite(value.latitude) ||
    !Number.isFinite(value.zoom) ||
    !Number.isFinite(value.bearing) ||
    !Number.isFinite(value.pitch) ||
    !Array.isArray(value.position) ||
    value.position.length !== 3 ||
    !value.position.every(Number.isFinite)
  ) {
    return null;
  }
  return {
    longitude: value.longitude,
    latitude: value.latitude,
    zoom: value.zoom,
    bearing: value.bearing,
    pitch: value.pitch,
    position: [...value.position]
  };
}

function freezeTargetViewState(
  value: WebMercatorTargetViewState
): Readonly<WebMercatorTargetViewState> {
  return Object.freeze({
    ...value,
    position: Object.freeze([...value.position]) as unknown as [number, number, number]
  });
}

export type MapStateProps = {
  /** Mapbox viewport properties */
  /** The width of the viewport */
  width: number;
  /** The height of the viewport */
  height: number;
  /** The latitude at the center of the viewport */
  latitude: number;
  /** The longitude at the center of the viewport */
  longitude: number;
  /** The tile zoom level of the map. */
  zoom: number;
  /** The bearing of the viewport in degrees */
  bearing?: number;
  /** The pitch of the viewport in degrees */
  pitch?: number;
  /**
   * Specify the altitude of the viewport camera
   * Unit: map heights, default 1.5
   * Non-public API, see https://github.com/mapbox/mapbox-gl-js/issues/1137
   */
  altitude?: number;
  /** Viewport position */
  position?: [number, number, number];

  /** Viewport constraints */
  maxZoom?: number;
  minZoom?: number;
  maxPitch?: number;
  minPitch?: number;

  /** Normalize viewport props to fit map height into viewport. Default `true` */
  normalize?: boolean;

  maxBounds?: ControllerProps['maxBounds'];
  maxBoundsPadding?: ControllerProps['maxBoundsPadding'];
  /** Enables elastic bounds and zoom constraints during interaction. Defaults to `false`. */
  rubberBand?: boolean;
};

export type MapStateInternal = {
  /** Interaction states, required to calculate change during transform */
  /* The point on map being grabbed when the operation first started */
  startPanLngLat?: [number, number];
  /* Center of the zoom when the operation first started */
  startZoomLngLat?: [number, number];
  /* Pointer position when rotation started */
  startRotatePos?: [number, number];
  /* The lng/lat/altitude point at the rotation pivot (where rotation started) */
  startRotateLngLat?: [number, number, number];
  /** Bearing when current perspective rotate operation started */
  startBearing?: number;
  /** Pitch when current perspective rotate operation started */
  startPitch?: number;
  /** Zoom when current zoom operation started */
  startZoom?: number;
  /** Numeric target snapshot retained by the active target-navigation session. */
  interactionTarget?: MapInteractionTarget;
  /** Canonical map state at target acquisition. */
  targetNavigationStartProps?: Required<MapStateProps>;
  /** Immutable perspective viewport at target acquisition. */
  targetNavigationStartViewport?: WebMercatorViewport;
  /** Immutable target metrics measured at acquisition. */
  targetNavigationStartTargetInfo?: Readonly<WebMercatorTargetInfo>;
  /** Controller-owned identity of the active target session. */
  targetNavigationSessionId?: number;
  /** Target's desired view-local screen position in the most recent accepted state. */
  targetNavigationScreenPosition?: [number, number];
  /** Raw pointer/touch origin, or first recognized trackpad sample, for absolute pan deltas. */
  targetNavigationInputOrigin?: [number, number];
  /** Constraint callback frozen for the active target session. */
  targetNavigationConstraint?: ConstrainMapInteractionTargetViewState;
  /** View and input identity frozen for the active target session. */
  targetNavigationViewId?: string;
  targetNavigationOperation?: MapInteractionTargetOperation;
  targetNavigationSource?: MapInteractionTargetSource;
};

/* Utils */

export class MapState extends ViewState<MapState, MapStateProps, MapStateInternal> {
  /* get optional altitude for rotation pivot
   *   - undefined: rotate around viewport center (no pivot point)
   *   - 0: rotate around pointer position at ground level
   *   - other value: rotate around pointer position at specified altitude
   */
  getAltitude?: (pos: [number, number]) => number | undefined;

  constructor(
    options: MapStateProps &
      MapStateInternal & {
        makeViewport: (props: Record<string, any>) => Viewport;
        getAltitude?: (pos: [number, number]) => number | undefined;
        constraintContext?: ConstraintContext;
      }
  ) {
    const {
      /** Mapbox viewport properties */
      /** The width of the viewport */
      width,
      /** The height of the viewport */
      height,
      /** The latitude at the center of the viewport */
      latitude,
      /** The longitude at the center of the viewport */
      longitude,
      /** The tile zoom level of the map. */
      zoom,
      /** The bearing of the viewport in degrees */
      bearing = 0,
      /** The pitch of the viewport in degrees */
      pitch = 0,
      /**
       * Specify the altitude of the viewport camera
       * Unit: map heights, default 1.5
       * Non-public API, see https://github.com/mapbox/mapbox-gl-js/issues/1137
       */
      altitude = 1.5,
      /** Viewport position */
      position = [0, 0, 0],

      /** Viewport constraints */
      maxZoom = 20,
      minZoom = 0,
      maxPitch = 60,
      minPitch = 0,

      /** Interaction states, required to calculate change during transform */
      /* The point on map being grabbed when the operation first started */
      startPanLngLat,
      /* Center of the zoom when the operation first started */
      startZoomLngLat,
      /* Pointer position when rotation started */
      startRotatePos,
      /* The lng/lat point at the rotation pivot (where rotation started) */
      startRotateLngLat,
      /** Bearing when current perspective rotate operation started */
      startBearing,
      /** Pitch when current perspective rotate operation started */
      startPitch,
      /** Zoom when current zoom operation started */
      startZoom,
      /** Numeric target snapshot retained by the active target-navigation session */
      interactionTarget,
      /** Canonical map state at target acquisition */
      targetNavigationStartProps,
      /** Perspective viewport and target metrics frozen at acquisition */
      targetNavigationStartViewport,
      targetNavigationStartTargetInfo,
      /** Controller-owned identity of the active target session */
      targetNavigationSessionId,
      /** Target's desired pixel in the most recent accepted state */
      targetNavigationScreenPosition,
      /** Raw input origin used to calculate absolute target-pan deltas */
      targetNavigationInputOrigin,
      /** Application candidate policy frozen for this target session */
      targetNavigationConstraint,
      /** View and input identity frozen for this target session */
      targetNavigationViewId,
      targetNavigationOperation,
      targetNavigationSource,

      /** Normalize viewport props to fit map height into viewport */
      normalize = true,
      rubberBand = false
    } = options;
    const {[CONSTRAINT_AROUND]: constraintAround} = options as typeof options & ConstraintAround;

    assert(Number.isFinite(longitude)); // `longitude` must be supplied
    assert(Number.isFinite(latitude)); // `latitude` must be supplied
    assert(Number.isFinite(zoom)); // `zoom` must be supplied

    const maxBounds = options.maxBounds || (normalize ? WEB_MERCATOR_MAX_BOUNDS : null);
    const maxBoundsPadding = options.maxBoundsPadding || null;

    super(
      {
        width,
        height,
        latitude,
        longitude,
        zoom,
        bearing,
        pitch,
        altitude,
        maxZoom,
        minZoom,
        maxPitch,
        minPitch,
        normalize,
        position,
        maxBounds,
        maxBoundsPadding,
        rubberBand,
        ...{[CONSTRAINT_AROUND]: constraintAround}
      },
      {
        startPanLngLat,
        startZoomLngLat,
        startRotatePos,
        startRotateLngLat,
        startBearing,
        startPitch,
        startZoom,
        interactionTarget,
        targetNavigationStartProps,
        targetNavigationStartViewport,
        targetNavigationStartTargetInfo,
        targetNavigationSessionId,
        targetNavigationScreenPosition,
        targetNavigationInputOrigin,
        targetNavigationConstraint,
        targetNavigationViewId,
        targetNavigationOperation,
        targetNavigationSource
      },
      options.makeViewport,
      options.constraintContext
    );

    this.getAltitude = options.getAltitude;
  }

  /** Returns a state carrying one immutable numeric interaction target. */
  withInteractionTarget(
    target: MapInteractionTarget,
    session?: {
      viewId: string;
      operation: MapInteractionTargetOperation;
      source: MapInteractionTargetSource;
      sessionId: number;
      inputOrigin?: [number, number] | null;
      constrainViewState?: ConstrainMapInteractionTargetViewState;
    }
  ): MapState {
    const coordinate = Object.freeze([...target.coordinate]) as unknown as [number, number, number];
    const screenPosition = Object.freeze([...target.screenPosition]) as unknown as [number, number];
    const interactionTarget = Object.freeze({
      coordinate,
      screenPosition,
      ...(target.minimumTargetDistance === undefined
        ? {}
        : {minimumTargetDistance: target.minimumTargetDistance})
    }) as MapInteractionTarget;
    const targetNavigationStartViewport = this._getTargetViewport() || undefined;
    const startTargetInfo = targetNavigationStartViewport?.getTargetInfo(coordinate);
    const targetNavigationStartTargetInfo = startTargetInfo
      ? Object.freeze({
          ...startTargetInfo,
          target: Object.freeze([...startTargetInfo.target]) as [number, number, number],
          projectedPosition: Object.freeze([...startTargetInfo.projectedPosition]) as [
            number,
            number,
            number
          ]
        })
      : undefined;
    return this._getUpdatedState({
      interactionTarget,
      targetNavigationStartProps: {...this.getViewportProps()},
      targetNavigationStartViewport,
      targetNavigationStartTargetInfo,
      targetNavigationSessionId: session?.sessionId,
      targetNavigationScreenPosition: [...screenPosition],
      targetNavigationInputOrigin: session?.inputOrigin
        ? [...session.inputOrigin]
        : [...screenPosition],
      targetNavigationConstraint: session?.constrainViewState,
      targetNavigationViewId: session?.viewId,
      targetNavigationOperation: session?.operation,
      targetNavigationSource: session?.source
    });
  }

  /** Returns a state without transient target-navigation bookkeeping. */
  withoutInteractionTarget(): MapState {
    return this._getUpdatedState({
      // A target session owns these gesture starts. Keeping any of them after a forced
      // cancellation would let a later stock move continue around the released 3D coordinate.
      startPanLngLat: null,
      startZoomLngLat: null,
      startZoom: null,
      startRotatePos: null,
      startRotateLngLat: null,
      startBearing: null,
      startPitch: null,
      interactionTarget: null,
      targetNavigationStartProps: null,
      targetNavigationStartViewport: null,
      targetNavigationStartTargetInfo: null,
      targetNavigationSessionId: null,
      targetNavigationScreenPosition: null,
      targetNavigationInputOrigin: null,
      targetNavigationConstraint: null,
      targetNavigationViewId: null,
      targetNavigationOperation: null,
      targetNavigationSource: null
    });
  }

  /**
   * Start panning
   * @param {[Number, Number]} pos - position on screen where the pointer grabs
   */
  panStart({pos}: {pos: [number, number]}, constraintContext?: ConstraintContext): MapState {
    return this._getUpdatedState(
      {
        startPanLngLat: this._unproject(pos)
      },
      constraintContext
    );
  }

  /**
   * Pan
   * @param {[Number, Number]} pos - position on screen where the pointer is
   * @param {[Number, Number], optional} startPos - where the pointer grabbed at
   *   the start of the operation. Must be supplied of `panStart()` was not called
   */
  pan(
    {pos, startPos}: {pos: [number, number]; startPos?: [number, number]},
    constraintContext?: ConstraintContext
  ): MapState {
    const state = this.getState();
    const interactionTarget = state.interactionTarget;
    if (interactionTarget) {
      const inputOrigin = state.targetNavigationInputOrigin || interactionTarget.screenPosition;
      const targetStartPosition = interactionTarget.screenPosition;
      return this._getTargetPanUpdatedState(
        [
          targetStartPosition[0] + pos[0] - inputOrigin[0],
          targetStartPosition[1] + pos[1] - inputOrigin[1]
        ],
        constraintContext
      );
    }

    const startPanLngLat = state.startPanLngLat || this._unproject(startPos);

    if (!startPanLngLat) {
      return this;
    }

    const viewport = this.makeViewport(this.getViewportProps());
    const newProps = viewport.panByPosition(startPanLngLat, pos);

    return this._getUpdatedState(newProps, constraintContext);
  }

  /**
   * End panning
   * Must call if `panStart()` was called
   */
  panEnd(constraintContext?: ConstraintContext): MapState {
    return this._getUpdatedState(
      {
        startPanLngLat: null
      },
      constraintContext
    );
  }

  /**
   * Start rotating
   * @param {[Number, Number]} pos - position on screen where the center is
   */
  rotateStart({pos}: {pos: [number, number]}, constraintContext?: ConstraintContext): MapState {
    const interactionTarget = this.getState().interactionTarget;
    if (interactionTarget) {
      const targetInfo = this._getTargetViewport()?.getTargetInfo(interactionTarget.coordinate);
      return this._getUpdatedState(
        {
          startRotatePos: pos,
          startRotateLngLat: targetInfo?.target || interactionTarget.coordinate,
          startBearing: this.getViewportProps().bearing,
          startPitch: this.getViewportProps().pitch
        },
        constraintContext
      );
    }

    const altitude = this.getAltitude?.(pos);

    return this._getUpdatedState(
      {
        startRotatePos: pos,
        startRotateLngLat: altitude !== undefined ? this._unproject3D(pos, altitude) : undefined,
        startBearing: this.getViewportProps().bearing,
        startPitch: this.getViewportProps().pitch
      },
      constraintContext
    );
  }

  /**
   * Rotate
   * @param {[Number, Number]} pos - position on screen where the center is
   */
  rotate(
    {
      pos,
      deltaAngleX = 0,
      deltaAngleY = 0
    }: {
      pos?: [number, number];
      deltaAngleX?: number;
      deltaAngleY?: number;
    },
    constraintContext?: ConstraintContext
  ): MapState {
    const {startRotatePos, startRotateLngLat, startBearing, startPitch} = this.getState();

    if (!startRotatePos || startBearing === undefined || startPitch === undefined) {
      return this;
    }
    let newRotation;
    if (pos) {
      newRotation = this._getNewRotation(pos, startRotatePos, startPitch, startBearing);
    } else {
      newRotation = {
        bearing: startBearing + deltaAngleX,
        pitch: startPitch + deltaAngleY
      };
    }

    // If we have a pivot point, adjust the camera position to keep the pivot point fixed
    if (startRotateLngLat) {
      if (this.getState().interactionTarget) {
        return this._getTargetPoseUpdatedState(newRotation, constraintContext);
      }
      const rotatedViewport = this.makeViewport({
        ...this.getViewportProps(),
        ...newRotation
      });
      // Use panByPosition3D if available (WebMercatorViewport), otherwise fall back to panByPosition
      const panMethod = 'panByPosition3D' in rotatedViewport ? 'panByPosition3D' : 'panByPosition';
      return this._getUpdatedState(
        {
          ...newRotation,
          ...rotatedViewport[panMethod](startRotateLngLat, startRotatePos)
        },
        constraintContext
      );
    }

    return this._getUpdatedState(newRotation, constraintContext);
  }

  /**
   * End rotating
   * Must call if `rotateStart()` was called
   */
  rotateEnd(constraintContext?: ConstraintContext): MapState {
    return this._getUpdatedState(
      {
        startRotatePos: null,
        startRotateLngLat: null,
        startBearing: null,
        startPitch: null
      },
      constraintContext
    );
  }

  /**
   * Start zooming
   * @param {[Number, Number]} pos - position on screen where the center is
   */
  zoomStart({pos}: {pos: [number, number]}, constraintContext?: ConstraintContext): MapState {
    return this._getUpdatedState(
      {
        startZoomLngLat: this._unproject(pos),
        startZoom: this.getViewportProps().zoom
      },
      constraintContext
    );
  }

  /**
   * Zoom
   * @param {[Number, Number]} pos - position on screen where the current center is
   * @param {[Number, Number]} startPos - the center position at
   *   the start of the operation. Must be supplied of `zoomStart()` was not called
   * @param {Number} scale - a number between [0, 1] specifying the accumulated
   *   relative scale.
   */
  zoom(
    {
      pos,
      startPos,
      scale
    }: {
      pos: [number, number];
      startPos?: [number, number];
      scale: number;
    },
    constraintContext?: ConstraintContext
  ): MapState {
    // Make sure we zoom around the current mouse position rather than map center
    let {startZoom, startZoomLngLat} = this.getState();

    if (this.getState().interactionTarget) {
      startZoom ??= this.getViewportProps().zoom;
      const zoom = this._constrainZoom(startZoom + Math.log2(scale));
      return this._getTargetPoseUpdatedState({zoom}, constraintContext);
    }

    if (!startZoomLngLat) {
      // We have two modes of zoom:
      // scroll zoom that are discrete events (transform from the current zoom level),
      // and pinch zoom that are continuous events (transform from the zoom level when
      // pinch started).
      // If startZoom state is defined, then use the startZoom state;
      // otherwise assume discrete zooming
      startZoom = this.getViewportProps().zoom;
      startZoomLngLat = this._unproject(startPos) || this._unproject(pos);
    }
    if (!startZoomLngLat) {
      return this;
    }

    return this._getUpdatedState(
      {
        zoom: (startZoom as number) + Math.log2(scale),
        [CONSTRAINT_AROUND]: {position: startZoomLngLat, screenPosition: pos}
      },
      constraintContext
    );
  }

  /** Applies the zoom and rotation components of one compound target gesture in one solve. */
  zoomRotate(
    {
      scale,
      deltaAngleX = 0,
      deltaAngleY = 0
    }: {scale: number; deltaAngleX?: number; deltaAngleY?: number},
    constraintContext?: ConstraintContext
  ): MapState {
    const {interactionTarget, startZoom, startBearing, startPitch} = this.getState();
    if (
      !interactionTarget ||
      startZoom === undefined ||
      startBearing === undefined ||
      startPitch === undefined
    ) {
      return this;
    }
    return this._getTargetPoseUpdatedState(
      {
        zoom: this._constrainZoom(startZoom + Math.log2(scale)),
        bearing: startBearing + deltaAngleX,
        pitch: startPitch + deltaAngleY
      },
      constraintContext
    );
  }

  /**
   * End zooming
   * Must call if `zoomStart()` was called
   */
  zoomEnd(constraintContext?: ConstraintContext): MapState {
    return this._getUpdatedState(
      {
        startZoomLngLat: null,
        startZoom: null
      },
      constraintContext
    );
  }

  zoomIn(speed: number = 2, constraintContext?: ConstraintContext): MapState {
    return this._zoomFromCenter(speed, constraintContext);
  }

  zoomOut(speed: number = 2, constraintContext?: ConstraintContext): MapState {
    return this._zoomFromCenter(1 / speed, constraintContext);
  }

  moveLeft(speed: number = 100, constraintContext?: ConstraintContext): MapState {
    return this._panFromCenter([speed, 0], constraintContext);
  }

  moveRight(speed: number = 100, constraintContext?: ConstraintContext): MapState {
    return this._panFromCenter([-speed, 0], constraintContext);
  }

  moveUp(speed: number = 100, constraintContext?: ConstraintContext): MapState {
    return this._panFromCenter([0, speed], constraintContext);
  }

  moveDown(speed: number = 100, constraintContext?: ConstraintContext): MapState {
    return this._panFromCenter([0, -speed], constraintContext);
  }

  rotateLeft(speed: number = 15, constraintContext?: ConstraintContext): MapState {
    const bearing = this.getViewportProps().bearing - speed;
    return this.getState().interactionTarget
      ? this._getTargetPoseUpdatedState({bearing}, constraintContext)
      : this._getUpdatedState({bearing}, constraintContext);
  }

  rotateRight(speed: number = 15, constraintContext?: ConstraintContext): MapState {
    const bearing = this.getViewportProps().bearing + speed;
    return this.getState().interactionTarget
      ? this._getTargetPoseUpdatedState({bearing}, constraintContext)
      : this._getUpdatedState({bearing}, constraintContext);
  }

  rotateUp(speed: number = 10, constraintContext?: ConstraintContext): MapState {
    const pitch = this.getViewportProps().pitch + speed;
    return this.getState().interactionTarget
      ? this._getTargetPoseUpdatedState({pitch}, constraintContext)
      : this._getUpdatedState({pitch}, constraintContext);
  }

  rotateDown(speed: number = 10, constraintContext?: ConstraintContext): MapState {
    const pitch = this.getViewportProps().pitch - speed;
    return this.getState().interactionTarget
      ? this._getTargetPoseUpdatedState({pitch}, constraintContext)
      : this._getUpdatedState({pitch}, constraintContext);
  }

  shortestPathFrom(viewState: MapState): MapStateProps {
    // const endViewStateProps = new this.ControllerState(endProps).shortestPathFrom(startViewstate);
    const fromProps = viewState.getViewportProps();
    const props = {...this.getViewportProps()};
    const {bearing, longitude} = props;

    if (Math.abs(bearing - fromProps.bearing) > 180) {
      props.bearing = bearing < 0 ? bearing + 360 : bearing - 360;
    }
    if (Math.abs(longitude - fromProps.longitude) > 180) {
      props.longitude = longitude < 0 ? longitude + 360 : longitude - 360;
    }
    return props;
  }

  // Apply any constraints (mathematical or defined by _viewportProps) to map state
  applyConstraints(
    props: Required<MapStateProps>,
    constraintContext?: ConstraintContext
  ): Required<MapStateProps> {
    const internalProps = props as typeof props & ConstraintAround;
    const constraintAround = internalProps[CONSTRAINT_AROUND];
    delete internalProps[CONSTRAINT_AROUND];
    // Ensure pitch is within specified range
    const {maxPitch, minPitch, pitch, bearing, normalize, maxBounds, rubberBand} = props;

    if (normalize) {
      if (bearing < -180 || bearing > 180) {
        props.bearing = mod(bearing + 180, 360) - 180;
      }
    }
    props.pitch = clamp(pitch, minPitch, maxPitch);

    const constrainedZoom = this._constrainZoom(props.zoom, props);
    const shouldRubberBand = rubberBand && constraintContext?.mode === 'elastic';
    props.zoom =
      constraintContext?.mode === 'preserve'
        ? props.zoom
        : shouldRubberBand
          ? applyRubberBand(props.zoom, constrainedZoom, ZOOM_RUBBER_BAND_RANGE)
          : constrainedZoom;

    // Resolve the geographic zoom anchor only after selecting the displayed zoom.
    if (constraintAround) {
      const viewport = this.makeViewport(props);
      Object.assign(
        props,
        viewport.panByPosition(constraintAround.position, constraintAround.screenPosition)
      );
    }

    if (normalize && (props.longitude < -180 || props.longitude > 180)) {
      props.longitude = mod(props.longitude + 180, 360) - 180;
    }

    if (maxBounds) {
      const maxBoundsRect = getMaxBoundsRect(props.width, props.height, props.maxBoundsPadding);
      // Resolve the semantic center through the viewport because view padding can
      // place it away from the canvas' geometric center.
      const viewport = this.makeViewport({...props, bearing: 0, pitch: 0});
      const screenExtents = getMaxBoundsExtents(
        viewport,
        [props.longitude, props.latitude],
        maxBoundsRect
      );
      const bl = lngLatToWorld(maxBounds[0]);
      const tr = lngLatToWorld(maxBounds[1]);
      // calculate center and zoom ranges at pitch=0 and bearing=0
      // to maintain visual stability when rotating
      const scale = 2 ** props.zoom;
      const minimumCenter = [
        bl[0] + screenExtents.left / scale,
        bl[1] + screenExtents.bottom / scale
      ];
      const maximumCenter = [
        tr[0] - screenExtents.right / scale,
        tr[1] - screenExtents.top / scale
      ];
      const center = lngLatToWorld([props.longitude, props.latitude]);
      const constrainedCenter = [
        clamp(center[0], minimumCenter[0], maximumCenter[0]),
        clamp(center[1], minimumCenter[1], maximumCenter[1])
      ];
      const displayedCenter = center.slice();
      // A negative target dimension is inverted and therefore has no legal interval.
      if (maxBoundsRect.width >= 0) {
        displayedCenter[0] =
          constraintContext?.mode === 'preserve'
            ? center[0]
            : shouldRubberBand
              ? applyRubberBand(center[0], constrainedCenter[0], maxBoundsRect.width / 2 / scale)
              : constrainedCenter[0];
      }
      if (maxBoundsRect.height >= 0) {
        displayedCenter[1] =
          constraintContext?.mode === 'preserve'
            ? center[1]
            : shouldRubberBand
              ? applyRubberBand(center[1], constrainedCenter[1], maxBoundsRect.height / 2 / scale)
              : constrainedCenter[1];
      }
      if (displayedCenter[0] !== center[0] || displayedCenter[1] !== center[1]) {
        const [displayedLongitude, displayedLatitude] = worldToLngLat(displayedCenter);
        if (displayedCenter[0] !== center[0]) {
          props.longitude = displayedLongitude;
        }
        if (displayedCenter[1] !== center[1]) {
          props.latitude = displayedLatitude;
        }
      }
    }

    return props;
  }

  /* Private methods */

  _constrainZoom(zoom: number, props?: Required<MapStateProps>): number {
    props ||= this.getViewportProps();
    const {maxZoom, maxBounds} = props;

    const shouldApplyMaxBounds = maxBounds !== null && props.width > 0 && props.height > 0;
    let {minZoom} = props;

    if (shouldApplyMaxBounds) {
      const maxBoundsRect = getMaxBoundsRect(props.width, props.height, props.maxBoundsPadding);
      const bl = lngLatToWorld(maxBounds[0]);
      const tr = lngLatToWorld(maxBounds[1]);
      const w = tr[0] - bl[0];
      const h = tr[1] - bl[1];
      // ignore bound size of 0 or Infinity
      if (maxBoundsRect.width > 0 && Number.isFinite(w) && w > 0) {
        minZoom = Math.max(minZoom, Math.log2(maxBoundsRect.width / w));
      }
      if (maxBoundsRect.height > 0 && Number.isFinite(h) && h > 0) {
        minZoom = Math.max(minZoom, Math.log2(maxBoundsRect.height / h));
      }
      if (minZoom > maxZoom) minZoom = maxZoom;
    }
    return clamp(zoom, minZoom, maxZoom);
  }

  _zoomFromCenter(scale, constraintContext?: ConstraintContext) {
    const targetScreenPosition = this.getState().targetNavigationScreenPosition;
    if (this.getState().interactionTarget && targetScreenPosition) {
      return this.zoom({pos: targetScreenPosition, scale}, constraintContext);
    }
    const {width, height} = this.getViewportProps();
    return this.zoom(
      {
        pos: [width / 2, height / 2],
        scale
      },
      constraintContext
    );
  }

  _panFromCenter(offset, constraintContext?: ConstraintContext) {
    const state = this.getState();
    const interactionTarget = state.interactionTarget;
    const targetScreenPosition = state.targetNavigationScreenPosition;
    if (interactionTarget && targetScreenPosition) {
      const screenPosition: [number, number] = [
        targetScreenPosition[0] + offset[0],
        targetScreenPosition[1] + offset[1]
      ];
      return this._getTargetPanUpdatedState(screenPosition, constraintContext);
    }
    const {width, height} = this.getViewportProps();
    return this.pan(
      {
        startPos: [width / 2, height / 2],
        pos: [width / 2 + offset[0], height / 2 + offset[1]]
      },
      constraintContext
    );
  }

  _getUpdatedState(newProps, constraintContext?: ConstraintContext): MapState {
    // @ts-ignore
    return new this.constructor({
      makeViewport: this.makeViewport,
      ...this.getViewportProps(),
      ...this.getState(),
      ...newProps,
      constraintContext
    });
  }

  /** Applies a target-aware planar translation using the frozen operation-start viewport. */
  _getTargetPanUpdatedState(
    screenPosition: [number, number],
    constraintContext?: ConstraintContext
  ): MapState {
    const state = this.getState();
    const sourceViewport = state.targetNavigationStartViewport;
    const sourceTargetInfo = state.targetNavigationStartTargetInfo;
    if (!state.interactionTarget || !sourceViewport || !sourceTargetInfo) {
      return this;
    }

    const requestedViewState = sourceViewport.getTargetPanViewState({
      target: sourceTargetInfo.target,
      screenPosition
    });
    if (!requestedViewState) {
      return this;
    }
    const constrainedViewState = this._applyTargetViewStateConstraint(
      requestedViewState,
      screenPosition
    );
    if (!constrainedViewState) {
      return this;
    }

    const candidate = this._getTargetUpdatedState(
      constrainedViewState,
      screenPosition,
      undefined,
      constraintContext
    );
    if (candidate === this) {
      return this;
    }

    const candidateViewport = candidate._getTargetViewport();
    if (!candidateViewport) {
      return this;
    }
    const centerZTolerance =
      TARGET_CENTER_Z_RELATIVE_TOLERANCE *
      Math.max(1, Math.abs(sourceViewport.center[2]), Math.abs(candidateViewport.center[2]));
    const bearingDelta = Math.abs(
      mod(candidateViewport.bearing - sourceViewport.bearing + 180, 360) - 180
    );
    if (
      Math.abs(candidateViewport.center[2] - sourceViewport.center[2]) > centerZTolerance ||
      Math.abs(candidateViewport.zoom - sourceViewport.zoom) > TARGET_CENTER_Z_RELATIVE_TOLERANCE ||
      Math.abs(candidateViewport.pitch - sourceViewport.pitch) >
        TARGET_CENTER_Z_RELATIVE_TOLERANCE ||
      bearingDelta > TARGET_CENTER_Z_RELATIVE_TOLERANCE
    ) {
      return this;
    }
    return candidate;
  }

  /** Applies a target-relative pose using the frozen operation-start viewport. */
  _getTargetPoseUpdatedState(
    pose: {bearing?: number; pitch?: number; zoom?: number},
    constraintContext?: ConstraintContext,
    expectedDistanceOverride?: number,
    screenPositionOverride?: readonly [number, number]
  ): MapState {
    const state = this.getState();
    const interactionTarget = state.interactionTarget;
    const startProps = state.targetNavigationStartProps;
    const screenPosition = screenPositionOverride
      ? ([...screenPositionOverride] as [number, number])
      : state.targetNavigationScreenPosition;
    if (!interactionTarget || !startProps || !screenPosition) {
      return this;
    }

    const currentProps = this.getViewportProps();
    const zoom = this._constrainZoom(pose.zoom ?? currentProps.zoom);
    const pitch = clamp(
      pose.pitch ?? currentProps.pitch,
      currentProps.minPitch,
      currentProps.maxPitch
    );
    const bearing = pose.bearing ?? currentProps.bearing;
    const sourceViewport = state.targetNavigationStartViewport;
    const sourceTargetInfo = state.targetNavigationStartTargetInfo;
    if (!sourceViewport || !sourceTargetInfo) {
      return this;
    }

    const targetViewState = sourceViewport.getTargetViewState({
      target: sourceTargetInfo.target,
      screenPosition,
      bearing,
      pitch,
      zoom,
      minimumTargetDistance: interactionTarget.minimumTargetDistance
    });
    if (!targetViewState) {
      return this;
    }

    const constrainedViewState = this._applyTargetViewStateConstraint(
      targetViewState,
      screenPosition
    );
    if (!constrainedViewState) {
      return this;
    }

    const expectedDistance =
      expectedDistanceOverride !== undefined
        ? expectedDistanceOverride * 2 ** (targetViewState.zoom - constrainedViewState.zoom)
        : sourceTargetInfo.targetDistance * 2 ** (startProps.zoom - constrainedViewState.zoom);
    return this._getTargetUpdatedState(
      constrainedViewState,
      screenPosition,
      expectedDistance,
      constraintContext
    );
  }

  /** Applies the application target policy before ordinary MapState constraints. */
  private _applyTargetViewStateConstraint(
    requestedViewState: WebMercatorTargetViewState,
    screenPosition: [number, number]
  ): WebMercatorTargetViewState | null {
    const state = this.getState();
    const interactionTarget = state.interactionTarget;
    const sourceViewport = state.targetNavigationStartViewport;
    if (!interactionTarget || !sourceViewport) {
      return null;
    }
    if (!state.targetNavigationConstraint) {
      return requestedViewState;
    }

    const candidateTarget = Object.freeze({
      coordinate: interactionTarget.coordinate,
      screenPosition: Object.freeze([...screenPosition]) as [number, number],
      ...(interactionTarget.minimumTargetDistance === undefined
        ? {}
        : {minimumTargetDistance: interactionTarget.minimumTargetDistance})
    }) as Readonly<MapInteractionTarget>;
    const applicationViewState = state.targetNavigationConstraint(
      Object.freeze({
        viewId: state.targetNavigationViewId || '',
        operation: state.targetNavigationOperation || 'zoom',
        source: state.targetNavigationSource || 'pointer',
        target: candidateTarget,
        sourceViewport,
        currentViewState: freezeTargetViewState(this._toTargetViewState(this.getViewportProps())),
        requestedViewState: freezeTargetViewState(requestedViewState)
      })
    );
    return applicationViewState && copyTargetViewState(applicationViewState);
  }

  private _toTargetViewState(props: Required<MapStateProps>): WebMercatorTargetViewState {
    return {
      longitude: props.longitude,
      latitude: props.latitude,
      zoom: props.zoom,
      bearing: props.bearing,
      pitch: props.pitch,
      position: [...props.position]
    };
  }

  /** Applies ordinary constraints, then validates target-relative camera invariants. */
  _getTargetUpdatedState(
    newProps: Record<string, any>,
    screenPosition: [number, number],
    expectedDistance?: number,
    constraintContext?: ConstraintContext
  ): MapState {
    const interactionTarget = this.getState().interactionTarget;
    if (!interactionTarget) {
      return this._getUpdatedState(newProps, constraintContext);
    }

    const candidate = this._getUpdatedState(
      {...newProps, targetNavigationScreenPosition: [...screenPosition]},
      constraintContext
    );
    const viewport = candidate._getTargetViewport();
    const targetInfo = viewport?.getTargetInfo(interactionTarget.coordinate);
    if (
      !targetInfo?.isValid ||
      targetInfo.cameraDepth < targetInfo.near * (1 + TARGET_NEAR_RELATIVE_EPSILON)
    ) {
      return this;
    }

    const pixelError = Math.hypot(
      targetInfo.projectedPosition[0] - screenPosition[0],
      targetInfo.projectedPosition[1] - screenPosition[1]
    );
    if (!Number.isFinite(pixelError) || pixelError > TARGET_PIXEL_TOLERANCE) {
      return this;
    }

    if (expectedDistance !== undefined) {
      const radiusTolerance = Math.max(
        TARGET_RADIUS_ABSOLUTE_TOLERANCE,
        TARGET_RADIUS_RELATIVE_TOLERANCE * expectedDistance
      );
      if (
        !Number.isFinite(expectedDistance) ||
        Math.abs(targetInfo.targetDistance - expectedDistance) > radiusTolerance
      ) {
        return this;
      }
    }

    const minimumTargetDistance = interactionTarget.minimumTargetDistance;
    const startTargetDistance = this.getState().targetNavigationStartTargetInfo?.targetDistance;
    if (
      minimumTargetDistance !== undefined &&
      minimumTargetDistance > 0 &&
      startTargetDistance !== undefined
    ) {
      // Never jump a camera that acquired its target inside the configured limit outwards. Such
      // sessions instead preserve their acquisition distance as the effective floor.
      const sessionMinimum = Math.min(minimumTargetDistance, startTargetDistance);
      const distanceTolerance = Math.max(
        TARGET_RADIUS_ABSOLUTE_TOLERANCE,
        TARGET_RADIUS_RELATIVE_TOLERANCE * sessionMinimum
      );
      if (
        !Number.isFinite(targetInfo.targetDistance) ||
        targetInfo.targetDistance < sessionMinimum - distanceTolerance
      ) {
        return this;
      }
    }

    return candidate;
  }

  /** Returns a supported perspective Web Mercator viewport for target operations. */
  _getTargetViewport(
    props: Required<MapStateProps> = this.getViewportProps()
  ): WebMercatorViewport | null {
    const viewport = this.makeViewport(props);
    return viewport instanceof WebMercatorViewport && viewport.supportsTargetNavigation
      ? viewport
      : null;
  }

  _unproject(pos?: [number, number]): [number, number] | undefined {
    const viewport = this.makeViewport(this.getViewportProps());
    // @ts-ignore
    return pos && viewport.unproject(pos);
  }

  _unproject3D(pos: [number, number], altitude: number): [number, number, number] {
    const viewport = this.makeViewport(this.getViewportProps());
    return viewport.unproject(pos, {targetZ: altitude}) as [number, number, number];
  }

  _getNewRotation(
    pos: [number, number],
    startPos: [number, number],
    startPitch: number,
    startBearing: number
  ): {
    pitch: number;
    bearing: number;
  } {
    const deltaX = pos[0] - startPos[0];
    const deltaY = pos[1] - startPos[1];
    const centerY = pos[1];
    const startY = startPos[1];
    const {width, height} = this.getViewportProps();

    const deltaScaleX = deltaX / width;
    let deltaScaleY = 0;

    if (deltaY > 0) {
      if (Math.abs(height - startY) > PITCH_MOUSE_THRESHOLD) {
        // Move from 0 to -1 as we drag upwards
        deltaScaleY = (deltaY / (startY - height)) * PITCH_ACCEL;
      }
    } else if (deltaY < 0) {
      if (startY > PITCH_MOUSE_THRESHOLD) {
        // Move from 0 to 1 as we drag upwards
        deltaScaleY = 1 - centerY / startY;
      }
    }
    // clamp deltaScaleY to [-1, 1] so that rotation is constrained between minPitch and maxPitch.
    // deltaScaleX does not need to be clamped as bearing does not have constraints.
    deltaScaleY = clamp(deltaScaleY, -1, 1);

    const {minPitch, maxPitch} = this.getViewportProps();

    const bearing = startBearing + 180 * deltaScaleX;
    let pitch = startPitch;
    if (deltaScaleY > 0) {
      // Gradually increase pitch
      pitch = startPitch + deltaScaleY * (maxPitch - startPitch);
    } else if (deltaScaleY < 0) {
      // Gradually decrease pitch
      pitch = startPitch - deltaScaleY * (minPitch - startPitch);
    }

    return {
      pitch,
      bearing
    };
  }
}

export default class MapController extends Controller<MapState> {
  ControllerState = MapState;

  transition = {
    transitionDuration: 300,
    transitionInterpolator: new LinearInterpolator({
      transitionProps: {
        compare: ['longitude', 'latitude', 'zoom', 'bearing', 'pitch', 'position'],
        required: ['longitude', 'latitude', 'zoom']
      }
    })
  };

  dragMode: 'pan' | 'rotate' = 'pan';

  /**
   * Rotation pivot behavior:
   * - 'center': Rotate around viewport center (default)
   * - '2d': Rotate around pointer position at ground level (z=0)
   * - '3d': Rotate around 3D picked point (requires pickPosition callback)
   */
  protected rotationPivot: 'center' | '2d' | '3d' = 'center';

  protected targetNavigation: boolean = false;
  protected getInteractionTarget?: GetMapInteractionTarget;
  protected constrainInteractionTargetViewState?: ConstrainMapInteractionTargetViewState;

  private _activeTarget: MapInteractionTarget | null = null;
  private _activeTargetOwners = new Set<'pan' | 'zoom' | 'rotate' | 'transition' | 'wheel'>();
  private _wheelTargetTimer: ReturnType<typeof setTimeout> | null = null;
  private _targetSessionGeneration = 0;
  private _configurationRevision = 0;
  private _targetConstraintDepth = 0;
  private _activeTargetViewStructure: TargetViewStructure | null = null;

  setProps(props: InternalMapControllerProps) {
    if (this._targetConstraintDepth > 0) {
      throw new Error(
        'MapController.setProps cannot be called synchronously from constrainInteractionTargetViewState'
      );
    }
    this._configurationRevision++;
    this.rotationPivot = props.rotationPivot || 'center';

    const wasEnabled = this.targetNavigation;
    this.targetNavigation = props._targetNavigation ?? false;
    this.getInteractionTarget = props.getInteractionTarget;
    this.constrainInteractionTargetViewState = props.constrainInteractionTargetViewState;
    if (wasEnabled && !this.targetNavigation) {
      this._releaseAllTargets(true);
    }
    // this will be passed to MapState constructor
    props.getAltitude = this._getAltitude;
    props.position = props.position || [0, 0, 0];
    props.maxBounds =
      props.maxBounds || (props.normalize === false ? null : WEB_MERCATOR_MAX_BOUNDS);

    if (
      this._activeTarget &&
      (!this._areTargetViewportDimensionsEqual(props) ||
        !deepEqual(this._activeTargetViewStructure, getTargetViewStructure(props), -1))
    ) {
      this._releaseAllTargets(true);
    }
    super.setProps(props);
    if (!this.targetNavigation) {
      this._cancelTargetTransition();
    }
  }

  protected updateViewport(
    newControllerState: MapState,
    extraProps: Record<string, any> | null = null,
    interactionState: InteractionState = {}
  ): void {
    const targetSessionId = newControllerState.getState().targetNavigationSessionId;
    if (
      targetSessionId !== undefined &&
      targetSessionId !== null &&
      (targetSessionId !== this._targetSessionGeneration || !this._activeTarget)
    ) {
      return;
    }
    extraProps = this._getTargetTransitionProps(newControllerState, extraProps);

    // Publish only the numeric target coordinate. Applications retain any semantic identity.
    const state = newControllerState.getState();
    if (state.interactionTarget) {
      interactionState = {
        ...interactionState,
        interactionTargetPosition: [...state.interactionTarget.coordinate]
      };
      const isTargetRotation =
        (this._activeTargetOwners.has('rotate') && interactionState.isDragging !== false) ||
        (state.targetNavigationOperation === 'rotate' && interactionState.isRotating === true);
      if (isTargetRotation) {
        interactionState.rotationPivotPosition = [...state.interactionTarget.coordinate];
      } else {
        interactionState.rotationPivotPosition = undefined;
      }
    } else if (interactionState.isDragging && state.startRotateLngLat) {
      // Retain the established rotation-pivot field for compatibility when target navigation is
      // not active.
      interactionState = {
        ...interactionState,
        rotationPivotPosition: state.startRotateLngLat
      };
    } else if (interactionState.isDragging === false) {
      // Clear pivot when drag ends
      interactionState = {...interactionState, rotationPivotPosition: undefined};
    }

    super.updateViewport(newControllerState, extraProps, interactionState);
  }

  finalize(): void {
    this._releaseAllTargets(true);
    super.finalize();
  }

  handleEvent(event: MjolnirEvent): boolean {
    try {
      return super.handleEvent(event);
    } catch (error) {
      this._releaseAllTargets(true);
      throw error;
    }
  }

  updateTransition(): void {
    try {
      super.updateTransition();
    } catch (error) {
      this._releaseAllTargets(true);
      throw error;
    }
  }

  /** Resolves one fresh numeric target. A configured provider is authoritative. */
  protected resolveInteractionTarget(
    screenPosition: [number, number] | null,
    operation: MapInteractionTargetOperation,
    source: MapInteractionTargetSource
  ): MapInteractionTarget | null {
    // Elastic MapState constraints require a separate target-aware rebound definition. Until that
    // contract is implemented, preserve the complete stock rubber-band lifecycle.
    if (!this.targetNavigation || this.props.rubberBand) {
      return null;
    }
    const viewport = this.makeViewport(this.props);
    if (!(viewport instanceof WebMercatorViewport) || !viewport.supportsTargetNavigation) {
      return null;
    }

    const configurationRevision = this._configurationRevision;
    const provider = this.getInteractionTarget;
    let resolved: MapInteractionTarget | null = null;
    if (provider) {
      resolved = provider({
        viewId: this.props.id,
        operation,
        source,
        screenPosition: screenPosition && [...screenPosition],
        viewport
      });
    } else if (screenPosition && this.pickPosition) {
      const picked = this.pickPosition(
        this.props.x + screenPosition[0],
        this.props.y + screenPosition[1]
      );
      if (picked?.coordinate && picked.coordinate.length >= 3) {
        resolved = {
          coordinate: picked.coordinate.slice(0, 3) as [number, number, number],
          screenPosition: [...screenPosition]
        };
      }
    }

    if (
      configurationRevision !== this._configurationRevision ||
      !this.targetNavigation ||
      provider !== this.getInteractionTarget
    ) {
      return null;
    }

    return this._copyValidTarget(resolved, viewport);
  }

  /** Whether target navigation currently owns an acquired numeric coordinate. */
  protected hasActiveInteractionTarget(): boolean {
    return Boolean(this._activeTarget);
  }

  protected _onPanStart(event): boolean {
    const currentPosition = this.getCenter(event);
    const acquisitionPosition = this._getGestureAcquisitionPosition(event);
    if (
      !this._isTargetPositionInBounds(currentPosition) ||
      !this._isTargetPositionInBounds(acquisitionPosition) ||
      event.handled
    ) {
      return false;
    }
    let alternateMode = this.isFunctionKeyPressed(event) || event.rightButton || false;
    if (this.invertPan || this.dragMode === 'pan') {
      alternateMode = !alternateMode;
    }
    const operation = alternateMode ? 'pan' : 'rotate';
    const sourceEnabled = event.pointerType !== 'trackpad' || this.trackpadGesture;
    if (
      sourceEnabled &&
      ((operation === 'pan' && this.dragPan) || (operation === 'rotate' && this.dragRotate))
    ) {
      const source: MapInteractionTargetSource =
        event.pointerType === 'trackpad'
          ? 'trackpad'
          : event.pointerType === 'touch'
            ? 'touch'
            : 'pointer';
      this._acquireTarget(operation, source, acquisitionPosition);
    }
    return super._onPanStart(event);
  }

  protected _onPanMoveEnd(event): boolean {
    const handled = super._onPanMoveEnd(event);
    if (handled) {
      if (this._activeTarget && this.transitionManager.transition.inProgress) {
        this._activeTargetOwners.add('transition');
      }
      this._releaseTargetOwner('pan');
    }
    return handled;
  }

  protected _onPanRotateEnd(event): boolean {
    const handled = super._onPanRotateEnd(event);
    if (handled) {
      if (this._activeTarget && this.transitionManager.transition.inProgress) {
        this._activeTargetOwners.add('transition');
      }
      this._releaseTargetOwner('rotate');
    }
    return handled;
  }

  protected _onMultiPanStart(event): boolean {
    const currentPos = this.getCenter(event);
    const isTrackpad = event.pointerType === 'trackpad';
    const pos = this._getGestureAcquisitionPosition(event);
    const modeEnabled =
      this.multiTouchDrag === 'pan'
        ? this.dragPan
        : this.multiTouchDrag === 'rotate' && this.dragRotate;
    const sourceEnabled =
      event.pointerType === 'touch' || (event.pointerType === 'trackpad' && this.trackpadGesture);
    if (
      sourceEnabled &&
      modeEnabled &&
      this._isTargetPositionInBounds(currentPos) &&
      this._isTargetPositionInBounds(pos) &&
      !event.handled
    ) {
      this._acquireTarget(this.multiTouchDrag!, isTrackpad ? 'trackpad' : 'touch', pos);
    }
    return super._onMultiPanStart(event);
  }

  protected _onPinchStart(event): boolean {
    const pos = this.getCenter(event);
    const source: MapInteractionTargetSource =
      event.pointerType === 'trackpad' ? 'trackpad' : 'touch';
    const owners: Array<'zoom' | 'rotate'> = [
      ...(this.touchZoom ? (['zoom'] as const) : []),
      ...(this.touchRotate ? (['rotate'] as const) : [])
    ];
    let acquired = false;
    if (owners.length > 0 && this._isTargetPositionInBounds(pos) && !event.handled) {
      this._acquireTarget('pinch', source, pos, owners);
      acquired = Boolean(this._activeTarget);
    }
    const handled = super._onPinchStart(event);
    if (!handled && acquired) {
      this._releaseAllTargets(true);
    }
    return handled;
  }

  protected _onPinch(event): boolean {
    if (!this._activeTarget || !this.touchZoom || !this.touchRotate) {
      return super._onPinch(event);
    }
    if (!this.isDragging()) {
      return false;
    }
    const newControllerState = this.controllerState.zoomRotate(
      {
        scale: event.scale,
        deltaAngleX: (this._startPinchRotation || 0) - event.rotation
      },
      this._getConstraintContext('zoom', 'update')
    );
    this.updateViewport(
      newControllerState,
      {transitionDuration: 0},
      {
        isDragging: true,
        isPanning: true,
        isZooming: true,
        isRotating: true
      }
    );
    this._lastPinchEvent = event;
    return true;
  }

  protected _onPinchEnd(event): boolean {
    const handled = super._onPinchEnd(event);
    if (handled) {
      if (this._activeTarget && this.transitionManager.transition.inProgress) {
        this._activeTargetOwners.add('transition');
      }
      this._releaseTargetOwner('zoom');
      this._releaseTargetOwner('rotate');
    }
    return handled;
  }

  protected _onDoubleClickDragStart(event): boolean {
    const pos = this.getCenter(event);
    if (this.doubleClickDragZoom && this._isTargetPositionInBounds(pos) && !event.handled) {
      this._acquireTarget('zoom', 'doubleClick', pos);
    }
    return super._onDoubleClickDragStart(event);
  }

  protected _onDoubleClickDragEnd(event): boolean {
    const handled = super._onDoubleClickDragEnd(event);
    if (handled) {
      if (this._activeTarget && this.transitionManager.transition.inProgress) {
        this._activeTargetOwners.add('transition');
      }
      this._releaseTargetOwner('zoom');
    }
    return handled;
  }

  protected _onWheel(event): boolean {
    if (this.scrollZoom && !(this.trackpadGesture && event.device !== 'mouse')) {
      const pos = this.getCenter(event);
      if (this._isTargetPositionInBounds(pos) && !event.handled) {
        this._acquireWheelTarget(pos);
      }
    }
    return super._onWheel(event);
  }

  protected _onDoubleClick(event): boolean {
    const pos = this.getCenter(event);
    if (
      this.doubleClickZoom &&
      Date.now() >= this._suppressDoubleClickUntil &&
      this._isTargetPositionInBounds(pos) &&
      !event.handled
    ) {
      this._acquireTarget('zoom', 'doubleClick', pos, ['transition']);
    }
    const handled = super._onDoubleClick(event);
    if (!handled || !this.transitionManager.transition.inProgress) {
      this._releaseTargetOwner('transition');
    }
    return handled;
  }

  protected _onKeyDown(event): boolean {
    if (!this.keyboard) {
      return super._onKeyDown(event);
    }
    const code = event.srcEvent.code;
    if (
      code !== 'Minus' &&
      code !== 'Equal' &&
      code !== 'ArrowLeft' &&
      code !== 'ArrowRight' &&
      code !== 'ArrowUp' &&
      code !== 'ArrowDown'
    ) {
      return super._onKeyDown(event);
    }
    const operation: MapInteractionTargetOperation =
      code === 'Minus' || code === 'Equal'
        ? 'zoom'
        : this.isFunctionKeyPressed(event)
          ? 'rotate'
          : 'pan';
    const target = this._acquireTarget(operation, 'keyboard', null, ['transition']);
    let handled: boolean;
    if (target && (code === 'Minus' || code === 'Equal') && this.isFunctionKeyPressed(event)) {
      const {zoomSpeed = 2} = this.keyboard === true ? {} : this.keyboard;
      const speed = zoomSpeed * zoomSpeed;
      const newControllerState =
        code === 'Minus' ? this.controllerState.zoomOut(speed) : this.controllerState.zoomIn(speed);
      this.updateViewport(newControllerState, this._getTransitionProps(), {isZooming: true});
      handled = true;
    } else {
      handled = super._onKeyDown(event);
    }
    if (!handled || !this.transitionManager.transition.inProgress) {
      this._releaseTargetOwner('transition');
    }
    return handled;
  }

  private _copyValidTarget(
    target: MapInteractionTarget | null,
    viewport: WebMercatorViewport
  ): MapInteractionTarget | null {
    if (
      !target ||
      !Array.isArray(target.coordinate) ||
      target.coordinate.length !== 3 ||
      !target.coordinate.every(Number.isFinite) ||
      !Array.isArray(target.screenPosition) ||
      target.screenPosition.length !== 2 ||
      !target.screenPosition.every(Number.isFinite) ||
      (target.minimumTargetDistance !== undefined &&
        (!Number.isFinite(target.minimumTargetDistance) || target.minimumTargetDistance < 0))
    ) {
      return null;
    }
    const targetInfo = viewport.getTargetInfo(target.coordinate);
    if (
      !targetInfo?.isVisible ||
      targetInfo.cameraDepth < targetInfo.near * (1 + TARGET_NEAR_RELATIVE_EPSILON)
    ) {
      return null;
    }
    const pixelError = Math.hypot(
      targetInfo.projectedPosition[0] - target.screenPosition[0],
      targetInfo.projectedPosition[1] - target.screenPosition[1]
    );
    if (pixelError > TARGET_PIXEL_TOLERANCE) {
      return null;
    }
    return {
      coordinate: [...targetInfo.target],
      screenPosition: [...target.screenPosition],
      ...(target.minimumTargetDistance === undefined
        ? {}
        : {minimumTargetDistance: target.minimumTargetDistance})
    };
  }

  private _isTargetPositionInBounds(pos: [number, number]): boolean {
    return pos[0] >= 0 && pos[0] <= this.props.width && pos[1] >= 0 && pos[1] <= this.props.height;
  }

  /** Returns the pointer/touch origin, or the first recognized trackpad sample. */
  private _getGestureAcquisitionPosition(event): [number, number] {
    if (event.pointerType === 'trackpad') {
      return this.getCenter(event);
    }
    const deltaX = Number.isFinite(event.deltaX) ? event.deltaX : 0;
    const deltaY = Number.isFinite(event.deltaY) ? event.deltaY : 0;
    return this.getCenter({
      ...event,
      offsetCenter: {
        x: event.offsetCenter.x - deltaX,
        y: event.offsetCenter.y - deltaY
      }
    });
  }

  private _acquireTarget(
    operation: MapInteractionTargetOperation,
    source: MapInteractionTargetSource,
    screenPosition: [number, number] | null,
    owners: Array<'pan' | 'zoom' | 'rotate' | 'transition' | 'wheel'> = [
      operation === 'pinch' ? 'zoom' : operation
    ] as Array<'pan' | 'zoom' | 'rotate' | 'transition' | 'wheel'>
  ): MapInteractionTarget | null {
    if (this._activeTarget) {
      const reuseActiveTarget =
        owners.length === 1 && owners[0] === 'wheel' && this._activeTargetOwners.has('wheel');
      if (reuseActiveTarget) {
        for (const owner of owners) this._activeTargetOwners.add(owner);
        return this._activeTarget;
      }
      // An active transition is a completed input session. A new gesture must acquire a fresh
      // scene target; only an explicitly continued wheel burst may reuse its frozen snapshot.
      this._releaseAllTargets(true);
    }

    try {
      const configurationRevision = this._configurationRevision;
      const target = this.resolveInteractionTarget(screenPosition, operation, source);
      if (
        !target ||
        !this.targetNavigation ||
        configurationRevision !== this._configurationRevision
      ) {
        return null;
      }
      this._activeTarget = target;
      this._targetSessionGeneration++;
      this._activeTargetViewStructure = getTargetViewStructure(
        this.props as InternalMapControllerProps
      );
      for (const owner of owners) this._activeTargetOwners.add(owner);
      this._installTargetState(target, operation, source, screenPosition);
      return target;
    } catch (error) {
      this._releaseAllTargets(true);
      this._setInteractionState({
        interactionTargetPosition: undefined,
        rotationPivotPosition: undefined
      });
      throw error;
    }
  }

  private _acquireWheelTarget(screenPosition: [number, number]): MapInteractionTarget | null {
    if (this._activeTargetOwners.has('wheel')) {
      this._acquireTarget('zoom', 'wheel', screenPosition, ['wheel']);
    } else {
      this._acquireTarget('zoom', 'wheel', screenPosition, ['wheel']);
    }
    if (this._activeTarget) {
      this._activeTargetOwners.add('transition');
    }
    if (this._wheelTargetTimer) {
      clearTimeout(this._wheelTargetTimer);
    }
    this._wheelTargetTimer = setTimeout(() => {
      this._wheelTargetTimer = null;
      this._releaseTargetOwner('wheel');
      if (!this.transitionManager.transition.inProgress) {
        this._releaseTargetOwner('transition');
      }
    }, TARGET_WHEEL_RELEASE_MS);
    return this._activeTarget;
  }

  private _installTargetState(
    target: MapInteractionTarget,
    operation: MapInteractionTargetOperation,
    source: MapInteractionTargetSource,
    inputOrigin: [number, number] | null
  ): void {
    const constraint = this.constrainInteractionTargetViewState;
    const state = this.controllerState.withInteractionTarget(target, {
      viewId: this.props.id,
      operation,
      source,
      sessionId: this._targetSessionGeneration,
      inputOrigin,
      constrainViewState: constraint
        ? context => {
            this._targetConstraintDepth++;
            try {
              return constraint(context);
            } finally {
              this._targetConstraintDepth--;
            }
          }
        : undefined
    });
    this.state = state.getState();
    this._controllerState = state;
    this._setInteractionState({interactionTargetPosition: [...target.coordinate]});
  }

  private _releaseTargetOwner(owner: 'pan' | 'zoom' | 'rotate' | 'transition' | 'wheel'): void {
    this._activeTargetOwners.delete(owner);
    if (this._activeTargetOwners.size === 0) {
      this._clearTargetState();
    }
  }

  private _releaseAllTargets(cancelTransition: boolean = false): void {
    if (cancelTransition) {
      this._cancelTargetTransition();
    }
    if (this._wheelTargetTimer) {
      clearTimeout(this._wheelTargetTimer);
      this._wheelTargetTimer = null;
    }
    this._activeTargetOwners.clear();
    this._clearTargetState(cancelTransition);
  }

  private _clearTargetState(cancelInteraction: boolean = false): void {
    if (!this._activeTarget) {
      return;
    }
    this._activeTarget = null;
    this._activeTargetViewStructure = null;
    this._targetSessionGeneration++;
    const state = this.controllerState.withoutInteractionTarget();
    this.state = state.getState();
    this._controllerState = state;
    this._setInteractionState({
      interactionTargetPosition: undefined,
      rotationPivotPosition: undefined,
      ...(cancelInteraction
        ? {
            isDragging: false,
            isPanning: false,
            isZooming: false,
            isRotating: false
          }
        : {})
    });
  }

  private _getCurrentTargetViewport(): WebMercatorViewport | null {
    const viewport = this.makeViewport(this.controllerState.getViewportProps());
    return viewport instanceof WebMercatorViewport && viewport.supportsTargetNavigation
      ? viewport
      : null;
  }

  private _areTargetViewportDimensionsEqual(props: ControllerProps): boolean {
    return (
      props.id === this.props.id &&
      props.x === this.props.x &&
      props.y === this.props.y &&
      props.width === this.props.width &&
      props.height === this.props.height
    );
  }

  private _cancelTargetTransition(): void {
    const transition = this.transitionManager.transition;
    const interpolator = (transition.settings as {interpolator?: unknown}).interpolator;
    if (transition.inProgress && interpolator instanceof TargetNavigationInterpolator) {
      transition.cancel();
    }
  }

  /** Replaces a controller-generated map transition with target-aware frame construction. */
  private _getTargetTransitionProps(
    endControllerState: MapState,
    transitionProps: Record<string, any> | null
  ): Record<string, any> | null {
    if (
      !this.targetNavigation ||
      !this._activeTarget ||
      !transitionProps ||
      !transitionProps.transitionDuration
    ) {
      return transitionProps;
    }

    const startViewport = this._getCurrentTargetViewport();
    const targetInfo = startViewport?.getTargetInfo(this._activeTarget.coordinate);
    const endScreenPosition = endControllerState.getState().targetNavigationScreenPosition;
    if (!startViewport || !targetInfo?.isValid || !endScreenPosition) {
      return transitionProps;
    }

    const target: MapInteractionTarget = {
      coordinate: [...targetInfo.target],
      screenPosition: [targetInfo.projectedPosition[0], targetInfo.projectedPosition[1]],
      ...(this._activeTarget.minimumTargetDistance === undefined
        ? {}
        : {minimumTargetDistance: this._activeTarget.minimumTargetDistance})
    };
    const mode =
      endControllerState.getState().targetNavigationOperation === 'pan' ? 'pan' : 'orbit';
    const targetSessionGeneration = this._targetSessionGeneration;
    return {
      ...transitionProps,
      transitionInterpolator:
        mode === 'pan'
          ? new TargetNavigationInterpolator({
              mode,
              target,
              endScreenPosition: [...endScreenPosition],
              resolveFrame: (props, context) => this._resolveTargetTransitionFrame(props, context)
            })
          : new TargetNavigationInterpolator({
              mode,
              target,
              startRadius: targetInfo.targetDistance,
              endScreenPosition: [...endScreenPosition],
              resolveFrame: (props, context) => this._resolveTargetTransitionFrame(props, context)
            }),
      onTransitionInterrupt: this._wrapTargetTransitionEnd(
        targetSessionGeneration,
        transitionProps.onTransitionInterrupt
      ),
      onTransitionEnd: this._wrapTargetTransitionEnd(
        targetSessionGeneration,
        transitionProps.onTransitionEnd
      )
    };
  }

  private _resolveTargetTransitionFrame(
    props: Readonly<Record<string, any>>,
    context: TargetNavigationTransitionContext
  ): Record<string, any> | null {
    const current = this.controllerState;
    if (!current.getState().interactionTarget) {
      return null;
    }
    const previous = current._getUpdatedState(context.previousProps, {mode: 'preserve'});
    if (context.mode === 'pan') {
      const candidate = previous._getTargetPanUpdatedState(
        context.screenPosition as [number, number],
        {mode: 'hard'}
      );
      return candidate === previous ? null : candidate.getViewportProps();
    }
    const candidate = previous._getTargetPoseUpdatedState(
      {
        bearing: props.bearing,
        pitch: props.pitch,
        zoom: props.zoom
      },
      {mode: 'hard'},
      context.radius,
      context.screenPosition as [number, number]
    );
    return candidate === previous ? null : candidate.getViewportProps();
  }

  private _wrapTargetTransitionEnd(
    targetSessionGeneration: number,
    callback?: (transition: any) => void
  ) {
    return transition => {
      // A smooth wheel update interrupts the preceding transition immediately before starting
      // the replacement. The wheel-burst owner bridges that internal restart.
      if (
        targetSessionGeneration === this._targetSessionGeneration &&
        !this._activeTargetOwners.has('wheel')
      ) {
        this._releaseTargetOwner('transition');
      }
      callback?.(transition);
    };
  }

  /** Add altitude to rotateStart params based on rotationPivot mode */
  protected _getAltitude = (pos: [number, number]): number | undefined => {
    if (this.rotationPivot === '2d') {
      return 0;
    } else if (this.rotationPivot === '3d') {
      if (this.pickPosition) {
        const {x, y} = this.props;
        const pickResult = this.pickPosition(x + pos[0], y + pos[1]);
        if (pickResult && pickResult.coordinate && pickResult.coordinate.length >= 3) {
          return pickResult.coordinate[2];
        }
      }
    }
    return undefined;
  };
}
