// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {test, expect} from 'vitest';
import {
  MapController,
  MapView,
  _GlobeView as GlobeView,
  _GlobeViewport as GlobeViewport,
  WebMercatorViewport
} from '@deck.gl/core';
import type {
  ControllerOptions,
  ConstrainMapInteractionTargetViewState,
  DeckProps,
  GetMapInteractionTarget,
  MapControllerOptions,
  MapInteractionTarget,
  MapInteractionTargetContext,
  MapInteractionTargetOperation,
  MapInteractionTargetSource,
  MapInteractionTargetViewStateContext,
  MapViewProps,
  WebMercatorTargetInfo,
  WebMercatorTargetPanViewStateOptions,
  WebMercatorTargetViewState,
  WebMercatorTargetViewStateOptions
} from '@deck.gl/core';
import type {
  InteractionTarget,
  InteractionTargetContext,
  GetInteractionTarget,
  TargetNavigationOptions,
  GlobeControllerOptions,
  GlobeViewProps
} from '@deck.gl/core';
import type {
  InteractionTarget as MainInteractionTarget,
  GlobeControllerOptions as MainGlobeControllerOptions,
  TargetNavigationOptions as MainTargetNavigationOptions
} from 'deck.gl';
import type {
  ControllerOptions as MainControllerOptions,
  ConstrainMapInteractionTargetViewState as MainConstrainMapInteractionTargetViewState,
  GetMapInteractionTarget as MainGetMapInteractionTarget,
  MapControllerOptions as MainMapControllerOptions,
  MapInteractionTarget as MainMapInteractionTarget,
  MapInteractionTargetContext as MainMapInteractionTargetContext,
  MapInteractionTargetOperation as MainMapInteractionTargetOperation,
  MapInteractionTargetSource as MainMapInteractionTargetSource,
  MapInteractionTargetViewStateContext as MainMapInteractionTargetViewStateContext,
  MapViewProps as MainMapViewProps,
  WebMercatorTargetInfo as MainWebMercatorTargetInfo,
  WebMercatorTargetPanViewStateOptions as MainWebMercatorTargetPanViewStateOptions,
  WebMercatorTargetViewState as MainWebMercatorTargetViewState,
  WebMercatorTargetViewStateOptions as MainWebMercatorTargetViewStateOptions
} from 'deck.gl';

class CustomMapController extends MapController {}

type CustomMapControllerOptions = MapControllerOptions & {
  customMode?: 'precise';
};

const getInteractionTarget: GetMapInteractionTarget = (
  _context: MapInteractionTargetContext
): MapInteractionTarget | null => null;

const mapControllerOptions: MapControllerOptions = {
  dragPan: true,
  rotationPivot: '3d',
  _targetNavigation: true,
  getInteractionTarget
};
const constrainInteractionTargetViewState: ConstrainMapInteractionTargetViewState = context =>
  context.requestedViewState;
mapControllerOptions.constrainInteractionTargetViewState = constrainInteractionTargetViewState;

const mapViewProps: MapViewProps = {controller: mapControllerOptions};
const deckProps: DeckProps = {controller: mapControllerOptions};
const typedCustomMapViewProps: MapViewProps<CustomMapControllerOptions> = {
  controller: {
    type: CustomMapController,
    customMode: 'precise'
  }
};
const looseCustomMapViewProps: MapViewProps = typedCustomMapViewProps;

// The custom-controller escape hatch is intentionally permissive. Check excess fields against
// named options, rather than relying on excess-property checking of a union with an index signature.
const invalidMapControllerOptions: MapControllerOptions = {
  dragPan: true,
  // @ts-expect-error Custom options do not belong to the named built-in controller contract.
  customMode: 'precise'
};
const invalidMapViewProps: MapViewProps = {controller: invalidMapControllerOptions};
const invalidDeckProps: DeckProps = {
  // @ts-expect-error Known options retain their types even with the custom-controller escape hatch.
  controller: {dragPan: 'enabled'}
};

// Verify that all experimental contracts are available without deep imports from both packages.
const mainControllerOptions: MainMapControllerOptions = mapControllerOptions;
const baseControllerOptions: ControllerOptions = mainControllerOptions;
const mainBaseControllerOptions: MainControllerOptions = baseControllerOptions;
const mainMapViewProps: MainMapViewProps = mapViewProps;
const mainGetInteractionTarget: MainGetMapInteractionTarget = getInteractionTarget;
const mainConstrainInteractionTargetViewState: MainConstrainMapInteractionTargetViewState =
  constrainInteractionTargetViewState;
