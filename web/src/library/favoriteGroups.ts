/**
 * @file The artists and albums the Account favorited, matched to the Library's names.
 *
 * The server keeps each artist by the id of the Library's artist, and each album by the
 * name it was favorited under; the client says which names those are, folding names as
 * the Albums view does, so a name differing in case or width is the same one. They tune
 * Radio; they don't keep songs downloaded or put them in Favorites, which follow each
 * song's own heart.
 */

import type { FavoritesRead, Track } from "../api";
import { fold, songsOf } from "./views";

/** The favorite artists and albums. */
export interface FavoriteGroups {
  /** The favorite artists, by the ids of the Library's artists, as the server keeps them. */
  readonly artistIds: ReadonlySet<string>;
  /** The folded names of the favorite artists, as the Library writes them; see `withLinkedFavorites`. */
  readonly artists: ReadonlySet<string>;
  /** Each album as its folded album artist and name, a line apart. */
  readonly albums: ReadonlySet<string>;
  /** Whether the Library's artist `id` shares its name with the name's first, so its name says nothing. */
  readonly isNamesake: (id: string) => boolean;
}

export const NO_FAVORITES: FavoriteGroups = {
  artistIds: new Set(),
  artists: new Set(),
  albums: new Set(),
  isNamesake: () => false,
};

/** An album as `FavoriteGroups` holds it. */
export const albumKey = (artist: string, name: string): string =>
  `${fold(artist.trim())}\n${fold(name.trim())}`;

/** The favorites the server sent, the artists by id, until their names are known. */
export function favoriteGroupsOf(read: FavoritesRead): FavoriteGroups {
  return {
    artistIds: new Set(read.artists.map(({ id }) => id)),
    artists: new Set(),
    albums: new Set(read.albums.map(({ artist, name }) => albumKey(artist, name))),
    isNamesake: () => false,
  };
}

/**
 * Whether the artist written `name` is a favorite: by its name, or, when a song binds it
 * to `id`, another artist called so than the name's first, by that id alone.
 */
export const isFavoriteArtist = (favorites: FavoriteGroups, name: string, id?: string): boolean =>
  id !== undefined && favorites.isNamesake(id)
    ? favorites.artistIds.has(id)
    : favorites.artists.has(fold(name.trim()));

export const isFavoriteAlbum = (favorites: FavoriteGroups, artist: string, name: string): boolean =>
  favorites.albums.has(albumKey(artist, name));

/** A name still a video's id says no artist or album yet. */
const UNNAMED = /^BV[0-9A-Za-z]{10}$/u;

/** Whether an artist or album named `name` can be a favorite: it has a name of its own. */
export const canFavorite = (name: string): boolean =>
  name.trim() !== "" && !UNNAMED.test(name.trim());

/**
 * How many favorite songs suggest favoriting the artist or album of `tracks`, or 0
 * when too few do: it takes 3, or 2 that are at least half of its songs. A split file
 * counts as its songs.
 */
export function favoriteSongsSuggesting(tracks: readonly Track[]): number {
  const songs = songsOf(tracks);
  const favorites = songs.filter((track) => track.favorite).length;
  return favorites >= 3 || (favorites >= 2 && favorites * 2 >= songs.length) ? favorites : 0;
}
