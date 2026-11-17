import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OfferedFile, SplitOffers } from "../api";
import { toDoOf } from "../library/cleanUp";
import { serve } from "../testing/server";
import { CleanUpView } from "./CleanUpView";

const MINUTE = 60_000;

/** *Live*, 24 minutes long, whose video's chapters list six songs of four minutes. */
const LIVE: OfferedFile = {
  track_id: 7,
  title: "Live",
  artist: "Blue Room",
  length_ms: 24 * MINUTE,
  offer: {
    source: "video",
    songs: Array.from({ length: 6 }, (_, place) => ({
      start_ms: place * 4 * MINUTE,
      title: `Song ${String(place + 1)}`,
      artist: "",
    })),
    doubts: [],
    trusted: true,
    signature: "0,240000,480000,720000,960000,1200000",
  },
  has_text: true,
};

/** *Set*, 80 minutes long, which the AI lists three songs of, one so long it may be two. */
const SET: OfferedFile = {
  track_id: 8,
  title: "Set",
  artist: "",
  length_ms: 80 * MINUTE,
  offer: {
    source: "ai",
    songs: [
      { start_ms: 0, title: "Intro", artist: "" },
      { start_ms: 192_000, title: "Night Drive", artist: "" },
      { start_ms: 4_060_000, title: "Outro", artist: "" },
    ],
    doubts: ["long_song"],
    trusted: false,
    signature: "0,192000,4060000",
  },
  has_text: true,
};

/** *Mixtape*, a long file whose video's text lists no songs. */
const MIXTAPE: OfferedFile = {
  track_id: 9,
  title: "Mixtape",
  artist: "",
  length_ms: 50 * MINUTE,
  offer: null,
  has_text: true,
};

function cleanUp(files: readonly OfferedFile[], setting: SplitOffers["setting"] = "approval") {
  const reload = vi.fn();
  const onEditSongs = vi.fn();
  render(
    <CleanUpView
      tidy={{ names: [], reload: vi.fn() }}
      artistNames={undefined}
      splits={{ names: { setting, files }, reload }}
      onEditSongs={onEditSongs}
    />,
  );
  return { reload, onEditSongs };
}

const section = () => within(screen.getByRole("region", { name: /^Split albums/u }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("splitting long files in Clean up", () => {
  it("counts each long file with a list to split it by, unless offering is off", () => {
    expect(toDoOf([], undefined, { setting: "approval", files: [LIVE, MIXTAPE] })).toBe(1);
    expect(toDoOf([], undefined, { setting: "off", files: [LIVE] })).toBe(0);
  });

  it("offers each long file with how long it is and who listed its songs", () => {
    cleanUp([LIVE, SET, MIXTAPE]);

    const rows = section().getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector(".tidy-meta")?.textContent)).toEqual([
      "24 minutes long, 6 songs from the video",
      "1 hour 20 minutes long, 3 songs from the AI, which estimated where they startCheck before splitting: a song is so long it may be two.",
      "50 minutes long, no song list found",
    ]);
  });

  it("splits a file by its list as it was shown", async () => {
    const sent: unknown[] = [];
    serve({
      "POST /api/split-offers/split": (body) => {
        sent.push(body);
        return { body: { split: 1, left: 0 } };
      },
    });
    const { reload } = cleanUp([LIVE]);

    await userEvent.click(section().getByRole("button", { name: "Split Live into 6 songs" }));

    expect(sent).toEqual([{ files: [{ track_id: 7, signature: LIVE.offer?.signature }] }]);
    expect(reload).toHaveBeenCalled();
  });

  it("splits every file with a list at once", async () => {
    const sent: unknown[] = [];
    serve({
      "POST /api/split-offers/split": (body) => {
        sent.push(body);
        return { body: { split: 2, left: 0 } };
      },
    });
    cleanUp([LIVE, SET, MIXTAPE]);

    await userEvent.click(section().getByRole("button", { name: "Split all" }));

    expect(sent).toEqual([
      {
        files: [
          { track_id: 7, signature: LIVE.offer?.signature },
          { track_id: 8, signature: SET.offer?.signature },
        ],
      },
    ]);
  });

  it("keeps a file as one, so it isn't offered again", async () => {
    const sent: unknown[] = [];
    serve({
      "POST /api/split-offers/keep": (body) => {
        sent.push(body);
        return { body: { kept: 1 } };
      },
    });
    cleanUp([LIVE]);

    await userEvent.click(section().getByRole("button", { name: "Keep Live as one file" }));

    expect(sent).toEqual([{ track_ids: [7] }]);
  });

  it("asks the AI for the songs of a file with text and no list, and says it is asked", async () => {
    const { calls } = serve({
      "POST /api/enrichers/ai-details/tracks/9": { body: { id: 1 } },
    });
    cleanUp([MIXTAPE]);

    await userEvent.click(
      section().getByRole("button", { name: "Ask the AI for the songs of Mixtape" }),
    );

    expect(calls).toContain("POST /api/enrichers/ai-details/tracks/9");
    await waitFor(() => {
      expect(section().getByText(/the AI is asked for its songs/u)).toBeVisible();
    });
  });

  it("asks the AI again about a file asked about today once someone agrees", async () => {
    const sent: unknown[] = [];
    serve({
      "POST /api/enrichers/ai-details/tracks/9": (body) => {
        sent.push(body);
        return body === undefined
          ? {
              status: 409,
              body: {
                detail: "This Track was looked up in the last 24 hours.",
                code: "asked_recently",
              },
            }
          : { body: { id: 1 } };
      },
    });
    cleanUp([MIXTAPE]);
    await userEvent.click(
      section().getByRole("button", { name: "Ask the AI for the songs of Mixtape" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Ask the AI again?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Ask again" }));

    expect(sent).toEqual([undefined, { again: true, hint: "" }]);
    await waitFor(() => {
      expect(section().getByText(/the AI is asked for its songs/u)).toBeVisible();
    });
    expect(section().queryByRole("alert")).toBeNull();
  });

  it("opens a file's songs to split it by hand", async () => {
    const { onEditSongs } = cleanUp([LIVE]);

    await userEvent.click(section().getByRole("button", { name: "Edit the songs of Live" }));

    expect(onEditSongs).toHaveBeenCalledWith(7);
  });

  it("offers no file while offering is off", () => {
    cleanUp([LIVE], "off");

    expect(screen.queryByRole("region", { name: /^Split albums/u })).toBeNull();
  });
});
