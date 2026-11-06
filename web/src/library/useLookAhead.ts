/**
 * @file Asking about the songs coming up, for each enricher the household has asked for
 * the next to play.
 *
 * The song playing and the one after it are each asked about once in the page, while
 * the enricher may be asked about them. A song of a split file is asked about through
 * its file, as any lookup is. What a lookup comes to shows on the song's row.
 */

import { useEffect, useEffectEvent, useRef } from "react";

import type { Track } from "../api";
import type { Library } from "./useLibrary";

export function useLookAhead(
  ids: readonly (number | undefined)[],
  tracks: ReadonlyMap<number, Track>,
  library: Pick<Library, "modes" | "findable" | "find">,
): void {
  // Each enricher and Track asked about already, so a song coming round again isn't.
  const asked = useRef(new Set<string>());
  const lookAhead = useEffectEvent(() => {
    for (const id of ids) {
      if (id === undefined) {
        continue;
      }
      const target = tracks.get(id)?.segment_of ?? id;
      for (const [enricher, mode] of library.modes) {
        const key = `${enricher}\n${String(target)}`;
        if (mode !== "next" || asked.current.has(key)) {
          continue;
        }
        if (library.findable.get(enricher)?.has(target) === true) {
          asked.current.add(key);
          library.find(enricher, target).catch(() => {
            // The song's row says why, as it does for any lookup.
          });
        }
      }
    }
  });
  const coming = ids.join(",");
  useEffect(() => {
    lookAhead();
  }, [coming, library.modes, library.findable]);
}
