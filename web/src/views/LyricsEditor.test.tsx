import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Lyrics } from "../api";
import { lyricsOf } from "../testing/server";
import { LyricsEditor, type SyncPlayer } from "./LyricsEditor";
import { SongsControlsContext } from "./songsControls";

/** *Melt* as plain lyrics, not synced yet: three lines. */
const PLAIN = lyricsOf({
  synced: false,
  lines: [],
  plain: "朝目が覚めて\n真っ先に思い浮かぶ\n君のこと",
  text: "朝目が覚めて\n真っ先に思い浮かぶ\n君のこと",
});

/** The player, playing this song `seconds` in. */
function playingAt(seconds: number, change: Partial<SyncPlayer> = {}): SyncPlayer {
  return {
    current: true,
    playing: true,
    seconds,
    start: vi.fn(),
    toggle: vi.fn(),
    seek: vi.fn(),
    ...change,
  };
}

function editing(lyrics: Lyrics | null, player: SyncPlayer = playingAt(0)) {
  const save = vi.fn<(text: string, instrumental: boolean) => Promise<unknown>>(() =>
    Promise.resolve(undefined),
  );
  const forget = vi.fn(() => Promise.resolve(null));
  const controls = { headingId: "lyrics-title", onBack: vi.fn(), onLock: vi.fn(), onDone: vi.fn() };
  const element = (shown: SyncPlayer) => (
    <SongsControlsContext value={controls}>
      <LyricsEditor
        load={() => Promise.resolve(lyrics)}
        save={save}
        forget={forget}
        player={shown}
      />
    </SongsControlsContext>
  );
  const { rerender } = render(element(player));
  return {
    save,
    forget,
    controls,
    region: () => screen.getByRole("region", { name: "Lyrics" }),
    play: (next: SyncPlayer) => {
      rerender(element(next));
    },
  };
}

describe("editing a song's lyrics", () => {
  it("starts from the lyrics shown, saying where they came from", async () => {
    const { region } = editing(lyricsOf());

    expect(await within(region()).findByText("Found on LRCLIB")).toBeVisible();
    expect(
      within(region()).getByRole("textbox", { name: "Lyrics, as LRC or plain text" }),
    ).toHaveValue("[00:12.34]朝目が覚めて\n");
  });

  it("saves the text as the household's, and goes back to the details", async () => {
    const { region, save, controls } = editing(null);
    const box = await within(region()).findByRole("textbox", {
      name: "Lyrics, as LRC or plain text",
    });

    await userEvent.type(box, "Here comes the morning");
    await userEvent.click(within(region()).getByRole("button", { name: "Save lyrics" }));

    expect(save).toHaveBeenCalledWith("Here comes the morning", false);
    expect(controls.onDone).toHaveBeenCalledOnce();
  });

  it("says a song is instrumental, with no text", async () => {
    const { region, save } = editing(PLAIN);
    await within(region()).findByText("Found on LRCLIB");

    await userEvent.click(within(region()).getByRole("checkbox", { name: /^Instrumental/u }));
    await userEvent.click(within(region()).getByRole("button", { name: "Save lyrics" }));

    expect(save).toHaveBeenCalledWith("", true);
  });

  it("offers to remove only the household's own lyrics", async () => {
    const { region } = editing(lyricsOf());

    await within(region()).findByText("Found on LRCLIB");

    expect(within(region()).queryByRole("button", { name: "Remove yours" })).toBeNull();
  });

  it("removes the household's lyrics, and goes back to the details", async () => {
    const { region, forget, controls } = editing(lyricsOf({ origin: "household" }));

    await userEvent.click(await within(region()).findByRole("button", { name: "Remove yours" }));

    expect(forget).toHaveBeenCalledOnce();
    expect(controls.onDone).toHaveBeenCalledOnce();
  });

  it("says why lyrics were refused, and stays", async () => {
    const { region, save, controls } = editing(PLAIN);
    save.mockRejectedValueOnce(new Error("Lyrics have at most 2,000 timed lines."));
    await within(region()).findByText("Found on LRCLIB");

    await userEvent.click(within(region()).getByRole("button", { name: "Save lyrics" }));

    expect(await within(region()).findByRole("alert")).toHaveTextContent(
      "at most 2,000 timed lines",
    );
    expect(controls.onDone).not.toHaveBeenCalled();
  });
});

describe("syncing lyrics to the song", () => {
  it("stamps each line as Space is pressed, while the song plays", async () => {
    const { region, play, save } = editing(PLAIN, playingAt(0));
    await within(region()).findByText("Found on LRCLIB");
    await userEvent.click(within(region()).getByRole("button", { name: "Sync to the song" }));

    play(playingAt(12.34));
    await userEvent.keyboard(" ");
    play(playingAt(15.5));
    await userEvent.click(within(region()).getByRole("button", { name: "Stamp" }));
    await userEvent.click(within(region()).getByRole("button", { name: "Save lyrics" }));

    expect(save).toHaveBeenCalledWith(
      "[00:12.34]朝目が覚めて\n[00:15.50]真っ先に思い浮かぶ\n君のこと\n",
      false,
    );
  });

  it("plays the song from its start, and from a line's time", async () => {
    const player = playingAt(0);
    const { region } = editing(lyricsOf(), player);
    await within(region()).findByText("Found on LRCLIB");
    await userEvent.click(within(region()).getByRole("button", { name: "Sync to the song" }));

    await userEvent.click(within(region()).getByRole("button", { name: "Play from the start" }));
    await userEvent.click(within(region()).getByRole("button", { name: "Play from [00:12.34]" }));

    expect(player.start).toHaveBeenCalledOnce();
    expect(player.seek).toHaveBeenCalledWith(12.34);
  });

  it("moves a line, or every line, a tenth of a second", async () => {
    const { region, save } = editing(lyricsOf());
    await within(region()).findByText("Found on LRCLIB");
    await userEvent.click(within(region()).getByRole("button", { name: "Sync to the song" }));

    await userEvent.click(
      within(region()).getByRole("button", { name: "朝目が覚めて a tenth of a second later" }),
    );
    await userEvent.click(
      within(region()).getByRole("button", { name: "Every line a tenth of a second earlier" }),
    );
    await userEvent.click(
      within(region()).getByRole("button", { name: "Every line a tenth of a second earlier" }),
    );
    await userEvent.click(within(region()).getByRole("button", { name: "Save lyrics" }));

    expect(save).toHaveBeenCalledWith("[00:12.24]朝目が覚めて\n", false);
  });

  it("stamps nothing until the song plays, and says how to start", async () => {
    const { region } = editing(PLAIN, playingAt(0, { current: false, playing: false }));
    await within(region()).findByText("Found on LRCLIB");

    await userEvent.click(within(region()).getByRole("button", { name: "Sync to the song" }));

    expect(within(region()).getByRole("button", { name: "Stamp" })).toBeDisabled();
    expect(region()).toHaveTextContent("Play the song from the start, then press Space");
    expect(within(region()).getByRole("status")).toHaveTextContent("3 lines aren't stamped yet.");
  });
});
