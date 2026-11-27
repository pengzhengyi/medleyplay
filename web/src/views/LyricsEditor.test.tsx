import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Lyrics } from "../api";
import type { ComponentProps } from "react";
import { lyricsFoundOf, lyricsOf, lyricsOptionOf, serve, trackOf } from "../testing/server";
import { LyricsEditor, type SyncPlayer } from "./LyricsEditor";
import { LanguageSelect } from "./LanguageSelect";
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

function editing(
  lyrics: Lyrics | null,
  player: SyncPlayer = playingAt(0),
  song?: ComponentProps<typeof LyricsEditor>["song"],
) {
  const save = vi.fn<(text: string, instrumental: boolean) => Promise<unknown>>(() =>
    Promise.resolve(undefined),
  );
  const forget = vi.fn(() => Promise.resolve(null));
  const controls = { headingId: "lyrics-title", onBack: vi.fn(), onLock: vi.fn(), onDone: vi.fn() };
  const element = (
    shown: SyncPlayer,
    changes: Partial<ComponentProps<typeof LyricsEditor>> = {},
  ) => (
    <SongsControlsContext value={controls}>
      <LyricsEditor
        load={() => Promise.resolve(lyrics)}
        save={save}
        forget={forget}
        player={shown}
        song={song}
        {...changes}
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
    refresh: (load: () => Promise<Lyrics | null>) => {
      const refreshVersion = { refreshVersion: "new lyrics" };
      rerender(element(player, { load, ...refreshVersion }));
    },
  };
}

describe("editing a song's lyrics", () => {
  it("translates LRC help after a language switch without modifying the text to save", async () => {
    const { region, save } = editing(null);
    await within(region()).findByText("None yet");
    const field = within(region()).getByRole("textbox", { name: "Lyrics, as LRC or plain text" });
    const text = "[00:12.34]The lantern is still lit";
    const language = render(<LanguageSelect />).getByRole("combobox", { name: "Language" });
    const user = userEvent.setup();
    await user.click(field);
    await user.paste(text);

    try {
      await user.selectOptions(language, "zh-Hans");

      const panel = within(screen.getByRole("region", { name: "歌词" }));
      expect(panel.getByRole("textbox", { name: "歌词（LRC 或纯文本）" })).toHaveValue(text);
      expect(panel.getByText(/例如 \[00:12.34\]/u)).toBeVisible();
      await user.click(panel.getByRole("button", { name: "保存歌词" }));
      expect(save).toHaveBeenCalledExactlyOnceWith(text, false);
    } finally {
      await user.selectOptions(language, "auto");
    }
  });

  it("starts from the lyrics shown, saying where they came from", async () => {
    const { region } = editing(lyricsOf());

    expect(await within(region()).findByText("Found on LRCLIB")).toBeVisible();
    expect(
      within(region()).getByRole("textbox", { name: "Lyrics, as LRC or plain text" }),
    ).toHaveValue("[00:12.34]朝目が覚めて\n");
  });

  it("shows new lyrics and their source in a clean open editor", async () => {
    const { region, refresh } = editing(null);
    await within(region()).findByText("None yet");

    refresh(() => Promise.resolve(PLAIN));

    expect(await within(region()).findByText("Found on LRCLIB")).toBeVisible();
    expect(within(region()).getByRole("textbox")).toHaveValue(PLAIN.text);
  });

  it("refreshes unchanged lyrics after a rejected save and keeps the right source with the text", async () => {
    const { region, refresh, save } = editing(PLAIN);
    await within(region()).findByText("Found on LRCLIB");
    save.mockRejectedValueOnce(new Error("Temporarily unavailable."));
    await userEvent.click(within(region()).getByRole("button", { name: "Save lyrics" }));
    expect(await within(region()).findByRole("alert")).toHaveTextContent(
      "Temporarily unavailable.",
    );

    refresh(() => Promise.resolve(lyricsOf({ origin: "household", text: "Updated words" })));

    expect(await within(region()).findByText("Yours")).toBeVisible();
    expect(within(region()).getByRole("textbox")).toHaveValue("Updated words");
  });

  it("offers recovery after a result read fails even without album or duration metadata", async () => {
    let first = true;
    serve({
      "GET /api/tracks/7/lyrics/found": () => {
        if (!first) return { body: lyricsFoundOf() };
        first = false;
        return { status: 503, body: { detail: "Read interrupted." } };
      },
    });
    const { region } = editing(
      null,
      playingAt(0),
      trackOf(7, "Melt", { artist: "ryo", album: "", duration_ms: null }),
    );
    const entry = within(region()).getByRole("button", { name: "Find" });
    expect(within(region()).getByText(/Your provider may charge/u)).toBeVisible();
    expect(entry).toHaveAccessibleDescription(/Your provider may charge/u);
    await userEvent.click(entry);
    const finder = within(screen.getByRole("region", { name: "Find lyrics" }));
    expect(await finder.findByRole("alert")).toHaveTextContent("Read interrupted.");

    await userEvent.click(finder.getByRole("button", { name: "Retry reading results" }));

    expect(await finder.findByRole("list", { name: "Lyrics found" })).toBeVisible();
    expect(finder.queryByRole("alert")).not.toBeInTheDocument();
    expect(finder.getByRole("button", { name: "Find" })).toBeEnabled();
  });

  it("keeps a draft entered before the refresh finishes", async () => {
    const { region, refresh, save } = editing(null);
    await within(region()).findByText("None yet");
    let answer: (lyrics: Lyrics) => void = () => undefined;
    const response = new Promise<Lyrics>((resolve) => {
      answer = resolve;
    });
    const load = vi.fn(() => response);

    refresh(load);
    await waitFor(() => {
      expect(load).toHaveBeenCalledOnce();
    });
    const box = within(region()).getByRole("textbox");
    await userEvent.type(box, "My version");
    await act(async () => {
      answer(PLAIN);
      await response;
    });

    expect(box).toHaveValue("My version");
    expect(within(region()).getByText("Unsaved draft")).toBeVisible();
    expect(within(region()).queryByText("Found on LRCLIB")).not.toBeInTheDocument();
    await userEvent.click(within(region()).getByRole("button", { name: "Save lyrics" }));
    expect(save).toHaveBeenCalledExactlyOnceWith("My version", false);
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

describe("finding lyrics", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes the lyrics of a song found into the text, saying where from, to save", async () => {
    serve({ "GET /api/tracks/7/lyrics/found": { body: lyricsFoundOf() } });
    const { save, region } = editing(null, playingAt(0), trackOf(7, "Melt", { artist: "ryo" }));

    await userEvent.click(await within(region()).findByRole("button", { name: "Find" }));
    const found = await screen.findByRole("listitem", { name: /^Melt/ });
    await userEvent.click(within(found).getByRole("button", { name: "Use" }));

    expect(within(region()).getByRole("textbox", { name: /Lyrics/ })).toHaveValue(
      lyricsOptionOf().text,
    );
    expect(region()).toHaveTextContent("From “Melt” on LRCLIB. Save to keep them.");
    await userEvent.click(within(region()).getByRole("button", { name: "Save lyrics" }));
    expect(save).toHaveBeenCalledWith(lyricsOptionOf().text, false);
  });

  it("offers no finding for lyrics with no song to find them for", async () => {
    const { region } = editing(null);

    await within(region()).findByRole("button", { name: "Text" });

    expect(within(region()).queryByRole("button", { name: "Find" })).toBeNull();
  });
});
