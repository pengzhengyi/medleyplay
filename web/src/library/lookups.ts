/**
 * @file The lookups a Track's menu may offer: which enricher each asks, what the menu
 * calls it, what is said once it is asked, and what its row shows while it runs.
 */

import { GlobeIcon, type Icon, MusicNotesIcon, SparkleIcon } from "@phosphor-icons/react";

import { AI_ENRICHER, DETAILS_ENRICHER, MUSICBRAINZ_ENRICHER } from "../api";
import type { TrackLookup } from "./useLibrary";

/** One way to look a Track up online. */
export interface Lookup {
  readonly enricher: string;
  /** The menu item's words. */
  readonly label: string;
  /** Says the Track `title` is being asked about. */
  readonly notice: (title: string) => string;
  /** What the Track's row says it is doing, such as `Looking up on MusicBrainz`. */
  readonly doing: string;
  readonly icon: Icon;
}

/** The lookups, in the order the menu offers them. */
export const LOOKUPS: readonly Lookup[] = [
  {
    enricher: DETAILS_ENRICHER,
    label: "Find details online",
    notice: (title) => `Looking up “${title}” on Bilibili.`,
    doing: "Looking up on Bilibili",
    icon: GlobeIcon,
  },
  {
    enricher: MUSICBRAINZ_ENRICHER,
    label: "Find on MusicBrainz",
    notice: (title) => `Looking up “${title}” on MusicBrainz.`,
    doing: "Looking up on MusicBrainz",
    icon: MusicNotesIcon,
  },
  {
    enricher: AI_ENRICHER,
    label: "Suggest details with AI",
    notice: (title) => `Asking the AI about “${title}”.`,
    doing: "Asking the AI",
    icon: SparkleIcon,
  },
];

/** What a Track's cover shows of a lookup: what it is doing, and its words. */
export interface CoverStatus {
  readonly kind: "looking" | "waiting" | "done" | "failed";
  readonly label: string;
}

/** What the cover shows of `lookup`, given whether medleyplay is Online; nothing once it's gone. */
export function coverStatusOf(
  lookup: TrackLookup | undefined,
  online: boolean,
): CoverStatus | undefined {
  const asked = LOOKUPS.find((each) => each.enricher === lookup?.enricher);
  if (lookup === undefined || asked === undefined) {
    return undefined;
  }
  switch (lookup.state) {
    case "waiting":
    case "queued":
      return online
        ? { kind: "looking", label: asked.doing }
        : { kind: "waiting", label: `${asked.doing} once medleyplay is Online` };
    case "running":
      return { kind: "looking", label: asked.doing };
    case "succeeded":
      return { kind: "done", label: `${asked.doing}: done` };
    case "failed":
      return {
        kind: "failed",
        label:
          lookup.message === ""
            ? `${asked.doing} failed`
            : `${asked.doing} failed: ${lookup.message}`,
      };
    case "cancelled":
      return undefined;
  }
}
