/**
 * @file Your rating of a song: the one you gave it, else the one you gave its album.
 */

import type { Track } from "../api";

/** Return your rating of `track`: your own, else your imported rating of its album, or `null`. */
export function ratingOf(track: Track): number | null {
  return track.rating ?? track.album_rating;
}
