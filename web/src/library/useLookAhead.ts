/**
 * @file Asking about the songs coming up, for each enricher the household has asked for
 * the next to play.
 *
 * The song playing and the one after it are each asked about once in the page, while
 * the enricher may be asked about them. A song of a split file is asked about through
 * its file, as any lookup is, unless the lookup asks about such a song itself, as lyrics
 * do. What a lookup comes to shows on the song's row.
 */

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { LYRICS_ENRICHER, lyricsMatchInProgress, type Track } from "../api";
import { LOOKUPS } from "./lookups";
import type { Library } from "./useLibrary";

export function useLookAhead(
  ids: readonly (number | undefined)[],
  tracks: ReadonlyMap<number, Track>,
  library: Pick<
    Library,
    "modes" | "findable" | "find" | "lyricsMatchEnds" | "lyricsStreamConnections"
  >,
): void {
  // Each enricher and Track asked about already, so a song coming round again isn't.
  const asked = useRef(new Set<string>());
  const deferred = useRef(new Map<number, { jobId: number; reconnects: number }>());
  const [refusals, setRefusals] = useState(0);
  const lookAhead = useEffectEvent(() => {
    for (const id of ids) {
      if (id === undefined) {
        continue;
      }
      for (const [enricher, mode] of library.modes) {
        const forSong = LOOKUPS.some((lookup) => lookup.enricher === enricher && lookup.forSong);
        const target = forSong ? id : (tracks.get(id)?.segment_of ?? id);
        const key = `${enricher}\n${String(target)}`;
        const end = library.lyricsMatchEnds.get(target) ?? 0;
        if (enricher === LYRICS_ENRICHER) {
          const held = deferred.current.get(target);
          if (held !== undefined) {
            const ended = end > held.jobId;
            if (!ended && library.lyricsStreamConnections === held.reconnects) continue;
            deferred.current.delete(target);
            asked.current.delete(key);
          }
        }
        if (mode !== "next" || asked.current.has(key)) {
          continue;
        }
        if (library.findable.get(enricher)?.has(target) === true) {
          asked.current.add(key);
          const reconnects = library.lyricsStreamConnections;
          library.find(enricher, target).catch((failure: unknown) => {
            if (enricher === LYRICS_ENRICHER && lyricsMatchInProgress(failure)) {
              deferred.current.set(target, { jobId: end, reconnects });
              setRefusals((count) => count + 1);
            }
          });
        }
      }
    }
  });
  const coming = ids.join(",");
  useEffect(() => {
    lookAhead();
  }, [
    coming,
    library.modes,
    library.findable,
    library.lyricsMatchEnds,
    library.lyricsStreamConnections,
    refusals,
  ]);
}
