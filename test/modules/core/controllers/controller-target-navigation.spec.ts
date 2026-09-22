// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  Controller,
  Viewport,
  LinearInterpolator,
  FirstPersonController,
  FirstPersonView
} from '@deck.gl/core';
import type {InteractionTarget, InteractionTargetOperation, InteractionState} from '@deck.gl/core';
import type {IViewState} from '@deck.gl/core/controllers/view-state';
import type {
  InteractionTargetSession,
  InteractionTargetState
} from '@deck.gl/core/controllers/interaction-target';
import TargetNavigationInterpolator from '@deck.gl/core/transitions/target-navigation-interpolator';
import {Timeline} from '@luma.gl/engine';

// A deliberately small structural state: no MapState, geographic coordinates, zoom, or radius.
// It tests the ownership contract, not a production camera's geometric invariants.
class CartesianState implements IViewState<CartesianState> {
  constructor(private readonly props: Record<string, any>) {
    props.session ||= {
      interactionTarget: props.interactionTarget,
      targetNavigationSessionId: props.targetNavigationSessionId
    };
  }
  getViewportProps() {
    return {position: this.props.position || [0, 0, 0]};
  }
  getState(): InteractionTargetState {
    return this.props.session || {};
  }
  shortestPathFrom() {
    return this.getViewportProps();
  }
  getTargetNavigationViewport(operation?: InteractionTargetOperation) {
    return operation === 'rotate' || operation === 'pinch'
      ? null
      : this.props.makeViewport(this.props);
  }
  validateInteractionTarget(target: InteractionTarget) {
    return target;
  }
  withInteractionTarget(target: InteractionTarget, session: InteractionTargetSession) {
    return this.update({
      session: {interactionTarget: target, targetNavigationSessionId: session.sessionId}
    });
  }
  withoutInteractionTarget() {
    return this.update({session: {}});
  }
  createTargetNavigationInterpolator() {
    return new TargetNavigationInterpolator({
      target: this.getState().interactionTarget!,
      transitionProps: ['position'],
      resolveFrame: props => ({...props})
    });
  }
  panStart() {
    return this;
  }
  pan() {
    return this.update({position: [1, 2, 3]});
  }
  panEnd() {
    return this;
  }
  rotateStart() {
    return this;
  }
  rotate() {
    return this;
  }
  rotateEnd() {
    return this;
  }
  zoomStart() {
    return this;
  }
  zoom() {
    return this.update({position: [4, 5, 6]});
  }
  zoomEnd() {
    return this;
  }
  zoomIn() {
    return this.zoom();
  }
  zoomOut() {
    return this.zoom();
  }
  moveLeft() {
    return this.pan();
  }
  moveRight() {
    return this.pan();
  }
  moveUp() {
    return this.pan();
  }
  moveDown() {
    return this.pan();
  }
  rotateLeft() {
    return this;
  }
  rotateRight() {
    return this;
  }
  rotateUp() {
    return this;
  }
  rotateDown() {
    return this;
  }
  private update(props: Record<string, any>) {
    return new CartesianState({...this.props, ...props});
  }
}

class CartesianController extends Controller<CartesianState> {
  ControllerState = CartesianState;
  dragMode: 'pan' | 'rotate' = 'pan';
  transition = {
    transitionDuration: 300,
    transitionInterpolator: new LinearInterpolator(['position'])
  };
}

const controllers: Controller<any>[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.finalize();
  vi.useRealTimers();
});

function event(type: string, extra: Record<string, any> = {}) {
  return {
    type,
    pointerType: 'mouse',
    device: 'mouse',
    offsetCenter: {x: 100, y: 100},
    delta: 20,
    srcEvent: {preventDefault() {}},
    stopPropagation() {},
    ...extra
  } as any;
}

function harness(options: Record<string, any> = {}, ControllerClass = CartesianController) {
  const timeline = new Timeline();
  const interaction: InteractionState = {};
  const target: InteractionTarget = {coordinate: [1, 2, 3], screenPosition: [100, 100]};
  const provider = vi.fn(() => target);
  const viewport = new Viewport({id: 'cartesian', width: 400, height: 300});
  let props = {
    id: 'cartesian',
    width: 400,
    height: 300,
    x: 0,
    y: 0,
    position: [0, 0, 0],
    _targetNavigation: true,
    getInteractionTarget: provider,
    ...options
  };
  const controller = new ControllerClass({
    timeline,
    eventManager: null as any,
    makeViewport: () => viewport,
    pickPosition: options.pickPosition,
    onStateChange: state => Object.assign(interaction, state),
    onViewStateChange: ({viewState}) => {
      props = {...props, ...viewState};
      controller.setProps(props);
    }
  });
  controllers.push(controller);
  controller.setProps(props);
  return {
    controller,
    timeline,
    interaction,
    provider,
    target,
    viewport,
    update: (next: Record<string, any>) => {
      props = {...props, ...next};
      controller.setProps(props);
    }
  };
}

