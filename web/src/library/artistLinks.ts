/**
 * @file Which of the Library's artist names are one artist, as the household linked them.
 *
 * Every Track keeps its artist as written, and names the Library's artist each name is
 * bound to. A name the household linked to an artist MusicBrainz knows joins that
 * artist's group, so *The Beatles*, *披头士*, and *甲壳虫* are one artist in the Artists
 * view, on an artist's page, in favorites, and in search, which also finds an artist by
 * any name it goes by. The artist is shown by the name the household chose for it, if
 * any. Any other name is the group of the Library's artist its songs are bound to, or,
 * written by no song, a group of its own, folded as the Library compares names.
 *
 * Two artists may go by one name, such as two singers called *Jay*: the name names the
 * one it named first, and a song bound to another artist called so is in that artist's
 * group, by its id.
 */

import type { ArtistNames, Track } from "../api";
import type { FavoriteGroups } from "./favoriteGroups";
import { fold } from "./views";

/** The groups the Library's artist names fall in. */
export interface ArtistLinks {
  /** The group of the name: its linked artist's, or its own. */
  readonly groupOf: (name: string) => string;
  /**
   * The group of the name as a song writes it, bound to the Library's artist `id`: that
   * artist's own when it is another artist called so than the name's first, else the name's.
   */
  readonly groupOfBound: (name: string, id: string | undefined) => string;
  /** Whether the Library's artist `id` is another artist called its name than the name's first. */
  readonly isNamesake: (id: string) => boolean;
  /** Every name the group's artist goes by, as MusicBrainz knows it; none for a name alone. */
  readonly aliasesOf: (group: string) => readonly string[];
  /** The Library's names in the group, folded. */
  readonly namesOf: (group: string) => readonly string[];
  /** The name the household shows the group's artist by, if it chose one. */
  readonly shownAsOf: (group: string) => string | undefined;
  /** The cover holding the group's artist's photo, the household's or Wikidata's; none for a name alone. */
  readonly photoOf: (group: string) => string | null;
  /** The id of the Library's artist the name names first, as its songs are bound; none for a name no song writes. */
  readonly idOf: (name: string) => string | undefined;
  /** The folded names the Library's artist `id` is the first of, whose songs are bound to it. */
  readonly namesOfId: (id: string) => readonly string[];
}

const own = (name: string) => fold(name.trim());

/** No links: every name is a group of its own. */
export const NO_LINKS: ArtistLinks = {
  groupOf: own,
  groupOfBound: own,
  isNamesake: () => false,
  aliasesOf: () => [],
  namesOf: (group) => [group],
  shownAsOf: () => undefined,
  photoOf: () => null,
  idOf: () => undefined,
  namesOfId: () => [],
};

/** The links the server knows, and the artists `tracks` are bound to, as the client groups by them. */
export function linksOf(found: ArtistNames, tracks: readonly Track[] = []): ArtistLinks {
  const namesakes = new Set(found.names.flatMap((each) => each.artist_ids?.slice(1) ?? []));
  const ids = new Map<string, string>();
  const idNames = new Map<string, Set<string>>();
  for (const track of tracks) {
    track.artists.forEach((name, index) => {
      const id = track.artist_ids[index];
      if (id !== undefined && !namesakes.has(id)) {
        ids.set(own(name), id);
        idNames.set(id, (idNames.get(id) ?? new Set()).add(own(name)));
      }
    });
  }
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
        ...new Set([
          artist.shown_as ?? "",
          artist.name,
          artist.sort_name,
          ...artist.aliases.map((alias) => alias.name),
        ]),
      ].filter(Boolean),
    ]),
  );
  const shownAs = new Map<string, string>();
  for (const artist of found.artists) {
    const group = `artist:${artist.id}`;
    if (artist.shown_as !== null && members.has(group)) {
      shownAs.set(group, artist.shown_as);
    }
  }
  const photos = new Map(found.artists.map((artist) => [`artist:${artist.id}`, artist.photo]));
  const idOf = (name: string) => ids.get(own(name));
  const groupOf = (name: string) => groups.get(own(name)) ?? idOf(name) ?? own(name);
  return {
    groupOf,
    groupOfBound: (name, id) => (id !== undefined && namesakes.has(id) ? id : groupOf(name)),
    isNamesake: (id) => namesakes.has(id),
    aliasesOf: (group) => aliases.get(group) ?? [],
    namesOf: (group) => members.get(group) ?? [...(idNames.get(group) ?? [group])],
    shownAsOf: (group) => shownAs.get(group),
    photoOf: (group) => photos.get(group) ?? null,
    idOf,
    namesOfId: (id) => [...(idNames.get(id) ?? [])],
  };
}

/**
 * The favorites with each favorite artist's names made favorites, and every name linked
 * with one of those too.
 */
export function withLinkedFavorites(favorites: FavoriteGroups, links: ArtistLinks): FavoriteGroups {
  const artists = new Set(favorites.artists);
  // Another artist called a name is a favorite by its id alone, which `namesOfId` leaves out.
  for (const id of favorites.artistIds) {
    for (const name of links.namesOfId(id)) {
      artists.add(name);
    }
  }
  for (const name of [...artists]) {
    for (const linked of links.namesOf(links.groupOf(name))) {
      artists.add(linked);
    }
  }
  return { ...favorites, artists, isNamesake: links.isNamesake };
}
