/**
 * @file The parts of the page whose code loads apart from the rest: large, or rarely
 * opened. Each loads while the browser is idle once the Library has drawn, so it opens
 * at once and an upgrade can't take its code away; until then it opens behind its frame.
 */

import { lazyPart } from "../lazyPart";

export const DeviceWindow = lazyPart(() =>
  import("./DeviceWindow").then((loaded) => loaded.DeviceWindow),
);
export const LyricsEditor = lazyPart(() =>
  import("./LyricsEditor").then((loaded) => loaded.LyricsEditor),
);
export const SongsEditor = lazyPart(() =>
  import("./EditSongs").then((loaded) => loaded.SongsEditor),
);
export const SettingsView = lazyPart(() =>
  import("./SettingsView").then((loaded) => loaded.SettingsView),
);
export const CleanUpView = lazyPart(() =>
  import("./CleanUpView").then((loaded) => loaded.CleanUpView),
);
export const InsightsView = lazyPart(() =>
  import("./InsightsView").then((loaded) => loaded.InsightsView),
);
/** The code editor of the Songs panel's list mode, by far the largest part. */
export const ListEditor = lazyPart(() => import("./ListEditor").then((loaded) => loaded.default));

/** Every part, in the order they are preloaded: the dialogs and panels, the views, the list editor. */
export const PRELOADED = [
  DeviceWindow,
  LyricsEditor,
  SongsEditor,
  SettingsView,
  CleanUpView,
  InsightsView,
  ListEditor,
] as const;
