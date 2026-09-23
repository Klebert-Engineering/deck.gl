// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Matrix4, vec3, vec4} from '@math.gl/core';
import {altitudeToFovy, fovyToAltitude, MAX_LATITUDE} from '@math.gl/web-mercator';
import Viewport from './viewport';
import {PROJECTION_MODE} from '../lib/constants';
import {getProjectionParameters, mod} from '../utils/math-utils';
import isFiniteTuple from '../utils/is-finite-tuple';
import {Globe, zoomAdjust} from './globe-utils';
export {zoomAdjust} from './globe-utils';
import type {TargetInfo} from './target-navigation';

const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const NORTH_UP_BEARING_THRESHOLD = 1;
const EARTH_RADIUS = 6370972;
export const GLOBE_RADIUS = 256;
// Pointer correction depends on distance from the screen-space limb, not latitude.
// Smoothly release edge and off-globe anchors so they converge to center without a snap.
const GLOBE_ZOOM_ANCHOR_DAMPING_START_RATIO = 0.75;
const GLOBE_ZOOM_ANCHOR_MAX_DISTANCE_RATIO = 1.15;

/** Returns whether a globe bearing uses the default north-up constraints. @internal */
export function isGlobeNorthUp(bearing: number): boolean {
  const normalizedBearing = mod(bearing + 180, 360) - 180;
  return Math.abs(normalizedBearing) < NORTH_UP_BEARING_THRESHOLD;
}

function getDistanceScales() {
  const unitsPerMeter = GLOBE_RADIUS / EARTH_RADIUS;
  const unitsPerDegree = (Math.PI / 180) * GLOBE_RADIUS;

  return {
    unitsPerMeter: [unitsPerMeter, unitsPerMeter, unitsPerMeter],
    unitsPerMeter2: [0, 0, 0],
    metersPerUnit: [1 / unitsPerMeter, 1 / unitsPerMeter, 1 / unitsPerMeter],
    unitsPerDegree: [unitsPerDegree, unitsPerDegree, unitsPerMeter],
    unitsPerDegree2: [0, 0, 0],
    degreesPerUnit: [1 / unitsPerDegree, 1 / unitsPerDegree, 1 / unitsPerMeter]
  };
}

export type GlobeViewportOptions = {
  /** Name of the viewport */
  id?: string;
  /** Left offset from the canvas edge, in pixels */
  x?: number;
  /** Top offset from the canvas edge, in pixels */
  y?: number;
  /** Viewport width in pixels */
  width?: number;
  /** Viewport height in pixels */
  height?: number;
  /** Longitude in degrees */
  longitude?: number;
  /** Latitude in degrees */
  latitude?: number;
  /** Bearing in degrees. Default `0` */
  bearing?: number;
  /** Pitch in degrees. Default `0` */
  pitch?: number;
  /** Camera altitude relative to the viewport height, used to control the FOV. Default `1.5` */
  altitude?: number;
  /* Meter offsets of the viewport center from lng, lat, elevation */
  position?: number[];
  /** Padding around the viewport in CSS pixels. */
  padding?: Viewport['padding'];
  /** Optional transform of the center offset. Unsupported by target navigation. */
  modelMatrix?: number[] | null;
  /** Custom projection. Unsupported by target navigation. */
  projectionMatrix?: number[];
  /** Zoom level */
  zoom?: number;
  /** Use orthographic projection */
  orthographic?: boolean;
  /** Camera fovy in degrees. If provided, overrides `altitude` */
  fovy?: number;
  /** Scaler for the near plane, 1 unit equals to the height of the viewport. Default `0.5` */
  nearZMultiplier?: number;
  /** Scaler for the far plane, 1 unit equals to the distance from the camera to the edge of the screen. Default `1` */
  farZMultiplier?: number;
  /** Optionally override the near plane position. `nearZMultiplier` is ignored if `nearZ` is supplied. */
  nearZ?: number;
  /** Optionally override the far plane position. `farZMultiplier` is ignored if `farZ` is supplied. */
  farZ?: number;
  /** The resolution at which to turn flat features into 3D meshes, in degrees. Smaller numbers will generate more detailed mesh. Default `10` */
  resolution?: number;
};

/** Canonical state reconstructed by the spherical target-navigation operations. */
export type GlobeTargetViewState = {
  longitude: number;
  latitude: number;
  bearing: number;
  pitch: number;
  zoom: number;
  /** Globe Cartesian meter offset, in the same basis as GlobeViewport.position. */
  position: [number, number, number];
};

