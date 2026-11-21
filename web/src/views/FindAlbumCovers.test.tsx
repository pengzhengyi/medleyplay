import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MissingCover } from "../api";
import { toDoOf } from "../library/cleanUp";
import { UNKNOWN_COVERS, serve, trackOf } from "../testing/server";
import { CleanUpView } from "./CleanUpView";

const USE = "POST /api/album-covers/use";
const DISMISS = "POST /api/album-covers/dismiss";
const HELP_COVERS = `GET /api/album-covers?${new URLSearchParams({ album: "Help!", artist: "The Beatles" }).toString()}`;

/** The album `album` by `artist` with no cover, with `change` on top: not searched yet. */
function missing(album: string, artist: string, change: Partial<MissingCover> = {}) {
  return {
    album,
    artist,
    songs: 3,
    suggested: null,
    picked: false,
    found: false,
    finding: false,
    ...change,
  } satisfies MissingCover;
}

/** *Help!* with a cover suggested by its title and artist; 范特西, by an AI's pick. */
const SUGGESTED = [
  missing("Help!", "The Beatles", { suggested: "cover-help", found: true }),
  missing("范特西", "周杰伦", { suggested: "cover-fantasy", picked: true, found: true, songs: 1 }),
];

/** The songs of *Help!*, to set a cover chosen in the editor on. */
const HELP_SONGS = [
  trackOf(1, "Help!", { album: "Help!", artist: "The Beatles" }),
  trackOf(2, "Yesterday", {
    album: "Help!",
    artist: "Paul McCartney",
    album_artist: "The Beatles",
  }),
];

function cleanUp(albums: readonly MissingCover[], onUse = vi.fn(() => Promise.resolve())) {
  const reload = vi.fn();
  const view = (answered: number, shown: readonly MissingCover[]) => (
    <CleanUpView
      tidy={{ names: [], reload: vi.fn() }}
      artistNames={undefined}
      tracks={HELP_SONGS}
      missingCovers={{ albums: shown, reload, answered }}
      albumCovers={{ onUse, onUpload: vi.fn(() => Promise.resolve("uploaded")) }}
    />
  );
  const { rerender } = render(view(0, albums));
  return {
    reload,
    onUse,
    /** Show `shown` as the albums read again, the same ones by default. */
    answeredAgain: (answered: number, shown: readonly MissingCover[] = albums) => {
      rerender(view(answered, shown));
    },
  };
}

const section = () => within(screen.getByRole("region", { name: /^Find album covers/u }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("finding album covers in Clean up", () => {
  it("counts each cover suggested", () => {
    const albums = [...SUGGESTED, missing("Rubber Soul", "The Beatles")];

    expect(toDoOf([], undefined, undefined, undefined, undefined, [], albums)).toBe(2);
  });

  it("shows each cover suggested, tagged, with its album's artist and songs", () => {
    cleanUp(SUGGESTED);

    const [help, fantasy] = within(
      section().getByRole("list", { name: "Covers suggested" }),
    ).getAllByRole("listitem");

    expect(within(help ?? document.body).getByText("Suggested")).toBeVisible();
    expect(within(help ?? document.body).getByText("The Beatles, 3 songs")).toBeVisible();
    expect(within(fantasy ?? document.body).getByText("AI pick")).toBeVisible();
    expect(within(fantasy ?? document.body).getByRole("link", { name: "范特西" })).toHaveAttribute(
      "href",
      `#/album?${new URLSearchParams({ artist: "周杰伦", name: "范特西" }).toString()}`,
    );
  });

  it("uses a cover suggested in one click, on the server", async () => {
    const sent: unknown[] = [];
    serve({
      [USE]: (body) => {
        sent.push(body);
        return { body: { used: 1 } };
      },
    });
    const { reload } = cleanUp(SUGGESTED);

    await userEvent.click(
      section().getByRole("button", { name: "Use the suggested cover of Help!" }),
    );

    expect(sent).toEqual([
      { albums: [{ album: "Help!", artist: "The Beatles", cover: "cover-help" }] },
    ]);
    expect(reload).toHaveBeenCalled();
  });

  it("uses every cover suggested in one request", async () => {
    const sent: unknown[] = [];
    serve({
      [USE]: (body) => {
        sent.push(body);
        return { body: { used: 2 } };
      },
    });
    cleanUp(SUGGESTED);

    await userEvent.click(section().getByRole("button", { name: "Use all 2" }));

    expect(sent).toEqual([
      {
        albums: [
          { album: "Help!", artist: "The Beatles", cover: "cover-help" },
          { album: "范特西", artist: "周杰伦", cover: "cover-fantasy" },
        ],
      },
    ]);
  });

  it("dismisses a cover suggested, then moves focus to the cover taking its place", async () => {
    const sent: unknown[] = [];
    serve({
      [DISMISS]: (body) => {
        sent.push(body);
        return { status: 204 };
      },
    });
    const { answeredAgain } = cleanUp(SUGGESTED);

    await userEvent.click(
      section().getByRole("button", { name: "Dismiss the suggested cover of Help!" }),
    );
    answeredAgain(1, SUGGESTED.slice(1));

    expect(sent).toEqual([{ album: "Help!", artist: "The Beatles", cover: "cover-help" }]);
    await vi.waitFor(() => {
      expect(
        section().getByRole("button", { name: "Choose another cover of 范特西…" }),
      ).toHaveFocus();
    });
  });

  it("opens the cover editor to choose another, setting it on the album's songs", async () => {
    serve({ [HELP_COVERS]: { body: UNKNOWN_COVERS } });
    cleanUp(SUGGESTED);

    await userEvent.click(
      section().getByRole("button", { name: "Choose another cover of Help!…" }),
    );

    const editor = await screen.findByRole("dialog", { name: "Add a cover" });
    expect(within(editor).getByRole("tab", { name: /MusicBrainz/u })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("counts the albums MusicBrainz has nothing for and those not searched, saying where that is set", () => {
    cleanUp([missing("A", "X", { found: true }), missing("B", "X"), missing("C", "X")]);

    expect(
      section().getByText(
        /^1 album has no cover on MusicBrainz that fits; 2 albums aren't searched yet\./u,
      ),
    ).toBeVisible();
    expect(section().getByRole("link", { name: "Settings → MusicBrainz" })).toHaveAttribute(
      "href",
      "#/settings?section=musicbrainz",
    );
  });

  it("reads again a few seconds after each answer while MusicBrainz is searched", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { reload, answeredAgain } = cleanUp([missing("范特西", "周杰伦", { finding: true })]);

    expect(section().getByRole("status")).toHaveTextContent("Looking on MusicBrainz for 1 album…");
    await act(() => vi.advanceTimersByTimeAsync(3000));
    answeredAgain(1);
    await act(() => vi.advanceTimersByTimeAsync(3000));

    expect(reload).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
