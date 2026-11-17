/**
 * @file The lyrics of the song playing, read from the server as the song changes.
 *
 * They are read again when `version` changes, as when a lookup of the song's lyrics
 * finishes, and a song read before shows what was read until the new read answers.
 */

import { useEffect, useState } from "react";

import { type Lyrics, api } from "../api";

/**
 * Return the lyrics of the song `trackId`: `null` when it has none, `undefined` while
 * they are read or when no song plays.
 */
export function useLyrics(
  trackId: number | undefined,
  version?: unknown,
): Lyrics | null | undefined {
  const [read, setRead] = useState<{ readonly id: number; readonly lyrics: Lyrics | null }>();
  useEffect(() => {
    if (trackId === undefined) {
      return undefined;
    }
    let current = true;
    api.lyrics(trackId).then(
      (lyrics) => {
        if (current) {
          setRead({ id: trackId, lyrics });
        }
      },
      () => {
        // Without an answer the song shows no lyrics; the next change reads them again.
        if (current) {
          setRead({ id: trackId, lyrics: null });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [trackId, version]);
  return read !== undefined && read.id === trackId ? read.lyrics : undefined;
}
