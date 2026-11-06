/**
 * @file What the songs editor needs from the dialog it is shown in, given by context,
 * so the page that makes the editor needn't know the dialog's ways.
 */

import { createContext } from "react";

export interface SongsControls {
  readonly headingId: string;
  readonly onBack: () => void;
  readonly onLock: (locked: boolean) => void;
  readonly onDone: () => void;
}

export const SongsControlsContext = createContext<SongsControls>({
  headingId: "edit-songs-title",
  onBack: () => undefined,
  onLock: () => undefined,
  onDone: () => undefined,
});
