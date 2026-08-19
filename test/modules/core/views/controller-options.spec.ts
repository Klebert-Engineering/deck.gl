// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {test, expect} from 'vitest';
import {MapController, MapView} from '@deck.gl/core';
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

const invalidMapViewProps: MapViewProps = {
  // @ts-expect-error Custom controller options require an explicit custom controller type
  controller: {dragPan: true, customMode: 'precise'}
};
const invalidDeckProps: DeckProps = {
  // @ts-expect-error Deck's MapView shorthand rejects unrelated controller options
  controller: {dragPan: true, customMode: 'precise'}
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
  expect(invalidDeckProps.controller).toEqual({dragPan: true, customMode: 'precise'});
});
