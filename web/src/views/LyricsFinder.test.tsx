import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LyricsFound, Track } from "../api";
import { lyricsFoundOf, lyricsOptionOf, serve, trackOf } from "../testing/server";
import { LyricsFinder } from "./LyricsFinder";

afterEach(() => {
  vi.unstubAllGlobals();
});

const NEVER_LOOKED: LyricsFound = lyricsFoundOf([], { title: "", artist: "", found_at: null });

/** The answers of reads one after another, the last answered from then on. */
function reading(...answers: [LyricsFound, ...LyricsFound[]]): () => LyricsFound {
  let read = 0;
  return () => answers[Math.min(read++, answers.length - 1)] ?? answers[0];
}

/** An AI model's pick of the second song found, the one by its length. */
const PICKED_LIVE = {
  option: 1,
  why: "The live take, by its length",
  model: "deepseek-flash",
  host: "api.deepseek.com",
  at: "2026-11-19T12:00:01Z",
};

/** The finder of song 7's lyrics, *Melt* by ryo, the server answering `found` and `asked`. */
function finding(
  found: LyricsFound | (() => LyricsFound),
  asked: unknown[] = [],
  details: Partial<Track> = {},
) {
  const served = serve({
    "GET /api/tracks/7/lyrics/found": () => ({
      body: typeof found === "function" ? found() : found,
    }),
    "POST /api/tracks/7/lyrics/find": (body) => {
      asked.push(body);
      return { status: 202, body: null };
    },
    "POST /api/tracks/7/lyrics/choose": { status: 202, body: null },
  });
  const onUse = vi.fn();
  const song = trackOf(7, "【MV】Melt", { artist: "初音ミク", ...details });
  render(<LyricsFinder song={song} onUse={onUse} />);
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

  it("shows Find waiting, its label kept, while it looks", async () => {
    finding(lyricsFoundOf([], { finding: true }));

    await screen.findByText("Looking for lyrics…");

    const find = screen.getByRole("button", { name: "Find" });
    expect(find).toHaveAttribute("aria-busy", "true");
    expect(find).toBeDisabled();
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

  it("keeps the library song's album and length as a reference when the search changes", async () => {
    const asked: unknown[] = [];
    finding(lyricsFoundOf(), asked, { album: "Library Edition", duration_ms: 277_000 });
    const title = screen.getByRole("textbox", { name: "Title" });
    const candidate = await screen.findByRole("listitem", { name: /^Melt/ });

    await userEvent.clear(title);
    await userEvent.type(title, "Melt live");
    await userEvent.click(screen.getByRole("button", { name: "Find" }));

    expect(asked).toEqual([{ title: "Melt live", artist: "ryo" }]);
    expect(screen.getByText("Your song")).toBeVisible();
    expect(screen.getByText("Album: Library Edition")).toBeVisible();
    expect(screen.getByText("Length: 4:37")).toBeVisible();
    expect(candidate).toHaveTextContent(/Re:Start.*4:20/u);
  });

  it("shows the known library detail without a placeholder for the missing one", async () => {
    finding(lyricsFoundOf(), [], { album: "", duration_ms: 277_000 });

    await screen.findByRole("listitem", { name: /^Melt/ });

    expect(screen.getByText("Length: 4:37")).toBeVisible();
    expect(screen.queryByText(/^Album:/u)).not.toBeInTheDocument();
  });

  it("leaves out the library reference when neither detail is known", async () => {
    finding(lyricsFoundOf(), [], { album: "", duration_ms: null });

    await screen.findByRole("listitem", { name: /^Melt/ });

    expect(screen.queryByText("Your song")).not.toBeInTheDocument();
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

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not look for lyrics: LRCLIB refused the request (HTTP 403).",
    );
  });
});

describe("asking an AI model which song found is the song", () => {
  const found = [lyricsOptionOf(), lyricsOptionOf({ title: "Melt (Live)" })];

  it("asks once the songs are found, and marks its pick with why", async () => {
    const { calls } = finding(
      reading(
        lyricsFoundOf(found, { may_choose: true }),
        lyricsFoundOf(found, { choosing: true }),
        lyricsFoundOf(found, { pick: PICKED_LIVE }),
      ),
    );

    const live = await screen.findByRole("listitem", { name: /^Melt \(Live\)/u });
    await waitFor(() => {
      expect(live).toHaveTextContent("AI pick");
    });

    expect(within(live).getByText("AI pick")).toHaveAttribute(
      "title",
      "deepseek-flash picked this: The live take, by its length",
    );
    expect(screen.getByRole("listitem", { name: /^Melt by/u })).not.toHaveTextContent("AI pick");
    expect(calls.filter((call) => call === "POST /api/tracks/7/lyrics/choose")).toHaveLength(1);
  });

  it("says the AI is being asked while it is", async () => {
    finding(lyricsFoundOf(found, { choosing: true }));

    expect(await screen.findByText("Asking the AI which is this song…")).toBeVisible();
  });

  it("does not ask when no AI model may be asked", async () => {
    const { calls } = finding(lyricsFoundOf(found));

    await screen.findByRole("listitem", { name: /^Melt \(Live\)/u });

    expect(calls).not.toContain("POST /api/tracks/7/lyrics/choose");
  });

  it("says why asking the AI failed, offering the songs all the same", async () => {
    finding(lyricsFoundOf(found, { choice_failure: "DeepSeek refused the request." }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not get the AI's lyric suggestion: DeepSeek refused the request.",
    );
    expect(screen.getAllByRole("button", { name: "Use" })).toHaveLength(2);
  });
});
