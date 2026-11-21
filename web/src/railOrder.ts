/**
 * @file The order of the views in the rail, as this browser chose it.
 *
 * Like how the rail shows, the order belongs to the screen in front of you, so each
 * browser keeps its own; without storage it lasts as long as the page. Clean up stays
 * under Insights and Settings stays last, so only the views here move.
 */

import { useSyncExternalStore } from "react";

/** A view whose place in the rail can be chosen. */
export type RailView =
  "library" | "artists" | "albums" | "radio" | "playlists" | "downloaded" | "insights";

/** The rail's order until a browser chooses another. */
export const DEFAULT_RAIL_ORDER: readonly RailView[] = [
  "library",
  "artists",
  "albums",
  "radio",
  "playlists",
  "downloaded",
  "insights",
];

const KEY = "medleyplay.rail-order";
const KNOWN: ReadonlySet<string> = new Set(DEFAULT_RAIL_ORDER);

/**
 * Return the order `saved` says, kept to the views there are: an unknown or repeated
 * view is dropped, and a view it lacks goes after the view it follows by default.
 * Anything but a list of names is the default order.
 */
export function railOrderOf(saved: unknown): readonly RailView[] {
  if (!Array.isArray(saved) || !saved.every((each) => typeof each === "string")) {
    return DEFAULT_RAIL_ORDER;
  }
  const order: RailView[] = [];
  for (const name of saved) {
    if (KNOWN.has(name) && !order.includes(name as RailView)) {
      order.push(name as RailView);
    }
  }
  DEFAULT_RAIL_ORDER.forEach((view, index) => {
    if (!order.includes(view)) {
      const before = index === 0 ? undefined : DEFAULT_RAIL_ORDER[index - 1];
      order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, view);
    }
  });
  return order;
}

/** Return `order` with `view` moved `by` one place up (-1) or down (1); the same order at either end. */
export function moved(order: readonly RailView[], view: RailView, by: -1 | 1): readonly RailView[] {
  const from = order.indexOf(view);
  const to = from + by;
  if (from < 0 || to < 0 || to >= order.length) {
    return order;
  }
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, view);
  return next;
}

const listeners = new Set<() => void>();
let kept: readonly RailView[] | undefined;
let held: readonly RailView[] | undefined;

function read(): readonly RailView[] {
  if (held !== undefined) {
    return held;
  }
  let saved: unknown = kept;
  try {
    const stored = localStorage.getItem(KEY);
    saved = stored === null ? kept : (JSON.parse(stored) as unknown);
  } catch {
    // Without storage, or with a broken one, the order kept for this page stands.
  }
  held = railOrderOf(saved);
  return held;
}

function changed(order: readonly RailView[] | undefined): void {
  kept = order;
  held = undefined;
  for (const listener of listeners) {
    listener();
  }
}

/** Keep `order` as this browser's rail order. */
export function setRailOrder(order: readonly RailView[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    // Without storage the order lasts as long as the page.
  }
  changed(order);
}

/** Go back to the default order in this browser. */
export function resetRailOrder(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Without storage there is nothing kept to forget.
  }
  changed(undefined);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The rail's order in this browser; every rail and list on the page agrees. */
export function useRailOrder(): readonly RailView[] {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_RAIL_ORDER);
}
