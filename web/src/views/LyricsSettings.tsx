/**
 * @file The Lyrics section of Settings, for an admin: when a song's lyrics are looked up on
 * LRCLIB, and a reset after LRCLIB refused a request.
 *
 * Lyrics are looked up as songs come up by default, so the song playing has them; every
 * song at once is not offered, as that would ask a free service about the whole Library.
 */

import { LYRICS_ENRICHER } from "../api";
import { EnricherSettings, type EnricherWords } from "./EnricherSettings";

const WORDS: EnricherWords = {
  enricher: LYRICS_ENRICHER,
  site: "LRCLIB",
  heading: "Song lyrics",
  description: (
    <>
      Looks up a song&apos;s lyrics on LRCLIB (lrclib.net), an open lyrics database, sending its
      title, artist, album, and length, at most once a second. A song whose lyrics you entered, or
      whose files hold them, is never looked up; one LRCLIB doesn&apos;t know is asked again a month
      later.
    </>
  ),
  count: (tracks) =>
    tracks === 1
      ? "1 song's lyrics can be looked up."
      : `${String(tracks)} songs' lyrics can be looked up.`,
  off: "Looking up lyrics is turned off.",
  modes: ["next", "manual"],
};

/** When lyrics are looked up, how many songs can be, and a reset once stopped. */
export function LyricsSettings({ onChanged }: { readonly onChanged?: (() => void) | undefined }) {
  return <EnricherSettings words={WORDS} onChanged={onChanged} />;
}
