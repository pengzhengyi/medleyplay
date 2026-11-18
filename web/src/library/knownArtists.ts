/**
 * @file Saying which artist MusicBrainz knows is meant, as lists of them show it.
 */

import type { KnownArtist } from "../api";

/** Name an artist as lists show it: its name, what tells it apart, and its country. */
export function describeKnown(artist: KnownArtist | undefined): string {
  if (artist === undefined) {
    return "an artist no longer known";
  }
  const about = [artist.disambiguation, artist.country].filter(Boolean).join(", ");
  return about === "" ? artist.name : `${artist.name} (${about})`;
}
