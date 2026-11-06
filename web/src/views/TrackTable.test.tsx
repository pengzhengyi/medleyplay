import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Track } from "../api";
import { trackOf } from "../testing/server";
import { type TrackActions, TrackTable } from "./TrackTable";

/** Intro, a Long Road that can't play, and Outro, listed in that order, as the server adds them. */
const TRACKS = [
  trackOf(1, "Intro", { duration_ms: 61_000 }),
  trackOf(2, "Long Road", { availability: "missing", duration_ms: 600_000 }),
  trackOf(3, "Outro", { duration_ms: 90_000, rating: 4, favorite: true }),
];

function renderTable(tracks: readonly Track[] = TRACKS, playingId?: number) {
  const actions: TrackActions = {
    onPlay: vi.fn(),
    onPlayAll: vi.fn(),
    onPlayNext: vi.fn(),
    onAdd: vi.fn(),
    onAddToPlaylist: vi.fn(),
    onEditDetails: vi.fn(),
    canFind: () => false,
    onFind: vi.fn(),
    onEditSongs: vi.fn(),
    onAddFile: vi.fn(),
    onFavorite: vi.fn(),
    onRate: vi.fn(),
  };
  const view = render(
    <TrackTable
      tracks={tracks}
      playingId={playingId}
      actions={actions}
      empty={<p>No music yet.</p>}
    />,
  );
  return { actions, ...view };
}

const titles = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("button")[1]?.textContent);

beforeEach(() => {
  localStorage.clear();
});

