/**
 * @file Telling the server which songs come up, so their albums with no cover are searched.
 *
 * Each time the song playing changes, the song playing and those after it in the queue, up
 * to 50, are sent in the order they play. The server searches the albums of the first two
 * at once and searches the rest first in the background, as the household chose.
 */

import { useEffect, useEffectEvent } from "react";

import { api } from "../api";

/** The most songs sent, the one playing included. */
export const MAX_COMING = 50;

/** Send the songs `ids` coming up, the one playing first, each time the song playing changes. */
export function useCoverLookAhead(ids: readonly (number | undefined)[]): void {
  const send = useEffectEvent(() => {
    const coming = ids.filter((id): id is number => id !== undefined).slice(0, MAX_COMING);
    if (coming.length === 0) {
      return;
    }
    api.findMissingCovers(coming).catch(() => {
      // Nothing waits on it: an album's page still searches it when opened.
    });
  });
  const [playing] = ids;
  useEffect(() => {
    send();
  }, [playing]);
}