/** Options for a perspective spherical target orbit or zoom. */
export type GlobeTargetViewStateOptions = {
  target: [number, number, number];
  screenPosition: [number, number];
  bearing?: number;
  pitch?: number;
  zoom?: number;
  /** Minimum camera-to-target distance in metres; zero disables the floor. */
  minimumTargetDistance?: number;
};

/** Options for spherical target panning using a rigid camera-frame rotation. */
export type GlobeTargetPanViewStateOptions = Pick<
  GlobeTargetViewStateOptions,
  'target' | 'screenPosition'
>;

/** Camera-relative target measurements; distances are in metres or view space as documented. */
export type GlobeTargetInfo = TargetInfo;

export default class GlobeViewport extends Viewport {
  static displayName = 'GlobeViewport';

  longitude: number;
  latitude: number;
  bearing: number;
  pitch: number;
  fovy: number;
  resolution: number;
  /** Whether the viewport supports the standard perspective target-navigation transforms. */
  readonly supportsTargetNavigation: boolean;
  private readonly _targetNavigationOptions: GlobeViewportOptions;

  constructor(opts: GlobeViewportOptions = {}) {
    const {
      longitude = 0,
      bearing = 0,
      pitch = 0,
      zoom = 0,
      // Matches Maplibre defaults
      // https://github.com/maplibre/maplibre-gl-js/blob/f8ab4b48d59ab8fe7b068b102538793bbdd4c848/src/geo/projection/globe_transform.ts#L632-L633
      nearZMultiplier = 0.5,
      farZMultiplier = 1,
      resolution = 10
    } = opts;

    let {latitude = 0, height, altitude = 1.5, fovy} = opts;

    // Clamp to valid range
    latitude = Math.max(Math.min(latitude, 90), -90);

    height = height || 1;
    if (fovy) {
      altitude = fovyToAltitude(fovy);
    } else {
      fovy = altitudeToFovy(altitude);
    }
    // Exagerate distance by latitude to match the Web Mercator distortion
    // The goal is that globe and web mercator projection results converge at high zoom
    // https://github.com/maplibre/maplibre-gl-js/blob/f8ab4b48d59ab8fe7b068b102538793bbdd4c848/src/geo/projection/globe_transform.ts#L575-L577
    // Cap latitude for scale calculation to avoid the singularity at the poles
    // where cos(90°)=0 → scale→∞. GlobeController applies the same cap when
    // compensating zoom during pan (MAX_LATITUDE).
    const scaleLatitude = Math.max(Math.min(latitude, MAX_LATITUDE), -MAX_LATITUDE);
    const scale = Math.pow(2, zoom - zoomAdjust(scaleLatitude));
    // Adjust far plane for pitch — tilted camera can see further across the globe
    const pitchRadians = pitch * DEGREES_TO_RADIANS;
    const nearZ = opts.nearZ ?? nearZMultiplier;
    const farZ =
      opts.farZ ??
      (altitude + (GLOBE_RADIUS * 2 * scale) / height / Math.max(Math.cos(pitchRadians), 0.1)) *
        farZMultiplier;

    // Calculate view matrix
    // The lookAt places the camera along -Y looking toward origin.
    // After the globe rotation (Rx(lat) * Rz(-lng)), the surface normal at the target
    // aligns with -Y, East with +X, and North with +Z.
    const viewMatrix = new Matrix4()
      .lookAt({eye: [0, -altitude, 0], up: [0, 0, 1]})
      // Pitch: tilt the camera away from straight-down
      .rotateX(-pitchRadians)
      // Bearing: rotate around the surface normal.
      // Negative sign matches the WebMercator convention (bearing > 0 = clockwise from North).
      .rotateY(-bearing * DEGREES_TO_RADIANS)
      // Globe orientation: position the target's surface at the top
      .rotateX(latitude * DEGREES_TO_RADIANS)
      .rotateZ(-longitude * DEGREES_TO_RADIANS)
      .scale(scale / height);

    super({
      ...opts,
      // x, y, width,
      height,

      // view matrix
      viewMatrix,
      longitude,
      latitude,
      zoom,

      // projection matrix parameters
      distanceScales: getDistanceScales(),
      fovy,
      focalDistance: altitude,
      near: nearZ,
      far: farZ
    });

    this.scale = scale;
    this.latitude = latitude;
    this.longitude = longitude;
    this.bearing = bearing;
    this.pitch = pitch;
    this.fovy = fovy;
    this.resolution = resolution;
    this._targetNavigationOptions = {...opts};
    this.supportsTargetNavigation =
      !opts.orthographic &&
      !opts.projectionMatrix &&
      !opts.modelMatrix &&
      (opts.width === undefined || (Number.isFinite(opts.width) && opts.width > 0)) &&
      (opts.height === undefined || (Number.isFinite(opts.height) && opts.height > 0));
  }

