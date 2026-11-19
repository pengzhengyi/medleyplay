import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LyricsFound } from "../api";
import { lyricsFoundOf, lyricsOptionOf, serve } from "../testing/server";
import { LyricsFinder } from "./LyricsFinder";

afterEach(() => {
  vi.unstubAllGlobals();
});

const NEVER_LOOKED: LyricsFound = lyricsFoundOf([], { title: "", artist: "", found_at: null });

/** The finder of song 7's lyrics, *Melt* by ryo, the server answering `found` and `asked`. */
function finding(found: LyricsFound | (() => LyricsFound), asked: unknown[] = []) {
  const served = serve({
    "GET /api/tracks/7/lyrics/found": () => ({
      body: typeof found === "function" ? found() : found,
    }),
    "POST /api/tracks/7/lyrics/find": (body) => {
      asked.push(body);
      return { status: 202, body: null };
    },
  });
  const onUse = vi.fn();
  render(<LyricsFinder trackId={7} title="【MV】Melt" artist="初音ミク" onUse={onUse} />);
  return { ...served, onUse };
}

describe("finding a song's lyrics", () => {
  it("looks on opening by the song's title and artist, when never looked for", async () => {
    const asked: unknown[] = [];
    let reads = 0;
    finding(() => (reads++ === 0 ? NEVER_LOOKED : lyricsFoundOf()), asked);

    expect(await screen.findByRole("listitem", { name: /^Melt/ })).toBeVisible();

    expect(asked).toEqual([{ title: "【MV】Melt", artist: "初音ミク" }]);
  });

  it("does not look again on opening once looked for, showing what was asked", async () => {
    const asked: unknown[] = [];
    finding(lyricsFoundOf(), asked);

    await screen.findByRole("listitem", { name: /^Melt/ });

    expect(asked).toEqual([]);
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Melt");
    expect(screen.getByRole("textbox", { name: "Artist" })).toHaveValue("ryo");
  });

  it("names each song found by its site, album, length, kind, and first lines", async () => {
    finding(
      lyricsFoundOf([
        lyricsOptionOf(),
        lyricsOptionOf({
          provider: "netease",
          title: "Melt (Live)",
          album: "",
          duration_ms: null,
          text: "",
          instrumental: true,
        }),
      ]),
    );

    const [melt, live] = await screen.findAllByRole("listitem");

    expect(melt).toHaveTextContent(/LRCLIB.*Re:Start.*4:20.*Timed/u);
    expect(melt).toHaveTextContent("朝目が覚めて 真っ先に思い浮かぶ");
    expect(melt).not.toHaveTextContent("君の顔");
    expect(live).toHaveTextContent(/NetEase Cloud Music.*Instrumental/u);
  });

  it("looks again by the words typed", async () => {
    const asked: unknown[] = [];
    finding(lyricsFoundOf(), asked);
    const title = await screen.findByRole("textbox", { name: "Title" });

    await userEvent.clear(title);
    await userEvent.type(title, "メルト");
    await userEvent.click(screen.getByRole("button", { name: "Find" }));

    await waitFor(() => {
      expect(asked).toEqual([{ title: "メルト", artist: "ryo" }]);
    });
  });

  it("hands over the song chosen", async () => {
    const { onUse } = finding(lyricsFoundOf());
    const melt = await screen.findByRole("listitem", { name: /^Melt/ });

    await userEvent.click(within(melt).getByRole("button", { name: "Use" }));

    expect(onUse).toHaveBeenCalledWith(lyricsOptionOf());
  });

  it("says when nothing was found", async () => {
    finding(lyricsFoundOf([]));

    expect(await screen.findByText("Nothing found for “Melt” by ryo.")).toBeVisible();
  });

  it("says why looking failed", async () => {
    finding(lyricsFoundOf([], { failure: "LRCLIB refused the request (HTTP 403)." }));

    expect(await screen.findByText("LRCLIB refused the request (HTTP 403).")).toBeVisible();
  });
});
