/**
 * @file The video details part of the Bilibili section of Settings, for an admin: queue the
 * lookup for every Track that can have one, and reset the lookup after Bilibili refused it.
 */

import { DETAILS_ENRICHER } from "../api";
import { EnricherSettings, type EnricherWords } from "./EnricherSettings";

const WORDS: EnricherWords = {
  enricher: DETAILS_ENRICHER,
  site: "Bilibili",
  heading: "Video details",
  description: (
    <>
      Find details online asks Bilibili for a video&apos;s title, description, and cover. It asks
      only when someone chooses it, one Track at a time, and never the same video twice in a day.
    </>
  ),
  findAll: "Find details for all",
  count: (tracks) =>
    tracks === 1
      ? "1 Track can have its details found."
      : `${String(tracks)} Tracks can have their details found.`,
  off: "Finding video details is turned off.",
};

/** The lookup's state, a button to queue every Track, and a button to reset it once stopped. */
export function VideoDetailsSettings() {
  return <EnricherSettings words={WORDS} />;
}
