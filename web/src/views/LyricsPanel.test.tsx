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

/** *Melt*'s lyrics, suggested: those of the nearest song a site has. */
const SUGGESTED: Lyrics = { ...MELT, origin: "suggested" };

function suggested(
  onSave = vi.fn(() => Promise.resolve()),
  onDismiss = vi.fn(() => Promise.resolve()),
) {
  render(
    <LyricsPanel
      lyrics={SUGGESTED}
      seconds={13}
      onSeek={vi.fn()}
      onSave={onSave}
      onDismiss={onDismiss}
    />,
  );
  return {
    bar: within(screen.getByRole("group", { name: "Lyrics suggested" })),
    onSave,
    onDismiss,
  };
}

describe("lyrics suggested, of the nearest song a site has", () => {
  it("are tagged as found on the web, with what that means in the tooltip", () => {
    const { bar } = suggested();

    expect(bar.getByText("Found on the web")).toHaveAttribute(
      "title",
      "The lyrics of the nearest song LRCLIB has, not saved",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("are saved as the household's in one click", async () => {
    const { bar, onSave } = suggested();

    await userEvent.click(bar.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledOnce();
  });

  it("are dismissed in one click", async () => {
    const { bar, onDismiss } = suggested();

    await userEvent.click(bar.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("show saving at once, taking no more input", async () => {
    const { bar } = suggested(vi.fn(() => new Promise<void>(() => undefined)));

    await userEvent.click(bar.getByRole("button", { name: "Save" }));

    expect(bar.getByRole("button", { name: "Save" })).toHaveAttribute("aria-busy", "true");
    expect(bar.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(bar.getByRole("button", { name: "Dismiss" })).toBeDisabled();
  });

  it("say why they were not saved, and can be saved again", async () => {
    const { bar } = suggested(vi.fn(() => Promise.reject(new Error("Disk full"))));

    await userEvent.click(bar.getByRole("button", { name: "Save" }));

    expect(await bar.findByRole("alert")).toHaveTextContent("Disk full");
    expect(bar.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("show no bar for lyrics a site has for the song", () => {
    render(
      <LyricsPanel
        lyrics={MELT}
        seconds={13}
        onSeek={vi.fn()}
        onSave={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.queryByRole("group", { name: "Lyrics suggested" })).toBeNull();
  });
});

describe("the line sung now, in the player", () => {
  it("at 13 seconds is the line sung then, whole in its tooltip", () => {
    const { container } = render(<LyricNow lyrics={MELT} seconds={13} />);

    const line = container.querySelector(".lyric-now");
    expect(line).toHaveTextContent("朝目が覚めて");
    expect(line).toHaveAttribute("title", "朝目が覚めて");
  });

  it.each([
    [11, "before the first line"],
    [21, "in a pause"],
  ])("at %i seconds, %s, keeps its row empty so the player does not change height", (seconds) => {
    const { container } = render(<LyricNow lyrics={MELT} seconds={seconds} />);

    const line = container.querySelector(".lyric-now");
    expect(line).toBeInTheDocument();
    expect(line).toBeEmptyDOMElement();
  });

  it("shows suggested lyrics too", () => {
    render(<LyricNow lyrics={SUGGESTED} seconds={13} />);

    expect(screen.getByText("朝目が覚めて")).toBeVisible();
  });

  it("is none for plain lyrics", () => {
    const { container } = render(<LyricNow lyrics={PLAIN} seconds={13} />);

    expect(container).toBeEmptyDOMElement();
  });
});