  /** Measures a target on or above the globe, rejecting clipped and planet-occluded points. */
  getTargetInfo(target: [number, number, number]): GlobeTargetInfo | null {
    if (
      !this.supportsTargetNavigation ||
      !isFiniteTuple(target, 3) ||
      Math.abs(target[1]) > 90 ||
      target[2] < 0
    ) {
      return null;
    }
    const commonTarget = this.projectPosition(target);
    const projectedPosition = this.project(target) as [number, number, number];
    const cameraTarget = new Matrix4(this.viewMatrix).transformAsPoint(commonTarget);
    const cameraDepth = -cameraTarget[2];
    const {near, far} = getProjectionParameters(this.projectionMatrix);
    const direction = vec3.sub([], commonTarget, this.cameraPosition);
    const distanceSquared = vec3.squaredLength(direction);
    const targetDistance = Math.sqrt(distanceSquared) * this.distanceScales.metersPerUnit[0];
    // Test the finite camera-to-target segment, not an infinite ray. Elevated points beyond
    // the surface horizon can still be visible when the segment clears the reference sphere.
    const closestProgress = Math.max(
      0,
      Math.min(1, -vec3.dot(this.cameraPosition, direction) / distanceSquared)
    );
    const closestPoint = vec3.scaleAndAdd([], this.cameraPosition, direction, closestProgress);
    const clearsGlobe = vec3.length(closestPoint) >= GLOBE_RADIUS * (1 - 1e-12);
    const isValid =
      [...projectedPosition, cameraDepth, near, far, targetDistance].every(Number.isFinite) &&
      near > 0 &&
      far > near &&
      cameraDepth > near &&
      cameraDepth < far &&
      targetDistance > 0 &&
      clearsGlobe;
    return {
      target: [...target],
      projectedPosition,
      targetDistance,
      cameraDepth,
      near,
      far,
      isValid,
      isVisible:
        isValid &&
        projectedPosition[0] >= 0 &&
        projectedPosition[0] <= this.width &&
        projectedPosition[1] >= 0 &&
        projectedPosition[1] <= this.height
    };
  }

  /**
   * Reconstructs a target-relative perspective pose in the source geographic frame.
   * The target pixel is fixed and distance follows the requested scale at this latitude.
   * The returned Cartesian offset is part of the canonical Globe camera representation;
   * rebuild it with the source view's lens, padding and clipping configuration.
   * Returns null for unsupported projections or an invalid/clipped/occluded pose.
   */
  getTargetViewState(options: GlobeTargetViewStateOptions): GlobeTargetViewState | null {
    const {target, screenPosition, minimumTargetDistance = 0} = options;
    const bearing = options.bearing ?? this.bearing;
    const pitch = options.pitch ?? this.pitch;
    let zoom = options.zoom ?? this.zoom;
    const targetInfo = this.getTargetInfo(target);
    if (
      !targetInfo?.isValid ||
      !isFiniteTuple(screenPosition, 2) ||
      ![bearing, pitch, zoom, minimumTargetDistance].every(Number.isFinite) ||
      minimumTargetDistance < 0
    ) {
      return null;
    }
    if (minimumTargetDistance > 0) {
      zoom = Math.min(
        zoom,
        this.zoom +
          Math.log2(
            targetInfo.targetDistance / Math.min(minimumTargetDistance, targetInfo.targetDistance)
          )
      );
    }
    const reference = new GlobeViewport({
      ...this._targetNavigationOptions,
      longitude: this.longitude,
      latitude: this.latitude,
      bearing,
      pitch,
      zoom,
      position: [0, 0, 0]
    });
    const rayPosition = new Matrix4(reference.pixelUnprojectionMatrix).transformAsPoint([
      ...screenPosition,
      0
    ]);
    const direction = vec3.normalize([], vec3.sub([], rayPosition, reference.cameraPosition));
    const commonDistance =
      targetInfo.targetDistance * 2 ** (this.zoom - zoom) * this.distanceScales.unitsPerMeter[0];
    const cameraPosition = vec3.scaleAndAdd(
      [],
      this.projectPosition(target),
      direction,
      -commonDistance
    );
    const position = vec3.scale(
      [],
      vec3.sub([], cameraPosition, reference.cameraPosition),
      this.distanceScales.metersPerUnit[0]
    ) as [number, number, number];
    return this._validateTargetViewState(
      {longitude: this.longitude, latitude: this.latitude, bearing, pitch, zoom, position},
      target,
      screenPosition
    );
  }

