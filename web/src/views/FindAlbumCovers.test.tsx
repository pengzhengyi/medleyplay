import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MissingCover, Track } from "../api";
import { toDoOf } from "../library/cleanUp";
import { UNKNOWN_COVERS, serve, trackOf } from "../testing/server";
import { CleanUpView } from "./CleanUpView";
import { LanguageSelect } from "./LanguageSelect";
import { LyricsAvailabilityProvider } from "./LyricsAvailabilityProvider";

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

function cleanUp(
  albums: readonly MissingCover[],
  onUse = vi.fn(() => Promise.resolve()),
  tracks: readonly Track[] = HELP_SONGS,
  admin = true,
) {
  const reload = vi.fn();
  const onUsed = vi.fn();
  const view = (answered: number, shown: readonly MissingCover[]) => (
    <LyricsAvailabilityProvider tracks={tracks}>
      <CleanUpView
        admin={admin}
        tidy={{ names: [], reload: vi.fn() }}
        artistNames={undefined}
        tracks={tracks}
        missingCovers={{ albums: shown, reload, answered, onUsed }}
        albumCovers={{ onUse, onUpload: vi.fn(() => Promise.resolve("uploaded")) }}
      />
    </LyricsAvailabilityProvider>
  );
  const { rerender } = render(view(0, albums));
  return {
    reload,
    onUse,
    onUsed,
    /** Show `shown` as the albums read again, the same ones by default. */
    answeredAgain: (answered: number, shown: readonly MissingCover[] = albums) => {
      rerender(view(answered, shown));
    },
  };
}

const section = () => within(screen.getByRole("region", { name: /^Find album covers/u }));

