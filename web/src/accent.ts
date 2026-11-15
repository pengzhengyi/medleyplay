/**
 * @file The accent color: medleyplay's jade, or one this browser chose.
 *
 * Like the theme, the choice is kept per browser. A chosen accent sets the
 * `--chosen-accent-*` properties on the root element, one shade per scheme, which
 * the stylesheet's tokens read before falling back to jade.
 */

import { useSyncExternalStore } from "react";

import { shadesOf } from "./color";

/** The accent every page starts with, as the light scheme shows it. */
export const DEFAULT_ACCENT = "#0b8a70";

const KEY = "medleyplay.accent";
const HEX = /^#[0-9a-f]{6}$/;
const PROPERTIES = {
  light: "--chosen-accent-light",
  lightInk: "--chosen-accent-ink-light",
  dark: "--chosen-accent-dark",
  darkInk: "--chosen-accent-ink-dark",
} as const;

/** Return the accent this browser chose, or `undefined` for jade. */
export function savedAccent(): string | undefined {
  try {
    const saved = localStorage.getItem(KEY)?.toLowerCase();
    return saved !== undefined && HEX.test(saved) ? saved : undefined;
  } catch {
    return undefined;
  }
}

let shown: string | undefined;
const listeners = new Set<() => void>();

/** Color the page with `accent`, or jade when `undefined`, and remember it for this browser. */
export function applyAccent(accent: string | undefined): void {
  const chosen = accent?.toLowerCase();
  shown = chosen;
  const { style } = document.documentElement;
  if (chosen === undefined) {
    for (const property of Object.values(PROPERTIES)) {
      style.removeProperty(property);
    }
  } else {
    const shades = shadesOf(chosen);
    for (const [shade, property] of Object.entries(PROPERTIES)) {
      style.setProperty(property, shades[shade as keyof typeof PROPERTIES]);
    }
  }
  try {
    if (chosen === undefined) {
      localStorage.removeItem(KEY);
    } else {
      localStorage.setItem(KEY, chosen);
    }
  } catch {
    // A browser that keeps nothing still shows the accent until the page closes.
  }
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const current = () => shown ?? savedAccent();

/** The accent chosen, `undefined` for jade, and a way to choose another. */
export function useAccent(): [string | undefined, (accent: string | undefined) => void] {
  return [useSyncExternalStore(subscribe, current), applyAccent];
}
