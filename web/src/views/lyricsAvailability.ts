/** @file Lyrics availability from the complete Library for song and album kind marks. */

import { createContext, use } from "react";

import type { Track } from "../api";
import { albumKey } from "../library/favoriteGroups";
import { albumArtistOf } from "../library/views";
import { useWords } from "../locale";

export type LyricsSubject =
  Track | { readonly artist: string; readonly album: string } | { readonly file: number };

export function albumLyricsSubject(track: Track): LyricsSubject {
  return track.segment_of === null
    ? { artist: albumArtistOf(track), album: track.album }
    : { file: track.segment_of };
}

export const LyricsAvailability = createContext<
  | {
      readonly tracks: ReadonlyMap<number, Track>;
      readonly albums: ReadonlyMap<string, boolean>;
    }
  | undefined
>(undefined);

/** The readable state of a song or a complete album; no state for missing lyrics. */
export function useLyricsLabel(subject: LyricsSubject | undefined): string | undefined {
  const catalog = use(LyricsAvailability);
  const t = useWords();
  if (subject === undefined) return undefined;
  if ("file" in subject) {
    return catalog?.tracks.get(subject.file)?.has_lyrics ? t("All songs have lyrics") : undefined;
  }
  if ("id" in subject) {
    const track = catalog === undefined ? subject : catalog.tracks.get(subject.id);
    if (!track?.has_lyrics) return undefined;
    return t(track.kind === "album" ? "All songs have lyrics" : "Lyrics available");
  }
  return subject.album.trim() !== "" && catalog?.albums.get(albumKey(subject.artist, subject.album))
    ? t("All songs have lyrics")
    : undefined;
}
