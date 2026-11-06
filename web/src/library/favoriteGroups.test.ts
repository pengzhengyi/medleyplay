// cspell:ignore ＲＡＤＩＯＨＥＡＤ Budokan
import { describe, expect, it } from "vitest";

import { trackOf } from "../testing/server";
import {
  canFavorite,
  favoriteGroupsOf,
  isFavoriteAlbum,
  isFavoriteArtist,
  favoriteSongsSuggesting,
} from "./favoriteGroups";

describe("favorite artists and albums", () => {
  it("matches the names the Library uses, whatever their case or width", () => {
    const favorites = favoriteGroupsOf({
      artists: [{ name: "radiohead" }],
      albums: [{ artist: "朴树", name: "生如夏花" }],
    });

    expect(isFavoriteArtist(favorites, "Radiohead")).toBe(true);
    expect(isFavoriteArtist(favorites, "ＲＡＤＩＯＨＥＡＤ")).toBe(true);
    expect(isFavoriteAlbum(favorites, "朴树", "生如夏花")).toBe(true);
    expect(isFavoriteAlbum(favorites, "", "生如夏花")).toBe(false);
  });

  it("offers no heart for the unknown artist, no album, or an album named for a video's id", () => {
    expect(canFavorite("朴树")).toBe(true);
    expect(canFavorite("  ")).toBe(false);
    expect(canFavorite("BV1dm4y1s7ak")).toBe(false);
  });
});

describe("suggesting a favorite", () => {
  const songs = (favorites: number, others: number) => [
    ...Array.from({ length: favorites }, (_, i) =>
      trackOf(i + 1, `Loved ${String(i)}`, { favorite: true }),
    ),
    ...Array.from({ length: others }, (_, i) => trackOf(100 + i, `Other ${String(i)}`)),
  ];

  it("suggests an artist or album with three favorite songs", () => {
    expect(favoriteSongsSuggesting(songs(3, 20))).toBe(3);
  });

  it("suggests one with two favorite songs when they are half its songs", () => {
    expect(favoriteSongsSuggesting(songs(2, 2))).toBe(2);
    expect(favoriteSongsSuggesting(songs(2, 3))).toBe(0);
  });

  it("suggests nothing for a single favorite song", () => {
    expect(favoriteSongsSuggesting(songs(1, 0))).toBe(0);
  });

  it("counts the songs of a split file, never the file itself", () => {
    const file = trackOf(9, "Live at Budokan", { split: true, favorite: true });
    const parts = [1, 2].map((part) =>
      trackOf(10 + part, `Part ${String(part)}`, { segment_of: 9, favorite: true }),
    );

    expect(
      favoriteSongsSuggesting([file, ...parts, trackOf(20, "Encore"), trackOf(21, "Outro")]),
    ).toBe(2);
    expect(favoriteSongsSuggesting([file, parts[0] ?? file, trackOf(20, "Encore")])).toBe(0);
  });
});
