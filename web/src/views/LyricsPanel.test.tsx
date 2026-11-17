import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Lyrics } from "../api";
import { lyricsOf } from "../testing/server";
import { LyricNow, LyricsPanel } from "./LyricsPanel";

/** *Melt*, timed, its first line translated, a pause after its second. */
const MELT: Lyrics = lyricsOf({
  lines: [
    { at_ms: 12_340, text: "朝目が覚めて", translation: "Waking up", words: [] },
    { at_ms: 15_500, text: "真っ先に思い浮かぶ", translation: "", words: [] },
    { at_ms: 20_000, text: "", translation: "", words: [] },
    { at_ms: 62_000, text: "君のこと", translation: "", words: [] },
  ],
});

/** Lyrics with no times, as written. */
const PLAIN: Lyrics = {
  ...MELT,
  synced: false,
  lines: [],
  plain: "朝目が覚めて\n真っ先に思い浮かぶ",
};

function panel(lyrics: Lyrics | null | undefined, seconds: number, onSeek = vi.fn()) {
  render(<LyricsPanel lyrics={lyrics} seconds={seconds} onSeek={onSeek} />);
  return { region: screen.getByRole("region", { name: "Lyrics" }), onSeek };
}

describe("the lyrics beside the cover", () => {
  it("marks the line sung now, with its translation under it", () => {
    const { region } = panel(MELT, 13);

    const now = within(region)
      .getAllByRole("listitem")
      .find((line) => line.getAttribute("aria-current") === "true");
    expect(now).toHaveTextContent("朝目が覚めてWaking up");
  });

  it("plays from a line pressed", async () => {
    const { region, onSeek } = panel(MELT, 13);

    await userEvent.click(within(region).getByRole("button", { name: "君のこと" }));

    expect(onSeek).toHaveBeenCalledWith(62);
  });

  it("shows a pause in the singing as a note", () => {
    const { region } = panel(MELT, 13);

    expect(within(region).getByLabelText("A pause in the singing")).toHaveTextContent("♪");
  });

  it("shows plain lyrics as written, an instrumental, and a song with none", () => {
    const { region } = panel(PLAIN, 0);
    expect(region).toHaveTextContent("朝目が覚めて 真っ先に思い浮かぶ", {
      normalizeWhitespace: true,
    });
  });

  it.each([
    [{ ...MELT, instrumental: true }, "Instrumental"],
    [null, "No lyrics for this song."],
  ])("says so for an instrumental or a song with none", (lyrics, said) => {
    const { region } = panel(lyrics, 0);

    expect(region).toHaveTextContent(said);
  });

  it("shows nothing while the lyrics are read", () => {
    const { region } = panel(undefined, 0);

    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveAttribute("aria-busy", "true");
  });
});

describe("the line sung now, in the player", () => {
  it.each([
    [13, "朝目が覚めて"],
    [11, ""],
    [21, ""],
  ])("at %i seconds is “%s”", (seconds, line) => {
    const { container } = render(<LyricNow lyrics={MELT} seconds={seconds} />);

    expect(container).toHaveTextContent(line);
  });

  it("is none for plain lyrics", () => {
    const { container } = render(<LyricNow lyrics={PLAIN} seconds={13} />);

    expect(container).toBeEmptyDOMElement();
  });
});
