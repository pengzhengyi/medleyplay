import { describe, expect, it } from "vitest";

import { trackOf } from "../testing/server";
import { NO_LINKS } from "./artistLinks";
import { playingPages } from "./playingPages";

describe("the album and artist pages prepared during playback", () => {
  it("prepares the shared album once and the artists of both queue entries, not the rest", () => {
    const tracks = [
      trackOf(1, "First", {
        album: "Sampler",
        album_artist: "Various",
        artist: "A",
        artists: ["A"],
        cover: null,
      }),
      trackOf(2, "Second", {
        album: "Sampler",
        album_artist: "Various",
        artist: "B",
        artists: ["B"],
        cover: "sleeve",
      }),
      trackOf(3, "Unrelated", { album: "Other", artist: "C", artists: ["C"], cover: "other" }),
    ];
    const links = { ...NO_LINKS, photoOf: (group: string) => (group === "a" ? "portrait" : null) };

    const pages = playingPages(tracks, links, 1, 2);

    expect(pages.album("Various", "Sampler").songs.map((song) => song.id)).toEqual([1, 2]);
    expect(pages.artist("B").songs.map((song) => song.id)).toEqual([2]);
    expect([...pages.pictures].sort()).toEqual(["portrait", "sleeve"]);
  });

  it("does not warm the next entry alone when there is no current song", () => {
    const tracks = [trackOf(1, "First", { cover: "sleeve" })];
    expect([...playingPages(tracks, NO_LINKS, undefined, 1).pictures]).toEqual([]);
  });
});
