/**
 * @file How much of the Library waits to be cleaned up: names to tidy or link, and long
 * files to split.
 */

import type {
  ArtistNames,
  ArtistSplits,
  MissingPhoto,
  NameToTidy,
  SharedName,
  SplitOffers,
} from "../api";

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

/** Return how many names that may name several artists wait to be told apart or confirmed. */
export function toTellApartOf(names: readonly SharedName[] | undefined): number {
  return names?.filter((each) => each.waiting).length ?? 0;
}

/** Return how many artists with no photo have one suggested, to use. */
export function photosToUseOf(artists: readonly MissingPhoto[] | undefined): number {
  return artists?.filter((each) => each.suggested !== null).length ?? 0;
}

/**
 * Return how many wait: names to tidy, names that may be linked and aren't, long files
 * with a song list to split them by, artist names to split, names to tell apart, and
 * photos suggested for artists with none.
 */
export function toDoOf(
  tidy: readonly NameToTidy[],
  artistNames: ArtistNames | undefined,
  offers?: SplitOffers,
  artistSplits?: ArtistSplits,
  sharedNames?: readonly SharedName[],
  missingPhotos?: readonly MissingPhoto[],
): number {
  return (
    tidy.length +
    (artistNames === undefined ? 0 : unlinkedOf(artistNames)) +
    toSplitOf(offers) +
    (artistSplits?.offers.length ?? 0) +
    toTellApartOf(sharedNames) +
    photosToUseOf(missingPhotos)
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
