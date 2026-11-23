import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { type Routes, serve, signedIn, trackOf } from "../testing/server";

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

/**
 * A signed-in page playing Intro, by The Band from the album Blue, with Long Road and
 * Outro up next; the server answers `routes` too.
 */
async function playingIntro(routes: Routes = {}, intro = trackOf(1, "Intro")) {
  const served = serve({
    ...routes,
    "PUT /api/tracks/1/favorite": { body: trackOf(1, "Intro", { favorite: true }) },
    ...signedIn([intro, trackOf(2, "Long Road"), trackOf(3, "Outro")]),
    ...Object.fromEntries(
      [1, 2, 3].map((id) => [
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
  return served;
}

/** Open Now Playing from the player's cover, and return it. */
async function openNowPlaying() {
  const player = screen.getByRole("region", { name: "Player" });
  await userEvent.click(within(player).getByRole("button", { name: "Open Now Playing" }));
  // Now Playing loads the first time it opens.
  return screen.findByRole("dialog", { name: "Now Playing" });
}

/** Press Next in `nowPlaying` until the queue runs out: Long Road, Outro, then past the end. */
async function runOutTheQueue(nowPlaying: HTMLElement) {
  for (let press = 0; press < 3; press++) {
    await userEvent.click(within(nowPlaying).getByRole("button", { name: "Next" }));
  }
}

describe("Now Playing", () => {
  it("shows the song favorited from the player's heart, in the player and in Now Playing", async () => {
    const { calls } = await playingIntro();
    const player = screen.getByRole("region", { name: "Player" });

    await userEvent.click(within(player).getByRole("button", { name: "Favorite Intro" }));

    expect(calls).toContain("PUT /api/tracks/1/favorite");
    expect(within(player).getByRole("button", { name: "Favorite Intro" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const nowPlaying = await openNowPlaying();
    expect(within(nowPlaying).getByRole("button", { name: "Favorite Intro" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("favorites a whole album in one file from the player's heart, as Now Playing shows it", async () => {
    const album = trackOf(4, "Jim Restaurant", {
      kind: "album",
      album: "Jim Restaurant",
      artist: "赵雷",
      duration_ms: 3_000_000,
    });
    const { calls } = serve({
      ...signedIn([album]),
      "POST /api/tracks/4/playback": {
        body: {
          state: "ready",
          source_id: 4,
          audio_url: "/api/sources/4/audio",
          media_type: "audio/wav",
        },
      },
      "PUT /api/albums/favorite": {
        body: { artists: [], albums: [{ artist: "赵雷", name: "Jim Restaurant" }] },
      },
    });
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Jim Restaurant" }));
    const player = screen.getByRole("region", { name: "Player" });

    await userEvent.click(
      within(player).getByRole("button", { name: "Favorite album Jim Restaurant" }),
    );

    expect(calls).toContain("PUT /api/albums/favorite");
    const nowPlaying = await openNowPlaying();
    expect(
      within(nowPlaying).getByRole("button", { name: "Favorite album Jim Restaurant" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("opens from the player's cover", async () => {
    await playingIntro();

    const nowPlaying = await openNowPlaying();

    expect(nowPlaying).toBeVisible();
  });

  it("shows the song playing, its artist, and its album", async () => {
    await playingIntro();

    const nowPlaying = await openNowPlaying();

    expect(within(nowPlaying).getByRole("heading", { name: "Intro" })).toBeInTheDocument();
    expect(within(nowPlaying).getByRole("link", { name: "The Band" })).toBeInTheDocument();
    expect(within(nowPlaying).getByRole("link", { name: "Blue" })).toBeInTheDocument();
  });

  it("names in the player the song's artist and album, each opening its page", async () => {
    await playingIntro();
    const player = screen.getByRole("region", { name: "Player" });

    await userEvent.click(within(player).getByRole("link", { name: "The Band" }));
    expect(await screen.findByRole("heading", { level: 2, name: "The Band" })).toBeVisible();
    await userEvent.click(within(player).getByRole("link", { name: "Blue" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Blue" })).toBeVisible();
  });

  it("offers no cover to open while nothing plays", async () => {
    serve(signedIn([trackOf(1, "Intro")]));
    render(<App />);

    const player = await screen.findByRole("region", { name: "Player" });

    expect(within(player).queryByRole("button", { name: "Open Now Playing" })).toBeNull();
  });

  it("plays the next song from its own controls", async () => {
    await playingIntro();
    const nowPlaying = await openNowPlaying();

    await userEvent.click(within(nowPlaying).getByRole("button", { name: "Next" }));

    expect(
      await within(nowPlaying).findByRole("heading", { name: "Long Road" }),
    ).toBeInTheDocument();
  });

  it("closes with its close button", async () => {
    await playingIntro();
    const nowPlaying = await openNowPlaying();

    await userEvent.click(within(nowPlaying).getByRole("button", { name: "Close Now Playing" }));

    expect(screen.queryByRole("dialog", { name: "Now Playing" })).toBeNull();
  });

  it("closes with Escape", async () => {
    await playingIntro();
    await openNowPlaying();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Now Playing" })).toBeNull();
  });

  it("opens with its shortcut", async () => {
    await playingIntro();

    await userEvent.keyboard("f");

    expect(screen.getByRole("dialog", { name: "Now Playing" })).toBeInTheDocument();
  });

  it("closes with its shortcut", async () => {
    await playingIntro();
    await openNowPlaying();

    await userEvent.keyboard("f");

    expect(screen.queryByRole("dialog", { name: "Now Playing" })).toBeNull();
  });

  it("leaves Space to play or pause once opened with its shortcut", async () => {
    await playingIntro();
    await userEvent.keyboard("f");

    await userEvent.keyboard(" ");

    expect(screen.getByRole("dialog", { name: "Now Playing" })).toBeInTheDocument();
  });

  it("opens what plays next with Q while it is open", async () => {
    await playingIntro();
    const nowPlaying = await openNowPlaying();

    await userEvent.keyboard("q");

    expect(within(nowPlaying).getByRole("region", { name: "Up next" })).toBeInTheDocument();
  });

  it("offers the song's menu inside itself", async () => {
    await playingIntro();
    const nowPlaying = await openNowPlaying();

    await userEvent.click(
      within(nowPlaying).getByRole("button", { name: "More actions for Intro" }),
    );

    expect(within(nowPlaying).getByRole("menuitem", { name: /Add to playlist/ })).toBeVisible();
  });

  it("stays open when Escape closes the song's menu", async () => {
    await playingIntro();
    const nowPlaying = await openNowPlaying();
    await userEvent.click(
      within(nowPlaying).getByRole("button", { name: "More actions for Intro" }),
    );

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Now Playing" })).toBeInTheDocument();
  });

  it("closes when the queue runs out", async () => {
    await playingIntro();
    const nowPlaying = await openNowPlaying();

    await runOutTheQueue(nowPlaying);

    expect(screen.queryByRole("dialog", { name: "Now Playing" })).toBeNull();
  });

  it("stays closed when a song plays after the queue ran out", async () => {
    await playingIntro();
    const nowPlaying = await openNowPlaying();
    await runOutTheQueue(nowPlaying);

    await userEvent.click(screen.getByRole("button", { name: "Long Road" }));

    expect(screen.queryByRole("dialog", { name: "Now Playing" })).toBeNull();
  });

  it("shows what plays next when asked", async () => {
    await playingIntro();
    const nowPlaying = await openNowPlaying();

    await userEvent.click(within(nowPlaying).getByRole("button", { name: "Up next" }));

    const queue = within(nowPlaying).getByRole("region", { name: "Up next" });
    expect(within(queue).getByText("Long Road")).toBeInTheDocument();
  });

  it("closes Up next with Escape, leaving Now Playing open", async () => {
    await playingIntro();
    const nowPlaying = await openNowPlaying();
    await userEvent.click(within(nowPlaying).getByRole("button", { name: "Up next" }));

    await userEvent.keyboard("{Escape}");

    expect(within(nowPlaying).queryByRole("region", { name: "Up next" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Now Playing" })).toBeInTheDocument();
  });

  it("closes Up next with a click outside it", async () => {
    await playingIntro();
    const nowPlaying = await openNowPlaying();
    await userEvent.click(within(nowPlaying).getByRole("button", { name: "Up next" }));

    await userEvent.click(within(nowPlaying).getByRole("heading", { name: "Intro" }));

    expect(within(nowPlaying).queryByRole("region", { name: "Up next" })).toBeNull();
  });

  it("closes when its artist link names the view already open", async () => {
    await playingIntro();
    window.location.hash = "#/artist?name=The%20Band";
    const nowPlaying = await openNowPlaying();

    await userEvent.click(within(nowPlaying).getByRole("link", { name: "The Band" }));

    expect(screen.queryByRole("dialog", { name: "Now Playing" })).toBeNull();
  });

  it("closes when its album link opens the album", async () => {
    await playingIntro();
    const nowPlaying = await openNowPlaying();

    await userEvent.click(within(nowPlaying).getByRole("link", { name: "Blue" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Now Playing" })).toBeNull();
    });
    expect(window.location.hash).toContain("#/album");
    expect(screen.queryByRole("dialog", { name: /a cover|the cover/ })).toBeNull();
  });

  it("opens the album artist's cover editor from the big picture and returns to that album", async () => {
    await playingIntro({}, trackOf(1, "Intro", { album_artist: "Guest & Co", cover: "blue.jpg" }));
    const nowPlaying = await openNowPlaying();
    const cover = within(nowPlaying).getByRole("link", { name: "Edit album cover for Blue" });

    cover.focus();
    await userEvent.keyboard("{Enter}");

    const editor = await screen.findByRole("dialog", { name: "Replace the cover" });
    expect(editor).toHaveAccessibleDescription("Blue");
    expect(editor.contains(document.activeElement)).toBe(true);
    expect(nowPlaying).not.toBeInTheDocument();
    await userEvent.click(within(editor).getByRole("button", { name: "Close" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Blue" })).toBeVisible();
    expect(window.location.hash).toBe("#/album?artist=Guest+%26+Co&name=Blue");
    expect(screen.queryByRole("button", { name: "Long Road" })).toBeNull();
    expect(editor).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "About the album" })).toHaveFocus();
    window.history.back();
    expect(await screen.findByRole("button", { name: "Long Road" })).toBeVisible();
    window.history.forward();
    expect(await screen.findByRole("heading", { level: 2, name: "Blue" })).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the editor over the current album without adding another Back step", async () => {
    await playingIntro();
    const player = screen.getByRole("region", { name: "Player" });
    await userEvent.click(within(player).getByRole("link", { name: "Blue" }));
    await screen.findByRole("heading", { name: "Blue" });
    const nowPlaying = await openNowPlaying();

    await userEvent.click(
      within(nowPlaying).getByRole("link", { name: "Edit album cover for Blue" }),
    );
    const editor = await screen.findByRole("dialog", { name: "Add a cover" });
    await userEvent.keyboard("{Escape}");

    expect(editor).not.toBeInTheDocument();
    window.history.back();
    expect(await screen.findByRole("heading", { name: "Library" })).toBeVisible();
  });

  it("leaves the big picture without a cover action when the song has no album", async () => {
    await playingIntro({}, trackOf(1, "Intro", { album: "" }));
    const nowPlaying = await openNowPlaying();

    expect(within(nowPlaying).queryByRole("link", { name: /edit album cover/i })).toBeNull();
    expect(within(nowPlaying).getByRole("button", { name: "Next" })).toBeVisible();
  });
});

describe("the lyrics in Now Playing", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("shows the song's lyrics beside the cover, and hides them when asked, as this browser remembers", async () => {
    await playingIntro({
      "GET /api/tracks/1/lyrics": {
        body: {
          origin: "tag",
          synced: true,
          instrumental: false,
          lines: [{ at_ms: 0, text: "Here we go", translation: "", words: [] }],
          plain: "",
          found_at: "2026-11-17T12:00:00Z",
        },
      },
    });
    const nowPlaying = await openNowPlaying();
    const lyrics = await within(nowPlaying).findByRole("region", { name: "Lyrics" });
    expect(await within(lyrics).findByRole("button", { name: "Here we go" })).toBeVisible();

    await userEvent.click(within(nowPlaying).getByRole("button", { name: "Lyrics" }));

    expect(within(nowPlaying).queryByRole("region", { name: "Lyrics" })).toBeNull();
    expect(within(nowPlaying).getByRole("button", { name: "Lyrics" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(localStorage.getItem("medleyplay.lyrics")).toBe("hidden");
  });

  it("keeps the lyrics beside the cover while Up next opens over them", async () => {
    await playingIntro({
      "GET /api/tracks/1/lyrics": {
        body: {
          origin: "tag",
          synced: true,
          instrumental: false,
          lines: [{ at_ms: 0, text: "Here we go", translation: "", words: [] }],
          plain: "",
          found_at: "2026-11-17T12:00:00Z",
        },
      },
    });
    const nowPlaying = await openNowPlaying();
    await within(nowPlaying).findByRole("button", { name: "Here we go" });

    await userEvent.click(within(nowPlaying).getByRole("button", { name: "Up next" }));

    expect(within(nowPlaying).getByRole("region", { name: "Up next" })).toBeInTheDocument();
    expect(within(nowPlaying).getByRole("region", { name: "Lyrics" })).toBeInTheDocument();
  });

  it("shows the line sung now under the artist in the player, until hidden", async () => {
    await playingIntro({
      "GET /api/tracks/1/lyrics": {
        body: {
          origin: "tag",
          synced: true,
          instrumental: false,
          lines: [{ at_ms: 0, text: "Here we go", translation: "", words: [] }],
          plain: "",
          found_at: "2026-11-17T12:00:00Z",
        },
      },
    });
    const player = screen.getByRole("region", { name: "Player" });

    expect(await within(player).findByText("Here we go")).toBeVisible();
    const nowPlaying = await openNowPlaying();
    await userEvent.click(within(nowPlaying).getByRole("button", { name: "Lyrics" }));

    expect(within(player).queryByText("Here we go")).toBeNull();
  });
});