/** The suggested cover's tile of the album `name`. */
const tileOf = (name: string) =>
  section()
    .getAllByRole("listitem")
    .find((tile) => within(tile).queryByRole("link", { name: `Album${name}` }) !== null) ??
  document.body;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("finding album covers in Clean up", () => {
  it("uses the next 1,000 covers when the suggestions exceed one batch", async () => {
    const albums = Array.from({ length: 1001 }, (_, at) =>
      missing(`Album ${String(at)}`, "The Beatles", {
        suggested: `cover-${String(at)}`,
        found: true,
      }),
    );
    let sent: unknown;
    serve({
      [USE]: (body) => {
        sent = body;
        return { status: 204 };
      },
    });
    cleanUp(albums);

    await userEvent.click(section().getByText("Use next 1000", { selector: "button" }));

    expect(sent).toEqual({
      albums: albums
        .slice(0, 1000)
        .map(({ album, artist, suggested: cover }) => ({ album, artist, cover })),
    });
  }, 15000);

  it("keeps the settings link out of the member view and separates active searches", () => {
    cleanUp(
      [
        missing("Help!", "The Beatles", { finding: true }),
        missing("Rubber Soul", "The Beatles"),
        missing("Revolver", "The Beatles", { found: true }),
      ],
      undefined,
      HELP_SONGS,
      false,
    );

    expect(section().getByRole("status")).toHaveTextContent("Looking on MusicBrainz for 1 album");
    expect(
      section().getByText(/1 album has no current cover suggestion; 1 album isn't searched yet/u),
    ).toHaveTextContent("An admin controls when MusicBrainz searches for covers.");
    expect(
      section().queryByRole("link", { name: "Settings → MusicBrainz" }),
    ).not.toBeInTheDocument();
  });

  it("can act on a new image after dismissing a suggestion for the same album", async () => {
    serve({ [DISMISS]: { status: 204 } });
    const { answeredAgain } = cleanUp([
      missing("Help!", "The Beatles", { suggested: "first", found: true }),
    ]);
    await userEvent.click(
      section().getByRole("button", { name: "Dismiss the suggested cover of Help!" }),
    );

    answeredAgain(1, [missing("Help!", "The Beatles", { suggested: "second", found: true })]);

    expect(
      section().getByRole("button", { name: "Use the suggested cover of Help!" }),
    ).toBeEnabled();
  });
  it("explains in Chinese why a cover was suggested and where searches are configured", async () => {
    cleanUp([...SUGGESTED, missing("Rubber Soul", "The Beatles")]);
    const language = render(<LanguageSelect />).getByRole("combobox", { name: "Language" });
    const user = userEvent.setup();

    try {
      await user.selectOptions(language, "zh-Hans");

      const suggestions = within(screen.getByRole("list", { name: "建议的封面" }));
      expect(suggestions.getByRole("button", { name: "采用「Help!」的建议封面" })).toBeVisible();
      expect(
        suggestions.getByRole("img", { name: /「Help!」的封面建议.*MusicBrainz/u }),
      ).toBeVisible();
      expect(screen.getByRole("link", { name: "设置 → MusicBrainz" })).toHaveAttribute(
        "href",
        "#/settings?section=musicbrainz",
      );
    } finally {
      await user.selectOptions(language, "auto");
    }
  });

  it("marks available album lyrics beside the suggestion name without covering its image", () => {
    cleanUp(
      SUGGESTED,
      undefined,
      HELP_SONGS.map((track) => ({ ...track, has_lyrics: true })),
    );

    const mark = screen.getByRole("img", { name: "Album, All songs have lyrics" });
    expect(mark.closest(".photo-suggestion-name")).not.toBeNull();
    expect(document.querySelector(".photo-suggestion-art .lyrics-badge")).toBeNull();
    expect(screen.getByRole("button", { name: "Use the suggested cover of Help!" })).toBeEnabled();
  });
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
    expect(
      within(fantasy ?? document.body).getByRole("link", { name: "Album范特西" }),
    ).toHaveAttribute(
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

  it("shows a cover being used as saving at once, taking no more input", async () => {
    serve({ [USE]: { body: { used: 1 }, after: new Promise(() => undefined) } });
    cleanUp(SUGGESTED);

    await userEvent.click(
      section().getByRole("button", { name: "Use the suggested cover of Help!" }),
    );

    const help = within(tileOf("Help!"));
    expect(help.getByRole("group", { name: "Suggested cover of Help!" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(help.getByText("Saving…")).toBeVisible();
    for (const control of help.getAllByRole("button")) {
      expect(control).toBeDisabled();
    }
    expect(
      section().getByRole("button", { name: "Use the suggested cover of 范特西" }),
    ).toBeEnabled();
  });

  it("keeps a cover used saving until the albums are read again without it", async () => {
    serve({ [USE]: { body: { used: 1 } } });
    const { reload } = cleanUp(SUGGESTED);

    await userEvent.click(
      section().getByRole("button", { name: "Use the suggested cover of Help!" }),
    );

    expect(reload).toHaveBeenCalled();
    expect(within(tileOf("Help!")).getByText("Saving…")).toBeVisible();
  });

  it("lets a cover be used again when saving it fails", async () => {
    serve({ [USE]: { status: 500, body: { detail: "Disk full" } } });
    cleanUp(SUGGESTED);

    await userEvent.click(
      section().getByRole("button", { name: "Use the suggested cover of Help!" }),
    );

    expect(await section().findByRole("alert")).toHaveTextContent("Disk full");
    expect(within(tileOf("Help!")).queryByText("Saving…")).not.toBeInTheDocument();
    expect(
      section().getByRole("button", { name: "Use the suggested cover of Help!" }),
    ).toBeEnabled();
  });

  it("reads the songs again once a cover is used, so the album shows it", async () => {
    serve({ [USE]: { body: { used: 1 } } });
    const { onUsed } = cleanUp(SUGGESTED);

    await userEvent.click(
      section().getByRole("button", { name: "Use the suggested cover of Help!" }),
    );

    expect(onUsed).toHaveBeenCalledOnce();
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
    expect(within(editor).getByRole("tab", { name: "Upload" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("counts the albums MusicBrainz has nothing for and those not searched, saying where that is set", () => {
    cleanUp([missing("A", "X", { found: true }), missing("B", "X"), missing("C", "X")]);

    expect(
      section().getByText(
        /^1 album has no current cover suggestion; 2 albums aren't searched yet\./u,
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
