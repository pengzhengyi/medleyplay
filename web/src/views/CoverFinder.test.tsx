import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AlbumCovers, CoverRelease } from "../api";
import { serve } from "../testing/server";
import { CoverFinder } from "./CoverFinder";

const VINYL: CoverRelease = {
  release_id: "0a1b2c3d-0000-4000-8000-000000001965",
  title: "Help!",
  artist: "The Beatles",
  date: "1965-08-06",
  country: "GB",
  format: '12" Vinyl',
  tracks: 14,
};
const CD: CoverRelease = {
  ...VINYL,
  release_id: "0a1b2c3d-0000-4000-8000-000000001987",
  date: "1987-04-30",
  format: "CD",
};

/** Nothing known of an album's covers: never looked up. */
const UNKNOWN: AlbumCovers = {
  covers: [],
  found_at: null,
  pick: null,
  finding: false,
  choosing: false,
  waiting: false,
  failure: null,
  choice_failure: null,
  may_choose: false,
};

/** *Help!*'s 1965 vinyl and 1987 CD found, `cover-1965` and `cover-1987`, with `known` on top. */
function helpFound(known: Partial<AlbumCovers> = {}): AlbumCovers {
  return {
    ...UNKNOWN,
    covers: [
      { release: VINYL, cover: "cover-1965" },
      { release: CD, cover: "cover-1987" },
    ],
    found_at: "2026-11-16T00:00:00Z",
    ...known,
  };
}

const COVERS = `GET /api/album-covers?${new URLSearchParams({ album: "Help!", artist: "The Beatles" }).toString()}`;

/** Answer the reads of *Help!*'s covers with each of `answers` in turn, then the last again. */
function reading(...answers: AlbumCovers[]) {
  let read = 0;
  return () => ({ body: answers[Math.min(read++, answers.length - 1)] });
}

function finder(onUse = vi.fn(), shown?: string) {
  render(<CoverFinder album="Help!" artist="The Beatles" shown={shown} onUse={onUse} />);
  return onUse;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("finding an album's covers", () => {
  it("looks an album never looked up on MusicBrainz at once, and shows the covers found", async () => {
    const { calls } = serve({
      [COVERS]: reading(UNKNOWN, helpFound()),
      "POST /api/album-covers/find": { body: null },
    });

    finder();

    const grid = await screen.findByRole("region", { name: "Covers on MusicBrainz" });
    expect(
      await within(grid).findByRole("button", {
        name: 'Use the cover of Help!, 1965, GB, 12" Vinyl, 14 tracks',
      }),
    ).toBeVisible();
    expect(within(grid).getByRole("button", { name: /1987, GB, CD/u })).toBeVisible();
    expect(calls.filter((call) => call === "POST /api/album-covers/find")).toHaveLength(1);
  });

  it("says when MusicBrainz has no cover of an album looked up, without asking again", async () => {
    const { calls } = serve({
      [COVERS]: { body: { ...UNKNOWN, found_at: "2026-11-16T00:00:00Z" } },
    });

    finder();

    expect(await screen.findByText("MusicBrainz has no cover of this album.")).toBeVisible();
    expect(calls).not.toContain("POST /api/album-covers/find");
  });

  it("marks the release an AI model picks, asking one once the covers are found", async () => {
    const pick = {
      release_id: CD.release_id,
      why: "The CD, by its songs",
      model: "deepseek-flash",
      host: "api.deepseek.com",
      at: "2026-11-16T00:00:01Z",
    };
    const { calls } = serve({
      [COVERS]: reading(helpFound({ may_choose: true }), helpFound({ pick })),
      "POST /api/album-covers/choose": { body: null },
    });

    finder();

    const cd = await screen.findByRole("button", { name: /1987, GB, CD/u });
    await waitFor(() => {
      expect(cd).toHaveTextContent("AI pick");
    });
    expect(cd).toHaveAttribute("title", "deepseek-flash picked this: The CD, by its songs");
    expect(screen.getByRole("button", { name: /1965/u })).not.toHaveTextContent("AI pick");
    expect(calls.filter((call) => call === "POST /api/album-covers/choose")).toHaveLength(1);
  });

  it("uses the cover chosen, and shows which the album shows now", async () => {
    serve({ [COVERS]: { body: helpFound() } });

    const onUse = finder(vi.fn(), "cover-1965");
    const cd = await screen.findByRole("button", { name: /1987, GB, CD/u });
    await userEvent.click(cd);

    expect(onUse).toHaveBeenCalledWith("cover-1987");
    expect(screen.getByRole("button", { name: /1965/u })).toHaveAttribute("aria-pressed", "true");
    expect(cd).toHaveAttribute("aria-pressed", "false");
  });

  it("says why looking failed", async () => {
    serve({
      [COVERS]: { body: { ...UNKNOWN, failure: "MusicBrainz refused the request (403)." } },
    });

    finder();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "MusicBrainz refused the request (403).",
    );
  });
});
