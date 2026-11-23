// cspell:ignore supercell ｍｅｌｔ
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Track } from "../api";
import { App } from "../App";
import { hrefOf } from "../routes";
import {
  ALICE,
  OTHER_JAY,
  type Routes,
  artistIdOf,
  artistNameOf,
  detailsOf,
  downloadUnderWayOf,
  favoritesPlaylistOf,
  knownArtistOf,
  lookupOf,
  playlistOf,
  serve,
  signedIn,
  trackOf,
  twoJaysNames,
  twoJaysSongs,
} from "../testing/server";

/**
 * A Library of three Tracks and one Playlist:
 *
 * | Title     | Artist   | Album    | Album artist | Favorite | Downloaded |
 * | --------- | -------- | -------- | ------------ | -------- | ---------- |
 * | Melt      | ryo      | Supercell |             | yes      |            |
 * | Shiver    | ryo      | Supercell |             |          | yes        |
 * | クジラ     | ルワン    | 空想      | Various     |          |            |
 *
 * The Playlist *Mornings* holds Shiver, then Melt, then Shiver again, after the
 * Favorites the server keeps.
 */
const LIBRARY = [
  trackOf(1, "Melt", { artist: "ryo", album: "Supercell", favorite: true }),
  trackOf(2, "Shiver", { artist: "ryo", album: "Supercell", downloaded: true }),
  trackOf(3, "クジラ", { artist: "ルワン", album: "空想", album_artist: "Various" }),
];

/** `LIBRARY`, with *Supercell*'s songs showing its cover, named `supercell`. */
function withCovers(): Track[] {
  return LIBRARY.map((track) =>
    track.album === "Supercell" ? { ...track, cover: "supercell" } : track,
  );
}

/** The routes of a server with the Bilibili plugin on, holding `LIBRARY`. */
function withBilibili(): Routes {
  return signedIn(LIBRARY, [favoritesPlaylistOf([1])], {
    multiple_accounts: false,
    providers: { source_resolver: ["bilibili"] },
    ai_set_up: false,
  });
}

/** What is read beside the songs: once they are in, and whenever the Library may change. */
const SIDE_READS: ReadonlySet<string> = new Set([
  "GET /api/artist-names",
  "GET /api/names-to-tidy",
  "GET /api/split-offers",
  "GET /api/artist-splits",
  "GET /api/shared-names",
  "GET /api/artist-photos/missing",
]);

function open(
  hash: string,
  routes: Routes = signedIn(LIBRARY, [
    favoritesPlaylistOf([1]),
    playlistOf("p1", "Mornings", [2, 1, 2]),
  ]),
) {
  history.replaceState(null, "", `/${hash}`);
  const served = serve(routes);
  render(<App />);
  return served;
}

const songs = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.querySelector("button.title")?.textContent);

