// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// View and Projection Matrix calculations for mapbox-js style
// map view properties
import Viewport from './viewport';

import {
  pixelsToWorld,
  getViewMatrix,
  addMetersToLngLat,
  unitsPerMeter,
  getProjectionParameters,
  altitudeToFovy,
  fovyToAltitude,
  fitBounds,
  getBounds
} from '@math.gl/web-mercator';
import {Padding} from './viewport';

import {Matrix4, clamp, vec2} from '@math.gl/core';

export type WebMercatorViewportOptions = {
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
  /** Tilt of the camera in degrees */
  pitch?: number;
  /** Heading of the camera in degrees */
  bearing?: number;
  /** Camera altitude relative to the viewport height, legacy property used to control the FOV. Default `1.5` */
  altitude?: number;
  /** Camera fovy in degrees. If provided, overrides `altitude` */
  fovy?: number;
  /** Viewport center in world space. If geospatial, refers to meter offsets from lng, lat, elevation */
  position?: number[];
  /** Zoom level */
  zoom?: number;
  /** Padding around the viewport, in pixels. */
  padding?: Padding | null;
  /** Model matrix of viewport center */
  modelMatrix?: number[] | null;
  /** Custom projection matrix */
  projectionMatrix?: number[];
  /** Use orthographic projection */
  orthographic?: boolean;
  /** Scaler for the near plane, 1 unit equals to the height of the viewport. Default `0.1` */
  nearZMultiplier?: number;
  /** Scaler for the far plane, 1 unit equals to the distance from the camera to the edge of the screen. Default `1.01` */
  farZMultiplier?: number;
  /** Optionally override the near plane position. `nearZMultiplier` is ignored if `nearZ` is supplied. */
  nearZ?: number;
  /** Optionally override the far plane position. `farZMultiplier` is ignored if `farZ` is supplied. */
  farZ?: number;
  /** Render multiple copies of the world */
  repeat?: boolean;
  /** Internal use */
  worldOffset?: number;
  /** @deprecated Revert to approximated meter size calculation prior to v8.5 */
  legacyMeterSizes?: boolean;
};

/** Options for reconstructing a map view around a world-space target. */
export type WebMercatorTargetViewStateOptions = {
  /** World coordinate as `[longitude, latitude, altitude]`. */
  target: [number, number, number];
  /** Target position in view-local CSS pixels. */
  screenPosition: [number, number];
  /** Requested map bearing. Defaults to the source viewport's bearing. */
  bearing?: number;
  /** Requested map pitch. Defaults to the source viewport's pitch. */
  pitch?: number;
  /** Requested map zoom. Defaults to the source viewport's zoom. */
  zoom?: number;
  /**
   * Optional minimum physical camera-to-target distance in metres. `0` disables the limit.
   * Zoom-in requests stop exactly at this distance. If the source camera is already closer,
   * zooming in preserves its current distance instead of moving the camera outwards.
   */
  minimumTargetDistance?: number;
};

/** Options for translating a map view parallel to the Web Mercator world plane. */
export type WebMercatorTargetPanViewStateOptions = {
  /** World coordinate as `[longitude, latitude, altitude]`. */
  target: [number, number, number];
  /** Desired target position in view-local CSS pixels. */
  screenPosition: [number, number];
};

/** Canonical map state reconstructed by {@link WebMercatorViewport.getTargetViewState}. */
export type WebMercatorTargetViewState = {
  /** Longitude in degrees, kept continuous with the source viewport's rendered world copy. */
  longitude: number;
  /** Latitude in degrees. */
  latitude: number;
  /** Effective map zoom after applying the optional minimum target distance. */
  zoom: number;
  /** Requested map bearing in degrees. */
  bearing: number;
  /** Requested map pitch in degrees. */
  pitch: number;
  /** Meter offset that represents the reconstructed camera center. */
  position: [number, number, number];
};

/** Camera-relative information about a world-space target. */
export type WebMercatorTargetInfo = {
  /** Target localized to the world copy rendered by this viewport. */
  target: [number, number, number];
  /** Projected target as view-local `[x, y, depth]`. */
  projectedPosition: [number, number, number];
  /** Physical distance between the camera and target, in meters. */
  targetDistance: number;
  /** Positive distance from the camera along its forward axis, in view space. */
  cameraDepth: number;
  /** Near clipping distance in view space. */
  near: number;
  /** Far clipping distance in view space. */
  far: number;
  /** Whether the target is finite, front-facing, and strictly inside the clip volume. */
  isValid: boolean;
  /** Whether the valid target also projects inside the viewport's pixel bounds. */
  isVisible: boolean;
};