  /** Rotates the spherical camera frame to move a target to a new view-local pixel. */
  getTargetPanViewState(options: GlobeTargetPanViewStateOptions): GlobeTargetViewState | null {
    const {target, screenPosition} = options;
    if (!this.getTargetInfo(target)?.isValid || !isFiniteTuple(screenPosition, 2)) {
      return null;
    }
    const currentTarget = this.unproject(screenPosition, {targetZ: target[2]});
    const currentProjection = this.project(currentTarget);
    if (
      Math.hypot(
        currentProjection[0] - screenPosition[0],
        currentProjection[1] - screenPosition[1]
      ) > 0.1
    ) {
      return null;
    }
    const currentDirection = vec3.normalize([], this.projectPosition(currentTarget));
    const targetDirection = vec3.normalize([], this.projectPosition(target));
    const axis = vec3.cross([], currentDirection, targetDirection);
    const axisLength = vec3.length(axis);
    const angle = Math.atan2(axisLength, vec3.dot(currentDirection, targetDirection));
    if (axisLength < 1e-12 && angle > 1e-12) {
      return null;
    }
    const frame = Globe.rotateFrameToMatch(
      Globe.cameraFrame(this.longitude, this.latitude, this.bearing),
      [currentTarget[0], currentTarget[1]],
      [target[0], target[1]]
    );
    const position = (
      axisLength > 0
        ? Globe.rotate(this.position, vec3.scale([], axis, 1 / axisLength), angle)
        : [...this.position]
    ) as [number, number, number];
    return this._validateTargetViewState(
      {
        longitude: frame.longitude,
        latitude: frame.latitude,
        bearing: frame.bearing,
        pitch: this.pitch,
        zoom: this.zoom + zoomAdjust(frame.latitude, true) - zoomAdjust(this.latitude, true),
        position
      },
      target,
      screenPosition
    );
  }

  /** Rebuilds a candidate before accepting its camera representation and target projection. */
  private _validateTargetViewState(
    state: GlobeTargetViewState,
    target: [number, number, number],
    screenPosition: [number, number]
  ): GlobeTargetViewState | null {
    if (
      ![
        state.longitude,
        state.latitude,
        state.bearing,
        state.pitch,
        state.zoom,
        ...state.position
      ].every(Number.isFinite)
    ) {
      return null;
    }
    const viewport = new GlobeViewport({...this._targetNavigationOptions, ...state});
    const info = viewport.getTargetInfo(target);
    return info?.isValid &&
      Math.hypot(
        info.projectedPosition[0] - screenPosition[0],
        info.projectedPosition[1] - screenPosition[1]
      ) <= 0.1
      ? state
      : null;
  }

  get projectionMode() {
    return PROJECTION_MODE.GLOBE;
  }

  getDistanceScales() {
    return this.distanceScales;
  }

  getBounds(options: {z?: number} = {}): [number, number, number, number] {
    const unprojectOption = {targetZ: options.z || 0};

    const left = this.unproject([0, this.height / 2], unprojectOption);
    const top = this.unproject([this.width / 2, 0], unprojectOption);
    const right = this.unproject([this.width, this.height / 2], unprojectOption);
    const bottom = this.unproject([this.width / 2, this.height], unprojectOption);

    if (right[0] < this.longitude) right[0] += 360;
    if (left[0] > this.longitude) left[0] -= 360;

    return [
      Math.min(left[0], right[0], top[0], bottom[0]),
      Math.min(left[1], right[1], top[1], bottom[1]),
      Math.max(left[0], right[0], top[0], bottom[0]),
      Math.max(left[1], right[1], top[1], bottom[1])
    ];
  }

