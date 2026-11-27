import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Track } from "../api";
import type { FavoriteGroups } from "../library/favoriteGroups";
import type { Station } from "../library/useStation";
import { favoriteGroupsNaming, trackOf } from "../testing/server";
import { LanguageSelect } from "./LanguageSelect";
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

function renderRadio(
  tracks: readonly Track[] = LIBRARY,
  playing?: Partial<Station>,
  favorites?: FavoriteGroups,
) {
  const station: Station = {
    seed: undefined,
    playing: undefined,
    start: vi.fn(() => true),
    startFavorites: vi.fn(() => true),
    ...playing,
  };
  const onPlayAll = vi.fn<(tracks: readonly Track[], shuffled: boolean) => void>();
  render(
    <RadioView
      tracks={tracks}
      station={station}
      onPlayAll={onPlayAll}
      accountId={1}
      now={NOW}
      {...(favorites === undefined ? {} : { favorites })}
    />,
  );
  return { station, onPlayAll };
}

describe("the Radio tab", () => {
  it("keeps the recommendation across a language switch after the same day's cutoff", async () => {
    const noon = new Date(2026, 10, 6, 12);
    const added = new Date(noon.getTime() - 30 * 86_400_000).toISOString();
    const tracks = [
      trackOf(1, "One", { artist: "A", album: "Cutoff", added_at: added }),
      trackOf(2, "Two", { artist: "A", album: "Cutoff", added_at: added }),
    ];
    const station: Station = {
      seed: undefined,
      playing: undefined,
      start: () => false,
      startFavorites: () => false,
    };
    const renderAt = (now: Date) => (
      <RadioView tracks={tracks} station={station} onPlayAll={vi.fn()} accountId={1} now={now} />
    );
    const { rerender } = render(renderAt(noon));
    render(<LanguageSelect />);
    const user = userEvent.setup();
    const language = screen.getByRole("combobox", { name: "Language" });
    const original = within(screen.getByRole("region", { name: "Just added" })).getByRole("link", {
      name: /Cutoff/u,
    });

    try {
      rerender(renderAt(new Date(noon.getTime() + 120_000)));
      await user.selectOptions(language, "zh-Hans");

      expect(
        within(screen.getByRole("region", { name: "最近添加" })).getByRole("link", {
          name: /Cutoff/u,
        }),
      ).toBe(original);
    } finally {
      await user.selectOptions(language, "auto");
    }
  });

  it("explains when no song can start the station", async () => {
    renderRadio([], { start: () => false });

    await userEvent.click(screen.getByRole("button", { name: "Play my station" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "No songs can start your station right now.",
    );
  });

  it("translates why an album was suggested without changing the album or artist", async () => {
    renderRadio();
    render(<LanguageSelect />);
    const user = userEvent.setup();
    const language = screen.getByRole("combobox", { name: "Language" });

    try {
      await user.selectOptions(language, "zh-Hans");

      const shelf = within(screen.getByRole("region", { name: "尚未播放" }));
      expect(shelf.getByText("你还没听过，来自「朴树」")).toBeVisible();
      expect(shelf.getByRole("button", { name: "播放「猎户星座」" })).toBeVisible();
    } finally {
      await user.selectOptions(language, "auto");
    }
  });

  it("plays the Account's own station", async () => {
    const { station } = renderRadio();

    await userEvent.click(screen.getByRole("button", { name: "Play my station" }));

    expect(station.start).toHaveBeenCalledWith();
  });

  it("says which song the Account's own station plays from", () => {
    renderRadio(LIBRARY, { seed: LIBRARY[1], playing: "mine" });

    expect(screen.getByText("Started from 生如夏花 by 朴树")).toBeInTheDocument();
  });

  it("plays the favorites station, saying how many favorites it holds", async () => {
    const { station } = renderRadio([
      ...LIBRARY.map((track) => (track.id <= 3 ? { ...track, favorite: true } : track)),
    ]);

    const favorites = screen.getByRole("region", { name: "Favorites" });
    expect(favorites).toHaveTextContent("Your 3 favorite songs, every one before any again.");
    await userEvent.click(within(favorites).getByRole("button", { name: "Play favorites" }));

    expect(station.startFavorites).toHaveBeenCalledOnce();
  });

  it("counts a song by a favorite artist as a favorite", () => {
    renderRadio(LIBRARY, undefined, favoriteGroupsNaming(["朴树"]));

    expect(screen.getByRole("region", { name: "Favorites" })).toHaveTextContent(
      "Your 4 favorite songs",
    );
  });

  it("says the favorites station plays while it does", () => {
    renderRadio(
      LIBRARY.map((track) => ({ ...track, favorite: true })),
      { playing: "favorites" },
    );

    expect(screen.getByRole("region", { name: "Favorites" })).toHaveTextContent("Current station");
  });

  it("says how to fill the favorites station while it is empty", () => {
    renderRadio();

    const favorites = screen.getByRole("region", { name: "Favorites" });
    expect(favorites).toHaveTextContent(
      "Heart a song, or favorite an artist or album, to fill it.",
    );
    expect(within(favorites).getByRole("button", { name: "Play favorites" })).toBeDisabled();
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
