import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AlbumSong, Playing } from "../player/albumNow";
import { useLanguageChoice } from "../locale";
import { trackOf } from "../testing/server";
import { AlbumCard, PlayingKind } from "./PlayingKind";
import { LyricsAvailabilityProvider } from "./LyricsAvailabilityProvider";

/**
 * 生如夏花 split into three songs, the second playing:
 *
 * ```text
 * 1  傲慢的上校  4:00  played, a favorite
 * 2  浮游        5:00  playing, 1:12 in
 * 3  生如夏花    3:00  to come
 * ```
 */
const SONGS: readonly AlbumSong[] = [
  ["傲慢的上校", 0, 240],
  ["浮游", 240, 300],
  ["生如夏花", 540, 180],
].map(([title, start, length], index) => ({
  entry: { key: String.fromCharCode(97 + index), trackId: 11 + index, unit: "file:9" },
  track: trackOf(11 + index, String(title), {
    album: "生如夏花",
    segment_of: 9,
    favorite: index === 0,
  }),
  start: Number(start),
  from: 0,
  length: Number(length),
}));
const ALBUM: Playing = { kind: "album", songs: SONGS, current: 1, length: 720 };
const PLAYING = SONGS[1]?.track ?? trackOf(12, "浮游");

function renderKind(playing: Playing, track = PLAYING) {
  const onPlaySong = vi.fn();
  const onEditSongs = vi.fn();
  const onFavorite = vi.fn();
  render(
    <PlayingKind
      playing={playing}
      track={track}
      position={72}
      moving
      opens="below"
      onPlaySong={onPlaySong}
      onEditSongs={onEditSongs}
      onFavorite={onFavorite}
    />,
  );
  return { onPlaySong, onEditSongs, onFavorite };
}

/** The album's songs as buttons that play them, leaving out each one's heart. */
const songButtons = (songs: HTMLElement) =>
  within(songs).getAllByRole("button", { name: /, (played|playing now|to come)$/u });

