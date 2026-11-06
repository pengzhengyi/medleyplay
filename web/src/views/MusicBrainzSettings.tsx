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
      and for a long file&apos;s album, one Track at a time, at most once a second, and never the
      same Track twice in a day.
    </>
  ),
  count: (tracks) =>
    tracks === 1
      ? "1 Track can be found on MusicBrainz."
      : `${String(tracks)} Tracks can be found on MusicBrainz.`,
  off: "Finding Tracks on MusicBrainz is turned off.",
};

/** When the lookup is asked, how many Tracks it can be, and a reset once stopped. */
export function MusicBrainzSettings({
  onChanged,
}: {
  readonly onChanged?: (() => void) | undefined;
}) {
  return <EnricherSettings words={WORDS} onChanged={onChanged} />;
}
