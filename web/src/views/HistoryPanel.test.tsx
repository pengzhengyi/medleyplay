import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HistoryLength, Played, Track } from "../api";
import { App } from "../App";
import { historyOf, preferencesOf, serve, signedIn, trackOf } from "../testing/server";

afterEach(() => {
  vi.unstubAllGlobals();
});

const INTRO = trackOf(1, "Intro");
const LONG_ROAD = trackOf(2, "Long Road");
const OUTRO = trackOf(3, "Outro");

/** A play of `track` `minutes` ago, numbered `number`. */
function playedAgo(number: number, track: Track, minutes: number): Played {
  return {
    id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    track_id: track.id,
    played_at: new Date(Date.now() - minutes * 60_000).toISOString(),
  };
}

/**
 * A signed-in page playing Intro, with Long Road and Outro up next, whose History
 * holds `plays` and shows `length` songs; returns the server's calls.
 */
async function playingIntroWithHistory(
  plays: readonly Played[],
  { tracks = [INTRO, LONG_ROAD, OUTRO], length = null as HistoryLength | null } = {},
) {
  const { calls } = serve({
    ...signedIn(tracks),
    ...preferencesOf(null, length),
    ...historyOf(plays),
    ...Object.fromEntries(
      tracks.map(({ id }) => [
        `POST /api/tracks/${String(id)}/playback`,
        {
          body: {
            state: "ready",
            source_id: id,
            audio_url: `/api/sources/${String(id)}/audio`,
            media_type: "audio/wav",
          },
        },
      ]),
    ),
  });
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Intro" }));
  return calls;
}

/** Show the History tab, and return its panel once its songs have loaded. */
async function openHistory(): Promise<HTMLElement> {
  const queue = screen.getByRole("region", { name: "Up next" });
  await userEvent.click(within(queue).getByRole("tab", { name: "History" }));
  const panel = within(queue).getByRole("tabpanel", { name: "History" });
  await vi.waitFor(() => {
    expect(within(panel).queryByText("Loading…")).not.toBeInTheDocument();
  });
  return panel;
}

const titlesIn = (panel: HTMLElement) =>
  within(panel)
    .queryAllByRole("listitem")
    .flatMap((item) => item.querySelector(".entry-title")?.textContent ?? []);

function upNext(): string[] {
  const queue = screen.getByRole("region", { name: "Up next" });
  return within(queue)
    .queryAllByRole("listitem")
    .flatMap((item) => item.querySelector(".entry-title")?.textContent ?? []);
}

describe("History", () => {
  it("lists the songs played, newest first, a song played twice twice, with when", async () => {
    await playingIntroWithHistory([
      playedAgo(3, OUTRO, 12),
      playedAgo(2, LONG_ROAD, 16),
      playedAgo(1, OUTRO, 20),
    ]);

    const panel = await openHistory();

    expect(titlesIn(panel)).toEqual(["Outro", "Long Road", "Outro"]);
    expect(within(panel).getByText("12 min ago")).toBeInTheDocument();
  });

  it("is a tab beside Up next, reached with the arrow keys", async () => {
    await playingIntroWithHistory([]);
    const queue = screen.getByRole("region", { name: "Up next" });

    within(queue).getByRole("tab", { name: "Up next" }).focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(within(queue).getByRole("tab", { name: "History" })).toHaveFocus();
    expect(within(queue).getByRole("tab", { name: "History" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("loads again when the page is shown again, for plays made on other devices", async () => {
    const calls = await playingIntroWithHistory([]);
    await openHistory();
    const loads = () => calls.filter((call) => call === "GET /api/plays?limit=50").length;
    const before = loads();

    document.dispatchEvent(new Event("visibilitychange"));

    await vi.waitFor(() => {
      expect(loads()).toBe(before + 1);
    });
  });

  it("says how a song comes to be there while nothing has played", async () => {
    await playingIntroWithHistory([]);

    const panel = await openHistory();

    expect(within(panel).getByText(/^Nothing played yet\./u)).toBeInTheDocument();
  });

  it("plays a song now and leaves Up next as it was", async () => {
    await playingIntroWithHistory([playedAgo(1, OUTRO, 12)]);
    const panel = await openHistory();

    await userEvent.click(within(panel).getByRole("button", { name: /^Play Outro,/u }));

    const player = screen.getByRole("region", { name: "Player" });
    expect(within(player).getByText("Outro")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Up next" }));
    expect(upNext()).toEqual(["Long Road", "Outro"]);
  });

  it("adds a song to the end of Up next", async () => {
    await playingIntroWithHistory([playedAgo(1, LONG_ROAD, 12)]);
    const panel = await openHistory();

    await userEvent.click(within(panel).getByRole("button", { name: "Add Long Road to Up next" }));

    await userEvent.click(screen.getByRole("tab", { name: "Up next" }));
    expect(upNext()).toEqual(["Long Road", "Outro", "Long Road"]);
  });

  it("won't play a song that can't play now", async () => {
    const missing = trackOf(3, "Outro", { availability: "missing" });
    await playingIntroWithHistory([playedAgo(1, missing, 12)], {
      tracks: [INTRO, LONG_ROAD, missing],
    });

    const panel = await openHistory();

    expect(within(panel).getByRole("button", { name: /^Play Outro,/u })).toBeDisabled();
  });

  it("clears on every device once asked again, and not before", async () => {
    const calls = await playingIntroWithHistory([playedAgo(1, OUTRO, 12)]);
    const panel = await openHistory();
    const queue = screen.getByRole("region", { name: "Up next" });

    await userEvent.click(within(queue).getByRole("button", { name: "Clear" }));
    const asking = within(queue).getByRole("group", { name: "Clear History" });
    expect(within(asking).getByText("On every device?")).toBeInTheDocument();
    expect(calls).not.toContain("DELETE /api/plays");
    await userEvent.click(within(asking).getByRole("button", { name: "Clear" }));

    expect(calls).toContain("DELETE /api/plays");
    expect(within(panel).getByText(/^Nothing played yet\./u)).toBeInTheDocument();
  });

  it("shows as many songs as the Account chose", async () => {
    const calls = await playingIntroWithHistory([], { length: 100 });

    const panel = await openHistory();

    expect(within(panel).getByRole("combobox", { name: /Keeps the last/u })).toHaveValue("100");
    expect(calls).toContain("GET /api/plays?limit=100");
  });

  it("saves a new length with the Account's preferences and shows that many", async () => {
    const calls = await playingIntroWithHistory([]);
    const panel = await openHistory();

    await userEvent.selectOptions(
      within(panel).getByRole("combobox", { name: /Keeps the last/u }),
      "25",
    );

    await vi.waitFor(() => {
      expect(calls).toContain("GET /api/plays?limit=25");
    });
    expect(calls).toContain("PUT /api/me/preferences");
  });
});
