/** @file Complete Library membership for song and album lyrics badges. */

import { type ReactNode, useMemo } from "react";

import type { Track } from "../api";
import { albumKey } from "../library/favoriteGroups";
import { albumArtistOf, songsOf } from "../library/views";
import { LyricsAvailability } from "./lyricsAvailability";

/** Supply the unfiltered catalog: a queue or search result cannot establish album completeness. */
export function LyricsAvailabilityProvider({
  tracks,
  children,
}: {
  readonly tracks: readonly Track[];
  readonly children: ReactNode;
}) {
  const value = useMemo(() => {
    const albums = new Map<string, boolean>();
    for (const track of songsOf(tracks)) {
      const key = albumKey(albumArtistOf(track), track.album);
      albums.set(key, (albums.get(key) ?? true) && track.kind === "song" && track.has_lyrics);
    }
    return { tracks: new Map(tracks.map((track) => [track.id, track])), albums };
  }, [tracks]);
  return <LyricsAvailability value={value}>{children}</LyricsAvailability>;
}
