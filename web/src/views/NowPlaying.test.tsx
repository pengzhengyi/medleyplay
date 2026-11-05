import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { serve, signedIn, trackOf } from "../testing/server";

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

/**
 * A signed-in page playing Intro, by The Band from the album Blue, with Long Road and
 * Outro up next.
 */
async function playingIntro() {
  serve({
    ...signedIn([trackOf(1, "Intro"), trackOf(2, "Long Road"), trackOf(3, "Outro")]),
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
}

/** Open Now Playing from the player's cover, and return it. */
async function openNowPlaying() {
  const player = screen.getByRole("region", { name: "Player" });
  await userEvent.click(within(player).getByRole("button", { name: "Open Now Playing" }));
  return screen.getByRole("dialog", { name: "Now Playing" });
}

/** Press Next in `nowPlaying` until the queue runs out: Long Road, Outro, then past the end. */
async function runOutTheQueue(nowPlaying: HTMLElement) {
  for (let press = 0; press < 3; press++) {
    await userEvent.click(within(nowPlaying).getByRole("button", { name: "Next" }));
  }
}

describe("Now Playing", () => {
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
  });
});