afterEach(() => {
  history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the views", () => {
  it("opens on the Library, marked in the navigation", async () => {
    open("");

    expect(await screen.findByRole("button", { name: "Melt" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
  });

  it("lists the artists, and opens one's songs, with a way back", async () => {
    open("#/artists");

    await userEvent.click(await screen.findByRole("link", { name: /ryo/ }));

    expect(await screen.findByRole("heading", { name: "ryo" })).toBeInTheDocument();
    expect(songs()).toEqual(["Melt", "Shiver"]);
    const nav = screen.getByRole("navigation", { name: "Views" });
    expect(within(nav).getByRole("link", { name: "Artists" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await userEvent.click(within(screen.getByRole("main")).getByRole("link", { name: "Artists" }));
    expect(await screen.findByRole("heading", { name: "Artists" })).toBeInTheDocument();
  });

  it("lists each album under its album artist", async () => {
    open("#/albums");

    expect(
      await screen.findByRole("link", { name: /Supercell.*ryo, 2 songs/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /空想.*Various, 1 song/ })).toBeInTheDocument();
  });

  it("opens the row's album from the keyboard without playing the song", async () => {
    open(
      "#/library",
      signedIn([
        trackOf(1, "First Light", {
          artist: "Guest",
          album: "Goodbye & Hello",
          album_artist: "North/South",
        }),
        trackOf(2, "Last Light", { artist: "West", album: "Goodbye & Hello" }),
        trackOf(3, "Demo", { album: "" }),
        trackOf(4, "Split recording", { album: "Old title", kind: "album", split: true }),
        trackOf(5, "Part One", { album: "New title", segment_of: 4 }),
      ]),
    );
    const user = userEvent.setup();
    const first = await screen.findByRole("button", { name: "First Light" });
    const album = within(screen.getByRole("row", { name: /First Light/u })).getByRole("link", {
      name: "Goodbye & Hello",
    });
    const other = within(screen.getByRole("row", { name: /Last Light/u })).getByRole("link", {
      name: "Goodbye & Hello",
    });
    expect(other).toHaveAttribute("href", "#/album?artist=West&name=Goodbye+%26+Hello");
    expect(
      within(screen.getByRole("row", { name: /Demo/u })).queryByRole("link"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("cell", { name: "Old title" })).queryByRole("link"),
    ).not.toBeInTheDocument();

    first.focus();
    await user.tab();
    expect(album).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("heading", { name: "Goodbye & Hello" })).toBeVisible();
    expect(location.hash).toBe("#/album?artist=North%2FSouth&name=Goodbye+%26+Hello");
    expect(songs()).toEqual(["First Light"]);
    expect(screen.getByText("Nothing playing")).toBeVisible();
  });

  it("shows a song's cover in its row as a small thumbnail", async () => {
    open("", signedIn(withCovers(), [favoritesPlaylistOf([1])]));

    const melt = (await screen.findByRole("button", { name: "Melt" })).closest("tr");

    expect(melt?.querySelector(".cover img")).toHaveAttribute(
      "src",
      "/api/covers/supercell?size=small&recipe=1",
    );
  });

  it("shows an album's cover on its tile as a medium thumbnail", async () => {
    open("#/albums", signedIn(withCovers(), [favoritesPlaylistOf([1])]));

    const supercell = await screen.findByRole("link", { name: /Supercell.*ryo, 2 songs/ });

    expect(supercell.querySelector(".cover img")).toHaveAttribute(
      "src",
      "/api/covers/supercell?size=medium&recipe=1",
    );
  });

  it("plays every album whole, one after another, from Albums", async () => {
    open("#/albums");

    await userEvent.click(await screen.findByRole("button", { name: "Play every album" }));

    const queue = screen.getByRole("region", { name: "Up next" });
    expect(
      within(queue)
        .getAllByRole("listitem")
        .map((item) => item.querySelector(".entry-title")?.textContent),
    ).toEqual(["Shiver", "クジラ"]);
  });

  it("opens each view with no filters on, whatever the last view had", async () => {
    open("");
    await userEvent.click(await screen.findByText("Filter"));
    const filters = screen.getByRole("group", { name: "Filters" });
    await userEvent.selectOptions(within(filters).getByLabelText("Artist"), "ルワン");
    expect(songs()).toEqual(["クジラ"]);

    await userEvent.click(screen.getByRole("link", { name: "Downloaded" }));

    expect(await screen.findByRole("heading", { name: "Downloaded" })).toBeInTheDocument();
    expect(songs()).toEqual(["Shiver"]);
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("marks a view headed by its rail name, which a minimized rail's menu says instead", async () => {
    open("");

    const library = await screen.findByRole("heading", { name: "Library" });
    expect(library).toHaveAttribute("data-rail-named");

    open(`#/artist?name=${encodeURIComponent("ルワン")}`);

    const artist = await screen.findByRole("heading", { name: "ルワン" });
    expect(artist).not.toHaveAttribute("data-rail-named");
  });

  it("opens the Radio tab, with the Account's own station", async () => {
    open("");

    await userEvent.click(await screen.findByRole("link", { name: "Radio" }));

    expect(await screen.findByRole("heading", { name: "Radio" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play my station" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Radio" })).toHaveAttribute("aria-current", "page");
  });

  it("lists only the songs downloaded", async () => {
    open("#/downloaded");

    expect(await screen.findByRole("button", { name: "Shiver" })).toBeInTheDocument();
    expect(songs()).toEqual(["Shiver"]);
  });
});

describe("Settings search", () => {
  afterEach(() => {
    localStorage.removeItem("medleyplay.settings.folded.v1");
  });

  it("waits for Enter before opening Your ratings, and opens it again by click", async () => {
    const { calls } = open("#/library");
    const box = await screen.findByRole("combobox", { name: "Search" });
    await userEvent.click(box);
    vi.useFakeTimers();
    fireEvent.change(box, { target: { value: "settings" } });
    fireEvent.change(box, { target: { value: "settings: rating" } });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    vi.useRealTimers();

    expect(location.hash).toBe("#/library");
    expect(screen.getByRole("option", { name: "Your ratings" })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    const toggle = await screen.findByRole("button", { name: "Your ratings" });
    expect(location.hash).toBe("#/settings?section=ratings");
    expect(toggle).toHaveFocus();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    const section = screen.getByRole("region", { name: "Your ratings" });
    const scroll = vi.spyOn(section, "scrollIntoView");
    await userEvent.click(box);
    await userEvent.paste("SETTINGS: RATING");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(screen.getByRole("option", { name: "Your ratings" }));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveFocus();
    expect(scroll).toHaveBeenCalled();
    expect(calls.filter((call) => !call.startsWith("GET "))).toEqual([]);
  });

  it("matches a translated title on Settings and keeps the section ID in the URL", async () => {
    open("#/settings");
    const language = await screen.findByLabelText("Language");
    await userEvent.selectOptions(language, "zh-Hans");
    try {
      await userEvent.click(screen.getByRole("combobox", { name: "Search" }));
      await userEvent.paste("settings: 评分");
      await userEvent.click(screen.getByRole("option", { name: "我的评分" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "我的评分" })).toHaveFocus());
      expect(location.hash).toBe("#/settings?section=ratings");
    } finally {
      await userEvent.selectOptions(await screen.findByLabelText("语言"), "auto");
    }
  });

  it.each(["member", "admin"])("offers only sections visible to the %s role", async (role) => {
    open("#/albums", { ...signedIn(LIBRARY), "GET /api/me": { body: { ...ALICE, role } } });
    const box = await screen.findByRole("combobox", { name: "Search" });
    await userEvent.click(box);
    await userEvent.paste("settings:");
    expect(screen.getByRole("option", { name: "Appearance" })).toBeVisible();
    expect(Boolean(screen.queryByRole("option", { name: "Other devices" }))).toBe(role === "admin");
    await userEvent.keyboard("{ArrowDown}{ArrowUp}");
    expect(screen.getByRole("option", { selected: true })).toHaveAccessibleName("Appearance");
    await userEvent.keyboard("{Escape}{Enter}");
    expect(screen.queryByRole("listbox")).toBeNull();
    await userEvent.paste(" nowhere");
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("No matching settings.")).toBeVisible();
    expect(screen.queryByRole("option")).toBeNull();
    expect(location.hash).toBe("#/albums");
  });
});

describe("search suggestions", () => {
  it("offers the artists a search names, each to show, its songs, and its albums", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });

    await userEvent.type(screen.getByRole("combobox", { name: "Search" }), "ルワ");

    const offered = within(screen.getByRole("listbox", { name: "Suggestions" }));
    const options = offered.getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveAccessibleName("ルワン 1 song");
    expect(options[1]).toHaveAccessibleName("Songs");
    expect(options[2]).toHaveAccessibleName("Albums");
    expect(options[3]).toHaveAccessibleName("Group the Library by artist");
    expect(offered.getByRole("group", { name: "ルワン" })).toContainElement(options[2] ?? null);
  });

  it("goes to the artist chosen with the arrow keys and Enter", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });
    const box = screen.getByRole("combobox", { name: "Search" });

    await userEvent.type(box, "ルワ{ArrowDown}");
    const offered = within(screen.getByRole("listbox", { name: "Suggestions" }));
    expect(box).toHaveAttribute(
      "aria-activedescendant",
      offered.getByRole("option", { name: "ルワン 1 song" }).id,
    );
    await userEvent.keyboard("{Enter}");

    expect(await screen.findByRole("heading", { level: 2, name: "ルワン" })).toBeVisible();
    expect(box).toHaveValue("");
    expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull();
  });

  it("shows only the artist's songs in the Library, as a filter there", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });

    await userEvent.type(screen.getByRole("combobox", { name: "Search" }), "ルワ");
    await userEvent.click(screen.getByRole("option", { name: "Songs" }));

    expect(await screen.findByRole("heading", { name: "Library" })).toBeVisible();
    expect(songs()).toEqual(["クジラ"]);
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    await waitFor(() => {
      expect(location.hash).toBe("#/library");
    });
  });

  it("keeps the artist's songs by every name they are written by, as its page does", async () => {
    open(
      hrefOf({ view: "library", artist: "ryo" }),
      signedIn([
        trackOf(1, "Melt", { artist: "ryo" }),
        trackOf(2, "Shiver", { artist: "Ryo" }),
        trackOf(3, "クジラ", { artist: "ルワン" }),
      ]),
    );

    await screen.findByRole("button", { name: "Melt" });

    expect(songs()).toEqual(["Melt", "Shiver"]);
    expect(
      screen.getByRole("button", { name: "Remove the filter Artist: ryo / Ryo" }),
    ).toBeVisible();
  });

  it("shows only the albums the artist sings on, until the filter is removed", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });

    await userEvent.type(screen.getByRole("combobox", { name: "Search" }), "ルワ");
    await userEvent.click(screen.getByRole("option", { name: "Albums" }));

    const albums = await screen.findByRole("list", { name: "Albums" });
    expect(within(albums).getAllByRole("link")).toHaveLength(1);
    expect(within(albums).getByRole("link", { name: /空想/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Remove the filter Artist: ルワン" }));
    expect(
      within(await screen.findByRole("list", { name: "Albums" })).getAllByRole("link"),
    ).toHaveLength(2);
  });

  it("groups the Library by artist", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });

    await userEvent.type(screen.getByRole("combobox", { name: "Search" }), "ryo");
    await userEvent.click(screen.getByRole("option", { name: "Group the Library by artist" }));

    expect(await screen.findByLabelText("Group by")).toHaveValue("artist");
  });

  it("stays open when pressed between its choices", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });
    const box = screen.getByRole("combobox", { name: "Search" });

    await userEvent.type(box, "ルワ");
    await userEvent.click(screen.getByRole("listbox", { name: "Suggestions" }));

    expect(box).toHaveFocus();
    expect(screen.getByRole("listbox", { name: "Suggestions" })).toBeVisible();
  });

  it("closes on Escape, keeping what was typed", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });
    const box = screen.getByRole("combobox", { name: "Search" });

    await userEvent.type(box, "ryo{Escape}");

    expect(screen.queryByRole("listbox", { name: "Suggestions" })).toBeNull();
    expect(box).toHaveValue("ryo");
    expect(box).toHaveAttribute("aria-expanded", "false");
  });

  it("lists the tags on ArrowDown in an empty box, and starts the one chosen", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });
    const box = screen.getByRole("combobox", { name: "Search" });

    await userEvent.click(box);
    await userEvent.keyboard("{ArrowDown}");
    const tags = screen.getByRole("listbox", { name: "Search by" });
    await userEvent.click(within(tags).getByRole("option", { name: /^artist:/ }));

    expect(box).toHaveAccessibleDescription("Artist:");
    expect(box).toHaveFocus();
  });

  it("completes a site's name being typed, and searches it when chosen", async () => {
    open("", withBilibili());
    const box = await screen.findByRole("combobox", { name: "Search" });

    await userEvent.type(box, "bi");
    await userEvent.click(screen.getByRole("option", { name: /^bilibili:/u }));

    expect(screen.getByRole("radio", { name: "Bilibili" })).toBeChecked();
    expect(box).toHaveValue("");
    expect(box).toHaveFocus();
  });

  it("completes a tag's name being typed, keeping the words before it", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });
    const box = screen.getByRole("combobox", { name: "Search" });

    await userEvent.type(box, "melt ar");
    await userEvent.click(screen.getByRole("option", { name: /^artist:/u }));

    expect(box).toHaveAccessibleDescription("melt Artist:");
    expect(box).toHaveValue("");
  });

  it("takes the first completion on Tab", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });
    const box = screen.getByRole("combobox", { name: "Search" });

    await userEvent.type(box, "ar{Tab}");

    expect(box).toHaveAccessibleDescription("Artist:");
    expect(box).toHaveFocus();
  });

  it("offers no completion for a single letter", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });

    await userEvent.type(screen.getByRole("combobox", { name: "Search" }), "a");

    expect(screen.queryByRole("option", { name: /^artist:/u })).toBeNull();
  });

  it("offers no site to complete where only the Library can be searched", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });

    await userEvent.type(screen.getByRole("combobox", { name: "Search" }), "bi");

    expect(screen.queryByRole("option", { name: /^bilibili:/u })).toBeNull();
  });

  it("lists the tags when the pointer rests on an empty box", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });
    vi.useFakeTimers({ shouldAdvanceTime: true });

    await userEvent.hover(screen.getByRole("combobox", { name: "Search" }));
    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(screen.getByRole("listbox", { name: "Search by" })).toBeVisible();
  });
});