  /**
   * Builds the screen-pixel → globe-center ray and the intermediate ray/sphere
   * math reused by `unproject` and anchored zoom. One function so the same
   * pixelUnprojectionMatrix work isn't duplicated.
   */
  private _getRayToGlobe(
    screenPosition: number[],
    {topLeft = true, targetZ}: {topLeft?: boolean; targetZ?: number} = {}
  ): {
    rayStartPosition: number[];
    rayEndPosition: number[];
    radius: number;
    rayLengthSquared: number;
    rayStartDistanceSquared: number;
    distanceToCenterSquared: number;
  } {
    const [screenX, screenY] = screenPosition;
    const adjustedScreenY = topLeft ? screenY : this.height - screenY;
    const {pixelUnprojectionMatrix} = this;

    const rayStartPosition = transformVector(pixelUnprojectionMatrix, [
      screenX,
      adjustedScreenY,
      -1,
      1
    ]);
    const rayEndPosition = transformVector(pixelUnprojectionMatrix, [
      screenX,
      adjustedScreenY,
      1,
      1
    ]);

    const radius = ((targetZ || 0) / EARTH_RADIUS + 1) * GLOBE_RADIUS;
    const rayLengthSquared = vec3.sqrLen(vec3.sub([], rayStartPosition, rayEndPosition));
    const rayStartDistanceSquared = vec3.sqrLen(rayStartPosition);
    const rayEndDistanceSquared = vec3.sqrLen(rayEndPosition);
    const triangleAreaSquared =
      (4 * rayStartDistanceSquared * rayEndDistanceSquared -
        (rayLengthSquared - rayStartDistanceSquared - rayEndDistanceSquared) ** 2) /
      16;
    const distanceToCenterSquared = (4 * triangleAreaSquared) / rayLengthSquared;

    return {
      rayStartPosition,
      rayEndPosition,
      radius,
      rayLengthSquared,
      rayStartDistanceSquared,
      distanceToCenterSquared
    };
  }

  private _getRayDistanceToGlobeCenterRatio(
    screenPosition: number[],
    options?: {topLeft?: boolean; targetZ?: number}
  ): number {
    const {distanceToCenterSquared, radius} = this._getRayToGlobe(screenPosition, options);

    return Math.sqrt(Math.max(0, distanceToCenterSquared)) / radius;
  }

  /**
   * Returns how strongly a screen position should anchor zoom on the visible globe.
   * A value of `0` means that the controller should fall back to center zoom.
   * @param screenPosition - Screen position to evaluate.
   * @returns Anchor strength from `0` to `1`.
   */
  getZoomAnchorStrength(screenPosition: number[]): number {
    const distanceRatio = this._getRayDistanceToGlobeCenterRatio(screenPosition);
    if (distanceRatio >= GLOBE_ZOOM_ANCHOR_MAX_DISTANCE_RATIO) {
      return 0;
    }

    const edgeProgress = Math.max(
      0,
      Math.min(
        1,
        (distanceRatio - GLOBE_ZOOM_ANCHOR_DAMPING_START_RATIO) /
          (GLOBE_ZOOM_ANCHOR_MAX_DISTANCE_RATIO - GLOBE_ZOOM_ANCHOR_DAMPING_START_RATIO)
      )
    );
    const smoothProgress = edgeProgress * edgeProgress * (3 - 2 * edgeProgress);
    return 1 - smoothProgress;
  }

  unproject(
    xyz: number[],
    {topLeft = true, targetZ}: {topLeft?: boolean; targetZ?: number} = {}
  ): number[] {
    const [x, y, z] = xyz;

    const y2 = topLeft ? y : this.height - y;
    const {pixelUnprojectionMatrix} = this;

    let coord;
    if (Number.isFinite(z)) {
      // Has depth component
      coord = transformVector(pixelUnprojectionMatrix, [x, y2, z, 1]);
    } else {
      // since we don't know the correct projected z value for the point,
      // unproject two points to get a line and then find the point on that line that intersects with the sphere
      const {
        rayStartPosition,
        rayEndPosition,
        radius,
        rayLengthSquared,
        rayStartDistanceSquared,
        distanceToCenterSquared
      } = this._getRayToGlobe(xyz, {topLeft, targetZ});
      const rayStartToClosestApproach = Math.sqrt(
        rayStartDistanceSquared - distanceToCenterSquared
      );
      const closestApproachToIntersection = Math.sqrt(
        Math.max(0, radius * radius - distanceToCenterSquared)
      );
      const intersectionRatio =
        (rayStartToClosestApproach - closestApproachToIntersection) / Math.sqrt(rayLengthSquared);

      coord = vec3.lerp([], rayStartPosition, rayEndPosition, intersectionRatio);
    }
    const [X, Y, Z] = this.unprojectPosition(coord);

    if (Number.isFinite(z)) {
      return [X, Y, Z];
    }
    return Number.isFinite(targetZ) ? [X, Y, targetZ as number] : [X, Y];
  }

