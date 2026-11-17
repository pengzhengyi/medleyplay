// cspell:ignore supercell
import { describe, expect, it } from "vitest";

import { type Route, hrefOf, routeOf } from "./routes";

describe("routes", () => {
  it.each<[string, Route]>([
    ["", { view: "library" }],
    ["#/library", { view: "library" }],
    ["#/library?focus=12", { view: "library", focus: 12 }],
    ["#/library?artist=ryo", { view: "library", artist: "ryo" }],
    ["#/library?group=artist", { view: "library", group: "artist" }],
    ["#/albums?artist=ryo", { view: "albums", artist: "ryo" }],
    ["#/songs", { view: "library" }],
    ["#/artists", { view: "artists" }],
    ["#/artist?name=ryo", { view: "artist", name: "ryo" }],
    ["#/artist?id=a1&name=ryo", { view: "artist", id: "a1", name: "ryo" }],
    ["#/artist?id=a1", { view: "artist", id: "a1", name: "" }],
    ["#/albums", { view: "albums" }],
    ["#/album?artist=ryo&name=Supercell", { view: "album", artist: "ryo", name: "Supercell" }],
    ["#/downloaded", { view: "downloaded" }],
    ["#/playlists", { view: "playlists" }],
    ["#/playlist?id=favorites", { view: "playlist", id: "favorites" }],
    ["#/search?q=melt", { view: "search", query: "melt" }],
    ["#/insights", { view: "insights" }],
    ["#/settings", { view: "settings" }],
    ["#/settings?section=ai", { view: "settings", section: "ai" }],
    ["#/clean-up", { view: "clean-up" }],
  ])("reads %s", (hash, route) => {
    expect(routeOf(hash)).toEqual(route);
  });

  it("ignores a song to show in the Library that isn't a number", () => {
    expect(routeOf("#/library?focus=twelve")).toEqual({ view: "library" });
    expect(routeOf("#/library?focus=")).toEqual({ view: "library" });
  });

  it("ignores a grouping the Library doesn't offer", () => {
    expect(routeOf("#/library?group=mood")).toEqual({ view: "library" });
  });

  it("goes back to the Library for a route it doesn't know", () => {
    expect(routeOf("#/nowhere")).toEqual({ view: "library" });
    expect(routeOf("#/artist")).toEqual({ view: "library" });
  });

  it.each<Route>([
    { view: "artist", name: "初音ミク/米津玄師" },
    { view: "artist", id: "0f3a", name: "Jay" },
    { view: "album", artist: "AC/DC & Friends", name: "Back in Black?" },
    { view: "artist", name: "" },
    { view: "search", query: "melt live #1" },
    { view: "settings", section: "ai" },
    { view: "library", artist: "AC/DC & Friends", group: "album" },
    { view: "albums", artist: "初音ミク/米津玄師" },
  ])("writes and reads back %o, whatever its names hold", (route) => {
    expect(routeOf(hrefOf(route))).toEqual(route);
  });
});
