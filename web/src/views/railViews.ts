/**
 * @file The views of the rail: each one's name and icon, and their order.
 *
 * The views a browser can move come in the order it chose; *Clean up* follows Insights,
 * under it, and Settings comes last.
 */

import {
  BroomIcon,
  ChartBarIcon,
  DownloadSimpleIcon,
  GearSixIcon,
  type Icon,
  MicrophoneStageIcon,
  MusicNotesSimpleIcon,
  PlaylistIcon,
  RadioIcon,
  VinylRecordIcon,
} from "@phosphor-icons/react";

import { VIEW_LABELS } from "../rail";
import type { RailView } from "../railOrder";
import type { Announcements, UniqueIdentifier } from "@dnd-kit/core";
import type { Words } from "../locale";

/** A view the rail links to. */
export type Top = RailView | "clean-up" | "settings";

/** A view as the rail shows it. */
export interface RailEntry {
  readonly view: Top;
  readonly label: string;
  readonly icon: Icon;
  /** Shown under the view before it, and left out of a phone's tab bar. */
  readonly under?: boolean;
}

/** Each view's name and icon. */
export const RAIL_ENTRIES: Readonly<Record<Top, RailEntry>> = {
  library: { view: "library", label: VIEW_LABELS.library, icon: MusicNotesSimpleIcon },
  artists: { view: "artists", label: VIEW_LABELS.artists, icon: MicrophoneStageIcon },
  albums: { view: "albums", label: VIEW_LABELS.albums, icon: VinylRecordIcon },
  radio: { view: "radio", label: VIEW_LABELS.radio, icon: RadioIcon },
  playlists: { view: "playlists", label: VIEW_LABELS.playlists, icon: PlaylistIcon },
  downloaded: { view: "downloaded", label: VIEW_LABELS.downloaded, icon: DownloadSimpleIcon },
  insights: { view: "insights", label: VIEW_LABELS.insights, icon: ChartBarIcon },
  "clean-up": { view: "clean-up", label: VIEW_LABELS["clean-up"], icon: BroomIcon, under: true },
  settings: { view: "settings", label: VIEW_LABELS.settings, icon: GearSixIcon },
};

/** The rail's views in `order`, with Clean up under Insights and Settings last. */
export function railEntriesIn(order: readonly RailView[]): readonly RailEntry[] {
  const entries = order.flatMap((view) =>
    view === "insights" ? [RAIL_ENTRIES.insights, RAIL_ENTRIES["clean-up"]] : [RAIL_ENTRIES[view]],
  );
  return [...entries, RAIL_ENTRIES.settings];
}

export function railAnnouncements(order: readonly RailView[], t: Words): Announcements {
  const name = (id: UniqueIdentifier) =>
    t(
      order.find((view) => view === id) === undefined ? "View" : RAIL_ENTRIES[id as RailView].label,
    );
  const position = (id: UniqueIdentifier) => order.findIndex((view) => view === id) + 1;
  return {
    onDragStart: ({ active }) => t("Picked up {{name}}.", { name: name(active.id) }),
    onDragOver: ({ active, over }) =>
      over === null || over.id === active.id
        ? undefined
        : t("{{name}} would move to position {{position}}.", {
            name: name(active.id),
            position: position(over.id),
          }),
    onDragEnd: ({ active, over }) =>
      over === null || over.id === active.id
        ? t("{{name}} stays where it was.", { name: name(active.id) })
        : t("{{name}} moved to position {{position}}.", {
            name: name(active.id),
            position: position(over.id),
          }),
    onDragCancel: ({ active }) => t("{{name}} stays where it was.", { name: name(active.id) }),
  };
}