describe("the song table", () => {
  it("plays the Track chosen, with the Tracks in the order shown", async () => {
    const { actions } = renderTable();

    await userEvent.click(screen.getByRole("button", { name: "Outro" }));

    expect(actions.onPlay).toHaveBeenCalledWith(TRACKS, 2);
  });

  it("plays a Track from anywhere on its row, as from its title", async () => {
    const { actions } = renderTable();
    const outro = screen.getByRole("row", { name: /Outro/u });

    await userEvent.click(within(outro).getByRole("cell", { name: "1:30" }));

    expect(actions.onPlay).toHaveBeenCalledWith(TRACKS, 2);
  });

  it("leaves a row's own buttons to do only what they do", async () => {
    const { actions } = renderTable();
    const outro = screen.getByRole("row", { name: /Outro/u });

    await userEvent.click(within(outro).getByRole("button", { name: "Favorite Outro" }));
    await userEvent.click(within(outro).getByRole("button", { name: "2 stars" }));
    await userEvent.click(within(outro).getByRole("group", { name: "Rate Outro" }));

    expect(actions.onFavorite).toHaveBeenCalledWith(TRACKS[2], false);
    expect(actions.onRate).toHaveBeenCalledWith(TRACKS[2], 2);
    expect(actions.onPlay).not.toHaveBeenCalled();
  });

  it("doesn't play a Track that can't play from its row", async () => {
    const { actions } = renderTable();
    const longRoad = screen.getByRole("row", { name: /Long Road/u });

    await userEvent.click(within(longRoad).getByRole("cell", { name: "10:00" }));

    expect(actions.onPlay).not.toHaveBeenCalled();
  });

  it("queues a Track next or last", async () => {
    const { actions } = renderTable();

    await userEvent.click(screen.getByRole("button", { name: "Play Intro next" }));
    await userEvent.click(screen.getByRole("button", { name: "Add Outro to the queue" }));

    expect(actions.onPlayNext).toHaveBeenCalledWith(TRACKS[0]);
    expect(actions.onAdd).toHaveBeenCalledWith(TRACKS[2]);
  });

  it("grays out a Track that can't play, saying why", () => {
    renderTable();

    expect(screen.getByRole("button", { name: "Long Road" })).toBeDisabled();
    expect(screen.getByText("Missing")).toBeInTheDocument();
  });

  it("marks the Track playing", () => {
    renderTable(TRACKS, 3);

    expect(screen.getByRole("button", { name: "Outro" }).closest("tr")).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("shows what it was given when there are no Tracks", () => {
    renderTable([]);

    expect(screen.getByText("No music yet.")).toBeInTheDocument();
  });

  it("counts every Track and the header for screen readers", () => {
    renderTable();

    expect(screen.getByRole("table")).toHaveAttribute("aria-rowcount", "4");
    expect(screen.getByRole("button", { name: "Outro" }).closest("tr")).toHaveAttribute(
      "aria-rowindex",
      "4",
    );
  });
});

describe("sorting", () => {
  it("sorts by a column, then the other way, then back to the order added", async () => {
    renderTable([trackOf(1, "track 10"), trackOf(2, "Banana"), trackOf(3, "track 2")]);
    const title = screen.getByRole("button", { name: "Title" });
    const header = () => screen.getByRole("columnheader", { name: "Title" });

    await userEvent.click(title);
    expect(titles()).toEqual(["Banana", "track 2", "track 10"]);
    expect(header()).toHaveAttribute("aria-sort", "ascending");

    await userEvent.click(title);
    expect(titles()).toEqual(["track 10", "track 2", "Banana"]);
    expect(header()).toHaveAttribute("aria-sort", "descending");

    await userEvent.click(title);
    expect(titles()).toEqual(["track 10", "Banana", "track 2"]);
    expect(header()).not.toHaveAttribute("aria-sort");
  });

  it("sorts times as numbers, shortest first", async () => {
    renderTable();

    await userEvent.click(screen.getByRole("button", { name: "Time" }));

    expect(titles()).toEqual(["Intro", "Outro", "Long Road"]);
  });

  it("plays from the order sorted", async () => {
    const { actions } = renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Time" }));

    await userEvent.click(screen.getByRole("button", { name: "Outro" }));

    expect(actions.onPlay).toHaveBeenCalledWith([TRACKS[0], TRACKS[2], TRACKS[1]], 1);
  });
});

describe("playing them all", () => {
  it("plays every Track that can play, in the order shown", async () => {
    const { actions } = renderTable();
    const title = screen.getByRole("button", { name: "Title" });
    await userEvent.click(title);
    await userEvent.click(title);

    await userEvent.click(screen.getByRole("button", { name: "Play all" }));

    expect(actions.onPlayAll).toHaveBeenCalledExactlyOnceWith([TRACKS[2], TRACKS[0]], false);
  });

  it("shuffles every Track that can play", async () => {
    const { actions } = renderTable();

    await userEvent.click(screen.getByRole("button", { name: "Shuffle all" }));

    expect(actions.onPlayAll).toHaveBeenCalledExactlyOnceWith([TRACKS[0], TRACKS[2]], true);
  });

  it("says a Track still to download plays once medleyplay is Online", () => {
    renderTable([trackOf(2, "Long Road", { availability: "waiting_online" })]);

    expect(screen.getByText("When online")).toBeVisible();
  });

  it("can't play them all when none can play", () => {
    renderTable([trackOf(2, "Long Road", { availability: "missing" })]);

    expect(screen.getByRole("button", { name: "Play all" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Shuffle all" })).toBeDisabled();
  });
});

describe("favorites and ratings", () => {
  it("marks and clears a favorite with the heart", async () => {
    const { actions } = renderTable();

    await userEvent.click(screen.getByRole("button", { name: "Favorite Intro" }));
    await userEvent.click(screen.getByRole("button", { name: "Favorite Outro" }));

    expect(actions.onFavorite).toHaveBeenCalledWith(TRACKS[0], true);
    expect(actions.onFavorite).toHaveBeenCalledWith(TRACKS[2], false);
    expect(screen.getByRole("button", { name: "Favorite Outro" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("rates with the stars, and clears the rating given by choosing it again", async () => {
    const { actions } = renderTable();
    const stars = (title: string) => within(screen.getByRole("group", { name: `Rate ${title}` }));

    await userEvent.click(stars("Intro").getByRole("button", { name: "2 stars" }));
    await userEvent.click(stars("Outro").getByRole("button", { name: "4 stars" }));

    expect(actions.onRate).toHaveBeenCalledWith(TRACKS[0], 2);
    expect(actions.onRate).toHaveBeenCalledWith(TRACKS[2], null);
  });
});

describe("columns", () => {
  it("hides a column, and remembers it in this browser", async () => {
    const { unmount } = renderTable();

    await userEvent.click(screen.getByText("Columns"));
    await userEvent.click(screen.getByRole("checkbox", { name: "Album" }));
    unmount();
    renderTable();

    expect(screen.queryByRole("columnheader", { name: "Album" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Artist" })).toBeInTheDocument();
  });

  it("shows plays and when a Track was added once asked to", async () => {
    renderTable();
    expect(screen.queryByRole("columnheader", { name: "Plays" })).toBeNull();

    await userEvent.click(screen.getByText("Columns"));
    await userEvent.click(screen.getByRole("checkbox", { name: "Plays" }));

    expect(screen.getByRole("columnheader", { name: "Plays" })).toBeInTheDocument();
  });
});

describe("a Track whose download failed", () => {
  const FAILED = trackOf(4, "Night Drive", { download_failed: true, site: "bilibili" });

  it("says so where a Track that can't play says why, and still plays", async () => {
    const { actions } = renderTable([FAILED]);

    expect(screen.getByText(/Download failed/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Night Drive" }));

    expect(actions.onPlay).toHaveBeenCalledOnce();
  });

  it("offers to add the file", async () => {
    const { actions } = renderTable([FAILED]);

    await userEvent.click(screen.getByRole("button", { name: "Add the file…" }));

    expect(actions.onAddFile).toHaveBeenCalledExactlyOnceWith(FAILED);
  });

  it("says nothing of a Track whose download did not fail", () => {
    renderTable();

    expect(screen.queryByText(/Download failed/)).toBeNull();
  });
});

/**
 * Five songs for filtering and grouping:
 *
 * ```text
 * 1 Colorful Days  朴树         生如夏花   2003  pop; rock   4 stars
 * 2 生如夏花        朴树         生如夏花   2003  pop         favorite
 * 3 Let Down       Radiohead    OK Computer 1997 alternative rock; britpop  5 stars
 * 4 Airbag         Radiohead    OK Computer 1997 alternative rock  can't play
 * 5 New Song       周杰伦        (none)      —    —
 * ```
 */
const LIBRARY = [
  trackOf(1, "Colorful Days", {
    artist: "朴树",
    album: "生如夏花",
    year: 2003,
    genre: "pop; rock",
    rating: 4,
  }),
  trackOf(2, "生如夏花", {
    artist: "朴树",
    album: "生如夏花",
    year: 2003,
    genre: "pop",
    favorite: true,
  }),
  trackOf(3, "Let Down", {
    artist: "Radiohead",
    album: "OK Computer",
    year: 1997,
    genre: "alternative rock; britpop",
    rating: 5,
  }),
  trackOf(4, "Airbag", {
    artist: "Radiohead",
    album: "OK Computer",
    year: 1997,
    genre: "alternative rock",
    availability: "missing",
  }),
  trackOf(5, "New Song", { artist: "周杰伦", album: "" }),
];

const shownTitles = () =>
  screen
    .getAllByRole("button")
    .filter((button) => button.classList.contains("title"))
    .map((button) => button.textContent);

async function openFilters() {
  await userEvent.click(screen.getByText("Filter"));
  return screen.getByRole("group", { name: "Filters" });
}

describe("filtering", () => {
  it("keeps one artist's songs, and says how many of all are shown", async () => {
    renderTable(LIBRARY);
    const filters = await openFilters();

    await userEvent.selectOptions(within(filters).getByLabelText("Artist"), "Radiohead");

    expect(shownTitles()).toEqual(["Let Down", "Airbag"]);
    expect(screen.getByText("2 of 5 songs")).toBeInTheDocument();
  });

  it("offers only the albums the other filters leave, each with how many songs it has", async () => {
    renderTable(LIBRARY);
    const filters = await openFilters();

    await userEvent.selectOptions(within(filters).getByLabelText("Artist"), "朴树");

    const albums = within(within(filters).getByLabelText("Album")).getAllByRole("option");
    expect(albums.map((option) => option.textContent)).toEqual(["Any album", "生如夏花 (2)"]);
  });

  it("keeps the songs with a genre among any of their genres", async () => {
    renderTable(LIBRARY);
    const filters = await openFilters();

    await userEvent.selectOptions(within(filters).getByLabelText("Genre"), "rock");

    expect(shownTitles()).toEqual(["Colorful Days"]);
  });

  it("keeps the songs of one year", async () => {
    renderTable(LIBRARY);
    const filters = await openFilters();

    await userEvent.selectOptions(within(filters).getByLabelText("Year"), "1997");

    expect(shownTitles()).toEqual(["Let Down", "Airbag"]);
  });

  it("keeps the songs rated at least the stars chosen, or the unrated ones", async () => {
    renderTable(LIBRARY);
    const filters = await openFilters();
    const rating = within(filters).getByLabelText("Rating");

    await userEvent.selectOptions(rating, "At least 4 stars");
    const rated = shownTitles();
    await userEvent.selectOptions(rating, "Unrated");

    expect(rated).toEqual(["Colorful Days", "Let Down"]);
    expect(shownTitles()).toEqual(["生如夏花", "Airbag", "New Song"]);
  });

  it("keeps only favorites, or only the songs that play now", async () => {
    renderTable(LIBRARY);
    const filters = await openFilters();

    await userEvent.click(within(filters).getByLabelText("Favorites only"));
    const favorites = shownTitles();
    await userEvent.click(within(filters).getByLabelText("Favorites only"));
    await userEvent.click(within(filters).getByLabelText("Only songs that play now"));

    expect(favorites).toEqual(["生如夏花"]);
    expect(shownTitles()).toEqual(["Colorful Days", "生如夏花", "Let Down", "New Song"]);
  });

  it("shows each filter on as one to remove, and clears them all", async () => {
    renderTable(LIBRARY);
    const filters = await openFilters();
    await userEvent.selectOptions(within(filters).getByLabelText("Artist"), "Radiohead");
    await userEvent.click(within(filters).getByLabelText("Favorites only"));
    expect(screen.getByText("0 of 5 songs")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove the filter Favorites only" }));
    const afterOne = shownTitles();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(afterOne).toEqual(["Let Down", "Airbag"]);
    expect(shownTitles()).toHaveLength(5);
    expect(screen.queryByText(/of 5 songs/u)).not.toBeInTheDocument();
  });

  it("plays from the songs the filters leave", async () => {
    const { actions } = renderTable(LIBRARY);
    const filters = await openFilters();
    await userEvent.selectOptions(within(filters).getByLabelText("Artist"), "Radiohead");

    await userEvent.click(screen.getByRole("button", { name: "Play all" }));

    expect(actions.onPlayAll).toHaveBeenCalledWith([LIBRARY[2]], false);
  });
});

describe("grouping", () => {
  it("puts each album's songs under a row naming the album, its artist, and its count", async () => {
    renderTable(LIBRARY);

    await userEvent.selectOptions(screen.getByLabelText("Group by"), "Album");

    const groups = screen.getAllByRole("button", { expanded: true });
    expect(groups.map((group) => group.textContent)).toEqual([
      "生如夏花 · 朴树 · 2 songs",
      "OK Computer · Radiohead · 2 songs",
      "No album · 周杰伦 · 1 song",
    ]);
    expect(shownTitles()).toEqual(["Colorful Days", "生如夏花", "Let Down", "Airbag", "New Song"]);
  });

  it("folds a group away, and opens it again", async () => {
    renderTable(LIBRARY);
    await userEvent.selectOptions(screen.getByLabelText("Group by"), "Artist");

    await userEvent.click(screen.getByRole("button", { name: /^Radiohead · 2 songs/u }));
    const folded = shownTitles();
    await userEvent.click(screen.getByRole("button", { name: /^Radiohead · 2 songs/u }));

    expect(folded).toEqual(["Colorful Days", "生如夏花", "New Song"]);
    expect(shownTitles()).toHaveLength(5);
  });

  it("plays a song of a group with the songs shown, in their order", async () => {
    const { actions } = renderTable(LIBRARY);
    await userEvent.selectOptions(screen.getByLabelText("Group by"), "Year");

    await userEvent.click(screen.getByRole("button", { name: "Let Down" }));

    const [shown, index] = vi.mocked(actions.onPlay).mock.calls[0] ?? [];
    expect(shown?.map((track) => track.id)).toEqual([1, 2, 3, 4, 5]);
    expect(index).toBe(2);
  });

  it("groups the songs a filter leaves", async () => {
    renderTable(LIBRARY);
    const filters = await openFilters();
    await userEvent.click(within(filters).getByLabelText("Only songs that play now"));

    await userEvent.selectOptions(screen.getByLabelText("Group by"), "Album");

    expect(screen.getByRole("button", { name: "OK Computer · Radiohead · 1 song" })).toBeVisible();
  });
});
