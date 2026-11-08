import { describe, expect, it } from "vitest";

import { trackOf } from "../testing/server";
import { EMPTY, type Store, reduce, tracksOf } from "./store";

/** A store holding Intro and Outro, as the server listed them, neither a favorite. */
const LOADED: Store = reduce(EMPTY, {
  type: "loaded",
  tracks: [trackOf(1, "Intro"), trackOf(2, "Outro")],
});

const favoriteOf = (store: Store, id: number) => tracksOf(store).get(id)?.favorite;
const ratingOf = (store: Store, id: number) => tracksOf(store).get(id)?.rating;

describe("the Track store", () => {
  it("holds the Tracks the server listed, by id, in its order", () => {
    expect([...tracksOf(LOADED).keys()]).toEqual([1, 2]);
    expect(LOADED.loaded).toBe(true);
    expect(EMPTY.loaded).toBe(false);
  });

  it("takes a Track's details from the server's answer, and ignores a Track it never listed", () => {
    const edited = reduce(LOADED, {
      type: "details",
      track: trackOf(1, "Night Drive", { year: 2016 }),
    });
    const unknown = reduce(LOADED, { type: "details", track: trackOf(9, "Nowhere") });

    expect(tracksOf(edited).get(1)).toMatchObject({ title: "Night Drive", year: 2016 });
    expect(tracksOf(edited).get(2)?.title).toBe("Outro");
    expect(unknown).toBe(LOADED);
  });

  it("takes a Track's cover from the server's answer, so the player shows it at once", () => {
    const covered = reduce(LOADED, {
      type: "details",
      track: trackOf(1, "Intro", { cover: "a".repeat(64) }),
    });

    expect(tracksOf(covered).get(1)?.cover).toBe("a".repeat(64));
  });

  it("takes a Track's Kind, and why, from the server's answer, so its mark shows it at once", () => {
    const marked = reduce(LOADED, {
      type: "details",
      track: trackOf(1, "Intro", { kind: "album", kind_reason: "named" }),
    });

    expect(tracksOf(marked).get(1)).toMatchObject({ kind: "album", kind_reason: "named" });
  });

  it("takes what listeners elsewhere rated a Track from the server's answer, once it is found", () => {
    const community = {
      source: "musicbrainz",
      of: "song" as const,
      rating: 4.2,
      votes: 24,
      link: "https://musicbrainz.org/recording/47b02a82",
    };

    const found = reduce(LOADED, { type: "details", track: trackOf(1, "Intro", { community }) });

    expect(tracksOf(found).get(1)?.community).toEqual(community);
  });

  it("keeps a favorite confirmed since the details were read", () => {
    const favored = reduce(LOADED, {
      type: "answered",
      id: 1,
      field: "favorite",
      value: true,
      seq: 1,
    });

    const edited = reduce(favored, { type: "details", track: trackOf(1, "Night Drive") });

    expect(tracksOf(edited).get(1)).toMatchObject({ title: "Night Drive", favorite: true });
  });

  it("shows a write at once, and keeps it once the server confirms it", () => {
    const writing = reduce(LOADED, {
      type: "write",
      id: 1,
      field: "favorite",
      value: true,
      seq: 1,
    });
    const confirmed = reduce(writing, {
      type: "answered",
      id: 1,
      field: "favorite",
      value: true,
      seq: 1,
    });

    expect(favoriteOf(writing, 1)).toBe(true);
    expect(favoriteOf(confirmed, 1)).toBe(true);
    expect(confirmed.pending.size).toBe(0);
  });

  it("puts back the last value the server confirmed when a write is refused", () => {
    const rated = reduce(
      reduce(LOADED, { type: "write", id: 1, field: "rating", value: 3, seq: 1 }),
      { type: "answered", id: 1, field: "rating", value: 3, seq: 1 },
    );
    const writing = reduce(rated, { type: "write", id: 1, field: "rating", value: 5, seq: 2 });

    const refused = reduce(writing, { type: "refused", id: 1, field: "rating", seq: 2 });

    expect(ratingOf(refused, 1)).toBe(3);
  });

  it("shows the latest write while an earlier one is answered", () => {
    const on = reduce(LOADED, { type: "write", id: 1, field: "favorite", value: true, seq: 1 });
    const off = reduce(on, { type: "write", id: 1, field: "favorite", value: false, seq: 2 });

    const earlierAnswered = reduce(off, {
      type: "answered",
      id: 1,
      field: "favorite",
      value: true,
      seq: 1,
    });
    const earlierRefused = reduce(off, { type: "refused", id: 1, field: "favorite", seq: 1 });

    expect(favoriteOf(earlierAnswered, 1)).toBe(false);
    expect(favoriteOf(earlierRefused, 1)).toBe(false);
  });

  it("keeps a favorite and a rating written at once apart", () => {
    const both = reduce(
      reduce(LOADED, { type: "write", id: 1, field: "favorite", value: true, seq: 1 }),
      { type: "write", id: 1, field: "rating", value: 4, seq: 2 },
    );

    const ratingAnswered = reduce(both, {
      type: "answered",
      id: 1,
      field: "rating",
      value: 4,
      seq: 2,
    });

    expect(favoriteOf(ratingAnswered, 1)).toBe(true);
    expect(ratingOf(ratingAnswered, 1)).toBe(4);
  });

  it("keeps a write under way over a fresh list from the server", () => {
    const writing = reduce(LOADED, {
      type: "write",
      id: 2,
      field: "favorite",
      value: true,
      seq: 1,
    });

    const reloaded = reduce(writing, {
      type: "loaded",
      tracks: [trackOf(1, "Intro", { play_count: 4 }), trackOf(2, "Outro")],
    });

    expect(favoriteOf(reloaded, 2)).toBe(true);
    expect(tracksOf(reloaded).get(1)?.play_count).toBe(4);
  });

  it("forgets a write for a Track the server no longer lists", () => {
    const writing = reduce(LOADED, {
      type: "write",
      id: 2,
      field: "favorite",
      value: true,
      seq: 1,
    });

    const reloaded = reduce(writing, { type: "loaded", tracks: [trackOf(1, "Intro")] });

    expect([...tracksOf(reloaded).keys()]).toEqual([1]);
    expect(reloaded.pending.size).toBe(0);
  });

  it("gives back the same Tracks while nothing changes, so views needn't work again", () => {
    expect(tracksOf(LOADED)).toBe(tracksOf(LOADED));
  });
});
