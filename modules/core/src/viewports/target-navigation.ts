// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** @internal Camera-relative measurements in a concrete viewport's metric. */
export type TargetInfo = {
  target: [number, number, number];
  projectedPosition: [number, number, number];
  targetDistance: number;
  cameraDepth: number;
  near: number;
  far: number;
  isValid: boolean;
  isVisible: boolean;
};
