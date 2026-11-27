import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Playlist } from "../api";
import { favoritesPlaylistOf, playlistOf, trackOf } from "../testing/server";
import { AddToPlaylist } from "./AddToPlaylist";
import { LanguageSelect } from "./LanguageSelect";

const OUTRO = trackOf(2, "Outro");

/**
 * The Account's Playlists: Favorites, which the server keeps; Mornings, which
 * already holds Outro; Car and Gym, which don't; and Loud, a smart playlist.
 */
const PLAYLISTS: readonly Playlist[] = [
  favoritesPlaylistOf([2]),
  playlistOf("p1", "Mornings", [1, 2]),
  playlistOf("p2", "Car", []),
  playlistOf("p3", "Gym", [1]),
  { ...playlistOf("p4", "Loud", []), rules: { version: 1, match: "all", conditions: [] } },
  {
    ...playlistOf("p5", "Newer", []),
    unreadable: "The rules are version 2, newer than this server reads.",
  },
];

function renderDialog(onSave = vi.fn(() => Promise.resolve())) {
  const onClose = vi.fn();
  render(<AddToPlaylist track={OUTRO} playlists={PLAYLISTS} onSave={onSave} onClose={onClose} />);
  return {
    onSave,
    onClose,
    dialog: screen.getByRole("dialog", { name: "Add “Outro” to playlists" }),
  };
}

describe("adding a song to playlists", () => {
  it("translates guidance and the pending playlist label without changing the typed name", async () => {
    render(<LanguageSelect />);
    const onSave = vi.fn(() => Promise.resolve());
    render(
      <AddToPlaylist
        track={OUTRO}
        playlists={[favoritesPlaylistOf([])]}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    const language = screen.getByRole("combobox", { name: "Language" });
    expect(
      screen.getByText("No playlists take songs by hand yet. Name one below to make it."),
    ).toBeVisible();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "New playlist" }), "Search");

    try {
      fireEvent.change(language, { target: { value: "zh-Hans" } });

      expect(
        screen.getByText("没有可手动添加歌曲的播放列表。请在下方输入名称以创建一个。"),
      ).toBeVisible();
      expect(screen.getByRole("textbox", { name: "新建播放列表" })).toHaveValue("Search");
      await user.click(screen.getByRole("button", { name: "创建" }));
      expect(screen.getByRole("checkbox", { name: /Search/u })).toBeChecked();
      await user.click(screen.getByRole("button", { name: "添加到 1 个播放列表" }));
      expect(onSave).toHaveBeenCalledExactlyOnceWith([], ["Search"]);
    } finally {
      fireEvent.change(language, { target: { value: "auto" } });
    }
  });

  it("does not stage a new name until Enter is pressed outside IME composition", () => {
    const { dialog } = renderDialog();
    const name = within(dialog).getByRole("textbox", { name: "New playlist" });
    fireEvent.change(name, { target: { value: "周末" } });

    fireEvent.keyDown(name, { key: "Enter", isComposing: true });

    expect(name).toHaveValue("周末");
    expect(within(dialog).queryByRole("checkbox", { name: /周末/u })).not.toBeInTheDocument();
    fireEvent.keyDown(name, { key: "Enter", isComposing: false });
    expect(within(dialog).getByRole("checkbox", { name: /周末/u })).toBeChecked();
    expect(name).toHaveValue("");
  });

  it("submits only playlists that are still eligible when the list changes", async () => {
    const plain = playlistOf("p1", "Car", []);
    const other = playlistOf("p2", "Beach", []);
    const onSave = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    const { rerender } = render(
      <AddToPlaylist track={OUTRO} playlists={[plain, other]} onSave={onSave} onClose={onClose} />,
    );
    const dialog = within(screen.getByRole("dialog"));
    const user = userEvent.setup();
    await user.click(dialog.getByRole("checkbox", { name: /Car/u }));
    await user.click(dialog.getByRole("checkbox", { name: /Beach/u }));
    const unreadable = {
      ...plain,
      unreadable: "The rules are version 2, newer than this server reads.",
    };
    rerender(
      <AddToPlaylist
        track={OUTRO}
        playlists={[unreadable, other]}
        onSave={onSave}
        onClose={onClose}
      />,
    );

    await user.click(dialog.getByRole("button", { name: "Add to 1 playlist" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith(["p2"], []);
  });

  it("offers the Account's own plain Playlists, and shows those that already hold the song", () => {
    const { dialog } = renderDialog();

    const boxes = within(dialog).getAllByRole("checkbox");

    expect(boxes.map((box) => box.closest("label")?.textContent)).toEqual([
      "MorningsAlready added",
      "Car0 songs",
      "Gym1 song",
    ]);
    expect(within(dialog).getByRole("checkbox", { name: /Mornings/ })).toBeDisabled();
    expect(within(dialog).getByRole("checkbox", { name: /Mornings/ })).toBeChecked();
  });

  it("adds the song to every Playlist chosen at once", async () => {
    const { dialog, onSave, onClose } = renderDialog();

    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Car/ }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Gym/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Add to 2 playlists" }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith(["p2", "p3"], []);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("makes a new Playlist, chosen at once, only when the song is added", async () => {
    const { dialog, onSave } = renderDialog();

    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "New playlist" }),
      "Beach{Enter}",
    );

    expect(within(dialog).getByRole("checkbox", { name: /Beach/ })).toBeChecked();
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Add to 1 playlist" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith([], ["Beach"]);
  });

  it("can't add before a Playlist is chosen", () => {
    const { dialog } = renderDialog();

    expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("stays open and says why when the server refuses", async () => {
    const onSave = vi.fn(() => Promise.reject(new Error("The server is busy.")));
    const { dialog, onClose } = renderDialog(onSave);

    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Car/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Add to 1 playlist" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The server is busy.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    [
      "its ✕",
      async (dialog: HTMLElement) => {
        await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      },
    ],
    [
      "Escape",
      async () => {
        await userEvent.keyboard("{Escape}");
      },
    ],
  ])("is dismissed with %s, adding nothing", async (_, dismiss) => {
    const { dialog, onSave, onClose } = renderDialog();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Car/ }));

    await dismiss(dialog);

    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });
});
