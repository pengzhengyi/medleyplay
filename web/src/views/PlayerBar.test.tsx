import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Track } from "../api";
import { NO_FAVORITES } from "../library/favoriteGroups";
import { playerOf } from "../testing/player";
import { trackOf } from "../testing/server";
import { PlayerBar } from "./PlayerBar";
import type { TrackMenuActions } from "./TrackMenu";

/** 劳动之余, 声音玩具's album downloaded as one video, then split into its songs. */
const FILE = trackOf(40, "BV12C4y1c7jB", {
  artist: "声音玩具",
  album: "劳动之余",
  kind: "album",
  kind_reason: "split",
  split: true,
  duration_ms: 766_000,
});

/** The file's first song, 0:00 to 6:38. */
const FIRST = trackOf(401, "爱是昂贵的", {
  artist: "声音玩具",
  album: "劳动之余",
  segment_of: 40,
  track_number: 1,
  duration_ms: 398_000,
});

/** The file's second song, 6:38 to 12:38. */
const SECOND = trackOf(402, "你的城市", {
  artist: "声音玩具",
  album: "劳动之余",
  segment_of: 40,
  track_number: 2,
  duration_ms: 360_000,
});

const ACTIONS: TrackMenuActions = {
  onPlayNext: vi.fn(),
  onAdd: vi.fn(),
  onAddToPlaylist: vi.fn(),
  onEditDetails: vi.fn(),
  canFind: () => false,
  onFind: vi.fn(),
  onEditSongs: vi.fn(),
  onAddFile: vi.fn(),
  onSetKind: vi.fn(),
  onRate: vi.fn(),
};

/** Show the bar playing `file` whole from the queue, `position` seconds into it. */
function renderPlayingWhole(file: Track, songs: readonly Track[], position: number) {
  const player = playerOf({
    queue: { ...playerOf().queue, entries: [{ key: "w", trackId: file.id }], position: 0 },
    position,
    duration: (file.duration_ms ?? 0) / 1000,
  });
  render(
    <PlayerBar
      player={player}
      track={file}
      tracks={new Map([file, ...songs].map((track) => [track.id, track]))}
      onFavorite={vi.fn()}
      favorites={NO_FAVORITES}
      onFavoriteAlbum={vi.fn()}
      menuActions={ACTIONS}
      lyrics={null}
      queueOpen={false}
      onToggleQueue={vi.fn()}
      onOpenNowPlaying={vi.fn()}
    />,
  );
  return screen.getByRole("region", { name: "Player" });
}

describe("the player bar", () => {
  it("names the song a split file playing whole has reached, not the file", () => {
    const bar = renderPlayingWhole(FILE, [FIRST, SECOND], 45);

    expect(within(bar).getByText("爱是昂贵的")).toBeVisible();
    expect(within(bar).queryByText("BV12C4y1c7jB")).not.toBeInTheDocument();
  });

  it("names the next song once playing passes into it", () => {
    const bar = renderPlayingWhole(FILE, [FIRST, SECOND], 400);

    expect(within(bar).getByText("你的城市")).toBeVisible();
  });

  it("names a whole file not yet split by its own title", () => {
    const unsplit = { ...FILE, split: false, kind_reason: "length" as const };

    const bar = renderPlayingWhole(unsplit, [], 45);

    expect(within(bar).getByText("BV12C4y1c7jB")).toBeVisible();
  });
});