describe("playlists", () => {
  it("lists the server's Favorites once, first, then the Account's Playlists", async () => {
    open("#/playlists");
    await screen.findByRole("link", { name: /^Mornings/u });

    const links = within(await screen.findByRole("list", { name: "Playlists" })).getAllByRole(
      "link",
    );

    expect(links.map((link) => link.textContent)).toEqual([
      "Favorites1 song, 3 min",
      "Mornings3 songs, 9 min",
    ]);
  });

  it("makes Favorites from the hearts, and follows a heart taken away", async () => {
    open("#/playlist?id=favorites", {
      ...signedIn(LIBRARY),
      "PUT /api/tracks/1/favorite": { body: trackOf(1, "Melt", { favorite: false }) },
    });
    expect(await screen.findByRole("button", { name: "Melt" })).toBeInTheDocument();

    await userEvent.click(
      within(screen.getByRole("main")).getByRole("button", { name: "Favorite Melt" }),
    );

    expect(await screen.findByText(/No favorites yet/)).toBeInTheDocument();
  });

  it("reads nothing beside the songs again for a heart given", async () => {
    const { calls } = open("#/library", {
      ...signedIn(LIBRARY),
      "PUT /api/tracks/2/favorite": { body: trackOf(2, "Shiver", { favorite: true }) },
    });
    const sideReads = () => calls.filter((call) => SIDE_READS.has(call)).length;
    await waitFor(() => {
      expect(sideReads()).toBe(SIDE_READS.size);
    });

    await userEvent.click(
      within(screen.getByRole("main")).getByRole("button", { name: "Favorite Shiver" }),
    );
    await waitFor(() => {
      expect(calls).toContain("PUT /api/tracks/2/favorite");
    });
    await act(() => new Promise((settled) => setTimeout(settled, 500)));

    expect(sideReads()).toBe(SIDE_READS.size);
  });

  it("plays a Playlist's songs in its order, a song as often as it holds it", async () => {
    open("#/playlist?id=p1");

    expect(await screen.findByRole("heading", { name: "Mornings" })).toBeInTheDocument();
    expect(songs()).toEqual(["Shiver", "Melt", "Shiver"]);
  });
});