describe("what plays now", () => {
  it.each(["song", "album"] as const)(
    "keeps a mounted %s mark's lyrics and language current without changing its track props",
    (kind) => {
      const { result } = renderHook(() => useLanguageChoice());
      const original = result.current[0];
      const track = trackOf(9, "Blue", { kind, album: "Blue" });
      const playing: Playing =
        kind === "song"
          ? { kind: "song" }
          : { kind: "album", songs: [], current: -1, length: undefined };
      const shown = (
        <PlayingKind
          playing={playing}
          track={track}
          position={0}
          moving={false}
          opens="below"
          onPlaySong={vi.fn()}
          onEditSongs={vi.fn()}
        />
      );
      const { rerender } = render(
        <LyricsAvailabilityProvider tracks={[track]}>{shown}</LyricsAvailabilityProvider>,
      );
      const role = kind === "song" ? "img" : "button";
      const mark = screen.getByRole(role, {
        name: kind === "song" ? "Playing a song" : "Album: Blue",
      });

      rerender(
        <LyricsAvailabilityProvider tracks={[{ ...track, has_lyrics: true }]}>
          {shown}
        </LyricsAvailabilityProvider>,
      );

      expect(mark).toHaveAccessibleName(
        kind === "song" ? "Playing a song, Lyrics available" : "Album: Blue, All songs have lyrics",
      );
      try {
        act(() => {
          result.current[1]("zh-Hans");
        });

        expect(
          screen.getByRole(role, {
            name: kind === "song" ? "正在播放歌曲，有歌词" : "专辑：Blue，所有歌曲都有歌词",
          }),
        ).toBe(mark);
        rerender(<LyricsAvailabilityProvider tracks={[track]}>{shown}</LyricsAvailabilityProvider>);
        expect(mark).toHaveAccessibleName(kind === "song" ? "正在播放歌曲" : "专辑：Blue");
      } finally {
        act(() => {
          result.current[1](original);
        });
      }
    },
  );

  it("is a song's mark, with nothing to open", () => {
    renderKind({ kind: "song" });

    expect(screen.getByRole("img", { name: "Playing a song" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("opens an album's songs in order: played, playing and how far, and to come", async () => {
    renderKind(ALBUM);

    await userEvent.click(screen.getByRole("button", { name: "Album: 生如夏花, song 2 of 3" }));

    const songs = screen.getByRole("region", { name: "Songs of 生如夏花" });
    expect(songButtons(songs).map((song) => song.getAttribute("aria-label"))).toEqual([
      "傲慢的上校, played",
      "浮游, playing now",
      "生如夏花, to come",
    ]);
    expect(within(songs).getByRole("button", { current: true })).toHaveTextContent("1:12 / 5:00");
    expect(songs).toHaveTextContent("5:12 of 12:00");
  });

  it("opens the songs of a split file playing whole, timed from where each starts in it", async () => {
    const file = trackOf(9, "生如夏花", { album: "生如夏花", kind: "album", split: true });
    const whole = SONGS.map((song) => ({
      ...song,
      entry: { key: "w", trackId: 9 },
      from: song.start,
    }));
    const playing: Playing = { kind: "album", songs: whole, current: 1, length: 720 };
    render(
      <PlayingKind
        playing={playing}
        track={file}
        position={312}
        moving
        opens="below"
        onPlaySong={vi.fn()}
        onEditSongs={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Album: 生如夏花, song 2 of 3" }));

    const songs = screen.getByRole("region", { name: "Songs of 生如夏花" });
    expect(within(songs).getByRole("button", { current: true })).toHaveTextContent("1:12 / 5:00");
    expect(songs).toHaveTextContent("5:12 of 12:00");
  });

  it("plays a song of the album when it is chosen", async () => {
    const { onPlaySong } = renderKind(ALBUM);
    await userEvent.click(screen.getByRole("button", { name: /^Album:/u }));

    await userEvent.click(screen.getByRole("button", { name: "生如夏花, to come" }));

    expect(onPlaySong).toHaveBeenCalledWith(SONGS[2]);
  });

  it("closes the songs with Escape, back on the album's mark", async () => {
    renderKind(ALBUM);
    const mark = screen.getByRole("button", { name: /^Album:/u });
    await userEvent.click(mark);
    await userEvent.tab();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(mark).toHaveFocus();
  });

  it("closes the songs once the mouse leaves, also after a click opened them", async () => {
    renderKind(ALBUM);
    const mark = screen.getByRole("button", { name: /^Album:/u });
    await userEvent.click(mark);
    expect(screen.getByRole("region", { name: "Songs of 生如夏花" })).toBeInTheDocument();

    await userEvent.unhover(mark.parentElement ?? mark);

    await waitFor(() => {
      expect(screen.queryByRole("region")).not.toBeInTheDocument();
    });
  });

  it("shows whether each song is a favorite first in its row, and toggles it", async () => {
    const { onFavorite } = renderKind(ALBUM);
    await userEvent.click(screen.getByRole("button", { name: /^Album:/u }));
    const songs = screen.getByRole("region", { name: "Songs of 生如夏花" });
    const loved = within(songs).getByRole("button", { name: "Favorite 傲慢的上校" });
    const row = loved.closest("li");

    await userEvent.click(within(songs).getByRole("button", { name: "Favorite 浮游" }));

    expect(loved).toHaveAttribute("aria-pressed", "true");
    expect(row?.firstElementChild).toBe(loved);
    expect(onFavorite).toHaveBeenCalledWith(SONGS[1]?.track, true);
  });

  it("offers to split a whole album in one file into its songs", async () => {
    const file = trackOf(5, "Bremen", { kind: "album", album: "" });
    const { onEditSongs } = renderKind(
      { kind: "album", songs: [], current: -1, length: undefined },
      file,
    );
    await userEvent.click(screen.getByRole("button", { name: "Album: Bremen" }));

    await userEvent.click(screen.getByRole("button", { name: "Split into songs" }));

    expect(onEditSongs).toHaveBeenCalledWith(file);
  });
});

describe("an album's card over its seek bar", () => {
  it("lists the album's songs, lighting up the one pointed at and how far into it", () => {
    const { container } = render(
      <AlbumCard playing={ALBUM} track={PLAYING} position={72} pointedAt={600} />,
    );

    const pointed = container.querySelectorAll(".album-song.pointed");
    expect(pointed).toHaveLength(1);
    expect(pointed[0]).toHaveTextContent("生如夏花");
    expect(pointed[0]).toHaveTextContent("1:00 / 3:00");
    expect(container).toHaveTextContent("5:12 of 12:00");
  });

  it("plays a song chosen on it, which a pointer reaches but Tab passes by", async () => {
    const onPlaySong = vi.fn();
    render(
      <AlbumCard
        playing={ALBUM}
        track={PLAYING}
        position={72}
        pointedAt={600}
        onPlaySong={onPlaySong}
      />,
    );

    const song = screen.getByRole("button", { name: /^生如夏花/u });
    await userEvent.click(song);

    expect(onPlaySong).toHaveBeenCalledExactlyOnceWith(SONGS[2]);
    expect(song).toHaveAttribute("tabindex", "-1");
  });

  it("only shows when no song can be chosen on it", () => {
    const { container } = render(
      <AlbumCard playing={ALBUM} track={PLAYING} position={72} pointedAt={600} />,
    );

    expect(container.querySelector(".album-card")).toHaveAttribute("inert");
  });
});