const MINIMUM_TARGET_SCALE = 32 * Number.EPSILON;

function isFiniteArray(values: ArrayLike<number>): boolean {
  for (let index = 0; index < values.length; index++) {
    if (!Number.isFinite(values[index])) {
      return false;
    }
  }
  return true;
}

function hasStableInverse(matrix: Matrix4): boolean {
  const values = matrix as unknown as ArrayLike<number>;
  if (!isFiniteArray(values)) {
    return false;
  }
  const determinant = matrix.determinant();
  if (!Number.isFinite(determinant) || determinant === 0) {
    return false;
  }
  const inverse = new Matrix4(matrix).invert();
  if (!isFiniteArray(inverse)) {
    return false;
  }
  // A dimensionless infinity-norm condition estimate is invariant to uniform matrix scaling.
  // Unlike comparing the determinant to the fourth power of the largest entry, it also does not
  // reject ordinary low-zoom view matrices or moderate model translations.
  const condition = matrixInfinityNorm(values) * matrixInfinityNorm(inverse);
  return Number.isFinite(condition) && condition <= 1 / MINIMUM_TARGET_SCALE;
}

/** Infinity norm (maximum absolute row sum) of a column-major 4x4 matrix. */
function matrixInfinityNorm(values: ArrayLike<number>): number {
  let norm = 0;
  for (let row = 0; row < 4; row++) {
    let rowSum = 0;
    for (let column = 0; column < 4; column++) {
      rowSum += Math.abs(values[column * 4 + row]);
    }
    norm = Math.max(norm, rowSum);
  }
  return norm;
}

/** Returns the equivalent longitude nearest to a reference world copy. */
function normalizeLongitude(longitude: number, reference: number): number {
  return longitude + 360 * Math.round((reference - longitude) / 360);
}

/**
 * Manages transformations to/from WGS84 coordinates using the Web Mercator Projection.
 */
export default class WebMercatorViewport extends Viewport {
  static displayName = 'WebMercatorViewport';

  longitude: number;
  latitude: number;
  pitch: number;
  bearing: number;
  altitude: number;
  fovy: number;
  orthographic: boolean;
  /** Whether this viewport supports target-relative perspective camera reconstruction. */
  readonly supportsTargetNavigation: boolean;

  /** Each sub viewport renders one copy of the world if repeat:true. The list is generated and cached on first request. */
  private _subViewports: WebMercatorViewport[] | null;
  /** @deprecated Revert to approximated meter size calculation prior to v8.5 */
  private _pseudoMeters: boolean;
  /** Whether target-relative camera operations are unsupported because the lens is custom. */
  private _hasCustomProjectionMatrix: boolean;
  /** World-copy offset applied to this viewport's view matrix. */
  private _worldOffset: number;
  /** Whether the dimensions supplied by the caller are usable for camera reconstruction. */
  private _hasValidDimensions: boolean;

