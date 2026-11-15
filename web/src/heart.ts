/**
 * @file What a heart, which favorites a song, artist, or album, says on hover.
 */

/** What a heart says on hover: whether `name` is a favorite, and what a click does. */
export function heartTitleOf(name: string, favorite: boolean): string {
  return favorite ? `“${name}” is a favorite; click to remove` : `Add “${name}” to favorites`;
}
