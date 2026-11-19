/**
 * @file Looking up the artists of the songs coming up that have no photo, once each.
 *
 * The song playing and the one after it are each sent once in the page; the server asks
 * Deezer about their artists with no photo only while the household has those looked up,
 * and never about one looked up before.
 */

import { useEffect, useEffectEvent, useRef } from "react";

import { api } from "../api";

/** Have the server look up the artists with no photo of the songs `ids`, each song once. */
export function usePhotoLookAhead(ids: readonly (number | undefined)[]): void {
  const asked = useRef(new Set<number>());
  const lookAhead = useEffectEvent(() => {
    const fresh = ids.filter((id): id is number => id !== undefined && !asked.current.has(id));
    if (fresh.length === 0) {
      return;
    }
    for (const id of fresh) {
      asked.current.add(id);
    }
    api.findPhotos(fresh).catch(() => {
      // Nothing waits on it: the photo is looked for again when someone looks.
    });
  });
  const coming = ids.join(",");
  useEffect(() => {
    lookAhead();
  }, [coming]);
}
