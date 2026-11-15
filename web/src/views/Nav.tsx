/**
 * @file The views to move between: a rail, tabs, or a tab bar, as the width allows.
 *
 * *Clean up* sits under Insights, with how many names wait. A phone's tab bar has no
 * room for it, so there Insights carries the count, and opens with a way to it.
 *
 * The rail can collapse to its icons, to leave the page more room; each then names its
 * view on hover, as its accessible name always does.
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
  SidebarSimpleIcon,
  VinylRecordIcon,
} from "@phosphor-icons/react";

import { type Route, hrefOf } from "../routes";

type Top =
  | "library"
  | "radio"
  | "artists"
  | "albums"
  | "downloaded"
  | "playlists"
  | "insights"
  | "settings"
  | "clean-up";

const TOPS: readonly {
  readonly view: Top;
  readonly label: string;
  readonly icon: Icon;
  /** Shown under the view before it, and left out of a phone's tab bar. */
  readonly under?: boolean;
}[] = [
  { view: "library", label: "Library", icon: MusicNotesSimpleIcon },
  { view: "radio", label: "Radio", icon: RadioIcon },
  { view: "artists", label: "Artists", icon: MicrophoneStageIcon },
  { view: "albums", label: "Albums", icon: VinylRecordIcon },
  { view: "downloaded", label: "Downloaded", icon: DownloadSimpleIcon },
  { view: "playlists", label: "Playlists", icon: PlaylistIcon },
  { view: "insights", label: "Insights", icon: ChartBarIcon },
  { view: "clean-up", label: "Clean up", icon: BroomIcon, under: true },
  { view: "settings", label: "Settings", icon: GearSixIcon },
];

/** The top view a route belongs to: an artist's Tracks belong to Artists, and so on. */
function topOf(route: Route): Top | undefined {
  switch (route.view) {
    case "artist":
      return "artists";
    case "album":
      return "albums";
    case "playlist":
      return "playlists";
    case "search":
      return undefined;
    default:
      return route.view;
  }
}

/**
 * Links to each view, the current one marked, and how many names wait to be cleaned up.
 * With `onToggle`, a rail that shows its names, or not while `collapsed`.
 */
export function Nav({
  route,
  toDo = 0,
  collapsed = false,
  onToggle,
}: {
  readonly route: Route;
  readonly toDo?: number;
  readonly collapsed?: boolean;
  readonly onToggle?: () => void;
}) {
  const top = topOf(route);
  return (
    <nav className={collapsed ? "views collapsed" : "views"} aria-label="Views" id="views">
      <ul>
        {TOPS.map(({ view, label, icon: ViewIcon, under = false }) => {
          const current = view === top;
          const counted = toDo > 0 && (view === "clean-up" || view === "insights");
          const waiting = `${String(toDo)} ${toDo === 1 ? "name" : "names"} to clean up`;
          const named = counted ? `${label}, ${waiting}` : label;
          return (
            <li key={view} className={under ? "under" : undefined}>
              <a
                className="view-link"
                href={hrefOf({ view })}
                aria-current={current ? "page" : undefined}
                aria-label={counted ? named : undefined}
                title={collapsed ? named : undefined}
              >
                <ViewIcon weight={current ? "fill" : "regular"} aria-hidden />
                <span>{label}</span>
                {counted && (
                  <span
                    className={view === "insights" ? "view-count on-phone" : "view-count"}
                    aria-hidden
                  >
                    {toDo}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
      {onToggle !== undefined && (
        <button
          type="button"
          className="views-toggle"
          aria-label="Show the views' names"
          aria-expanded={!collapsed}
          aria-controls="views"
          title={collapsed ? "Show the views' names" : "Show only the icons"}
          onClick={onToggle}
        >
          <SidebarSimpleIcon aria-hidden />
        </button>
      )}
    </nav>
  );
}
