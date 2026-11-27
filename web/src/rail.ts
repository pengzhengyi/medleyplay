/**
 * @file How the rail of views shows, as this browser chose: its icons only, or not;
 * minimized to the view shown, or not.
 *
 * The choices belong to the screen in front of you, so each browser keeps its own;
 * without storage they last as long as the page.
 */

import { choice } from "./storedChoice";

const [collapse, useCollapsed] = choice("medleyplay.rail", "icons");
const [minimize, useMinimized] = choice("medleyplay.rail-minimized", "yes");

/** Show only the rail's icons, or its names too, in this browser. */
export const setRailCollapsed: (collapsed: boolean) => void = collapse;

/** Whether the rail shows only its icons in this browser. */
export const useRailCollapsed: () => boolean = useCollapsed;

/** Minimize the rail to the view shown, or show it whole, in this browser. */
export const setRailMinimized: (minimized: boolean) => void = minimize;

/** Whether the rail is minimized to the view shown in this browser. */
export const useRailMinimized: () => boolean = useMinimized;

/**
 * What the rail calls each of its views. A view headed by its own name needs no heading
 * while the rail is minimized: the rail's menu above it says the same.
 */
export const VIEW_LABELS = {
  library: "Library",
  radio: "Radio",
  artists: "Artists",
  albums: "Albums",
  playlists: "Playlists",
  downloaded: "Downloaded",
  insights: "Insights",
  "clean-up": "Clean up",
  settings: "Settings",
} as const;
