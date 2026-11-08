import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlayCount, Track } from "../api";
import { serve, trackOf } from "../testing/server";
import { InsightsView } from "./InsightsView";

afterEach(() => {
  vi.unstubAllGlobals();
});

const MINUTE = 60_000;

/**
 * Two artists, each with an album:
 *
 * ```text
 * 1  朴树  生如夏花  Colorful Days  4 min, played 3 times in all
 * 2  朴树  生如夏花  生如夏花       5 min, played twice in all
 * 3  Ado   狂言      うっせぇわ     3 min, played 20 times in all
 * ```
 */
const LIBRARY = [
  trackOf(1, "Colorful Days", {
    artist: "朴树",
    album: "生如夏花",
    duration_ms: 4 * MINUTE,
    play_count: 3,
  }),
  trackOf(2, "生如夏花", {
    artist: "朴树",
    album: "生如夏花",
    duration_ms: 5 * MINUTE,
    play_count: 2,
  }),
  trackOf(3, "うっせぇわ", {
    artist: "Ado",
    album: "狂言",
    duration_ms: 3 * MINUTE,
    play_count: 20,
  }),
];

/** Serve `last30` and `last7` as the play counts of the last 30 and 7 days. */
function servingPlays(last30: readonly PlayCount[], last7: readonly PlayCount[] = []) {
  return serve({
    "GET /api/plays/counts?days=30": { body: last30 },
    "GET /api/plays/counts?days=7": { body: last7 },
  });
}

/** The totals shown, each term to its value, once they have loaded. */
async function totalsShown(): Promise<Record<string, string>> {
  const terms = await screen.findAllByRole("term");
  return Object.fromEntries(
    terms.map((term) => [term.textContent, term.nextElementSibling?.textContent ?? ""]),
  );
}

function renderInsights(tracks: readonly Track[] = LIBRARY) {
  const onPlay = vi.fn();
  render(<InsightsView tracks={tracks} onPlay={onPlay} />);
  return onPlay;
}

describe("InsightsView", () => {
  it("opens on the last 30 days, with the time, plays, and songs listened to", async () => {
    servingPlays([
      { track_id: 1, plays: 3 },
      { track_id: 2, plays: 2 },
    ]);

    renderInsights();

    const period = screen.getByRole("radiogroup", { name: "Period" });
    expect(within(period).getByRole("radio", { name: "Last 30 days" })).toBeChecked();
    expect(await totalsShown()).toEqual({
      "Listening time": "About 22 min",
      Plays: "5",
      Songs: "2",
    });
  });

  it("shows the top artist and album as the most listened, each leading to its page", async () => {
    servingPlays([
      { track_id: 1, plays: 3 },
      { track_id: 3, plays: 2 },
    ]);

    renderInsights();

    const artist = await screen.findByRole("link", { name: /Top artist/ });
    expect(artist).toHaveTextContent("Top artist朴树About 12 min, 3 plays");
    expect(artist).toHaveAttribute("href", "#/artist?name=%E6%9C%B4%E6%A0%91");
    const album = screen.getByRole("link", { name: /Top album/ });
    expect(album).toHaveTextContent("Top album生如夏花朴树About 12 min, 3 plays");
  });

  it("ranks the artists by listening time, each with its time written out", async () => {
    servingPlays([
      { track_id: 1, plays: 1 },
      { track_id: 3, plays: 2 },
    ]);

    renderInsights();

    const ranking = await screen.findByRole("region", { name: "Top artists" });
    expect(
      within(ranking)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["AdoAbout 6 min, 2 plays", "朴树About 4 min, 1 play"]);
  });

  it("counts all time from each song's own play count, asking the server nothing", async () => {
    const { calls } = servingPlays([]);
    renderInsights();

    await userEvent.click(screen.getByRole("radio", { name: "All time" }));

    expect(screen.getByRole("link", { name: /Top artist/ })).toHaveTextContent("Ado");
    expect(calls).toEqual(["GET /api/plays/counts?days=30"]);
  });

  it("says nothing was played in a period with no plays", async () => {
    servingPlays([{ track_id: 1, plays: 1 }], []);
    renderInsights();
    await screen.findByRole("link", { name: /Top artist/ });

    await userEvent.click(screen.getByRole("radio", { name: "Last 7 days" }));

    expect(await screen.findByText("Nothing played in the last 7 days.")).toBeInTheDocument();
  });

  it("plays a top song, then the top songs after it", async () => {
    servingPlays([
      { track_id: 1, plays: 3 },
      { track_id: 2, plays: 2 },
      { track_id: 3, plays: 1 },
    ]);
    const onPlay = renderInsights();

    await userEvent.click(await screen.findByRole("button", { name: "Play 生如夏花, 2 plays" }));

    expect(onPlay).toHaveBeenCalledWith([LIBRARY[0], LIBRARY[1], LIBRARY[2]], 1);
  });

  it("says how many plays aren't timed, such as those of a whole album", async () => {
    const album = trackOf(9, "生如夏花 (Full Album)", {
      artist: "朴树",
      album: "生如夏花",
      duration_ms: 60 * MINUTE,
      kind: "album",
    });
    servingPlays([{ track_id: 9, plays: 2 }]);

    renderInsights([...LIBRARY, album]);

    expect(
      await screen.findByText("Not timed: 2 plays of whole albums or songs of unknown length."),
    ).toBeInTheDocument();
  });
});
