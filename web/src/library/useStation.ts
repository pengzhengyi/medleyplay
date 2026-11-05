/**
 * @file A station: a radio that keeps the queue filled as it plays.
 *
 * It starts from a song, or for the Account's own station from a song it likes, and
 * queues ten. When four remain it draws more, so a station plays on for as long as
 * songs like the seed remain; the Account's own station starts again from another
 * liked song when they run out. Choosing something else to play, or turning
 * shuffle on, ends it. It lives in this page only: a reload ends it.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { Track } from "../api";
import type { Player } from "../player/usePlayer";
import { current, upNext } from "../player/queue";
import { type Random, nextPicks, seedOf, seeded, stationSeed } from "./radio";

const FIRST = 10;
const REFILL_AT = 4;
const MORE = 6;

/** A station as the page sees it. */
export interface Station {
  /** The song the station plays from, while one plays. */
  readonly seed: Track | undefined;
  /** Whether the Account's own station plays, rather than one from a song. */
  readonly own: boolean;
  /**
   * Start a station from `seed`, or the Account's own without one. Return whether
   * anything could play.
   */
  readonly start: (seed?: Track) => boolean;
}

interface Running {
  seed: Track;
  own: boolean;
  random: Random;
  /** Every Track the station queued, the seed first. */
  queued: Set<number>;
  /** How many entries the queue holds once what the station last added is in it. */
  filledAt: number;
}

interface Shown {
  readonly seed: Track;
  readonly own: boolean;
}

/** What the page shows of the station, kept outside React, as the queue's effect changes it. */
function shownStore() {
  let value: Shown | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: Shown | undefined) => {
      value = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useStation(player: Player, tracks: readonly Track[], accountId: number): Station {
  const running = useRef<Running | undefined>(undefined);
  const [store] = useState(shownStore);
  const shown = useSyncExternalStore(store.subscribe, store.get);

  const stop = useCallback(() => {
    running.current = undefined;
    store.set(undefined);
  }, [store]);

  const start = useCallback(
    (seed?: Track) => {
      const random = seeded(seedOf(`${String(accountId)}:${String(Date.now())}`));
      const from = seed ?? stationSeed(tracks, random);
      if (from === undefined) {
        return false;
      }
      const picks = nextPicks(tracks, from, [], FIRST - 1, random, new Date());
      const list = [from, ...picks.map((pick) => pick.track)];
      running.current = {
        seed: from,
        own: seed === undefined,
        random,
        queued: new Set(list.map((track) => track.id)),
        filledAt: list.length,
      };
      store.set({ seed: from, own: seed === undefined });
      player.playList(list, 0);
      return true;
    },
    [accountId, player, store, tracks],
  );

  const { queue } = player;
  // The player is a new object each render; the station needs only its latest `add`.
  const add = useRef(player.add);
  useEffect(() => {
    add.current = player.add;
  });
  useEffect(() => {
    const station = running.current;
    if (station === undefined) {
      return;
    }
    const playing = current(queue);
    // A queue the station didn't fill, or one shuffled, is the Account's own again.
    if (
      playing === undefined ||
      queue.order !== undefined ||
      !station.queued.has(playing.trackId)
    ) {
      if (playing !== undefined || queue.entries.length === 0) {
        stop();
      }
      return;
    }
    // Draw more when few remain, unless what the station last added hasn't arrived yet.
    if (upNext(queue).length >= REFILL_AT || queue.entries.length < station.filledAt) {
      return;
    }
    const now = new Date();
    let picks = nextPicks(tracks, station.seed, [...station.queued], MORE, station.random, now);
    if (picks.length === 0 && station.own) {
      // The Account's own station goes on from another song it likes.
      const fresh = tracks.filter((track) => !station.queued.has(track.id));
      const next = stationSeed(fresh, station.random);
      if (next !== undefined) {
        station.seed = next;
        store.set({ seed: next, own: true });
        picks = [
          { track: next, reason: "" },
          ...nextPicks(tracks, next, [...station.queued], MORE - 1, station.random, now),
        ];
      }
    }
    station.filledAt = queue.entries.length + picks.length;
    for (const { track } of picks) {
      station.queued.add(track.id);
      add.current(track);
    }
  }, [queue, store, tracks, stop]);

  return { seed: shown?.seed, own: shown?.own ?? false, start };
}
