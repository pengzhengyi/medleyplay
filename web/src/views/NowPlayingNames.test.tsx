import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Track } from "../api";
import { type FavoriteGroups, NO_FAVORITES } from "../library/favoriteGroups";
import type { Playing } from "../player/albumNow";
import { hrefOf } from "../routes";
import { artistIdOf, favoriteGroupsNaming, trackOf } from "../testing/server";
import { NowPlayingNames } from "./NowPlayingNames";
import { LyricsAvailabilityProvider } from "./LyricsAvailabilityProvider";

/** 可爱女人, by 周杰伦, from the album *Jay*, playing as a song of its own. */
const LOVELY = trackOf(7, "可爱女人", { artist: "周杰伦", album: "Jay", album_artist: "周杰伦" });

/** *1*, The Beatles' album as one file, split into its songs. */
const ONE = trackOf(39, "1", {
  artist: "The Beatles",
  album: "1",
  kind: "album",
  kind_reason: "split",
  split: true,
});

function renderNames(
  track: Track,
  playing: Playing,
  favorites: FavoriteGroups = NO_FAVORITES,
  catalog: readonly Track[] = [track],
) {
  const handlers = {
    onFavorite: vi.fn(),
    onFavoriteArtist: vi.fn(),
    onFavoriteAlbum: vi.fn(),
  };
  render(
    <LyricsAvailabilityProvider tracks={catalog}>
      <NowPlayingNames
        track={track}
        playing={playing}
        position={0}
        moving
        favorites={favorites}
        onPlaySong={vi.fn()}
        onEditSongs={vi.fn()}
        onNavigate={vi.fn()}
        {...handlers}
      />
    </LyricsAvailabilityProvider>,
  );
  return handlers;
}

describe("what Now Playing names", () => {
  it.each(["song", "group", "file"] as const)(
    "keeps %s lyrics availability on its kind marks independently of artwork",
    (shape) => {
      const file = { ...ONE, has_lyrics: true };
      const first = trackOf(40, "Opening", {
        album: "1",
        artist: "The Beatles",
        segment_of: 39,
        has_lyrics: true,
      });
      const last = { ...first, id: 41, title: "Closing" };
      const playing: Playing =
        shape === "song"
          ? { kind: "song" }
          : {
              kind: "album",
              current: 0,
              length: 374,
              songs: [first, last].map((track, index) => ({
                entry: { key: String(track.id), trackId: track.id },
                track,
                start: index * 187,
                from: 0,
                length: 187,
              })),
            };

      renderNames(shape === "file" ? file : first, playing, NO_FAVORITES, [file, first, last]);

      expect(
        screen.getByRole("img", {
          name: shape === "song" ? "Playing a song, Lyrics available" : "Song, Lyrics available",
        }),
      ).toBeInTheDocument();
      if (shape === "file") {
        expect(
          screen.getByRole("button", { name: "Album: 1, song 1 of 2, All songs have lyrics" }),
        ).toBeInTheDocument();
      }
    },
  );

  it("marks the named album's complete lyrics independently of its playing song", () => {
    const song = { ...LOVELY, has_lyrics: true };
    const other = { ...song, id: 8, title: "Second song" };
    renderNames(song, { kind: "song" }, NO_FAVORITES, [song, other]);

    expect(screen.getByRole("img", { name: "Album, All songs have lyrics" })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Playing a song, Lyrics available" }),
    ).toBeInTheDocument();
  });

  it("does not derive album lyrics from only the songs in the playing group", () => {
    const song = { ...LOVELY, has_lyrics: true };
    const other = { ...song, id: 8, title: "Second song" };
    const missing = { ...song, id: 9, title: "Not queued", has_lyrics: false };
    renderNames(
      song,
      {
        kind: "album",
        current: 0,
        length: 374,
        songs: [song, other].map((track, index) => ({
          entry: { key: String(track.id), trackId: track.id },
          track,
          start: index * 187,
          from: 0,
          length: 187,
        })),
      },
      NO_FAVORITES,
      [song, other, missing],
    );

    expect(screen.queryByRole("img", { name: /All songs have lyrics/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Album: Jay, song 1 of 2" })).toBeInTheDocument();
  });

  it("names the album, then the song in it, then who sings it, each with its own heart", () => {
    renderNames(LOVELY, { kind: "song" });

    expect(screen.getByRole("link", { name: "Jay" })).toHaveAttribute(
      "href",
      hrefOf({ view: "album", artist: "周杰伦", name: "Jay" }),
    );
    expect(screen.getByRole("heading", { name: "可爱女人" })).toBeVisible();
    expect(screen.getByRole("link", { name: "周杰伦" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /^Favorite / }).map((h) => h.ariaLabel)).toEqual([
      "Favorite album Jay",
      "Favorite 可爱女人",
      "Favorite artist 周杰伦",
    ]);
  });

  it("favorites the album or the artist from the heart beside its name", async () => {
    const { onFavoriteAlbum, onFavoriteArtist, onFavorite } = renderNames(LOVELY, {
      kind: "song",
    });

    await userEvent.click(screen.getByRole("button", { name: "Favorite album Jay" }));
    await userEvent.click(screen.getByRole("button", { name: "Favorite artist 周杰伦" }));

    expect(onFavoriteAlbum).toHaveBeenCalledWith("周杰伦", "Jay", true);
    expect(onFavoriteArtist).toHaveBeenCalledWith("周杰伦", true, artistIdOf("周杰伦"));
    expect(onFavorite).not.toHaveBeenCalled();
  });

  it("shows a favorite album's heart given, and only its own", () => {
    renderNames(
      LOVELY,
      { kind: "song" },
      favoriteGroupsNaming([], [{ artist: "周杰伦", name: "Jay" }]),
    );

    expect(screen.getByRole("button", { name: "Favorite album Jay" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Favorite artist 周杰伦" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("names only the album for a whole album in one file not yet split", () => {
    const whole = { ...ONE, split: false, kind_reason: "length" as const };

    renderNames(whole, { kind: "album", songs: [], current: -1, length: undefined });

    expect(screen.getByRole("heading", { name: "1" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Favorite 1$/ })).not.toBeInTheDocument();
  });

  it("names the song the position is in for a split file playing whole", () => {
    const song = trackOf(214, "She Loves You", { artist: "The Beatles", segment_of: 39 });
    const entry = { key: "w", trackId: 39 };

    renderNames(ONE, {
      kind: "album",
      songs: [
        { entry, track: trackOf(212, "Love Me Do"), start: 0, from: 0, length: 143 },
        { entry, track: song, start: 143, from: 143, length: 116 },
      ],
      current: 1,
      length: 259,
    });

    expect(screen.getByRole("heading", { name: "She Loves You" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Favorite She Loves You" })).toBeVisible();
  });

  it("links to the video a Track came from, in a new tab", () => {
    renderNames(
      { ...LOVELY, video: "https://www.bilibili.com/video/BV1dm4y1s7ak" },
      { kind: "song" },
    );

    const video = screen.getByRole("link", { name: "Bilibili" });
    expect(video).toHaveAttribute("href", "https://www.bilibili.com/video/BV1dm4y1s7ak");
    expect(video).toHaveAttribute("target", "_blank");
  });
});
