// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';
import TargetNavigationInterpolator from '@deck.gl/core/transitions/target-navigation-interpolator';

import type {
  ResolveTargetNavigationTransitionFrame,
  TargetNavigationTransitionContext
} from '@deck.gl/core/transitions/target-navigation-interpolator';

const START_PROPS = {
  longitude: 10,
  latitude: 20,
  zoom: 10,
  bearing: 0,
  pitch: 20,
  position: [0, 0, 0]
};

const END_PROPS = {
  longitude: 14,
  latitude: 24,
  zoom: 12,
  bearing: 80,
  pitch: 40,
  position: [4, 8, 12]
};

const TRANSITION_PROPS = Object.keys(START_PROPS);

describe('TargetNavigationInterpolator', () => {
  it('carries a frozen numeric target and delegates the camera curve to the resolver', () => {
    const coordinate: [number, number, number] = [11.25, 47.75, 125];
    const screenPosition: [number, number] = [320, 240];
    const endScreenPosition: [number, number] = [420, 340];
    const sourceTarget = {coordinate, screenPosition, featureId: 'application-only'};
    const contexts: TargetNavigationTransitionContext[] = [];
    const resolveFrame = vi.fn(
      (props: Readonly<Record<string, any>>, context: TargetNavigationTransitionContext) => {
        contexts.push(context);
        return {
          ...props,
          acceptedRadius: 100 * 2 ** (START_PROPS.zoom - props.zoom)
        };
      }
    );
    const interpolator = new TargetNavigationInterpolator({
      target: sourceTarget,
      transitionProps: TRANSITION_PROPS,
      endScreenPosition,
      resolveFrame
    });

    coordinate[0] = 0;
    screenPosition[0] = 0;
    endScreenPosition[0] = 0;

    const {start, end} = interpolator.initializeProps(START_PROPS, END_PROPS);
    expect(resolveFrame).not.toHaveBeenCalled();

    const initial = interpolator.interpolateProps(start, end, 0);
    expect(resolveFrame).not.toHaveBeenCalled();
    const quarter = interpolator.interpolateProps(start, end, 0.25);
    const half = interpolator.interpolateProps(start, end, 0.5);
    const threeQuarters = interpolator.interpolateProps(start, end, 0.75);

    expect(initial).toMatchObject(START_PROPS);
    expect(quarter).toMatchObject({
      longitude: 11,
      latitude: 21,
      zoom: 10.5,
      bearing: 20,
      pitch: 25,
      position: [1, 2, 3],
      acceptedRadius: 100 * 2 ** -0.5
    });
    expect(half).toMatchObject({zoom: 11, acceptedRadius: 50});
    expect(threeQuarters).toMatchObject({zoom: 11.5, acceptedRadius: 100 * 2 ** -1.5});

    expect(resolveFrame).toHaveBeenCalledTimes(3);
    expect(contexts.map(context => context.progress)).toEqual([0.25, 0.5, 0.75]);
    expect(contexts.map(context => context.screenPosition)).toEqual([
      [345, 265],
      [370, 290],
      [395, 315]
    ]);
    expect(Object.isFrozen(contexts[1].screenPosition)).toBe(true);
    expect(contexts[1].target).toEqual({
      coordinate: [11.25, 47.75, 125],
      screenPosition: [320, 240]
    });
    expect(Object.isFrozen(contexts[1].target)).toBe(true);
    expect(Object.isFrozen(contexts[1].target.coordinate)).toBe(true);
    expect(Object.isFrozen(contexts[1].target.screenPosition)).toBe(true);
    expect(contexts[0].previousProps).toEqual(start);
    expect(Object.isFrozen(contexts[0].previousProps)).toBe(true);
    expect(Object.isFrozen(contexts[0].previousProps.position)).toBe(true);
    expect('featureId' in contexts[1].target).toBe(false);
    expect(contexts.every(context => !('radius' in context))).toBe(true);
  });

  it('interpolates planar target pixels without manufacturing a radius', () => {
    const contexts: TargetNavigationTransitionContext[] = [];
    const interpolator = new TargetNavigationInterpolator({
      transitionProps: TRANSITION_PROPS,
      target: {coordinate: [11.25, 47.75, 125], screenPosition: [320, 240]},
      endScreenPosition: [440, 300],
      resolveFrame: (props, context) => {
        contexts.push(context);
        return {...props, acceptedMode: 'pan'};
      }
    });
    const {start, end} = interpolator.initializeProps(START_PROPS, END_PROPS);

    expect(interpolator.interpolateProps(start, end, 0.25)).toMatchObject({
      acceptedMode: 'pan'
    });
    expect(interpolator.interpolateProps(start, end, 0.5)).toMatchObject({acceptedMode: 'pan'});

    expect(contexts.map(context => context.screenPosition)).toEqual([
      [350, 255],
      [380, 270]
    ]);
    expect(contexts.every(context => !('mode' in context))).toBe(true);
    expect(contexts.every(context => !('radius' in context))).toBe(true);
  });

  it.each([
    {endScreenPosition: new Array(2)},
    {endScreenPosition: Object.assign(new Array(2), {0: 320})},
    {endScreenPosition: [320]},
    {endScreenPosition: [320, 240, 0]},
    {endScreenPosition: [NaN, 240]},
    {endScreenPosition: [320, Infinity]}
  ])('rejects malformed transition endpoints %j', ({endScreenPosition}) => {
    const resolveFrame = vi.fn();
    expect(
      () =>
        new TargetNavigationInterpolator({
          target: {coordinate: [11.25, 47.75, 125], screenPosition: [320, 240]},
          endScreenPosition: endScreenPosition as [number, number],
          transitionProps: TRANSITION_PROPS,
          resolveFrame
        })
    ).toThrow('end screen position must be finite');
    expect(resolveFrame).not.toHaveBeenCalled();
  });

  it('passes the frozen distance policy to the model without requiring map fields', () => {
    const outsideContexts: TargetNavigationTransitionContext[] = [];
    const outside = new TargetNavigationInterpolator({
      target: {
        coordinate: [11.25, 47.75, 125],
        screenPosition: [320, 240],
        minimumTargetDistance: 60
      },
      transitionProps: ['position'],
      resolveFrame: (props, context) => {
        outsideContexts.push(context);
        return {...props};
      }
    });
    const outsideProps = outside.initializeProps({position: [0, 0, 0]}, {position: [4, 8, 12]});
    outside.interpolateProps(outsideProps.start, outsideProps.end, 0.25);
    outside.interpolateProps(outsideProps.start, outsideProps.end, 0.75);
    expect(outsideContexts.every(context => !('radius' in context))).toBe(true);
    expect(outside.interpolateProps(outsideProps.start, outsideProps.end, 0.5)).toEqual({
      position: [2, 4, 6]
    });
    expect(outsideContexts[0].target.minimumTargetDistance).toBe(60);

    const insideContexts: TargetNavigationTransitionContext[] = [];
    const inside = new TargetNavigationInterpolator({
      target: {
        coordinate: [11.25, 47.75, 125],
        screenPosition: [320, 240],
        minimumTargetDistance: 120
      },
      transitionProps: TRANSITION_PROPS,
      resolveFrame: (props, context) => {
        insideContexts.push(context);
        return {...props};
      }
    });
    const insideProps = inside.initializeProps(START_PROPS, {...END_PROPS, zoom: 14});
    inside.interpolateProps(insideProps.start, insideProps.end, 0.5);
    expect(insideContexts[0].target.minimumTargetDistance).toBe(120);
  });

  it.each([-1, Number.NaN, Infinity, null as unknown as number, '20' as unknown as number])(
    'rejects invalid minimum target distance %s',
    minimumTargetDistance => {
      expect(
        () =>
          new TargetNavigationInterpolator({
            target: {
              coordinate: [11.25, 47.75, 125],
              screenPosition: [320, 240],
              minimumTargetDistance
            },
            transitionProps: TRANSITION_PROPS,
            resolveFrame: props => ({...props})
          })
      ).toThrow('minimum target distance must be non-negative and finite');
    }
  );

  it('retains the exact previous valid frame on no solution and resumes afterwards', () => {
    let callbackResult: Record<string, any> | null = null;
    const resolveFrame: ResolveTargetNavigationTransitionFrame = (props, {progress}) => {
      if (progress === 0.5) {
        return null;
      }
      callbackResult = {...props, acceptedAt: progress};
      return callbackResult;
    };
    const interpolator = new TargetNavigationInterpolator({
      target: {coordinate: [11.25, 47.75, 125], screenPosition: [320, 240]},
      transitionProps: TRANSITION_PROPS,
      resolveFrame
    });
    const {start, end} = interpolator.initializeProps(START_PROPS, END_PROPS);

    const quarter = interpolator.interpolateProps(start, end, 0.25);
    expect(quarter).not.toBe(callbackResult);

    const rejectedHalf = interpolator.interpolateProps(start, end, 0.5);
    expect(rejectedHalf).toBe(quarter);

    const threeQuarters = interpolator.interpolateProps(start, end, 0.75);
    expect(threeQuarters).not.toBe(quarter);
    expect(threeQuarters).toMatchObject({zoom: 11.5, acceptedAt: 0.75});
  });

  it('uses the canonical start state without resolving the redundant t=0 frame', () => {
    const resolveFrame = vi.fn(() => null);
    const interpolator = new TargetNavigationInterpolator({
      target: {coordinate: [11.25, 47.75, 125], screenPosition: [320, 240]},
      transitionProps: TRANSITION_PROPS,
      resolveFrame
    });
    const {start, end} = interpolator.initializeProps(START_PROPS, END_PROPS);
    expect(resolveFrame).not.toHaveBeenCalled();

    const rejectedStartFrame = interpolator.interpolateProps(start, end, 0);
    const firstRejectedFrame = interpolator.interpolateProps(start, end, 0.25);
    const secondRejectedFrame = interpolator.interpolateProps(start, end, 0.5);

    expect(resolveFrame).toHaveBeenCalledTimes(2);
    expect(rejectedStartFrame).toEqual(start);
    expect(rejectedStartFrame).not.toBe(start);
    expect(firstRejectedFrame).toBe(rejectedStartFrame);
    expect(secondRejectedFrame).toBe(firstRejectedFrame);
  });
});