  /* eslint-disable complexity, max-statements */
  constructor(opts: WebMercatorViewportOptions = {}) {
    const {
      latitude = 0,
      longitude = 0,
      zoom = 0,
      pitch = 0,
      bearing = 0,
      nearZMultiplier = 0.1,
      farZMultiplier = 1.01,
      nearZ,
      farZ,
      orthographic = false,
      projectionMatrix,

      repeat = false,
      worldOffset = 0,
      position,
      padding,

      // backward compatibility
      // TODO: remove in v9
      legacyMeterSizes = false
    } = opts;

    let {width, height, altitude = 1.5} = opts;
    const scale = Math.pow(2, zoom);

    // Silently allow apps to send in 0,0 to facilitate isomorphic render etc
    width = width || 1;
    height = height || 1;

    let fovy;
    let projectionParameters: any = null;
    if (projectionMatrix) {
      altitude = projectionMatrix[5] / 2;
      fovy = altitudeToFovy(altitude);
    } else {
      if (opts.fovy) {
        fovy = opts.fovy;
        altitude = fovyToAltitude(fovy);
      } else {
        fovy = altitudeToFovy(altitude);
      }

      let offset: [number, number] | undefined;
      if (padding) {
        const {top = 0, bottom = 0} = padding;
        offset = [0, clamp((top + height - bottom) / 2, 0, height) - height / 2];
      }

      projectionParameters = getProjectionParameters({
        width,
        height,
        scale,
        center: position && [0, 0, position[2] * unitsPerMeter(latitude)],
        offset,
        pitch,
        fovy,
        nearZMultiplier,
        farZMultiplier
      });

      if (Number.isFinite(nearZ)) {
        projectionParameters.near = nearZ;
      }
      if (Number.isFinite(farZ)) {
        projectionParameters.far = farZ;
      }
    }

    // The uncentered matrix allows us two move the center addition to the
    // shader (cheap) which gives a coordinate system that has its center in
    // the layer's center position. This makes rotations and other modelMatrx
    // transforms much more useful.
    let viewMatrixUncentered = getViewMatrix({
      height,
      pitch,
      bearing,
      scale,
      altitude
    });

    if (worldOffset) {
      const viewOffset = new Matrix4().translate([512 * worldOffset, 0, 0]);
      viewMatrixUncentered = viewOffset.multiplyLeft(viewMatrixUncentered);
    }

    super({
      ...opts,
      // x, y,
      width,
      height,

      // view matrix
      viewMatrix: viewMatrixUncentered,
      longitude,
      latitude,
      zoom,

      // projection matrix parameters
      ...projectionParameters,
      fovy,
      focalDistance: altitude
    });

    // Save parameters
    this.latitude = latitude;
    this.longitude = longitude;
    this.zoom = zoom;
    this.pitch = pitch;
    this.bearing = bearing;
    this.altitude = altitude;
    this.fovy = fovy;

    this.orthographic = orthographic;

    this._subViewports = repeat ? [] : null;
    this._pseudoMeters = legacyMeterSizes;
    this._hasCustomProjectionMatrix = Boolean(projectionMatrix);
    this._worldOffset = worldOffset;
    this._hasValidDimensions =
      (opts.width === undefined || (Number.isFinite(opts.width) && opts.width > 0)) &&
      (opts.height === undefined || (Number.isFinite(opts.height) && opts.height > 0));
    this.supportsTargetNavigation =
      !orthographic &&
      !this._hasCustomProjectionMatrix &&
      !this._pseudoMeters &&
      this._hasValidDimensions;

    Object.freeze(this);
  }
  /* eslint-enable complexity, max-statements */

  get subViewports(): WebMercatorViewport[] | null {
    if (this._subViewports && !this._subViewports.length) {
      // Cache sub viewports so that we only calculate them once
      const bounds = this.getBounds();

      const minOffset = Math.floor((bounds[0] + 180) / 360);
      const maxOffset = Math.ceil((bounds[2] - 180) / 360);

      for (let x = minOffset; x <= maxOffset; x++) {
        const offsetViewport = x
          ? new WebMercatorViewport({
              ...this,
              worldOffset: x
            })
          : this;
        this._subViewports.push(offsetViewport);
      }
    }
    return this._subViewports;
  }

  /** Returns whether two Web Mercator viewports use the same projection settings. */
  equals(viewport: Viewport): boolean {
    return (
      viewport instanceof WebMercatorViewport &&
      viewport._pseudoMeters === this._pseudoMeters &&
      super.equals(viewport)
    );
  }

  projectPosition(xyz: number[]): [number, number, number] {
    if (this._pseudoMeters) {
      // Backward compatibility
      return super.projectPosition(xyz);
    }
    const [X, Y] = this.projectFlat(xyz);
    const Z = (xyz[2] || 0) * unitsPerMeter(xyz[1]);
    return [X, Y, Z];
  }

  unprojectPosition(xyz: number[]): [number, number, number] {
    if (this._pseudoMeters) {
      // Backward compatibility
      return super.unprojectPosition(xyz);
    }
    const [X, Y] = this.unprojectFlat(xyz);
    const Z = (xyz[2] || 0) / unitsPerMeter(Y);
    return [X, Y, Z];
  }

  /**
   * Add a meter delta to a base lnglat coordinate, returning a new lnglat array
   *
   * Note: Uses simple linear approximation around the viewport center
   * Error increases with size of offset (roughly 1% per 100km)
   *
   * @param {[Number,Number]|[Number,Number,Number]) lngLatZ - base coordinate
   * @param {[Number,Number]|[Number,Number,Number]) xyz - array of meter deltas
   * @return {[Number,Number]|[Number,Number,Number]) array of [lng,lat,z] deltas
   */
  addMetersToLngLat(lngLatZ: number[], xyz: number[]): number[] {
    return addMetersToLngLat(lngLatZ, xyz);
  }