type PublicTargetContracts =
  | MapInteractionTargetOperation
  | MapInteractionTargetSource
  | MapInteractionTargetViewStateContext
  | WebMercatorTargetInfo
  | WebMercatorTargetPanViewStateOptions
  | WebMercatorTargetViewState
  | WebMercatorTargetViewStateOptions
  | MainMapInteractionTarget
  | MainMapInteractionTargetContext
  | MainMapInteractionTargetOperation
  | MainMapInteractionTargetSource
  | MainMapInteractionTargetViewStateContext
  | MainWebMercatorTargetInfo
  | MainWebMercatorTargetPanViewStateOptions
  | MainWebMercatorTargetViewState
  | MainWebMercatorTargetViewStateOptions;
const publicTargetContract: PublicTargetContracts | null = null;
const trackpadSource: MapInteractionTargetSource = 'trackpad';

const genericProvider: GetInteractionTarget = context => {
  const pixel: number[] | null = context.screenPosition;
  return pixel ? {coordinate: [0, 0, 0], screenPosition: [pixel[0], pixel[1]]} : null;
};
const genericOptions: TargetNavigationOptions = {
  _targetNavigation: true,
  getInteractionTarget: genericProvider
};
const globeOptions: GlobeControllerOptions = {
  ...genericOptions,
  getInteractionTarget: context => {
    const viewport: GlobeViewport | WebMercatorViewport = context.viewport;
    return viewport.getTargetInfo([0, 0, 0])?.isVisible
      ? {coordinate: [0, 0, 0], screenPosition: [0, 0]}
      : null;
  }
};
const globeViewProps: GlobeViewProps = {controller: globeOptions};
const mainGlobeOptions: MainGlobeControllerOptions = globeOptions;
const mainGenericOptions: MainTargetNavigationOptions = genericOptions;
const compatibilityTarget: InteractionTarget | MainInteractionTarget | MapInteractionTarget | null =
  null;
const compatibilityContext:
  | InteractionTargetContext<WebMercatorViewport>
  | MapInteractionTargetContext
  | null = null;
const incompatibleProvider: TargetNavigationOptions = {
  // @ts-expect-error A Web Mercator-only callback cannot accept arbitrary viewports.
  getInteractionTarget
};

test('MapView types map controller options and preserve a custom controller escape hatch', () => {
  const mapView = new MapView(mapViewProps);
  const customMapView = new MapView(looseCustomMapViewProps);
  const inlineCustomMapView = new MapView({
    controller: {type: CustomMapController, customMode: 'precise'}
  });

  expect(mapView.controller).toMatchObject({
    type: MapController,
    dragPan: true,
    rotationPivot: '3d',
    _targetNavigation: true,
    getInteractionTarget
  });
  expect(customMapView.controller).toMatchObject({
    type: CustomMapController,
    customMode: 'precise'
  });
  expect(inlineCustomMapView.controller).toMatchObject({
    type: CustomMapController,
    customMode: 'precise'
  });
  expect(deckProps.controller).toBe(mapControllerOptions);
  expect(mainMapViewProps).toBe(mapViewProps);
  expect(mainBaseControllerOptions).toBe(baseControllerOptions);
  expect(mainGetInteractionTarget).toBe(getInteractionTarget);
  expect(mainConstrainInteractionTargetViewState).toBe(constrainInteractionTargetViewState);
  expect(publicTargetContract).toBeNull();
  expect(trackpadSource).toBe('trackpad');
  expect(invalidMapViewProps.controller).toEqual({dragPan: true, customMode: 'precise'});
  expect(invalidDeckProps.controller).toEqual({dragPan: 'enabled'});
  expect(new GlobeView(globeViewProps).controller).toMatchObject(mainGlobeOptions);
  expect(mainGenericOptions).toBe(genericOptions);
  expect(compatibilityTarget).toBeNull();
  expect(compatibilityContext).toBeNull();
  expect(incompatibleProvider.getInteractionTarget).toBe(getInteractionTarget);
});
