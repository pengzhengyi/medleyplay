// cspell:ignore supercell
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { trackOf } from "../testing/server";
import { TrackMenu, type TrackMenuActions } from "./TrackMenu";

/** Melt by ryo, on the album Supercell, which is listed under its album artist, supercell. */
const MELT = trackOf(1, "Melt", { artist: "ryo", album: "Supercell", album_artist: "supercell" });

/** Renders the menu of `track`, which the server says the enrichers named in `findable` can find. */
function renderMenu(queueing = true, track = MELT, findable: readonly string[] = []) {
  const actions: TrackMenuActions = {
    onPlayNext: vi.fn(),
    onAdd: vi.fn(),
    onAddToPlaylist: vi.fn(),
    onEditDetails: vi.fn(),
    canFind: (lookup) => findable.includes(lookup.enricher),
    onFind: vi.fn(),
    onEditSongs: vi.fn(),
    onAddFile: vi.fn(),
    onSetKind: vi.fn(),
  };
  render(<TrackMenu track={track} actions={actions} queueing={queueing} />);
  return actions;
}

const open = async () => {
  await userEvent.click(screen.getByRole("button", { name: "More actions for Melt" }));
  return screen.findByRole("menu");
};

afterEach(() => {
  history.replaceState(null, "", "/");
});

