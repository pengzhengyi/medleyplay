import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { serve, signedIn, trackOf } from "../testing/server";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A signed-in page whose Tracks Intro, Long Road, and Outro are ready to play. */
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

function upNext(): string[] {
  const queue = screen.getByRole("region", { name: "Up next" });
  return within(queue)
    .queryAllByRole("listitem")
    .flatMap((item) => item.querySelector(".entry-title")?.textContent ?? []);
}

describe("the queue", () => {
  it("queues the Tracks after the one chosen", async () => {
    await playingIntro();

    expect(upNext()).toEqual(["Long Road", "Outro"]);
    expect(
      within(screen.getByRole("region", { name: "Player" })).getByText("Intro"),
    ).toBeInTheDocument();
  });

  it("says how many songs are queued and how long they play", async () => {
    await playingIntro();

    const queue = screen.getByRole("region", { name: "Up next" });
    expect(within(queue).getByText(/^2 songs, 6 min/u)).toBeInTheDocument();
  });

  it("removes what plays next", async () => {
    await playingIntro();

    await userEvent.click(screen.getByRole("button", { name: "Remove Long Road" }));

    expect(upNext()).toEqual(["Outro"]);
  });

  it("gives each Track a handle to drag it into another place by", async () => {
    await playingIntro();

    const handle = screen.getByRole("button", { name: "Reorder Outro" });

    expect(handle).toHaveAttribute("aria-roledescription", "sortable");
    expect(handle).toHaveAccessibleDescription(/press Space to pick the Track up/);
  });

  it("puts a Track asked for next before the rest", async () => {
    await playingIntro();

    await userEvent.click(screen.getByRole("button", { name: "Play Outro next" }));

    expect(upNext()).toEqual(["Outro", "Long Road", "Outro"]);
  });

  it("clears what plays next", async () => {
    await playingIntro();

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(
      screen.getByText("Nothing queued. Add a Track from the list to play it later."),
    ).toBeInTheDocument();
  });

  it("moves on to the next Track", async () => {
    await playingIntro();

    await userEvent.click(
      within(screen.getByRole("region", { name: "Player" })).getByRole("button", { name: "Next" }),
    );

    expect(
      within(screen.getByRole("region", { name: "Player" })).getByText("Long Road"),
    ).toBeInTheDocument();
    expect(upNext()).toEqual(["Outro"]);
  });
});

/**
 * A signed-in page playing Melt from the Library, so the songs of 生如夏花, a file
 * split into three songs, and Bremen, an album in one file, play next.
 */
async function playingMelt() {
  const tracks = [
    trackOf(1, "Melt"),
    trackOf(9, "生如夏花", { artist: "朴树", kind: "album", split: true }),
    trackOf(11, "傲慢的上校", { artist: "朴树", segment_of: 9, track_number: 1 }),
    trackOf(12, "浮游", { artist: "朴树", segment_of: 9, track_number: 2 }),
    trackOf(13, "生如夏花", { artist: "朴树", segment_of: 9, track_number: 3 }),
    trackOf(20, "Bremen", { artist: "ハチ", kind: "album", duration_ms: 3_600_000 }),
  ];
  serve({
    ...signedIn(tracks),
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
  await userEvent.click(await screen.findByRole("button", { name: "Melt" }));
  return screen.getByRole("region", { name: "Up next" });
}

describe("an album in the queue", () => {
  it("shows the songs of one file under its name, saying where they start", async () => {
    const queue = await playingMelt();

    const album = within(queue).getByRole("listitem", { name: "生如夏花, 1 of 3" });
    expect(within(album).getByText("1 of 3")).toBeVisible();
    expect(upNext()).toEqual(["傲慢的上校", "浮游", "生如夏花", "Bremen"]);
  });

  it("marks an album in one file as an album, and a song as a song", async () => {
    const queue = await playingMelt();

    const marks = within(queue).getAllByRole("img", { name: /^(Song|Album)/u });
    expect(marks.map((mark) => mark.title)).toEqual([
      "Album",
      "Song",
      "Song",
      "Song",
      "Album, guessed from its length",
    ]);
  });

  it("removes the rest of an album at once", async () => {
    const queue = await playingMelt();

    await userEvent.click(
      within(queue).getByRole("button", { name: "Remove the rest of 生如夏花" }),
    );

    expect(upNext()).toEqual(["Bremen"]);
  });

  it("folds an album's songs away, and shows them again", async () => {
    const queue = await playingMelt();
    const toggle = within(queue).getByRole("button", { name: "Hide the songs of 生如夏花" });

    await userEvent.click(toggle);
    const folded = upNext();
    await userEvent.click(
      within(queue).getByRole("button", { name: "Show the songs of 生如夏花" }),
    );

    expect(folded).toEqual(["Bremen"]);
    expect(upNext()).toEqual(["傲慢的上校", "浮游", "生如夏花", "Bremen"]);
  });
});
