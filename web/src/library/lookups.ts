/**
 * @file The online lookups a Track's menu may offer: which enricher each asks, what the menu
 * calls it, and the site it asks.
 */

import { GlobeIcon, type Icon, MusicNotesIcon } from "@phosphor-icons/react";

import { DETAILS_ENRICHER, MUSICBRAINZ_ENRICHER } from "../api";

/** One way to look a Track up online. */
export interface Lookup {
  readonly enricher: string;
  /** The menu item's words. */
  readonly label: string;
  /** The site it asks, as the notice names it. */
  readonly site: string;
  readonly icon: Icon;
}

/** The lookups, in the order the menu offers them. */
export const LOOKUPS: readonly Lookup[] = [
  { enricher: DETAILS_ENRICHER, label: "Find details online", site: "Bilibili", icon: GlobeIcon },
  {
    enricher: MUSICBRAINZ_ENRICHER,
    label: "Find on MusicBrainz",
    site: "MusicBrainz",
    icon: MusicNotesIcon,
  },
];
