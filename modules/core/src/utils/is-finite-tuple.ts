// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Checks every component, including holes that Array.every would skip. */
export default function isFiniteTuple(value: unknown, length: number): value is number[] {
  if (!Array.isArray(value) || value.length !== length) return false;
  for (let i = 0; i < length; i++) {
    if (!Number.isFinite(value[i])) return false;
  }
  return true;
}
