import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AlbumSong, Playing } from "../player/albumNow";
import { trackOf } from "../testing/server";
import { AlbumCard, PlayingKind } from "./PlayingKind";

/**
 * 生如夏花 split into three songs, the second playing:
 *
 * ```text
 * 1  傲慢的上校  4:00  played
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
  track: trackOf(11 + index, String(title), { album: "生如夏花", segment_of: 9 }),
  start: Number(start),
  length: Number(length),
}));
const ALBUM: Playing = { kind: "album", songs: SONGS, current: 1, length: 720 };
const PLAYING = SONGS[1]?.track ?? trackOf(12, "浮游");

function renderKind(playing: Playing, track = PLAYING) {
  const onPlaySong = vi.fn();
  const onEditSongs = vi.fn();
  render(
    <PlayingKind
      playing={playing}
      track={track}
      position={72}
      moving
      opens="below"
      onPlaySong={onPlaySong}
      onEditSongs={onEditSongs}
    />,
  );
  return { onPlaySong, onEditSongs };
}

describe("what plays now", () => {
  it("is a song's mark, with nothing to open", () => {
    renderKind({ kind: "song" });

    expect(screen.getByRole("img", { name: "Playing a song" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("opens an album's songs in order: played, playing and how far, and to come", async () => {
    renderKind(ALBUM);

    await userEvent.click(screen.getByRole("button", { name: "Album: 生如夏花, song 2 of 3" }));

    const songs = screen.getByRole("region", { name: "Songs of 生如夏花" });
    expect(
      within(songs)
        .getAllByRole("button")
        .map((song) => song.getAttribute("aria-label")),
    ).toEqual(["傲慢的上校, played", "浮游, playing now", "生如夏花, to come"]);
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
});
