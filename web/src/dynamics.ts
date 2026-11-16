/**
 * @file Dynamics: the cover's colors moving behind Now Playing, in one of a few effects.
 *
 * The choice is kept per browser, as what a device's graphics and battery can bear is
 * its own. A device asking for less motion shows the effect still.
 */

import { useSyncExternalStore } from "react";

/** The effect behind Now Playing, or none. */
export type Dynamics = "off" | "flow" | "drift" | "mesh";

export const DYNAMICS: readonly Dynamics[] = ["off", "flow", "drift", "mesh"];
const KEY = "medleyplay.dynamics";
const DEFAULT: Dynamics = "flow";

/** Return the effect this browser chose, or the default. */
export function savedDynamics(): Dynamics {
  try {
    const saved = localStorage.getItem(KEY);
    return DYNAMICS.find((each) => each === saved) ?? DEFAULT;
  } catch {
    return DEFAULT;
  }
}

let chosen: Dynamics | undefined;
const listeners = new Set<() => void>();

/** Show `dynamics` behind Now Playing, and remember it for this browser. */
export function chooseDynamics(dynamics: Dynamics): void {
  chosen = dynamics;
  for (const listener of listeners) {
    listener();
  }
  try {
    localStorage.setItem(KEY, dynamics);
  } catch {
    // A browser that keeps nothing still shows the effect until the page closes.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const current = () => chosen ?? savedDynamics();

/** The effect chosen, and a way to choose another; every control on the page agrees. */
export function useDynamics(): [Dynamics, (dynamics: Dynamics) => void] {
  return [useSyncExternalStore(subscribe, current), chooseDynamics];
}
