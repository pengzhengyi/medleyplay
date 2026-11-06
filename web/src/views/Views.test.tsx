// cspell:ignore supercell ｍｅｌｔ
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import {
  type Routes,
  favoritesPlaylistOf,
  lookupOf,
  playlistOf,
  serve,
  signedIn,
  trackOf,
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

/** The routes of a server with the Bilibili plugin on, holding `LIBRARY`. */
function withBilibili(): Routes {
  return signedIn(LIBRARY, [favoritesPlaylistOf([1])], {
    multiple_accounts: false,
    providers: { source_resolver: ["bilibili"] },
  });
}

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
    .map((row) => within(row).getAllByRole("button")[1]?.textContent);

afterEach(() => {
  history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the views", () => {
  it("opens on Songs, marked in the navigation", async () => {
    open("");

    expect(await screen.findByRole("button", { name: "Melt" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Songs" })).toHaveAttribute("aria-current", "page");
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

describe("playlists", () => {
  it("lists the server's Favorites once, first, then the Account's Playlists", async () => {
    open("#/playlists");

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

  it("plays a Playlist's songs in its order, a song as often as it holds it", async () => {
    open("#/playlist?id=p1");

    expect(await screen.findByRole("heading", { name: "Mornings" })).toBeInTheDocument();
    expect(songs()).toEqual(["Shiver", "Melt", "Shiver"]);
  });
});

describe("search", () => {
  it("finds songs, artists, and albums as you type, ignoring hiragana or katakana", async () => {
    open("");
    await screen.findByRole("button", { name: "Melt" });

    await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "くじら");

    const found = await screen.findByRole("region", { name: "Songs found" });
    expect(within(found).getByRole("button", { name: "クジラ" })).toBeInTheDocument();
    expect(location.hash).toBe(`#/search?q=${encodeURIComponent("くじら")}`);
  });

  it("opens a search from its link, the box holding what was searched", async () => {
    open("#/search?q=supercell");

    const albums = await screen.findByRole("region", { name: "Albums found" });

    expect(within(albums).getByRole("link", { name: /Supercell/ })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("supercell");
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

  it("takes a link or a code with Bilibili chosen, and opens the add dialog on Enter", async () => {
    const { calls } = open("", {
      ...withBilibili(),
      "POST /api/links/lookup": { body: lookupOf(1) },
    });
    await userEvent.click(await screen.findByRole("radio", { name: "Bilibili" }));

    await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "BV1Xx41117Tz{Enter}");

    const dialog = await screen.findByRole("dialog", { name: "Add from Bilibili" });
    expect(await within(dialog).findByText("【MV】Night Drive")).toBeVisible();
    expect(calls).toContain("POST /api/links/lookup");
    expect(location.hash).toBe("");
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("");
  });

  it("adds what is chosen, says so, and asks for the Tracks again", async () => {
    const { calls } = open("", {
      ...withBilibili(),
      "POST /api/links/lookup": { body: lookupOf(1) },
      "POST /api/links": { body: [{ part: 1, track_id: 9, source_id: 90, job: null }] },
    });
    await userEvent.click(await screen.findByRole("radio", { name: "Bilibili" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "BV1Xx41117Tz{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Add from Bilibili" });
    await within(dialog).findByText("【MV】Night Drive");

    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Added 1 song. They are downloading.")).toBeVisible();
    expect(calls.filter((call) => call === "GET /api/tracks")).toHaveLength(2);
  });

  it("does not search the Library as you type with Bilibili chosen", async () => {
    open("", withBilibili());
    await userEvent.click(await screen.findByRole("radio", { name: "Bilibili" }));

    await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "melt");
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(location.hash).not.toContain("search");
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
    artists: (favorites.artists ?? []).map((name) => ({ name })),
    albums: (favorites.albums ?? []).map(([artist, name]) => ({ artist, name })),
  };
  return {
    ...signedIn(LIBRARY),
    "GET /api/favorites": { body: read },
    "PUT /api/artists/favorite": (body) => {
      const { name, favorite } = body as { name: string; favorite: boolean };
      return { body: { ...read, artists: favorite ? [...read.artists, { name }] : [] } };
    },
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
    expect(calls).toContain("PUT /api/artists/favorite");
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
    ).toHaveAccessibleDescription("Not a favorite");
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
    expect(within(header).queryByRole("button")).not.toBeInTheDocument();
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

  it("gives way to its songs among the Library's songs", async () => {
    open("", routes());

    expect(await screen.findByRole("button", { name: "Intro" })).toBeInTheDocument();
    expect(songs()).toEqual(["Intro", "Melt"]);
  });

  it("still plays whole in a Playlist that held it before it was split", async () => {
    open("#/playlists", routes());

    const links = within(await screen.findByRole("list", { name: "Playlists" })).getAllByRole(
      "link",
    );
    expect(links.map((link) => link.textContent)).toContain("Whole2 songs, 13 min");
  });
});