describe("a song's menu", () => {
  it("marks a song as an album, for one whose Kind was guessed wrong", async () => {
    const actions = renderMenu();
    await open();

    await userEvent.click(screen.getByRole("menuitem", { name: "Mark as album" }));

    expect(actions.onSetKind).toHaveBeenCalledWith(MELT, "album");
  });

  it("marks an album as a song", async () => {
    const album = { ...MELT, kind: "album" as const, kind_reason: "length" as const };
    const actions = renderMenu(true, album);
    await open();

    await userEvent.click(screen.getByRole("menuitem", { name: "Mark as song" }));

    expect(actions.onSetKind).toHaveBeenCalledWith(album, "song");
  });

  it.each([
    [
      "a file split into songs",
      { split: true, kind: "album" as const, kind_reason: "split" as const },
    ],
    ["a song of a split file", { segment_of: 9, kind_reason: "segment" as const }],
  ])("offers no other Kind for %s, which its split settles", async (_, change) => {
    renderMenu(true, { ...MELT, ...change });

    await open();

    expect(screen.queryByRole("menuitem", { name: /^Mark as/ })).not.toBeInTheDocument();
  });

  it("holds its less frequent actions, each an icon and words", async () => {
    renderMenu();

    await open();

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Play next",
      "Add to queue",
      "Go to artist",
      "Go to album",
      "Open on RYM",
      "Add to playlist…",
      "Edit details…",
      "Mark as album",
      "Split into songs…",
    ]);
  });

  it("offers to find the details online for a Track that can be looked up, after Edit details", async () => {
    renderMenu(true, MELT, ["bilibili-details"]);

    await open();

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Play next",
      "Add to queue",
      "Go to artist",
      "Go to album",
      "Open on RYM",
      "Add to playlist…",
      "Edit details…",
      "Find details online",
      "Mark as album",
      "Split into songs…",
    ]);
  });

  it("asks for the Track's details when Find details online is chosen", async () => {
    const actions = renderMenu(true, MELT, ["bilibili-details"]);
    await open();

    await userEvent.click(screen.getByRole("menuitem", { name: "Find details online" }));

    expect(actions.onFind).toHaveBeenCalledWith(
      expect.objectContaining({ enricher: "bilibili-details", label: "Find details online" }),
      MELT,
    );
  });

  it("leaves out Find details online for a Track that can't be looked up", async () => {
    renderMenu(true, MELT, []);

    await open();

    expect(screen.queryByRole("menuitem", { name: "Find details online" })).toBeNull();
  });

  it("offers Find on MusicBrainz for a Track that can be found there, after Edit details", async () => {
    renderMenu(true, MELT, ["musicbrainz"]);

    await open();

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Play next",
      "Add to queue",
      "Go to artist",
      "Go to album",
      "Open on RYM",
      "Add to playlist…",
      "Edit details…",
      "Find on MusicBrainz",
      "Mark as album",
      "Split into songs…",
    ]);
  });

  it("asks MusicBrainz about the Track when Find on MusicBrainz is chosen", async () => {
    const actions = renderMenu(true, MELT, ["musicbrainz"]);
    await open();

    await userEvent.click(screen.getByRole("menuitem", { name: "Find on MusicBrainz" }));

    expect(actions.onFind).toHaveBeenCalledWith(
      expect.objectContaining({ enricher: "musicbrainz", label: "Find on MusicBrainz" }),
      MELT,
    );
  });

  it("offers both lookups when both can find the Track, details online first", async () => {
    renderMenu(true, MELT, ["musicbrainz", "bilibili-details"]);

    await open();

    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items.slice(6, 9)).toEqual([
      "Edit details…",
      "Find details online",
      "Find on MusicBrainz",
    ]);
  });

  it("offers Suggest details with AI for a Track the AI can be asked about, after Edit details", async () => {
    renderMenu(true, MELT, ["ai-details"]);

    await open();

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Play next",
      "Add to queue",
      "Go to artist",
      "Go to album",
      "Open on RYM",
      "Add to playlist…",
      "Edit details…",
      "Suggest details with AI",
      "Mark as album",
      "Split into songs…",
    ]);
  });

  it("asks the AI about the Track when Suggest details with AI is chosen", async () => {
    const actions = renderMenu(true, MELT, ["ai-details"]);
    await open();

    await userEvent.click(screen.getByRole("menuitem", { name: "Suggest details with AI" }));

    expect(actions.onFind).toHaveBeenCalledWith(
      expect.objectContaining({ enricher: "ai-details", label: "Suggest details with AI" }),
      MELT,
    );
  });

  it("leaves out Suggest details with AI for a Track the AI can't be asked about", async () => {
    renderMenu(true, MELT, ["bilibili-details", "musicbrainz"]);

    await open();

    expect(screen.queryByRole("menuitem", { name: "Suggest details with AI" })).toBeNull();
  });

  it("leaves out queueing for the song playing", async () => {
    renderMenu(false);

    await open();

    expect(screen.queryByRole("menuitem", { name: "Play next" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Go to album" })).toBeInTheDocument();
  });

  it("goes to the song's artist", async () => {
    renderMenu();
    await open();

    await userEvent.click(screen.getByRole("menuitem", { name: "Go to artist" }));

    expect(location.hash).toBe("#/artist?name=ryo");
  });

  it("goes to the song's album, under its album artist", async () => {
    renderMenu();
    await open();

    await userEvent.click(screen.getByRole("menuitem", { name: "Go to album" }));

    expect(location.hash).toBe("#/album?artist=supercell&name=Supercell");
  });

  it("searches Rate Your Music for the song in a new tab, which medleyplay never reads", async () => {
    renderMenu();

    await open();

    const link = screen.getByRole("menuitem", { name: "Open on RYM" });
    expect(link).toHaveAttribute("href", "https://rateyourmusic.com/search?searchterm=ryo+Melt");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("searches Rate Your Music for an album by its album artist and name", async () => {
    renderMenu(true, { ...MELT, kind: "album", kind_reason: "named" });

    await open();

    expect(screen.getByRole("menuitem", { name: "Open on RYM" })).toHaveAttribute(
      "href",
      "https://rateyourmusic.com/search?searchterm=supercell+Supercell",
    );
  });

  it.each([
    ["Play next", "onPlayNext"],
    ["Add to queue", "onAdd"],
    ["Add to playlist…", "onAddToPlaylist"],
    ["Edit details…", "onEditDetails"],
    ["Split into songs…", "onEditSongs"],
  ] as const)("%s acts on the song, and closes the menu", async (item, action) => {
    const actions = renderMenu();
    await open();

    await userEvent.click(screen.getByRole("menuitem", { name: item }));

    expect(actions[action]).toHaveBeenCalledExactlyOnceWith(MELT);
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  it("opens from the keyboard, moves with the arrows, and acts with Enter", async () => {
    const actions = renderMenu();
    screen.getByRole("button", { name: "More actions for Melt" }).focus();

    await userEvent.keyboard("{Enter}");
    await screen.findByRole("menu");
    await userEvent.keyboard("{ArrowDown}{Enter}");

    expect(actions.onAdd).toHaveBeenCalledExactlyOnceWith(MELT);
  });

  it("closes on Escape, giving focus back to its button", async () => {
    renderMenu();
    await open();

    await userEvent.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
    expect(screen.getByRole("button", { name: "More actions for Melt" })).toHaveFocus();
  });
});

describe("a song's menu for a song inside a longer file", () => {
  it("edits the songs of its file", async () => {
    const actions = renderMenu(true, trackOf(1, "Melt", { segment_of: 104 }));
    await open();

    await userEvent.click(screen.getByRole("menuitem", { name: "Edit songs…" }));

    expect(actions.onEditSongs).toHaveBeenCalledOnce();
  });
});

describe("a song's menu for a file already split", () => {
  it("edits its songs", async () => {
    renderMenu(true, trackOf(1, "Melt", { split: true }));
    await open();

    expect(screen.getByRole("menuitem", { name: "Edit songs…" })).toBeInTheDocument();
  });
});

describe("a song's menu for a Track downloaded from a site", () => {
  const FROM_SITE = trackOf(1, "Melt", { site: "bilibili" });

  it("offers to add the file yourself, last", async () => {
    renderMenu(true, FROM_SITE);

    await open();

    expect(screen.getAllByRole("menuitem").at(-1)).toHaveTextContent("Add the file yourself…");
  });

  it("adds the file of the song, and closes the menu", async () => {
    const actions = renderMenu(true, FROM_SITE);
    await open();

    await userEvent.click(screen.getByRole("menuitem", { name: "Add the file yourself…" }));

    expect(actions.onAddFile).toHaveBeenCalledExactlyOnceWith(FROM_SITE);
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  it("offers nothing of the kind for a Track from a Library", async () => {
    renderMenu();

    await open();

    expect(screen.queryByRole("menuitem", { name: "Add the file yourself…" })).toBeNull();
  });
});
