/**
 * @file Matching typed text loosely: its letters in order, not side by side, so
 * *jch* finds *Jay Chou*. fuzzysort scores each match; this module owns it.
 */

import fuzzysort from "fuzzysort";

/** How well a loose match must score, from 0 to 1: *jay* finds *Jay Chou* but not *Jealousy*. */
const THRESHOLD = 0.32;

/** Fewer letters than this match too much loosely, so only side by side. */
const LOOSE_FROM = 3;

/**
 * Return the `items` whose text holds every word of `folded` side by side, in the
 * order given, then those that hold its letters in order, best first. `textOf` gives
 * an item's text folded, as `folded` is, a name to a line.
 */
export function ranked<T>(items: readonly T[], folded: string, textOf: (item: T) => string): T[] {
  const { close, loose } = matchesOf(items, folded, textOf);
  return [...close, ...loose];
}

/**
 * Return the `items` whose text holds every word of `folded` side by side, or, when
 * none does, those that hold its letters in order, best first.
 */
export function closestOf<T>(
  items: readonly T[],
  folded: string,
  textOf: (item: T) => string,
): T[] {
  const { close, loose } = matchesOf(items, folded, textOf);
  return close.length > 0 ? close : loose;
}

function matchesOf<T>(
  items: readonly T[],
  folded: string,
  textOf: (item: T) => string,
): { readonly close: T[]; readonly loose: T[] } {
  const words = folded.split(/\s+/u).filter(Boolean);
  if (words.length === 0) {
    return { close: [...items], loose: [] };
  }
  const close: T[] = [];
  const rest = new Map<string, T[]>();
  for (const item of items) {
    const text = textOf(item);
    if (words.every((word) => text.includes(word))) {
      close.push(item);
    } else {
      const same = rest.get(text);
      if (same === undefined) {
        rest.set(text, [item]);
      } else {
        same.push(item);
      }
    }
  }
  if (words.join("").length < LOOSE_FROM) {
    return { close, loose: [] };
  }
  // Each line is a name of its own, scored alone, so a long title doesn't hide a close artist.
  const search = words.join(" ");
  const loose = [...rest.entries()]
    .map(([text, same]) => ({
      same,
      score: Math.max(...text.split("\n").map((line) => scoreOf(search, line))),
    }))
    .filter(({ score }) => score >= THRESHOLD)
    .sort((a, b) => b.score - a.score);
  return { close, loose: loose.flatMap(({ same }) => same) };
}

function scoreOf(search: string, line: string): number {
  return fuzzysort.single(search, line)?.score ?? 0;
}
