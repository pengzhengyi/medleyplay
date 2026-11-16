/**
 * @file What the search box suggests as you type: the artists a search names, each
 * to show on its page, its songs, or its albums.
 */

import type { Track } from "../api";
import type { ArtistLinks } from "./artistLinks";
import { parseQuery } from "./query";
import { type Artist, search } from "./views";

/** The most artists suggested at once. */
const MOST = 3;

/**
 * Return the name a search asks about an artist by: its `artist:` tag's value, or else
 * its plain words; `""` when it asks by neither.
 */
export function artistAskedOf(text: string): string {
  const { tags, words } = parseQuery(text);
  const tagged = tags.findLast((tag) => tag.field === "artist" && tag.value !== "");
  return (tagged?.value ?? words).trim();
}

/** Return the artists `text` asks about, as a search finds them, at most three. */
export function suggestedArtists(
  tracks: readonly Track[],
  text: string,
  links?: ArtistLinks,
): readonly Artist[] {
  const asked = artistAskedOf(text);
  return asked === "" ? [] : search(tracks, asked, links).artists.slice(0, MOST);
}