describe("keeping a Playlist downloaded", () => {
  it("keeps a Playlist's songs downloaded once switched on, as the server saved it", async () => {
    const sent: unknown[] = [];
    open("#/playlist?id=p1", {
      ...signedIn(LIBRARY, [favoritesPlaylistOf([1]), playlistOf("p1", "Mornings", [2, 1, 2])]),
      "PUT /api/playlists/p1/keep_downloaded": (body) => {
        sent.push(body);
        return { body: { ...playlistOf("p1", "Mornings", [2, 1, 2]), keep_downloaded: true } };
      },
    });
    const keep = await screen.findByRole("switch", { name: "Keep downloaded" });
    expect(keep).not.toBeChecked();

    await userEvent.click(keep);

    expect(sent).toEqual([{ keep_downloaded: true }]);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Keep downloaded" })).toBeChecked();
    });
  });

  it("keeps Favorites downloaded too, through the Playlist the server keeps for them", async () => {
    const favorites = favoritesPlaylistOf([1]);
    const sent: string[] = [];
    open("#/playlist?id=favorites", {
      ...signedIn(LIBRARY, [favorites]),
      [`PUT /api/playlists/${favorites.id}/keep_downloaded`]: () => {
        sent.push(favorites.id);
        return { body: { ...favorites, keep_downloaded: true } };
      },
    });

    await userEvent.click(await screen.findByRole("switch", { name: "Keep downloaded" }));

    expect(sent).toEqual([favorites.id]);
  });

  it("says why when the server refuses, and leaves the switch as it was", async () => {
    open("#/playlist?id=p1", {
      ...signedIn(LIBRARY, [favoritesPlaylistOf([1]), playlistOf("p1", "Mornings", [2, 1, 2])]),
      "PUT /api/playlists/p1/keep_downloaded": {
        status: 404,
        body: { detail: "No Playlist p1." },
      },
    });

    await userEvent.click(await screen.findByRole("switch", { name: "Keep downloaded" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No Playlist p1.");
    expect(screen.getByRole("switch", { name: "Keep downloaded" })).not.toBeChecked();
  });
});

describe("search", () => {
  it("finds songs, artists, and albums as you type, ignoring hiragana or katakana", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });

    await userEvent.type(screen.getByRole("combobox", { name: "Search" }), "くじら");

    const found = await screen.findByRole("region", { name: "Songs found" });
    expect(within(found).getByRole("button", { name: "クジラ" })).toBeInTheDocument();
    expect(location.hash).toBe(`#/search?q=${encodeURIComponent("くじら")}`);
  });

  it("turns a field typed into a tag, the words after it its value", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });
    const box = screen.getByRole("combobox", { name: "Search" });

    await userEvent.type(box, "artist:ryo");

    expect(box).toHaveAccessibleDescription("Artist:");
    expect(box).toHaveValue("ryo");
    await waitFor(() => {
      expect(location.hash).toBe(hrefOf({ view: "search", query: "artist:ryo" }));
    });
  });

  it("keeps a tag on Enter, leaving the box for plain words", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });
    const box = screen.getByRole("combobox", { name: "Search" });

    await userEvent.type(box, "artist:ryo{Enter}melt");

    expect(box).toHaveAccessibleDescription("Artist: ryo");
    expect(box).toHaveValue("melt");
    await waitFor(() => {
      expect(location.hash).toBe(hrefOf({ view: "search", query: "artist:ryo melt" }));
    });
  });

  it("chooses a tag with the first Backspace and removes it with the second", async () => {
    open(`#/search?q=${encodeURIComponent('artist:ryo album:"Super cell"')}`);
    const box = await screen.findByRole("combobox", { name: "Search" });
    expect(box).toHaveAccessibleDescription("Artist: ryo Album: Super cell");

    await userEvent.type(box, "{Backspace}");

    expect(screen.getByTitle("Press Backspace again to remove")).toHaveTextContent(
      "Album: Super cell",
    );

    await userEvent.type(box, "{Backspace}");

    expect(box).toHaveAccessibleDescription("Artist: ryo");
    await waitFor(() => {
      expect(location.hash).toBe(hrefOf({ view: "search", query: "artist:ryo" }));
    });
  });

  it("removes a tag by its own button, and clears tags and words together", async () => {
    open(`#/search?q=${encodeURIComponent("artist:ryo album:Supercell melt")}`);
    const box = await screen.findByRole("combobox", { name: "Search" });

    await userEvent.click(screen.getByRole("button", { name: "Remove Artist: ryo" }));

    expect(box).toHaveAccessibleDescription("Album: Supercell");
    expect(screen.getByText("Artist: ryo removed.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
    expect(box).toHaveValue("");
  });

  it("clears the search, tags and all, on Escape", async () => {
    open(`#/search?q=${encodeURIComponent("artist:ryo melt")}`);
    const box = await screen.findByRole("combobox", { name: "Search" });

    await userEvent.type(box, "{Escape}");

    expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
    expect(box).toHaveValue("");
  });

  it("turns tags pasted into the box into tags", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });
    const box = screen.getByRole("combobox", { name: "Search" });
    await userEvent.click(box);

    await userEvent.paste("artist:ryo melt");

    expect(box).toHaveAccessibleDescription("Artist: ryo");
    expect(box).toHaveValue("melt");
  });

  it("titles the results by the tags and words asked", async () => {
    open(`#/search?q=${encodeURIComponent('artist:"ryo" melt')}`);

    expect(
      await screen.findByRole("heading", { name: "Results for Artist: ryo, “melt”" }),
    ).toBeInTheDocument();
  });

  it("opens a search from its link, the box holding what was searched", async () => {
    open("#/search?q=supercell");

    const albums = await screen.findByRole("region", { name: "Albums found" });

    expect(within(albums).getByRole("link", { name: /Supercell/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Search" })).toHaveValue("supercell");
  });

  it("says when nothing matches", async () => {
    open("#/search?q=nowhere");

    expect(await screen.findByText(/Nothing in your Library matches/)).toBeInTheDocument();
  });

  it("offers a music site a plugin provides as a place to search, after the Library", async () => {
    open("", withBilibili());

    const scope = await screen.findByRole("radiogroup", { name: "Search in" });

    expect(within(scope).getByRole("radio", { name: "Library" })).toBeChecked();
    expect(within(scope).getByRole("radio", { name: "Bilibili" })).toBeEnabled();
  });

  it("marks each place to search by its icon, naming it on hover", async () => {
    open("", withBilibili());

    const scope = await screen.findByRole("radiogroup", { name: "Search in" });

    for (const name of ["Library", "Bilibili"]) {
      const place = within(scope).getByRole("radio", { name }).closest("label");
      expect(place).toHaveAttribute("title", name);
      expect(place?.querySelector("svg")).not.toBeNull();
    }
  });

  it("resumes a saved result from Downloaded without asking the site or adding a song", async () => {
    const saved = { id: 8, state: "succeeded", label: "Night Drive", message: "", result: null };
    const { calls } = open("#/downloaded", {
      ...signedIn([]),
      "GET /api/links/lookups": { body: [saved] },
      "GET /api/links/lookups/8": { body: { ...saved, result: lookupOf(1) } },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Choose parts" }));

    expect(await screen.findByRole("textbox", { name: "Title of part 1" })).toHaveValue(
      "Night Drive",
    );
    expect(calls).not.toContain("POST /api/links/lookups");
    expect(calls).not.toContain("POST /api/links/lookups/8");
  });

  it("shows pending and failed video lookups inline and dismisses only the selected one", async () => {
    const pending = { id: 7, state: "running", label: "Video A", message: "", result: null };
    const failed = {
      ...pending,
      id: 8,
      state: "failed",
      label: "Video B",
      message: "Not a video.",
    };
    let dismissed = false;
    const { calls } = open("#/downloaded", {
      ...signedIn([]),
      "GET /api/links/lookups": () => ({ body: dismissed ? [pending] : [pending, failed] }),
      "DELETE /api/links/lookups/8": () => {
        dismissed = true;
        return { status: 204 };
      },
    });

    const row = (await screen.findByText("Video B")).closest("li");
    if (!row) throw new Error("Expected the failed lookup in a list item.");
    expect(within(row).getByText("Not a video.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Choose parts" })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText("Video B")).not.toBeInTheDocument());
    expect(screen.getByText("Video A")).toBeVisible();
    expect(calls).toContain("DELETE /api/links/lookups/8");
  });

  it("takes a link or a code with Bilibili chosen, and opens the add dialog on Enter", async () => {
    const { calls } = open("", {
      ...withBilibili(),
      "POST /api/links/lookups": { body: { id: 8, state: "queued", result: null } },
      "GET /api/links/lookups": { body: [{ id: 8, state: "succeeded", result: null }] },
      "GET /api/links/lookups/8": { body: { id: 8, state: "succeeded", result: lookupOf(1) } },
    });
    await userEvent.click(await screen.findByRole("radio", { name: "Bilibili" }));

    await userEvent.type(screen.getByRole("combobox", { name: "Search" }), "BV1Xx41117Tz{Enter}");

    expect(await screen.findByText("【MV】Night Drive")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Add from Bilibili" })).toContainElement(
      screen.getByText("【MV】Night Drive"),
    );
    expect(calls.filter((call) => call === "POST /api/links/lookups")).toHaveLength(1);
    expect(location.hash).toBe("");
    expect(screen.getByRole("combobox", { name: "Search" })).toHaveValue("");
  });

  it("opens the add dialog the moment Enter is pressed, saying it looks the video up", async () => {
    // The site never answers, so all the dialog can show is that it asked.
    open("", {
      ...withBilibili(),
      "POST /api/links/lookups": { after: new Promise(() => undefined) },
    });
    await userEvent.click(await screen.findByRole("radio", { name: "Bilibili" }));

    await userEvent.type(screen.getByRole("combobox", { name: "Search" }), "BV1Xx41117Tz{Enter}");

    const dialog = screen.getByRole("dialog", { name: "Add from Bilibili" });
    expect(within(dialog).getByText("Looking the video up…")).toBeVisible();
  });

  it("adds what is chosen, says so, and asks for the Tracks again", async () => {
    const { calls } = open("", {
      ...withBilibili(),
      "POST /api/links/lookups": { body: { id: 8, state: "succeeded", result: lookupOf(1) } },
      "POST /api/links/lookups/8": { body: [{ part: 1, track_id: 9, source_id: 90, job: null }] },
    });
    await userEvent.click(await screen.findByRole("radio", { name: "Bilibili" }));
    await userEvent.type(screen.getByRole("combobox", { name: "Search" }), "BV1Xx41117Tz{Enter}");
    await screen.findByText("【MV】Night Drive");
    const dialog = screen.getByRole("dialog", { name: "Add from Bilibili" });

    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Added 1 song. They are downloading.")).toBeVisible();
    expect(calls.filter((call) => call === "GET /api/tracks")).toHaveLength(2);
    // The Downloads are read again, so the songs added show downloading at once.
    expect(calls.filter((call) => call === "GET /api/downloads")).toHaveLength(2);
  });

  it("does not search the Library as you type with Bilibili chosen", async () => {
    open("", withBilibili());
    await userEvent.click(await screen.findByRole("radio", { name: "Bilibili" }));

    await userEvent.type(screen.getByRole("combobox", { name: "Search" }), "melt");
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(location.hash).not.toContain("search");
  });

  it("switches to Bilibili when bilibili: is typed, keeping what follows it", async () => {
    open("", withBilibili());
    const box = await screen.findByRole("combobox", { name: "Search" });

    await userEvent.type(box, "bilibili:BV1Xx");

    const scope = screen.getByRole("radiogroup", { name: "Search in" });
    expect(within(scope).getByRole("radio", { name: "Bilibili" })).toBeChecked();
    expect(box).toHaveValue("BV1Xx");
    expect(box).toHaveAttribute("placeholder", "Paste a Bilibili link or a BV or av code");
  });

  it("lists bilibili: among the tags to search by", async () => {
    open("", withBilibili());
    const box = await screen.findByRole("combobox", { name: "Search" });
    await userEvent.click(box);

    await userEvent.keyboard("{ArrowDown}");

    const listed = screen.getByRole("listbox", { name: "Search by" });
    await userEvent.click(within(listed).getByRole("option", { name: /^bilibili:/u }));
    expect(screen.getByRole("radio", { name: "Bilibili" })).toBeChecked();
  });

  it("goes back to the Library on Backspace in an empty box with Bilibili chosen", async () => {
    open("", withBilibili());
    await userEvent.click(await screen.findByRole("radio", { name: "Bilibili" }));
    const box = screen.getByRole("combobox", { name: "Search" });

    await userEvent.type(box, "{Backspace}");

    expect(screen.getByRole("radio", { name: "Library" })).toBeChecked();
  });

  it("keeps a bilibili: typed as a word where only the Library can be searched", async () => {
    open("");
    const box = await screen.findByRole("combobox", { name: "Search" });

    await userEvent.type(box, "bilibili:melt");

    expect(box).toHaveValue("bilibili:melt");
  });

  it("offers no choice of where to search when only the Library can be", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });

    expect(screen.queryByRole("radiogroup", { name: "Search in" })).toBeNull();
  });
});

