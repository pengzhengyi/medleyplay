/**
 * @file The lyrics of the song playing, read from the server as the song changes.
 *
 * They are read again when `version` changes, as when a lookup of the song's lyrics
 * finishes, and a song read before shows what was read until the new read answers.
 */

import { useEffect, useRef, useState } from "react";

import { type Lyrics, api } from "../api";

interface LyricsRead {
  readonly lyrics: Lyrics | null | undefined;
  readonly failed: boolean;
}

const WAITING: LyricsRead = { lyrics: undefined, failed: false };

/** Keep the last lyrics for this track if a refresh fails. */
export function useLyrics(
  trackId: number | undefined,
  version?: unknown,
): LyricsRead & { readonly confirm: (id: number, lyrics: Lyrics | null) => void } {
  const [read, setRead] = useState<LyricsRead & { readonly id: number }>();
  const current = useRef<{ readonly id: number } | undefined>(undefined);
  useEffect(() => {
    if (trackId === undefined) {
      return undefined;
    }
    const request = { id: trackId };
    current.current = request;
    api.lyrics(trackId).then(
      (lyrics) => {
        if (current.current === request) {
          setRead({ id: trackId, lyrics, failed: false });
        }
      },
      () => {
        if (current.current === request) {
          setRead((previous) =>
            previous?.id === trackId && previous.lyrics !== undefined
              ? previous
              : { id: trackId, lyrics: undefined, failed: true },
          );
        }
      },
    );
    return () => {
      current.current = undefined;
    };
  }, [trackId, version]);
  return {
    ...(read !== undefined && read.id === trackId ? read : WAITING),
    confirm: (id, lyrics) => {
      if (current.current?.id !== id) return;
      current.current = { id };
      setRead({ id, lyrics, failed: false });
    },
  };
}