describe('Controller shared target lifecycle', () => {
  it('owns a copied numeric target for a structural non-Map state and releases it after pan', () => {
    const fixture = harness();
    fixture.controller.handleEvent(event('panstart'));
    const coordinate = [...fixture.target.coordinate];
    fixture.target.coordinate[0] = 900;
    fixture.controller.handleEvent(event('panmove'));
    expect(fixture.interaction.interactionTargetPosition).toEqual(coordinate);
    expect(fixture.controller.controllerState.getViewportProps()).toEqual({position: [1, 2, 3]});
    fixture.controller.handleEvent(event('panend'));
    expect(fixture.interaction.interactionTargetPosition).toBeUndefined();
    expect(fixture.provider).toHaveBeenCalledTimes(1);
  });

  it('runs target transitions without a zoom field and clears ownership on completion', () => {
    const fixture = harness();
    fixture.controller.handleEvent(event('dblclick'));
    fixture.timeline.setTime(150);
    fixture.controller.updateTransition();
    expect(fixture.controller.controllerState.getViewportProps()).toEqual({position: [2, 2.5, 3]});
    expect(fixture.interaction.interactionTargetPosition).toEqual(fixture.target.coordinate);
    fixture.timeline.setTime(301);
    fixture.controller.updateTransition();
    expect(fixture.interaction.interactionTargetPosition).toBeUndefined();
  });

  it('does not call a provider for unsupported operations or compound input', () => {
    const fixture = harness({touchRotate: true});
    fixture.controller.handleEvent(event('panstart', {rightButton: true}));
    fixture.controller.handleEvent(event('panend'));
    fixture.controller.handleEvent(event('pinchstart', {pointerType: 'touch'}));
    expect(fixture.provider).not.toHaveBeenCalled();
    expect(fixture.interaction.interactionTargetPosition).toBeUndefined();
  });

  it('retains a wheel snapshot across callback replacement and releases it on expiry', () => {
    vi.useFakeTimers();
    const fixture = harness();
    fixture.controller.handleEvent(event('wheel'));
    const replacement = vi.fn(() => null);
    fixture.update({getInteractionTarget: replacement});
    fixture.controller.handleEvent(event('wheel'));
    expect(fixture.provider).toHaveBeenCalledTimes(1);
    expect(replacement).not.toHaveBeenCalled();
    vi.advanceTimersByTime(151);
    expect(fixture.interaction.interactionTargetPosition).toBeUndefined();
  });

  it('enforces numeric validation after an overridden resolver', () => {
    class InvalidResolverController extends CartesianController {
      protected resolveInteractionTarget(): InteractionTarget {
        return {coordinate: [Number.NaN, 2, 3], screenPosition: [100, 100]};
      }
    }
    const fixture = harness({}, InvalidResolverController);
    fixture.controller.handleEvent(event('panstart'));
    expect(fixture.interaction.interactionTargetPosition).toBeUndefined();
  });

  it('rejects built-in picks owned by a different view', () => {
    const pickPosition = vi.fn(() => ({
      coordinate: [1, 2, 3],
      viewport: new Viewport({id: 'other'})
    }));
    const fixture = harness({getInteractionTarget: undefined, pickPosition});
    fixture.controller.handleEvent(event('panstart'));
    expect(pickPosition).toHaveBeenCalledTimes(1);
    expect(fixture.interaction.interactionTargetPosition).toBeUndefined();
  });

  it('cancels on structural changes and exceptions without leaking the public target', () => {
    const fixture = harness();
    fixture.controller.handleEvent(event('panstart'));
    fixture.update({width: 500});
    expect(fixture.interaction.interactionTargetPosition).toBeUndefined();
    fixture.update({
      getInteractionTarget() {
        throw new Error('provider failed');
      }
    });
    expect(() => fixture.controller.handleEvent(event('panstart'))).toThrow('provider failed');
    expect(fixture.interaction.interactionTargetPosition).toBeUndefined();
  });

  it('leaves FirstPerson look-only navigation nonparticipating', () => {
    const provider = vi.fn();
    const view = new FirstPersonView();
    const controller = new FirstPersonController({
      timeline: new Timeline(),
      eventManager: null as any,
      makeViewport: props => view.makeViewport({width: 400, height: 300, viewState: props})!,
      onViewStateChange() {},
      onStateChange() {}
    });
    controllers.push(controller);
    controller.setProps({
      id: 'first-person',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      position: [0, 0, 10],
      _targetNavigation: true,
      getInteractionTarget: provider
    } as any);
    controller.handleEvent(event('panstart'));
    controller.handleEvent(event('panmove', {offsetCenter: {x: 110, y: 105}}));
    expect(provider).not.toHaveBeenCalled();
    expect(controller.controllerState.getViewportProps().position).toEqual([0, 0, 10]);
  });
});
