/**
 * @file The lookups a Track's menu may offer: which enricher each asks, what the menu
 * calls it, and what is said once it is asked.
 */

import { GlobeIcon, type Icon, MusicNotesIcon, SparkleIcon } from "@phosphor-icons/react";

import { AI_ENRICHER, DETAILS_ENRICHER, MUSICBRAINZ_ENRICHER } from "../api";

/** One way to look a Track up online. */
export interface Lookup {
  readonly enricher: string;
  /** The menu item's words. */
  readonly label: string;
  /** Says the Track `title` is being asked about. */
  readonly notice: (title: string) => string;
  readonly icon: Icon;
}

/** The lookups, in the order the menu offers them. */
export const LOOKUPS: readonly Lookup[] = [
  {
    enricher: DETAILS_ENRICHER,
    label: "Find details online",
    notice: (title) => `Looking up “${title}” on Bilibili.`,
    icon: GlobeIcon,
  },
  {
    enricher: MUSICBRAINZ_ENRICHER,
    label: "Find on MusicBrainz",
    notice: (title) => `Looking up “${title}” on MusicBrainz.`,
    icon: MusicNotesIcon,
  },
  {
    enricher: AI_ENRICHER,
    label: "Suggest details with AI",
    notice: (title) => `Asking the AI about “${title}”.`,
    icon: SparkleIcon,
  },
];
