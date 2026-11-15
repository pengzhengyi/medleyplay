/**
 * @file The accent color: medleyplay's jade, or one this browser chose.
 *
 * Like the theme, the choice is kept per browser. A chosen accent sets the
 * `--chosen-accent-*` properties on the root element, one shade per scheme, which
 * the stylesheet's tokens read before falling back to jade. Colors saved to choose
 * again are kept per browser too, the newest first, the oldest forgotten past
 * `MAX_SAVED_COLORS`.
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

/** How many saved colors are kept; saving one more forgets the oldest. */
export const MAX_SAVED_COLORS = 10;

const COLORS_KEY = "medleyplay.saved-colors";
let fallbackColors: readonly string[] = [];
let rawSeen: string | null | undefined;
let colorsSeen: readonly string[] = [];
const colorListeners = new Set<() => void>();

function colorsOf(raw: string | null): readonly string[] {
  try {
    const saved: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(saved)
      ? saved.filter((each): each is string => typeof each === "string" && HEX.test(each))
      : [];
  } catch {
    return [];
  }
}

/** Return the colors saved in this browser, the newest first. */
export function savedColors(): readonly string[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(COLORS_KEY);
  } catch {
    return fallbackColors;
  }
  if (raw !== rawSeen) {
    rawSeen = raw;
    colorsSeen = colorsOf(raw);
  }
  return colorsSeen;
}

function keepColors(colors: readonly string[]): void {
  fallbackColors = colors;
  try {
    localStorage.setItem(COLORS_KEY, JSON.stringify(colors));
  } catch {
    // Without storage the colors last as long as the page.
  }
  for (const listener of colorListeners) {
    listener();
  }
}

/** Save `color` first among the colors to choose again, forgetting the oldest past the most. */
export function saveColor(color: string): void {
  const saving = color.toLowerCase();
  const others = savedColors().filter((each) => each !== saving);
  keepColors([saving, ...others].slice(0, MAX_SAVED_COLORS));
}

/** Forget `color` from the colors to choose again. */
export function forgetColor(color: string): void {
  const forgetting = color.toLowerCase();
  keepColors(savedColors().filter((each) => each !== forgetting));
}

function subscribeColors(listener: () => void): () => void {
  colorListeners.add(listener);
  return () => {
    colorListeners.delete(listener);
  };
}

/** The colors saved in this browser, the newest first; every reader on the page agrees. */
export function useSavedColors(): readonly string[] {
  return useSyncExternalStore(subscribeColors, savedColors);
}