  panByPosition(
    coords: number[],
    pixel: number[],
    startPixel?: number[]
  ): WebMercatorViewportOptions {
    const fromLocation = pixelsToWorld(pixel, this.pixelUnprojectionMatrix);
    const toLocation = this.projectFlat(coords);

    const translate = vec2.add([], toLocation, vec2.negate([], fromLocation));
    const newCenter = vec2.add([], this.center, translate);

    const [longitude, latitude] = this.unprojectFlat(newCenter);
    return {longitude, latitude};
  }

  /**
   * Returns an approximate longitude and latitude that moves a 3D world coordinate toward a
   * screen pixel. This compatibility helper applies one geographic-coordinate correction and can
   * retain visible error for nonzero viewport `position`; use `getTargetPanViewState` when a full,
   * exact target-relative planar map state is required.
   */
  panByPosition3D(coords: number[], pixel: number[]): WebMercatorViewportOptions {
    const targetZ = coords[2] || 0;
    const deltaLngLat = vec2.sub([], coords, this.unproject(pixel, {targetZ}));
    return {longitude: this.longitude + deltaLngLat[0], latitude: this.latitude + deltaLngLat[1]};
  }

  /**
   * Reconstructs a canonical map state after translating the camera parallel to the world plane.
   *
   * Call this method on the frozen operation-start viewport. The target is placed at the supplied
   * view-local screen position by translating the viewport center in common-space X/Y only. Zoom,
   * bearing, pitch and common-space center Z are preserved; camera-to-target radius is deliberately
   * not preserved. The returned state must be rebuilt with the same dimensions, lens, padding,
   * clipping, model transform and world-copy configuration as this viewport.
   *
   * Returns `null` for unsupported projection modes, nonfinite/singular input, a target or desired
   * ray-plane intersection outside the camera clip volume, or an unrepresentable map state.
   */
  getTargetPanViewState(
    options: WebMercatorTargetPanViewStateOptions
  ): WebMercatorTargetViewState | null {
    const {target, screenPosition} = options;
    if (!isFiniteArray(screenPosition)) {
      return null;
    }

    const targetInfo = this.getTargetInfo(target);
    if (!targetInfo?.isValid) {
      return null;
    }

    try {
      const commonTarget = this.projectPosition(targetInfo.target);
      const intersectionXY = pixelsToWorld(
        screenPosition,
        this.pixelUnprojectionMatrix,
        commonTarget[2]
      );
      const commonIntersection = [intersectionXY[0], intersectionXY[1], commonTarget[2]];
      const intersectionView = new Matrix4(this.viewMatrix).transformAsPoint(commonIntersection);
      const intersectionDepth = -intersectionView[2];
      if (
        !isFiniteArray(commonTarget) ||
        !isFiniteArray(commonIntersection) ||
        !isFiniteArray(intersectionView) ||
        !Number.isFinite(intersectionDepth) ||
        Math.abs(commonIntersection[2] - commonTarget[2]) >
          MINIMUM_TARGET_SCALE * Math.max(1, Math.abs(commonTarget[2])) ||
        intersectionDepth <= targetInfo.near ||
        intersectionDepth >= targetInfo.far
      ) {
        return null;
      }

      const center = [
        this.center[0] + commonTarget[0] - commonIntersection[0],
        this.center[1] + commonTarget[1] - commonIntersection[1],
        this.center[2]
      ];
      return this._getTargetViewStateFromCenter(center, this.bearing, this.pitch, this.zoom);
    } catch {
      return null;
    }
  }

