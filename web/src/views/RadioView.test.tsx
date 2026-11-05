import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Track } from "../api";
import type { Station } from "../library/useStation";
import { trackOf } from "../testing/server";
import { RadioView } from "./RadioView";

const NOW = new Date("2026-11-06T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

/**
 * Two albums added this week, one played most:
 *
 * ```text
 * 1–2  朴树  生如夏花  added today, song 2 played 7 times
 * 3–4  朴树  猎户星座  added 3 days ago, never played
 * ```
 */
const LIBRARY = [
  trackOf(1, "Colorful Days", { artist: "朴树", album: "生如夏花", added_at: daysAgo(0) }),
  trackOf(2, "生如夏花", {
    artist: "朴树",
    album: "生如夏花",
    added_at: daysAgo(0),
    play_count: 7,
    last_played_at: daysAgo(40),
  }),
  trackOf(3, "猎户星座", { artist: "朴树", album: "猎户星座", added_at: daysAgo(3) }),
  trackOf(4, "清白之年", { artist: "朴树", album: "猎户星座", added_at: daysAgo(3) }),
];

function renderRadio(tracks: readonly Track[] = LIBRARY, playing?: Partial<Station>) {
  const station: Station = {
    seed: undefined,
    own: false,
    start: vi.fn(() => true),
    ...playing,
  };
  const onPlayAll = vi.fn<(tracks: readonly Track[], shuffled: boolean) => void>();
  render(
    <RadioView tracks={tracks} station={station} onPlayAll={onPlayAll} accountId={1} now={NOW} />,
  );
  return { station, onPlayAll };
}

describe("the Radio tab", () => {
  it("plays the Account's own station", async () => {
    const { station } = renderRadio();

    await userEvent.click(screen.getByRole("button", { name: "Play my station" }));

    expect(station.start).toHaveBeenCalledWith();
  });

  it("says which song the Account's own station plays from", () => {
    renderRadio(LIBRARY, { seed: LIBRARY[1], own: true });

    expect(screen.getByText("Playing from 生如夏花 by 朴树")).toBeInTheDocument();
  });

  it("shows each shelf of albums with why each is there, linked to its album", () => {
    renderRadio();

    const shelf = screen.getByRole("region", { name: "Not played yet" });
    const card = within(shelf).getByRole("link", { name: /猎户星座/u });
    expect(card).toHaveAttribute("href", expect.stringContaining("#/album?"));
    expect(within(shelf).getByText("New to you, from 朴树")).toBeInTheDocument();
  });

  it("plays an album's songs, or starts a station from its most played song", async () => {
    const { station, onPlayAll } = renderRadio([
      ...LIBRARY,
      trackOf(5, "Third", {
        artist: "Radiohead",
        album: "OK Computer",
        added_at: daysAgo(1),
      }),
      trackOf(6, "Fourth", {
        artist: "Radiohead",
        album: "OK Computer",
        added_at: daysAgo(1),
        play_count: 2,
        last_played_at: daysAgo(90),
      }),
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Play OK Computer" }));
    await userEvent.click(screen.getByRole("button", { name: "Start a station from OK Computer" }));

    expect(onPlayAll.mock.calls[0]?.[0].map((track) => track.id)).toEqual([5, 6]);
    expect(station.start).toHaveBeenCalledWith(expect.objectContaining({ id: 6 }));
  });

  it("says how albums come to show when there are none to suggest", () => {
    renderRadio([trackOf(1, "Alone", { album: "" })]);

    expect(screen.getByText(/albums for you show here/u)).toBeInTheDocument();
  });
});
