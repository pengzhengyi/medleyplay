/**
 * @file Which of the Library's artist names are one artist, as the household linked them.
 *
 * Every Track keeps its artist as written. A name the household linked to an artist
 * MusicBrainz knows joins that artist's group, so *The Beatles*, *披头士*, and *甲壳虫*
 * are one artist in the Artists view, on an artist's page, in favorites, and in
 * search, which also finds an artist by any name it goes by. Any other name is a
 * group of its own, folded as the Library compares names.
 */

import type { ArtistNames } from "../api";
import type { FavoriteGroups } from "./favoriteGroups";
import { fold } from "./views";

/** The groups the Library's artist names fall in. */
export interface ArtistLinks {
  /** The group of the name: its linked artist's, or its own. */
  readonly groupOf: (name: string) => string;
  /** Every name the group's artist goes by, as MusicBrainz knows it; none for a name alone. */
  readonly aliasesOf: (group: string) => readonly string[];
  /** The Library's names in the group, folded. */
  readonly namesOf: (group: string) => readonly string[];
}

const own = (name: string) => fold(name.trim());

/** No links: every name is a group of its own. */
export const NO_LINKS: ArtistLinks = {
  groupOf: own,
  aliasesOf: () => [],
  namesOf: (group) => [group],
};

/** The links the server knows, as the client groups by them. */
export function linksOf(found: ArtistNames): ArtistLinks {
  const groups = new Map<string, string>();
  const members = new Map<string, string[]>();
  for (const each of found.names) {
    if (each.artist_id !== null) {
      const group = `artist:${each.artist_id}`;
      groups.set(own(each.name), group);
      members.set(group, [...(members.get(group) ?? []), own(each.name)]);
    }
  }
  const aliases = new Map(
    found.artists.map((artist) => [
      `artist:${artist.id}`,
      [
        ...new Set([artist.name, artist.sort_name, ...artist.aliases.map((alias) => alias.name)]),
      ].filter(Boolean),
    ]),
  );
  return {
    groupOf: (name) => groups.get(own(name)) ?? own(name),
    aliasesOf: (group) => aliases.get(group) ?? [],
    namesOf: (group) => members.get(group) ?? [group],
  };
}

/** The favorites with every name linked with a favorite name made a favorite too. */
export function withLinkedFavorites(favorites: FavoriteGroups, links: ArtistLinks): FavoriteGroups {
  const artists = new Set(favorites.artists);
  for (const name of favorites.artists) {
    for (const linked of links.namesOf(links.groupOf(name))) {
      artists.add(linked);
    }
  }
  return { ...favorites, artists };
}
