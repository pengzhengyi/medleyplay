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

describe("Now Playing", () => {
  it("opens from the player's cover and shows the song playing", async () => {
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

  it("closes with its close button, and with Escape", async () => {
    await playingIntro();
    const first = await openNowPlaying();

    await userEvent.click(within(first).getByRole("button", { name: "Close Now Playing" }));

    expect(screen.queryByRole("dialog", { name: "Now Playing" })).toBeNull();

    await openNowPlaying();
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Now Playing" })).toBeNull();
  });

  it("opens and closes with its shortcut", async () => {
    await playingIntro();

    await userEvent.keyboard("f");

    expect(screen.getByRole("dialog", { name: "Now Playing" })).toBeInTheDocument();

    await userEvent.keyboard("f");

    expect(screen.queryByRole("dialog", { name: "Now Playing" })).toBeNull();
  });

  it("shows what plays next when asked", async () => {
    await playingIntro();
    const nowPlaying = await openNowPlaying();

    await userEvent.click(within(nowPlaying).getByRole("button", { name: "Up next" }));

    const queue = within(nowPlaying).getByRole("region", { name: "Up next" });
    expect(within(queue).getByText("Long Road")).toBeInTheDocument();
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
