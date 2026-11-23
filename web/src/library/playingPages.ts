/** @file Album and artist pages prepared from the Library for the current and next queue entries. */

import type { Track } from "../api";
import type { ArtistLinks } from "./artistLinks";
import {
  albumArtistOf,
  albumFileOf,
  albumsOf,
  artistMosaic,
  artistNamesOf,
  artistWrittenOf,
  songsOf,
  tracksOfAlbum,
  tracksOfArtist,
} from "./views";

export function playingPages(
  tracks: readonly Track[],
  links: ArtistLinks | undefined,
  current?: number,
  next?: number,
) {
  const songs = songsOf(tracks);
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const readAlbum = (artist: string, name: string) => {
    const members = tracksOfAlbum(songs, artist, name);
    const file = albumFileOf(members, byId);
    return { songs: members, file, cover: file?.cover ?? albumsOf(members)[0]?.cover ?? null };
  };
  const readArtist = (written: string, id?: string) => {
    const name = (id === undefined ? undefined : artistWrittenOf(songs, id)) ?? written;
    return { name, songs: tracksOfArtist(songs, name, links, id) };
  };
  const albums = new Map<string, ReturnType<typeof readAlbum>>();
  const artists = new Map<string, ReturnType<typeof readArtist>>();
  const pictures = new Set<string>();
  for (const id of current === undefined ? [] : [current, next]) {
    const track = id === undefined ? undefined : byId.get(id);
    if (track === undefined) continue;
    const artist = albumArtistOf(track);
    const albumKey = JSON.stringify([artist, track.album]);
    if (track.album && !albums.has(albumKey)) {
      const page = readAlbum(artist, track.album);
      albums.set(albumKey, page);
      if (page.cover) pictures.add(page.cover);
    }
    artistNamesOf(track).forEach((name, index) => {
      const bound = track.artist_ids[index];
      const key = JSON.stringify([name, bound]);
      if (!name || artists.has(key)) return;
      const page = readArtist(name, bound);
      artists.set(key, page);
      const photo = links?.photoOf(links.groupOfBound(page.name, bound));
      if (photo) {
        pictures.add(photo);
      } else {
        for (const cover of artistMosaic(page.songs)) pictures.add(cover);
      }
    });
  }
  return {
    songs,
    pictures,
    album: (artist: string, name: string) =>
      albums.get(JSON.stringify([artist, name])) ?? readAlbum(artist, name),
    artist: (name: string, id?: string) =>
      artists.get(JSON.stringify([name, id])) ?? readArtist(name, id),
  };
}
