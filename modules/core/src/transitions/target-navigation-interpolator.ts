// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import LinearInterpolator from './linear-interpolator';
import assert from '../utils/assert';
import {lerp} from '@math.gl/core';

import type {MapInteractionTarget} from '../controllers/map-controller';

const DEFAULT_TRANSITION_PROPS = {
  compare: ['longitude', 'latitude', 'zoom', 'bearing', 'pitch', 'position'],
  required: ['longitude', 'latitude', 'zoom']
};

type TransitionProps =
  | string[]
  | {
      compare: string[];
      extract?: string[];
      required?: string[];
    };

type FrozenMapInteractionTarget = {
  readonly coordinate: readonly [number, number, number];
  readonly screenPosition: readonly [number, number];
};

/** Camera invariant used to reconstruct target-aware transition frames. */
export type TargetNavigationTransitionMode = 'orbit' | 'pan';

type TargetNavigationTransitionContextBase = {
  /** Frozen world coordinate and view-local screen position acquired before the transition. */
  readonly target: FrozenMapInteractionTarget;
  /** Desired view-local target pixel for this frame. */
  readonly screenPosition: readonly [number, number];
  /** Interpolation progress in the range supplied by the transition manager. */
  readonly progress: number;
  /** Most recently accepted frame, or the current view state before the first accepted frame. */
  readonly previousProps: Readonly<Record<string, any>>;
};

/** Numeric metadata retained for one target-aware map transition. */
export type TargetNavigationTransitionContext =
  | (TargetNavigationTransitionContextBase & {
      /** Radius-preserving orbit/zoom frame. */
      readonly mode: 'orbit';
      /** Desired camera-to-target radius for this frame. */
      readonly radius: number;
    })
  | (TargetNavigationTransitionContextBase & {
      /** Common-XY target-pan frame. */
      readonly mode: 'pan';
    });

/**
 * Applies the target-relative camera transform and validates its result.
 *
 * The resolver must apply ordinary controller constraints and validate the target pixel,
 * camera radius and other supported camera invariants. It returns `null` when no valid
 * representation exists. Neither argument should be mutated.
 */
export type ResolveTargetNavigationTransitionFrame = (
  interpolatedProps: Readonly<Record<string, any>>,
  context: TargetNavigationTransitionContext
) => Record<string, any> | null;

type TargetNavigationInterpolatorOptionsBase = {
  /** Numeric target snapshot retained for the entire transition. */
  target: MapInteractionTarget;
  /** View-local target pixel at the transition endpoint. Defaults to the start pixel. */
  endScreenPosition?: [number, number];
  /** Applies the camera transform, controller constraints and invariant validation. */
  resolveFrame: ResolveTargetNavigationTransitionFrame;
  /** Map view-state properties to interpolate. Defaults to the standard MapController set. */
  transitionProps?: TransitionProps;
};

export type TargetNavigationInterpolatorOptions = TargetNavigationInterpolatorOptionsBase &
  (
    | {
        /** Radius-preserving orbit/zoom transition. This is the compatibility default. */
        mode?: 'orbit';
        /** Perspective camera-to-target radius at the start of the transition. */
        startRadius: number;
      }
    | {
        /** Common-XY target-pan transition. */
        mode: 'pan';
        startRadius?: never;
      }
  );

function copyTransitionProps(props: Readonly<Record<string, any>>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key in props) {
    const value = props[key];
    result[key] = Array.isArray(value) ? value.slice() : value;
  }
  return result;
}

function freezeTransitionProps(
  props: Readonly<Record<string, any>>
): Readonly<Record<string, any>> {
  const result = copyTransitionProps(props);
  for (const key in result) {
    if (Array.isArray(result[key])) {
      Object.freeze(result[key]);
    }
  }
  return Object.freeze(result);
}

function isFiniteTuple(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(component => Number.isFinite(component))
  );
}