  /**
   * Returns camera-relative information about a target in the viewport's rendered world copy.
   *
   * The input longitude is not mutated. The returned `target` is a numeric copy whose longitude
   * is shifted by a multiple of 360 degrees when necessary to address the active repeated world.
   * Projected coordinates are view-local and do not include this viewport's canvas `x`/`y` offset.
   * Returns `null` for unsupported projection modes or invalid target coordinates.
   */
  getTargetInfo(target: [number, number, number]): WebMercatorTargetInfo | null {
    if (
      !this.supportsTargetNavigation ||
      target.length !== 3 ||
      !isFiniteArray(target) ||
      Math.abs(target[1]) >= 90
    ) {
      return null;
    }

    try {
      const localizedTarget: [number, number, number] = [
        normalizeLongitude(target[0], this.longitude - this._worldOffset * 360),
        target[1],
        target[2]
      ];
      const commonPosition = this.projectPosition(localizedTarget);
      const projectedPosition = this.project(localizedTarget) as [number, number, number];
      const viewZ =
        this.viewMatrix[2] * commonPosition[0] +
        this.viewMatrix[6] * commonPosition[1] +
        this.viewMatrix[10] * commonPosition[2] +
        this.viewMatrix[14];
      const cameraDepth = -viewZ;
      const projection22 = this.projectionMatrix[10];
      const projection23 = this.projectionMatrix[14];
      const near = projection23 / (projection22 - 1);
      const far = projection23 / (projection22 + 1);
      // Freeze one isotropic local metric at the target. Web Mercator's local common-space scale
      // is conformal, so all three axes use the target latitude's meter conversion.
      const metersPerUnit = 1 / unitsPerMeter(localizedTarget[1]);
      const targetDistance = Math.hypot(
        (commonPosition[0] - this.cameraPosition[0]) * metersPerUnit,
        (commonPosition[1] - this.cameraPosition[1]) * metersPerUnit,
        (commonPosition[2] - this.cameraPosition[2]) * metersPerUnit
      );
      const isFinite =
        isFiniteArray(commonPosition) &&
        isFiniteArray(projectedPosition) &&
        Number.isFinite(cameraDepth) &&
        Number.isFinite(near) &&
        Number.isFinite(far) &&
        Number.isFinite(targetDistance);
      const hasValidClipRange = isFinite && near > 0 && far > near;
      const isValid =
        hasValidClipRange &&
        cameraDepth > 0 &&
        projectedPosition[2] > -1 &&
        projectedPosition[2] < 1;
      const isVisible =
        isValid &&
        projectedPosition[0] >= 0 &&
        projectedPosition[0] <= this.width &&
        projectedPosition[1] >= 0 &&
        projectedPosition[1] <= this.height;

      return {
        target: localizedTarget,
        projectedPosition,
        targetDistance,
        cameraDepth,
        near,
        far,
        isValid,
        isVisible
      };
    } catch {
      return null;
    }
  }

