/**
 * @file How much of the Library waits to be cleaned up: names to tidy or link, and long
 * files to split.
 */

import type { ArtistNames, NameToTidy, SplitOffers } from "../api";

/** Return how many long files have a song list to split them by, unless offering is off. */
export function toSplitOf(offers: SplitOffers | undefined): number {
  return offers === undefined || offers.setting === "off"
    ? 0
    : offers.files.filter((file) => file.offer !== null).length;
}

/** Return how many names may be linked and are not. */
export function unlinkedOf(names: ArtistNames): number {
  return names.names.filter((each) => each.look_up === "yes" && !each.linked).length;
}

/**
 * Return how many wait: names to tidy, names that may be linked and aren't, and long files
 * with a song list to split them by.
 */
export function toDoOf(
  tidy: readonly NameToTidy[],
  artistNames: ArtistNames | undefined,
  offers?: SplitOffers,
): number {
  return (
    tidy.length + (artistNames === undefined ? 0 : unlinkedOf(artistNames)) + toSplitOf(offers)
  );
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
