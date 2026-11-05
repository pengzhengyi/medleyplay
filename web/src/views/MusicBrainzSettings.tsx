/**
 * @file The MusicBrainz section of Settings, for an admin: queue the lookup for every Track
 * that can be searched for, and reset the lookup after MusicBrainz refused it.
 */

import { MUSICBRAINZ_ENRICHER } from "../api";
import { EnricherSettings, type EnricherWords } from "./EnricherSettings";

const WORDS: EnricherWords = {
  enricher: MUSICBRAINZ_ENRICHER,
  site: "MusicBrainz",
  heading: "Release and cover",
  description: (
    <>
      Find on MusicBrainz asks MusicBrainz for a song&apos;s album, track number, year, and cover,
      and for a long file&apos;s album. It asks only when someone chooses it, one Track at a time,
      at most once a second, and never the same Track twice in a day.
    </>
  ),
  findAll: "Find on MusicBrainz for all",
  count: (tracks) =>
    tracks === 1
      ? "1 Track can be found on MusicBrainz."
      : `${String(tracks)} Tracks can be found on MusicBrainz.`,
  off: "Finding Tracks on MusicBrainz is turned off.",
};

/** The lookup's state, a button to queue every Track, and a button to reset it once stopped. */
export function MusicBrainzSettings() {
  return <EnricherSettings words={WORDS} />;
}
