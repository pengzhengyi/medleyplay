/**
 * @file What the search box suggests as you type: the tag or site a word being typed
 * begins, as `bi` begins `bilibili:`, and the artists a search names, each to show on
 * its page, its songs, or its albums.
 */

import type { Track } from "../api";
import type { ArtistLinks } from "./artistLinks";
import { FIELDS, type Field, parseQuery } from "./query";
import { type Artist, search } from "./views";

/** The most artists suggested at once. */
const MOST = 3;

/** The fewest letters a word needs before the names it begins are offered. */
const FEWEST = 2;

/** A name a word being typed begins: a field's tag, or a site to search. */
export type Completion = { readonly tag: Field } | { readonly site: string };

/**
 * Return the tags and sites of `sites` whose names the last word of `text` begins, at
 * least two letters of it and no `:`, with the words before it. A space after the last
 * word finishes it, so nothing is offered.
 *
 * ```text
 * melt ar   →   melt artist:
 * ```
 */
export function completionsOf(
  text: string,
  sites: readonly string[],
): { readonly before: string; readonly completions: readonly Completion[] } {
  const match = /(?:^|\s)([^\s:：]+)$/u.exec(text);
  const word = match?.[1]?.toLowerCase() ?? "";
  if (match === null || word.length < FEWEST) {
    return { before: text.trim(), completions: [] };
  }
  return {
    before: text.slice(0, match.index).trim(),
    completions: [
      ...FIELDS.filter((field) => field.startsWith(word)).map((tag) => ({ tag })),
      ...sites.filter((site) => site.startsWith(word)).map((site) => ({ site })),
    ],
  };
}

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
  return asked === "" ? [] : search(tracks, asked, links, ["artists"]).artists.slice(0, MOST);
}
