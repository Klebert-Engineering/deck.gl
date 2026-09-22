// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type Viewport from '../viewports/viewport';

/** A numeric coordinate in the owning viewport's world space and its projected CSS pixel. */
export type InteractionTarget = {
  coordinate: [number, number, number];
  screenPosition: [number, number];
  /** Minimum camera distance, in metres for geographic views. Frozen for one session. */
  minimumTargetDistance?: number;
};

/** Camera operation acquiring an interaction target. */
export type InteractionTargetOperation = 'pan' | 'zoom' | 'rotate' | 'pinch';

/** Input source acquiring an interaction target. */
export type InteractionTargetSource =
  | 'pointer'
  | 'touch'
  | 'trackpad'
  | 'wheel'
  | 'doubleClick'
  | 'keyboard';

/** Context for a synchronous, view-scoped target provider. */
export type InteractionTargetContext<ViewportT extends Viewport = Viewport> = {
  viewId: string;
  operation: InteractionTargetOperation;
  source: InteractionTargetSource;
  /** View-local acquisition pixel, or null for pointerless input. */
  screenPosition: [number, number] | null;
  viewport: ViewportT;
};

/** Resolves a fresh numeric target, or selects the complete stock interaction path. */
export type GetInteractionTarget<ViewportT extends Viewport = Viewport> = (
  context: Readonly<InteractionTargetContext<ViewportT>>
) => InteractionTarget | null;

/** Experimental options shared by controllers that support target navigation. */
export type TargetNavigationOptions<ViewportT extends Viewport = Viewport> = {
  /** Enable target navigation for supported operations. Default false. */
  _targetNavigation?: boolean;
  /** Authoritative synchronous provider; null does not fall through to built-in picking. */
  getInteractionTarget?: GetInteractionTarget<ViewportT>;
};

/** @internal Controller-owned identity and input origin of a frozen target session. */
export type InteractionTargetSession = {
  viewId: string;
  operation: InteractionTargetOperation;
  source: InteractionTargetSource;
  sessionId: number;
  inputOrigin?: [number, number] | null;
};

/** @internal Transient state shared with the controller; camera geometry stays in each state. */
export type InteractionTargetState = {
  interactionTarget?: InteractionTarget;
  targetNavigationSessionId?: number;
  targetNavigationScreenPosition?: [number, number];
  targetNavigationOperation?: InteractionTargetOperation;
};

/** Copies only finite numeric target fields, excluding application objects and metadata. */
export function copyInteractionTarget(target: InteractionTarget | null): InteractionTarget | null {
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
  return {
    coordinate: [...target.coordinate],
    screenPosition: [...target.screenPosition],
    ...(target.minimumTargetDistance === undefined
      ? {}
      : {minimumTargetDistance: target.minimumTargetDistance})
  };
}

/** Captures only hard view configuration, never a camera pose or derived clip matrix. */
export function getInteractionTargetStructure(props: Record<string, any>): Record<string, unknown> {
  const view = props._view;
  const viewProps = view?.props || {};
  const result: Record<string, unknown> = {type: view?.constructor};
  for (const key of [
    'canvasId',
    'padding',
    'repeat',
    'nearZMultiplier',
    'farZMultiplier',
    'nearZ',
    'farZ',
    'near',
    'far',
    'projectionMatrix',
    'fovy',
    'altitude',
    'orthographic',
    'modelMatrix',
    'worldOffset',
    'up',
    'focalDistance',
    'legacyMeterSizes',
    'rubberBand'
  ]) {
    const value =
      viewProps[key] ??
      props[key] ??
      (key === 'altitude'
        ? 1.5
        : ['rubberBand', 'legacyMeterSizes'].includes(key)
          ? false
          : undefined);
    result[key] = Array.isArray(value)
      ? [...value]
      : value && typeof value === 'object'
        ? {...value}
        : value;
  }
  return result;
}
