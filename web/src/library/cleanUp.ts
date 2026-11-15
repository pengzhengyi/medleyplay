/**
 * @file How many of the Library's names wait to be cleaned up: to tidy, or to link.
 */

import type { ArtistNames, NameToTidy } from "../api";

/** Return how many names may be linked and are not. */
export function unlinkedOf(names: ArtistNames): number {
  return names.names.filter((each) => each.look_up === "yes" && !each.linked).length;
}

/** Return how many names wait: those to tidy, and those that may be linked and aren't. */
export function toDoOf(tidy: readonly NameToTidy[], artistNames: ArtistNames | undefined): number {
  return tidy.length + (artistNames === undefined ? 0 : unlinkedOf(artistNames));
}

/** Return `sections` with those that have names waiting first, and those done last, each as it was. */
export function inOrderOfWaiting<T extends { readonly waiting: number }>(
  sections: readonly T[],
): T[] {
  return [
    ...sections.filter((section) => section.waiting > 0),
    ...sections.filter((section) => section.waiting === 0),
  ];
}