  /**
   * Reconstructs a canonical perspective map state around a world-space target.
   *
   * Call this method on the frozen operation-start viewport. The target is placed at the supplied
   * view-local screen position, which may be outside the viewport. Its physical camera distance is
   * multiplied by
   * `2 ** (sourceZoom - requestedZoom)`, so omitting `zoom` produces a rigid orbit. The active
   * field of view, padding, clipping configuration, position/model transform, and world copy are
   * represented by the source viewport and must also be supplied when constructing the result.
   *
   * Returns `null` for orthographic or custom projections, nonfinite/singular input, a target
   * behind or outside the source camera's clip volume, or an unrepresentable map state.
   */
  getTargetViewState(
    options: WebMercatorTargetViewStateOptions
  ): WebMercatorTargetViewState | null {
    const {target, screenPosition} = options;
    const bearing = options.bearing ?? this.bearing;
    const pitch = options.pitch ?? this.pitch;
    const requestedZoom = options.zoom ?? this.zoom;
    const requestedMinimumTargetDistance =
      options.minimumTargetDistance === undefined ? 0 : options.minimumTargetDistance;
    if (
      !isFiniteArray(screenPosition) ||
      !isFiniteArray([bearing, pitch, requestedZoom, requestedMinimumTargetDistance]) ||
      requestedMinimumTargetDistance < 0
    ) {
      return null;
    }

    const targetInfo = this.getTargetInfo(target);
    if (!targetInfo?.isValid) {
      return null;
    }

    try {
      const commonTarget = this.projectPosition(targetInfo.target);
      const sceneScale = Math.max(
        1,
        ...commonTarget.map(Math.abs),
        ...this.cameraPosition.map(Math.abs)
      );
      const metersPerCommonUnit = 1 / unitsPerMeter(targetInfo.target[1]);
      const minimumRepresentableTargetDistance = Math.max(
        MINIMUM_TARGET_SCALE * sceneScale * Math.abs(metersPerCommonUnit),
        targetInfo.near * Math.abs(metersPerCommonUnit) * 1e-9
      );
      if (
        !Number.isFinite(metersPerCommonUnit) ||
        targetInfo.targetDistance <= minimumRepresentableTargetDistance
      ) {
        return null;
      }

      // Target distance follows D = D0 * 2 ** (sourceZoom - requestedZoom). Solving this
      // expression for zoom yields an exact upper bound and keeps coarse and fine input streams
      // convergent. The acquisition distance is the floor when the camera starts inside the
      // requested limit, which prevents an unexpected outward jump.
      let zoom = requestedZoom;
      if (requestedMinimumTargetDistance > 0) {
        const sessionMinimumTargetDistance = Math.min(
          requestedMinimumTargetDistance,
          targetInfo.targetDistance
        );
        const maximumZoom =
          this.zoom + Math.log2(targetInfo.targetDistance / sessionMinimumTargetDistance);
        zoom = Math.min(zoom, maximumZoom);
      }

      const scale = Math.pow(2, zoom);
      if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(this.altitude)) {
        return null;
      }

      // `pixelUnprojectionMatrix` incorporates the active perspective lens, padding and viewport
      // dimensions. Transforming an arbitrary point on its pixel ray back into view space removes
      // the source camera pose and leaves a direction from the camera origin through the requested
      // pixel. Keeping the source target's camera-space radius while replacing only that direction
      // preserves physical radius (scaled by zoom below) without retaining the source pixel.
      const sourceCameraTarget = new Matrix4(this.viewMatrix).transformAsPoint(commonTarget);
      const sourceCameraRadius = Math.hypot(...sourceCameraTarget);
      const unprojectedPixel = pixelsToWorld(
        [screenPosition[0], screenPosition[1], 0.5],
        this.pixelUnprojectionMatrix
      );
      const commonRayPoint = unprojectedPixel.slice(0, 3);
      const cameraRay = new Matrix4(this.viewMatrix).transformAsPoint(commonRayPoint);
      const cameraRayLength = Math.hypot(...cameraRay);
      if (
        !isFiniteArray(sourceCameraTarget) ||
        !isFiniteArray(commonRayPoint) ||
        !isFiniteArray(cameraRay) ||
        !Number.isFinite(sourceCameraRadius) ||
        !Number.isFinite(cameraRayLength) ||
        sourceCameraRadius <= 0 ||
        cameraRayLength <= 0 ||
        cameraRay[2] >= 0
      ) {
        return null;
      }
      const cameraTarget = cameraRay.map(
        component => (component * sourceCameraRadius) / cameraRayLength
      );
      const requestedViewMatrix = new Matrix4(
        getViewMatrix({
          height: this.height,
          pitch,
          bearing,
          scale,
          altitude: this.altitude
        })
      );
      if (!hasStableInverse(requestedViewMatrix)) {
        return null;
      }
      const uncenteredTarget = requestedViewMatrix.invert().transformAsPoint(cameraTarget);
      const center = [
        commonTarget[0] + 512 * this._worldOffset - uncenteredTarget[0],
        commonTarget[1] - uncenteredTarget[1],
        commonTarget[2] - uncenteredTarget[2]
      ];
      if (!isFiniteArray(center)) {
        return null;
      }

      return this._getTargetViewStateFromCenter(center, bearing, pitch, zoom);
    } catch {
      return null;
    }
  }

  /** @internal Change the elevation reference without moving the perspective camera. */
  _getRebasedViewState(altitude: number): WebMercatorTargetViewState | null {
    if (!this.supportsTargetNavigation || !Number.isFinite(altitude)) return null;

    const centerZ = altitude * this.distanceScales.unitsPerMeter[2];
    const oldHeight = this.cameraPosition[2] - this.center[2];
    const newHeight = this.cameraPosition[2] - centerZ;
    const ratio = newHeight / oldHeight;
    if (!Number.isFinite(ratio) || oldHeight <= 0 || ratio <= MINIMUM_TARGET_SCALE) return null;

    // The camera-to-center vector scales with 2^-zoom. Move the reference along that vector,
    // then normalize the complete center (including XYZ offsets and the new latitude's metric).
    const center = this.center.map(
      (value, i) =>
        value +
        (1 - ratio) * (this.cameraPosition[i] + (i === 0 ? 512 * this._worldOffset : 0) - value)
    );
    center[2] = centerZ;
    return this._getTargetViewStateFromCenter(
      center,
      this.bearing,
      this.pitch,
      this.zoom - Math.log2(ratio)
    );
  }

  /** @internal Validate a constrained elevation rebase in the source viewport's metric. */
  _isSameCamera(viewport: WebMercatorViewport): boolean {
    if (
      !viewport.supportsTargetNavigation ||
      viewport.width !== this.width ||
      viewport.height !== this.height ||
      viewport.fovy !== this.fovy ||
      viewport.pitch !== this.pitch ||
      Math.abs(Math.sin(((viewport.bearing - this.bearing) * Math.PI) / 360)) > 1e-10
    )
      return false;

    const meters = this.distanceScales.metersPerUnit;
    const distance = Math.hypot(
      ...this.cameraPosition.map(
        (value, i) => (value + (i === 0 ? 512 * this._worldOffset : 0) - this.center[i]) * meters[i]
      )
    );
    const error = Math.hypot(
      ...this.cameraPosition.map((value, i) => (viewport.cameraPosition[i] - value) * meters[i])
    );
    if (!(error <= Math.max(0.01, distance * 1e-7))) return false;

    // Camera position alone does not check an asymmetric lens or invalid projection matrix.
    return [
      [0.3, 0.3],
      [0.5, 0.5],
      [0.7, 0.7]
    ].every(([x, y]) => {
      const pixel = [x * this.width, y * this.height];
      const world = this.unproject(pixel, {targetZ: 0});
      const projected = viewport.project(world);
      return Math.hypot(projected[0] - pixel[0], projected[1] - pixel[1]) <= 0.1;
    });
  }

  /** Converts a common-space viewport center into the canonical public map-state fields. */
  private _getTargetViewStateFromCenter(
    center: number[],
    bearing: number,
    pitch: number,
    zoom: number
  ): WebMercatorTargetViewState | null {
    if (!isFiniteArray(center) || !isFiniteArray([bearing, pitch, zoom])) {
      return null;
    }

    const [longitude, latitude] = this.unprojectFlat(center);
    const unitsPerMeterAtCenter = unitsPerMeter(latitude);
    if (
      !isFiniteArray([longitude, latitude, unitsPerMeterAtCenter]) ||
      Math.abs(latitude) >= 90 ||
      unitsPerMeterAtCenter <= 0
    ) {
      return null;
    }

    let position: number[] = [0, 0, center[2] / unitsPerMeterAtCenter];
    if (this.modelMatrix) {
      const inverseModelMatrix = new Matrix4(this.modelMatrix);
      if (!hasStableInverse(inverseModelMatrix)) {
        return null;
      }
      position = Array.from(inverseModelMatrix.invert().transformAsVector(position));
    }
    if (!isFiniteArray(position)) {
      return null;
    }

    return {
      longitude,
      latitude,
      zoom,
      bearing,
      pitch,
      position: position as [number, number, number]
    };
  }

  getBounds(options: {z?: number} = {}): [number, number, number, number] {
    // @ts-ignore
    const corners = getBounds(this, options.z || 0);

    return [
      Math.min(corners[0][0], corners[1][0], corners[2][0], corners[3][0]),
      Math.min(corners[0][1], corners[1][1], corners[2][1], corners[3][1]),
      Math.max(corners[0][0], corners[1][0], corners[2][0], corners[3][0]),
      Math.max(corners[0][1], corners[1][1], corners[2][1], corners[3][1])
    ];
  }

  /**
   * Returns a new viewport that fit around the given rectangle.
   * Only supports non-perspective mode.
   */
  fitBounds(
    /** [[lon, lat], [lon, lat]] */
    bounds: [[number, number], [number, number]],
    options: {
      /** If not supplied, will use the current width of the viewport (default `1`) */
      width?: number;
      /** If not supplied, will use the current height of the viewport (default `1`) */
      height?: number;
      /** In degrees, 0.01 would be about 1000 meters */
      minExtent?: number;
      /** Max zoom level */
      maxZoom?: number;
      /** Extra padding in pixels */
      padding?: number | Required<Padding>;
      /** Center shift in pixels */
      offset?: number[];
    } = {}
  ) {
    const {width, height} = this;
    const {longitude, latitude, zoom} = fitBounds({width, height, bounds, ...options});
    return new WebMercatorViewport({width, height, longitude, latitude, zoom});
  }
}