/** The favorites a server holding `LIBRARY` answers with, after any change to them. */
function withFavorites(favorites: {
  readonly artists?: readonly string[];
  readonly albums?: readonly (readonly [string, string])[];
}): Routes {
  const read = {
    artists: (favorites.artists ?? []).map((name) => ({ id: artistIdOf(name) })),
    albums: (favorites.albums ?? []).map(([artist, name]) => ({ artist, name })),
  };
  return {
    ...signedIn(LIBRARY),
    "GET /api/favorites": { body: read },
    // Each artist of the Library, favorited by its id.
    ...Object.fromEntries(
      [...new Set(LIBRARY.flatMap((track) => track.artist_ids))].map((id) => [
        `PUT /api/favorites/artists/${id}`,
        (body: unknown) => {
          const { favorite } = body as { favorite: boolean };
          return { body: { ...read, artists: favorite ? [...read.artists, { id }] : [] } };
        },
      ]),
    ),
    "PUT /api/albums/favorite": (body) => {
      const { artist, name, favorite } = body as {
        artist: string;
        name: string;
        favorite: boolean;
      };
      return { body: { ...read, albums: favorite ? [...read.albums, { artist, name }] : [] } };
    },
  };
}

describe("an artist's page", () => {
  /**
   * The routes of `LIBRARY` with *ryo* linked to the composer MusicBrainz knows, or not,
   * shown as `shownAs` when the household chose a name for it, with `photo` its photo's cover.
   */
  const withRyo = (
    linked: boolean,
    shownAs: string | null = null,
    photo: string | null = null,
  ): Routes => ({
    ...signedIn(LIBRARY, [favoritesPlaylistOf([1])]),
    "GET /api/artist-names": {
      body: {
        names: [linked ? artistNameOf("ryo", "ryo-id") : artistNameOf("ryo")],
        artists: [
          knownArtistOf("ryo-id", "ryo", {
            sort_name: "ryo",
            disambiguation: "supercell composer",
            country: "JP",
            aliases: [{ name: "supercell", locale: null, primary: false }],
            shown_as: shownAs,
            photo,
          }),
        ],
      },
    },
  });

  it("says who a linked artist is, and links it to MusicBrainz", async () => {
    open("#/artist?name=ryo", withRyo(true));

    const about = await screen.findByRole("region", { name: "About the artist" });
    expect(await within(about).findByText("ryo (supercell composer, JP)")).toBeInTheDocument();
    expect(within(about).getByRole("link", { name: "MusicBrainz" })).toHaveAttribute(
      "href",
      "https://musicbrainz.org/artist/ryo-id",
    );
  });

  it("offers to link an artist name not linked yet", async () => {
    open("#/artist?name=ryo", withRyo(false));

    const about = await screen.findByRole("region", { name: "About the artist" });
    expect(await within(about).findByRole("link", { name: "Link it to an artist" })).toBeVisible();
    expect(within(about).queryByRole("link", { name: "MusicBrainz" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit details" })).toBeNull();
  });

  it("is named as the household chose, and edits the linked artist", async () => {
    open("#/artist?name=ryo", withRyo(true, "supercell"));

    expect(await screen.findByRole("heading", { level: 2, name: "supercell" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Edit details" }));

    expect(screen.getByRole("dialog", { name: "Edit artist" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: /Shown as/u })).toHaveValue("supercell");
  });

  it("shows a linked artist's photo on its Artists tile, and an initial on one without", async () => {
    open("#/artists", withRyo(true, null, "ryo-photo"));

    const ryo = await screen.findByRole("link", { name: /ryo/u });
    await waitFor(() => {
      expect(ryo.querySelector(".avatar img")).toHaveAttribute(
        "src",
        "/api/covers/ryo-photo?size=medium&recipe=1",
      );
    });
    const unlinked = screen.getByRole("link", { name: /ルワン/u });
    expect(unlinked.querySelector(".avatar img")).toBeNull();
    expect(unlinked.querySelector(".avatar")).toHaveTextContent("ル");
  });

  it("shows a linked artist's photo beside it among the search's suggestions", async () => {
    open("", withRyo(true, null, "ryo-photo"));
    await screen.findByRole("button", { name: "Melt" });

    await userEvent.type(screen.getByRole("combobox", { name: "Search" }), "ryo");

    const ryo = await screen.findByRole("option", { name: "ryo 2 songs" });
    // The artist names, which hold the photo, are read once the page is idle.
    await waitFor(() => {
      expect(ryo.querySelector("img")).toHaveAttribute(
        "src",
        "/api/covers/ryo-photo?size=small&recipe=1",
      );
    });
  });

  it("opens by the id of the Library's artist, headed by the name its songs write", async () => {
    open(`#/artist?id=${artistIdOf("ryo")}`, withRyo(false));

    expect(await screen.findByRole("heading", { level: 2, name: "ryo" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Favorite artist ryo" })).toBeInTheDocument();
  });

  it("still opens by the name alone, as links made before ids do", async () => {
    open("#/artist?name=RYO", withRyo(false));

    expect(await screen.findByRole("heading", { level: 2, name: "RYO" })).toBeVisible();
  });

  it("is opened from the Artists by the name its songs write, and keeps its heart", async () => {
    open("#/artists", {
      ...withRyo(true, "Ryo the composer"),
      "GET /api/favorites": { body: { artists: [{ id: artistIdOf("ryo") }], albums: [] } },
    });

    const tile = await screen.findByRole("link", { name: /Favorite.*Ryo the composer/u });
    expect(tile).toHaveAttribute("href", `#/artist?id=${artistIdOf("ryo")}&name=ryo`);
    await userEvent.click(tile);

    expect(
      await screen.findByRole("heading", { level: 2, name: "Ryo the composer" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Favorite artist Ryo the composer" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

describe("two artists of one name", () => {
  /** A Library with a song by each artist called Jay. */
  const twoJays = (): Routes => ({
    ...signedIn(twoJaysSongs(), [favoritesPlaylistOf([])]),
    "GET /api/artist-names": { body: twoJaysNames() },
  });

  it("are listed apart among the artists, each by the album its songs are on", async () => {
    open("#/artists", twoJays());

    const other = await screen.findByRole("link", { name: /Jay.*on Blue Night/u });
    expect(other).toHaveAttribute("href", `#/artist?id=${OTHER_JAY}&name=Jay`);
    expect(screen.getByRole("link", { name: /Jay.*on Jay/u })).toHaveAttribute(
      "href",
      `#/artist?id=${artistIdOf("Jay")}&name=Jay`,
    );
  });

  it("each open a page of their own songs", async () => {
    open(`#/artist?id=${OTHER_JAY}&name=Jay`, twoJays());

    expect(await screen.findByRole("heading", { level: 2, name: "Jay" })).toBeVisible();
    await waitFor(() => {
      expect(songs()).toEqual(["Blue Night"]);
    });
  });

  it("are asked between when a link names only the name, the one it named first first", async () => {
    open("#/artist?name=Jay", twoJays());

    expect(await screen.findByRole("heading", { level: 2, name: "Which Jay?" })).toBeVisible();
    const choices = within(screen.getByRole("list", { name: "Artists called Jay" }));
    expect(choices.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      `#/artist?id=${artistIdOf("Jay")}&name=Jay`,
      `#/artist?id=${OTHER_JAY}&name=Jay`,
    ]);
  });

  it("open the page of the one chosen", async () => {
    open("#/artist?name=Jay", twoJays());

    await userEvent.click(await screen.findByRole("link", { name: /Jay.*on Blue Night/u }));

    expect(await screen.findByRole("heading", { level: 2, name: "Jay" })).toBeVisible();
    await waitFor(() => {
      expect(songs()).toEqual(["Blue Night"]);
    });
  });
});

describe("favorite artists and albums", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("favorites an artist from its heading, and marks it among the artists", async () => {
    const { calls } = open("#/artist?name=ryo", withFavorites({}));

    await userEvent.click(await screen.findByRole("button", { name: "Favorite artist ryo" }));

    expect(screen.getByRole("button", { name: "Favorite artist ryo" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(calls).toContain(`PUT /api/favorites/artists/${artistIdOf("ryo")}`);
    await userEvent.click(within(screen.getByRole("main")).getByRole("link", { name: "Artists" }));
    expect(await screen.findByRole("link", { name: /Favorite.*ryo/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ルワン/ })).not.toHaveAccessibleName(/Favorite/);
  });

  it("shows an album the server keeps as a favorite, and takes its heart back", async () => {
    open("#/albums", withFavorites({ albums: [["ryo", "Supercell"]] }));

    await userEvent.click(await screen.findByRole("link", { name: /Favorite.*Supercell/ }));
    const heart = await screen.findByRole("button", { name: "Favorite album Supercell" });
    await userEvent.click(heart);

    expect(heart).toHaveAttribute("aria-pressed", "false");
  });

  it("suggests favoriting an artist whose songs the Account loves, once", async () => {
    const loved = LIBRARY.map((track) => ({ ...track, favorite: track.artist === "ryo" }));
    const routes = { ...withFavorites({}), "GET /api/tracks": { body: loved } };
    open("#/artist?name=ryo", routes);

    expect(await screen.findByText("2 songs you love")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Favorite artist ryo" })).toHaveAccessibleDescription(
      "2 songs you love",
    );
    cleanup();
    open("#/artist?name=ryo", routes);

    expect(
      await screen.findByRole("button", { name: "Favorite artist ryo" }),
    ).toHaveAccessibleDescription("Add “ryo” to favorites");
    expect(screen.queryByText("2 songs you love")).not.toBeInTheDocument();
  });

  it("offers no heart for an album with no name", async () => {
    const unnamed = [trackOf(1, "Demo", { artist: "ryo", album: "" })];
    open("#/album?artist=ryo&name=", {
      ...withFavorites({}),
      "GET /api/tracks": { body: unnamed },
    });

    const heading = await screen.findByRole("heading", { name: "Unknown album" });

    const header = heading.closest("header") ?? document.body;
    expect(within(header).queryByRole("button", { name: /^Favorite/ })).not.toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Edit details" })).toBeVisible();
  });
});

describe("a file split into songs", () => {
  /** *Bremen*, split into one song so far, and Melt; a Playlist holds the file whole. */
  const SPLIT = [
    trackOf(104, "Bremen", { split: true, duration_ms: 600_000 }),
    trackOf(154, "Intro", { segment_of: 104, duration_ms: 180_000 }),
    trackOf(1, "Melt"),
  ];
  const routes = () => signedIn(SPLIT, [playlistOf("p1", "Whole", [104, 1])]);

  it("is an item of the Library, its songs folded under it", async () => {
    open("", routes());

    await userEvent.click(await screen.findByRole("button", { name: "Show the songs of Bremen" }));

    expect(songs()).toEqual(["Bremen", "Intro", "Melt"]);
  });

  it("gives way to its songs among an artist's songs", async () => {
    open("#/artist?name=The%20Band", routes());

    expect(await screen.findByRole("button", { name: "Intro" })).toBeInTheDocument();
    expect(songs()).toEqual(["Intro", "Melt"]);
  });

  it("still plays whole in a Playlist that held it before it was split", async () => {
    open("#/playlists", routes());
    await screen.findByRole("link", { name: /^Whole/u });

    const links = within(await screen.findByRole("list", { name: "Playlists" })).getAllByRole(
      "link",
    );
    expect(links.map((link) => link.textContent)).toContain("Whole2 songs, 13 min");
  });
});

describe("an album's page", () => {
  it("links its artist to the artist's page", async () => {
    open(hrefOf({ view: "album", artist: "ryo", name: "Supercell" }));
    const heading = await screen.findByRole("heading", { level: 2, name: "Supercell" });

    await userEvent.click(
      within(heading.closest("header") ?? document.body).getByRole("link", { name: "ryo" }),
    );

    expect(await screen.findByRole("heading", { level: 2, name: "ryo" })).toBeVisible();
  });
});

describe("an album's page header", () => {
  /** *Supercell* by ryo: Melt and Shiver from 2009, Bless from 2010. */
  const SUPERCELL = [
    trackOf(1, "Melt", { artist: "ryo", album: "Supercell", year: 2009, duration_ms: 300_000 }),
    trackOf(2, "Shiver", { artist: "ryo", album: "Supercell", year: 2009, duration_ms: 240_000 }),
    trackOf(3, "Bless", { artist: "ryo", album: "Supercell", year: 2010, duration_ms: 360_000 }),
  ];
  const header = async () => {
    const heading = await screen.findByRole("heading", { level: 2, name: "Supercell" });
    return within(heading.closest("header") ?? document.body);
  };

  it("names its year under its artist, the year most of its songs give", async () => {
    open(hrefOf({ view: "album", artist: "ryo", name: "Supercell" }), signedIn(SUPERCELL));

    expect((await header()).getByText("2009")).toBeVisible();
  });

  it("names no year when none of its songs gives one", async () => {
    open(hrefOf({ view: "album", artist: "ryo", name: "Supercell" }));

    expect((await header()).queryByText(/^\d{4}$/u)).not.toBeInTheDocument();
  });

  it("plays the album from Play in its header", async () => {
    open(hrefOf({ view: "album", artist: "ryo", name: "Supercell" }), signedIn(SUPERCELL));

    await userEvent.click((await header()).getByRole("button", { name: "Play all" }));

    const queue = screen.getByRole("region", { name: "Up next" });
    expect(
      within(queue)
        .getAllByRole("listitem")
        .map((item) => item.querySelector(".entry-title")?.textContent),
    ).toEqual(["Shiver", "Bless"]);
  });

  it("says how many songs it holds and how long they last under its songs, not its title", async () => {
    open(hrefOf({ view: "album", artist: "ryo", name: "Supercell" }), signedIn(SUPERCELL));

    expect((await header()).queryByText("3 songs, 15 min")).not.toBeInTheDocument();
    const length = screen.getByText("3 songs, 15 min");
    expect(
      screen.getByRole("table").compareDocumentPosition(length) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("editing an album from its page", () => {
  it("sets what is typed on every song of an album of songs of their own", async () => {
    const sent: unknown[] = [];
    open(hrefOf({ view: "album", artist: "ryo", name: "Supercell" }), {
      ...signedIn(LIBRARY),
      "POST /api/tracks/details": (body) => {
        sent.push(body);
        return { body: { changed: 2 } };
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Edit details" }));
    const editor = await screen.findByRole("dialog", { name: "Edit album" });
    await userEvent.type(within(editor).getByRole("textbox", { name: "Genre" }), "J-Pop");
    await userEvent.click(within(editor).getByRole("button", { name: "Save" }));

    expect(sent).toEqual([{ track_ids: [1, 2], values: { genre: "J-Pop" } }]);
  });

  it("uploads a cover to the first song, then gives every song that cover", async () => {
    const sent: unknown[] = [];
    const { calls } = open(hrefOf({ view: "album", artist: "ryo", name: "Supercell" }), {
      ...signedIn(LIBRARY),
      "PUT /api/tracks/1/cover": { body: detailsOf(1, { cover: "cover-up" }) },
      "POST /api/tracks/details": (body) => {
        sent.push(body);
        return { body: { changed: 2 } };
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Edit details" }));
    const album = within(await screen.findByRole("dialog", { name: "Edit album" }));
    await userEvent.click(album.getByRole("button", { name: "Add a cover…" }));
    const editor = within(await screen.findByRole("dialog", { name: "Add a cover" }));

    await userEvent.upload(
      editor.getByLabelText("Choose a cover file"),
      new File(["png"], "Supercell.png", { type: "image/png" }),
    );
    await userEvent.click(await editor.findByRole("button", { name: "Use this cover" }));

    await waitFor(() => {
      expect(sent).toEqual([{ track_ids: [1, 2], values: { cover: "cover-up" } }]);
    });
    expect(calls).toContain("PUT /api/tracks/1/cover");
  });

  it("uploads a cover from the album's own cover, giving every song that cover", async () => {
    const sent: unknown[] = [];
    open(hrefOf({ view: "album", artist: "ryo", name: "Supercell" }), {
      ...signedIn(LIBRARY),
      "PUT /api/tracks/1/cover": { body: detailsOf(1, { cover: "cover-up" }) },
      "POST /api/tracks/details": (body) => {
        sent.push(body);
        return { body: { changed: 2 } };
      },
    });
    const about = within(await screen.findByRole("region", { name: "About the album" }));
    await userEvent.click(about.getByRole("button", { name: "Add a cover…" }));
    const editor = within(await screen.findByRole("dialog", { name: "Add a cover" }));

    await userEvent.upload(
      editor.getByLabelText("Choose a cover file"),
      new File(["png"], "Supercell.png", { type: "image/png" }),
    );
    await userEvent.click(await editor.findByRole("button", { name: "Use this cover" }));

    await waitFor(() => {
      expect(sent).toEqual([{ track_ids: [1, 2], values: { cover: "cover-up" } }]);
    });
  });

  it("gives a cover from the page of an album that is one split file to that file", async () => {
    const sent: unknown[] = [];
    const jay = [
      trackOf(9, "Jay", { artist: "周杰伦", album: "Jay", kind: "album", split: true }),
      trackOf(11, "可爱女人", { artist: "周杰伦", album: "Jay", segment_of: 9 }),
      trackOf(12, "完美主义", { artist: "周杰伦", album: "Jay", segment_of: 9 }),
    ];
    open(hrefOf({ view: "album", artist: "周杰伦", name: "Jay" }), {
      ...signedIn(jay),
      "PUT /api/tracks/9/cover": { body: detailsOf(9, { cover: "jay-cover" }) },
      "POST /api/tracks/details": (body) => {
        sent.push(body);
        return { body: { changed: 1 } };
      },
    });
    const about = within(await screen.findByRole("region", { name: "About the album" }));
    await userEvent.click(about.getByRole("button", { name: "Add a cover…" }));
    const editor = within(await screen.findByRole("dialog", { name: "Add a cover" }));

    await userEvent.upload(
      editor.getByLabelText("Choose a cover file"),
      new File(["png"], "Jay.png", { type: "image/png" }),
    );
    await userEvent.click(await editor.findByRole("button", { name: "Use this cover" }));

    await waitFor(() => {
      expect(sent).toEqual([{ track_ids: [9], values: { cover: "jay-cover" } }]);
    });
  });

  it("edits an album that is one split file as that file, in Edit details", async () => {
    const jay = [
      trackOf(9, "Jay", { artist: "周杰伦", album: "Jay", kind: "album", split: true }),
      trackOf(11, "可爱女人", { artist: "周杰伦", album: "Jay", segment_of: 9 }),
      trackOf(12, "完美主义", { artist: "周杰伦", album: "Jay", segment_of: 9 }),
    ];
    open(hrefOf({ view: "album", artist: "周杰伦", name: "Jay" }), {
      ...signedIn(jay),
      "GET /api/tracks/9/details": { body: detailsOf(9) },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Edit details" }));

    const editor = await screen.findByRole("dialog", { name: "Edit details" });
    expect(within(editor).queryByRole("button", { name: /^Save to/ })).not.toBeInTheDocument();
  });

  it("goes back from a song's Edit songs to that song's own details, its lyrics a click away", async () => {
    const jay = [
      trackOf(9, "Jay", { artist: "周杰伦", album: "Jay", kind: "album", split: true }),
      trackOf(11, "可爱女人", { artist: "周杰伦", album: "Jay", segment_of: 9 }),
      trackOf(12, "完美主义", { artist: "周杰伦", album: "Jay", segment_of: 9 }),
    ];
    open(hrefOf({ view: "album", artist: "周杰伦", name: "Jay" }), {
      ...signedIn(jay),
      "GET /api/tracks/9/details": { body: detailsOf(9) },
      "GET /api/tracks/11/details": { body: detailsOf(11) },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "More actions for 可爱女人" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit songs…" }));
    const editor = await screen.findByRole("dialog");
    const back = await within(editor).findByRole("button", { name: "Details" });

    await user.click(back);

    expect(await within(editor).findByRole("button", { name: "Lyrics" })).toBeVisible();
  });
});

describe("showing a song in the Library", () => {
  it("moves to the song asked for, and leaves it out of the address once shown", async () => {
    open("#/library?focus=3");

    const title = await screen.findByRole("button", { name: "クジラ" });

    await waitFor(() => {
      expect(title).toHaveFocus();
    });
    expect(location.hash).toBe("#/library");
  });
});

describe("the Downloaded view", () => {
  /**
   * `LIBRARY` with Night Drive downloading, 42% done, Mixtape waiting for Online, and
   * Long Road downloading with no word yet of how far.
   */
  function downloading(): Routes {
    return {
      ...signedIn([
        ...LIBRARY,
        trackOf(4, "Night Drive", { artist: "Blue Room" }),
        trackOf(5, "Mixtape", { artist: "Blue Room" }),
        trackOf(6, "Long Road", { artist: "Blue Room" }),
      ]),
      "GET /api/downloads": {
        body: [
          downloadUnderWayOf(4, { state: "running", progress: { fraction: 0.42, message: "" } }),
          downloadUnderWayOf(5, { waits_for_online: true }),
          downloadUnderWayOf(6, { state: "running" }),
        ],
      },
    };
  }

  it("shows the songs downloading above those downloaded, each with how far it has got", async () => {
    open(hrefOf({ view: "downloaded" }), downloading());

    const under = await screen.findByRole("region", { name: "Downloading" });

    const rows = within(under).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Night DriveBlue Room42%",
      "MixtapeBlue RoomWaiting for Online",
      "Long RoadBlue RoomDownloading",
    ]);
    expect(within(under).getByRole("progressbar", { name: "Night Drive" })).toHaveAttribute(
      "value",
      "0.42",
    );
    expect(within(under).getByRole("progressbar", { name: "Mixtape" })).toHaveAttribute(
      "value",
      "0",
    );
    expect(within(under).getByRole("progressbar", { name: "Long Road" })).not.toHaveAttribute(
      "value",
    );
    expect(songs()).toEqual(["Shiver"]);
  });

  it("keeps a song whose download failed among the songs, to try again", async () => {
    open(hrefOf({ view: "downloaded" }), {
      ...downloading(),
      ...signedIn([...LIBRARY, trackOf(7, "Lost Signal", { download_failed: true })]),
    });

    expect(await screen.findByRole("button", { name: "Lost Signal" })).toBeVisible();
    expect(songs()).toEqual(["Shiver", "Lost Signal"]);
  });

  it("shows no Downloading section while nothing downloads", async () => {
    open(hrefOf({ view: "downloaded" }));

    expect(await screen.findByRole("heading", { name: "Downloaded" })).toBeInTheDocument();

    expect(screen.queryByRole("region", { name: "Downloading" })).not.toBeInTheDocument();
  });
});

describe("cleaning up", () => {
  it("renames a name only a split file writes on that file, which its songs follow", async () => {
    const sent: unknown[] = [];
    open("#/clean-up", {
      ...signedIn([
        trackOf(14, "郊游", { artist: "蛙池乐队", album_artist: "蛙池乐队", split: true }),
        trackOf(588, "郊游", { artist: "蛙池", album_artist: "蛙池", segment_of: 14 }),
      ]),
      "GET /api/artist-names": {
        body: {
          names: [
            { ...artistNameOf("蛙池乐队"), looked_at: "2026-11-15T12:00:00Z" },
            artistNameOf("蛙池"),
          ],
          artists: [],
        },
      },
      "POST /api/tracks/details": (body) => {
        sent.push(body);
        return { body: { changed: 1 } };
      },
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "Show the songs of 蛙池乐队 by 蛙池" }),
    );

    expect(sent).toEqual([
      { track_ids: [14], values: { artist: "蛙池" } },
      { track_ids: [14], values: { album_artist: "蛙池" } },
    ]);
  });
});
