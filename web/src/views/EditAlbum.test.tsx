import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Track } from "../api";
import { albumCoversOf, serve, trackOf } from "../testing/server";
import { EditAlbum } from "./EditAlbum";

/** *Supercell*, two songs of their own that agree on all but the year. */
const SUPERCELL: readonly Track[] = [
  trackOf(1, "Melt", {
    artist: "ryo",
    album: "Supercell",
    album_artist: "supercell",
    year: 2009,
    genre: "J-Pop",
  }),
  trackOf(2, "Shiver", {
    artist: "ryo",
    album: "Supercell",
    album_artist: "supercell",
    year: 2010,
    genre: "J-Pop",
  }),
];

function renderEditor(songs: readonly Track[] = SUPERCELL) {
  const onSave = vi.fn(() => Promise.resolve());
  const onUseCover = vi.fn<(cover: string) => Promise<void>>(() => Promise.resolve());
  const onClose = vi.fn();
  render(<EditAlbum songs={songs} onSave={onSave} onUseCover={onUseCover} onClose={onClose} />);
  return { onSave, onUseCover, onClose };
}

describe("editing an album of songs of their own", () => {
  it("fills each detail its songs agree on, and leaves blank one they don't", () => {
    renderEditor();

    expect(screen.getByRole("textbox", { name: "Album" })).toHaveValue("Supercell");
    expect(screen.getByRole("textbox", { name: "Album artist" })).toHaveValue("supercell");
    expect(screen.getByRole("spinbutton", { name: "Year" })).toHaveValue(null);
    expect(screen.getByRole("spinbutton", { name: "Year" })).toHaveAttribute(
      "placeholder",
      "Varies; each keeps its own",
    );
    expect(screen.getByRole("textbox", { name: "Genre" })).toHaveValue("J-Pop");
  });

  it("saves only what changed, to every song", async () => {
    const { onSave } = renderEditor();

    await userEvent.clear(screen.getByRole("textbox", { name: "Album" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Album" }), "supercell");
    await userEvent.type(screen.getByRole("spinbutton", { name: "Year" }), "2009");
    await userEvent.click(screen.getByRole("button", { name: "Save to 2 songs" }));

    expect(onSave).toHaveBeenCalledWith({ album: "supercell", year: 2009 });
  });

  it("drops the household's own value for a detail emptied, so the files' shows again", async () => {
    const { onSave } = renderEditor();

    await userEvent.clear(screen.getByRole("textbox", { name: "Genre" }));
    await userEvent.click(screen.getByRole("button", { name: "Save to 2 songs" }));

    expect(onSave).toHaveBeenCalledWith({ genre: null });
  });

  it("says why a save was refused, and stays open", async () => {
    const onSave = vi.fn(() => Promise.reject(new Error("The year is 1-9999.")));
    render(<EditAlbum songs={SUPERCELL} onSave={onSave} onUseCover={vi.fn()} onClose={vi.fn()} />);

    await userEvent.type(screen.getByRole("spinbutton", { name: "Year" }), "2009");
    await userEvent.click(screen.getByRole("button", { name: "Save to 2 songs" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The year is 1-9999.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("has nothing to save until something changes", () => {
    renderEditor();

    expect(screen.getByRole("button", { name: "Save to 2 songs" })).toBeDisabled();
  });

  it("finds covers of the album on MusicBrainz, and sets the one chosen on every song", async () => {
    serve({
      [`GET /api/album-covers?${new URLSearchParams({ album: "Supercell", artist: "supercell" }).toString()}`]:
        { body: albumCoversOf(["cover-a", "cover-b"]) },
    });
    const { onUseCover } = renderEditor();

    await userEvent.click(screen.getByRole("button", { name: "Find covers on MusicBrainz" }));
    const found = await screen.findByRole("region", { name: "Covers on MusicBrainz" });
    const [, second] = within(found).getAllByRole("button", { name: /^Use the cover of/u });
    await userEvent.click(second ?? found);

    expect(onUseCover).toHaveBeenCalledExactlyOnceWith("cover-b");
    expect(second).toHaveAttribute("aria-pressed", "true");
  });

  it("offers no covers to find for songs on no album", () => {
    renderEditor([trackOf(1, "Melt", { album: "" }), trackOf(2, "Shiver", { album: "" })]);

    expect(screen.queryByRole("button", { name: "Find covers on MusicBrainz" })).toBeNull();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
