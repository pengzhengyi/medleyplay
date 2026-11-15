import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Track } from "../api";
import { EMPTY, type Queue } from "../player/queue";
import type { Player } from "../player/usePlayer";
import { playerOf } from "../testing/player";
import { trackOf } from "../testing/server";
import { useStation } from "./useStation";

/** Forty songs by one band, so a station from any of them has more to draw. */
const LIBRARY = Array.from({ length: 40 }, (_, n) => trackOf(n + 1, `Song ${String(n + 1)}`));

/** A queue of `tracks` playing the one at `position`, keyed by place from `from`. */
function queueOf(tracks: readonly Track[], position: number, from = 0): Queue {
  const entries = tracks.map((track, n) => ({ key: `k${String(from + n)}`, trackId: track.id }));
  return { ...EMPTY, entries, position };
}

/** A station started from the first song, its player showing `queue` as it changes. */
function startStation() {
  const playList = vi.fn();
  const add = vi.fn();
  const playing = (queue: Queue) => playerOf({ queue, playList, add });
  const rendered = renderHook(({ player }: { player: Player }) => useStation(player, LIBRARY, 1), {
    initialProps: { player: playing(EMPTY) },
  });
  act(() => {
    rendered.result.current.start(LIBRARY[0]);
  });
  const first = (playList.mock.calls[0]?.[0] ?? []) as Track[];
  const show = (queue: Queue) => {
    rendered.rerender({ player: playing(queue) });
  };
  const added = () => add.mock.calls.map(([track]) => track as Track);
  return { first, show, added };
}

describe("a station", () => {
  it("draws more when few remain", () => {
    const { first, show, added } = startStation();

    show(queueOf(first, 7));

    expect(added()).toHaveLength(6);
  });

  it("draws nothing more until what it last added has arrived", () => {
    const { first, show, added } = startStation();
    show(queueOf(first, 7));

    show(queueOf(first, 8));

    expect(added()).toHaveLength(6);
  });

  it("draws more though the queue shows only its end, as a remote shows the computer's", () => {
    const { first, show, added } = startStation();
    show(queueOf(first, 7));

    show(queueOf(added(), 3, first.length));

    expect(added()).toHaveLength(12);
  });
});

/** Forty songs by one band, the first five of them hearted. */
const HEARTED = LIBRARY.map((track) => (track.id <= 5 ? { ...track, favorite: true } : track));

/** The favorites station started over `tracks`, its player showing `queue` as it changes. */
function startFavorites(tracks: readonly Track[] = HEARTED) {
  const playList = vi.fn();
  const add = vi.fn();
  const playing = (queue: Queue) => playerOf({ queue, playList, add });
  const rendered = renderHook(({ player }: { player: Player }) => useStation(player, tracks, 1), {
    initialProps: { player: playing(EMPTY) },
  });
  let started = false;
  act(() => {
    started = rendered.result.current.startFavorites();
  });
  const first = (playList.mock.calls[0]?.[0] ?? []) as Track[];
  const show = (queue: Queue) => {
    rendered.rerender({ player: playing(queue) });
  };
  const added = () => add.mock.calls.map(([track]) => track as Track);
  return { started, first, show, added, station: () => rendered.result.current };
}

describe("the favorites station", () => {
  it("plays only favorites, each once before any again", () => {
    const { first, station } = startFavorites();

    expect(first.every((track) => track.favorite)).toBe(true);
    expect(new Set(first.slice(0, 5).map((track) => track.id)).size).toBe(5);
    expect(station().playing).toBe("favorites");
  });

  it("plays on with more favorites when few remain", () => {
    const { first, show, added } = startFavorites();

    show(queueOf(first, 7));

    expect(added()).toHaveLength(6);
    expect(added().every((track) => track.favorite)).toBe(true);
  });

  it("can't start without a favorite", () => {
    const { started, first, station } = startFavorites(LIBRARY);

    expect(started).toBe(false);
    expect(first).toEqual([]);
    expect(station().playing).toBeUndefined();
  });
});

describe("which station plays", () => {
  it("is a song's station when started from a song", () => {
    const { station } = startStationShowing();

    expect(station().playing).toBe("song");
  });
});

/** A station started from the first song, as the page shows it. */
function startStationShowing() {
  const rendered = renderHook(() => useStation(playerOf({ queue: EMPTY }), LIBRARY, 1));
  act(() => {
    rendered.result.current.start(LIBRARY[0]);
  });
  return { station: () => rendered.result.current };
}