  projectPosition(xyz: number[]): [number, number, number] {
    const [lng, lat, Z = 0] = xyz;
    const lambda = lng * DEGREES_TO_RADIANS;
    const phi = lat * DEGREES_TO_RADIANS;
    const cosPhi = Math.cos(phi);
    const D = (Z / EARTH_RADIUS + 1) * GLOBE_RADIUS;

    return [Math.sin(lambda) * cosPhi * D, -Math.cos(lambda) * cosPhi * D, Math.sin(phi) * D];
  }

  unprojectPosition(xyz: number[]): [number, number, number] {
    const [x, y, z] = xyz;
    const D = vec3.len(xyz);
    const phi = Math.asin(z / D);
    const lambda = Math.atan2(x, -y);

    const lng = lambda * RADIANS_TO_DEGREES;
    const lat = phi * RADIANS_TO_DEGREES;
    const Z = (D / GLOBE_RADIUS - 1) * EARTH_RADIUS;
    return [lng, lat, Z];
  }

  projectFlat(xyz: number[]): [number, number] {
    return xyz as [number, number];
  }

  unprojectFlat(xyz: number[]): [number, number] {
    return xyz as [number, number];
  }

  /**
   * Pan the globe to place geographic coordinates at a screen pixel.
   * When `dragStartPosition` is supplied, applies the delta-based movement used by globe dragging.
   * @param coordinates - Geographic anchor, or the starting longitude, latitude and zoom.
   * @param screenPosition - Current screen position.
   * @param dragStartPosition - Screen position where a drag started.
   * @returns Updated viewport options.
   */
  panByPosition(
    coordinates: number[],
    screenPosition: number[],
    dragStartPosition?: number[]
  ): GlobeViewportOptions {
    if (!dragStartPosition) {
      let anchorStrength = this.getZoomAnchorStrength(screenPosition);
      if (anchorStrength === 0) {
        return {longitude: this.longitude, latitude: this.latitude};
      }

      const currentCoordinates = this.unproject(screenPosition);
      const longitudeDelta = mod(coordinates[0] - currentCoordinates[0] + 180, 360) - 180;
      const latitudeDelta = coordinates[1] - currentCoordinates[1];
      const crossesPole =
        Math.abs(currentCoordinates[1]) > MAX_LATITUDE || Math.abs(longitudeDelta) > 90;
      if (isGlobeNorthUp(this.bearing) && crossesPole) {
        // A zoom gesture keeps its original geographic anchor. Once the
        // pointer crosses a pole it can reappear in the opposite hemisphere,
        // reversing longitude. Continue zooming around center in either case.
        return {longitude: this.longitude, latitude: this.latitude};
      }
      if (isGlobeNorthUp(this.bearing) && latitudeDelta !== 0) {
        // Longitude and latitude are one coupled correction. If north-up runs
        // out of latitude headroom, scale both axes together instead of
        // clipping latitude while applying the full sideways rotation.
        const latitudeLimit = latitudeDelta > 0 ? MAX_LATITUDE : -MAX_LATITUDE;
        const latitudeConstraintStrength = (latitudeLimit - this.latitude) / latitudeDelta;
        anchorStrength = Math.min(anchorStrength, Math.max(0, latitudeConstraintStrength));
      }
      const longitude = this.longitude + longitudeDelta * anchorStrength;
      const latitude = Math.max(Math.min(this.latitude + latitudeDelta * anchorStrength, 90), -90);

      return {longitude, latitude};
    }

    const [startLongitude, startLatitude, startZoom] = coordinates;
    // Scale rotation speed inversely with zoom, to approximate constant panning speed
    const scale = Math.pow(2, this.zoom - zoomAdjust(this.latitude));
    const rotationSpeed = 0.25 / scale;

    const longitude = startLongitude + rotationSpeed * (dragStartPosition[0] - screenPosition[0]);
    let latitude = startLatitude - rotationSpeed * (dragStartPosition[1] - screenPosition[1]);
    latitude = Math.max(Math.min(latitude, 90), -90);
    const nextViewState = {longitude, latitude, zoom: startZoom - zoomAdjust(startLatitude)};
    nextViewState.zoom += zoomAdjust(nextViewState.latitude);
    return nextViewState;
  }
}

function transformVector(matrix: number[], vector: number[]): number[] {
  const result = vec4.transformMat4([], vector, matrix);
  vec4.scale(result, result, 1 / result[3]);
  return result;
}
