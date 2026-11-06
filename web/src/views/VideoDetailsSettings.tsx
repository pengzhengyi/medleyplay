/**
 * @file The video details part of the Bilibili section of Settings, for an admin: when the
 * lookup is asked, and its reset after Bilibili refused it.
 */

import { DETAILS_ENRICHER } from "../api";
import { EnricherSettings, type EnricherWords } from "./EnricherSettings";

const WORDS: EnricherWords = {
  enricher: DETAILS_ENRICHER,
  site: "Bilibili",
  heading: "Video details",
  description: (
    <>
      Find details online asks Bilibili for a video&apos;s title, description, and cover, one Track
      at a time, and never the same video twice in a day.
    </>
  ),
  count: (tracks) =>
    tracks === 1
      ? "1 Track can have its details found."
      : `${String(tracks)} Tracks can have their details found.`,
  off: "Finding video details is turned off.",
};

/** When the lookup is asked, how many Tracks it can be, and a reset once stopped. */
export function VideoDetailsSettings({
  onChanged,
}: {
  readonly onChanged?: (() => void) | undefined;
}) {
  return <EnricherSettings words={WORDS} onChanged={onChanged} />;
}