/**
 * Linearly interpolates map view state while delegating target-relative camera construction
 * and validation to a controller callback on every frame.
 *
 * The target contains numeric coordinates only and is copied before it is retained. When the
 * callback reports no solution, the exact last accepted frame is returned. Initialization seeds
 * that fallback from the already validated canonical start props. The `t = 0` frame reuses that
 * state without a redundant camera inverse; subsequent animated frames are resolved normally.
 */
export default class TargetNavigationInterpolator extends LinearInterpolator {
  readonly target: FrozenMapInteractionTarget;
  readonly mode: TargetNavigationTransitionMode;
  readonly startRadius: number | null;

  private readonly resolveFrame: ResolveTargetNavigationTransitionFrame;
  private readonly endScreenPosition: readonly [number, number];
  private lastAcceptedProps: Record<string, any> | null = null;

  constructor(options: TargetNavigationInterpolatorOptions) {
    super({transitionProps: options.transitionProps || DEFAULT_TRANSITION_PROPS});

    assert(isFiniteTuple(options.target.coordinate, 3), 'target coordinate must be finite');
    assert(
      isFiniteTuple(options.target.screenPosition, 2),
      'target screen position must be finite'
    );
    const mode = options.mode || 'orbit';
    if (mode === 'orbit') {
      assert(
        Number.isFinite(options.startRadius) && Number(options.startRadius) > 0,
        'start radius must be positive and finite'
      );
    }
    assert(
      !options.endScreenPosition || isFiniteTuple(options.endScreenPosition, 2),
      'end screen position must be finite'
    );
    assert(typeof options.resolveFrame === 'function', 'resolveFrame must be a function');

    this.target = Object.freeze({
      coordinate: Object.freeze([...options.target.coordinate]) as readonly [
        number,
        number,
        number
      ],
      screenPosition: Object.freeze([...options.target.screenPosition]) as readonly [number, number]
    });
    this.mode = mode;
    this.startRadius = options.mode === 'pan' ? null : options.startRadius;
    this.endScreenPosition = Object.freeze([
      ...(options.endScreenPosition || options.target.screenPosition)
    ]) as readonly [number, number];
    this.resolveFrame = options.resolveFrame;
  }

  initializeProps(
    startProps: Record<string, any>,
    endProps: Record<string, any>
  ): {
    start: Record<string, any>;
    end: Record<string, any>;
  } {
    const result = super.initializeProps(startProps, endProps);
    this.lastAcceptedProps = copyTransitionProps(result.start);
    return result;
  }

  interpolateProps(
    startProps: Record<string, any>,
    endProps: Record<string, any>,
    t: number
  ): Record<string, any> {
    const interpolatedProps = super.interpolateProps(startProps, endProps, t);
    const startZoom = startProps.zoom;
    const zoom = interpolatedProps.zoom;

    assert(Number.isFinite(startZoom), 'start zoom is required for target navigation transition');
    assert(Number.isFinite(zoom), 'interpolated zoom must be finite');

    if (!this.lastAcceptedProps) {
      this.lastAcceptedProps = copyTransitionProps(startProps);
    }
    if (t <= 0) {
      return this.lastAcceptedProps;
    }

    const contextBase: TargetNavigationTransitionContextBase = {
      target: this.target,
      screenPosition: Object.freeze(
        lerp([...this.target.screenPosition], [...this.endScreenPosition], t) as number[]
      ) as readonly [number, number],
      progress: t,
      previousProps: freezeTransitionProps(this.lastAcceptedProps)
    };
    const context: TargetNavigationTransitionContext =
      this.mode === 'pan'
        ? {...contextBase, mode: 'pan'}
        : {
            ...contextBase,
            mode: 'orbit',
            radius: this.startRadius! * 2 ** (startZoom - zoom)
          };
    const resolvedFrame = this.resolveFrame(freezeTransitionProps(interpolatedProps), context);

    if (resolvedFrame) {
      this.lastAcceptedProps = copyTransitionProps(resolvedFrame);
    }
    return this.lastAcceptedProps;
  }
}
