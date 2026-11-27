import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CommunityRating, DownloadUnderWay, Track } from "../api";
import type { CoverStatus } from "../library/lookups";
import { albumUnit, songsByFile } from "../library/playOrder";
import type { UnitOf } from "../player/usePlayer";
import { downloadOf, downloadUnderWayOf, serve, trackOf } from "../testing/server";
import { LanguageSelect } from "./LanguageSelect";
import { type TrackActions, TrackTable } from "./TrackTable";

/** Intro, a Long Road that can't play, and Outro, listed in that order, as the server adds them. */
const TRACKS = [
  trackOf(1, "Intro", { duration_ms: 61_000 }),
  trackOf(2, "Long Road", { availability: "missing", duration_ms: 600_000 }),
  trackOf(3, "Outro", { duration_ms: 90_000, rating: 4, favorite: true }),
];

function renderTable(
  tracks: readonly Track[] = TRACKS,
  playingId?: number,
  statuses: ReadonlyMap<number, CoverStatus> = new Map(),
  songsIn?: ReadonlyMap<number, readonly Track[]>,
  focus?: { readonly id: number; readonly onFocused: () => void },
  downloads: readonly DownloadUnderWay[] = [],
  playAllIn?: HTMLElement | null,
) {
  const actions: TrackActions = {
    statusOf: (track) => statuses.get(track.id),
    downloadOf: (track) => downloads.find((each) => each.track_id === track.id),
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
    onSetKind: vi.fn(),
    onFavorite: vi.fn(),
    onRate: vi.fn(),
  };
  const view = render(
    <TrackTable
      tracks={tracks}
      playingId={playingId}
      actions={actions}
      empty={<p>No music yet.</p>}
      songsIn={songsIn}
      focus={focus?.id}
      onFocused={focus?.onFocused}
      playAllIn={playAllIn}
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

  it("shows the Track playing on its cover, leaving its title where it was", () => {
    renderTable(TRACKS, 3);

    const outro = screen.getByRole("row", { name: /Outro/u });
    expect(within(outro).getByRole("img", { name: "Playing" })).toHaveClass("cover-badge");
  });

  it("shows a lookup on the Track's cover while it runs, and why it failed", () => {
    renderTable(
      TRACKS,
      3,
      new Map([
        [1, { kind: "looking", label: "Looking up on MusicBrainz" }],
        [3, { kind: "failed", label: "Looking up on MusicBrainz failed: No answer." }],
      ]),
    );

    const intro = screen.getByRole("row", { name: /Intro/u });
    const outro = screen.getByRole("row", { name: /Outro/u });
    const failed = within(outro).getByRole("img", {
      name: "Looking up on MusicBrainz failed: No answer.",
    });
    expect(within(intro).getByRole("img", { name: "Looking up on MusicBrainz" })).toHaveAttribute(
      "title",
      "Looking up on MusicBrainz",
    );
    expect(failed).toHaveAttribute("title", "Looking up on MusicBrainz failed: No answer.");
    expect(within(outro).queryByRole("img", { name: "Playing" })).toBeNull();
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

  it("puts Play and Shuffle in the place given, playing the Tracks the table shows", async () => {
    const place = document.createElement("div");
    document.body.append(place);
    const actions = renderTable(
      TRACKS,
      undefined,
      new Map(),
      undefined,
      undefined,
      [],
      place,
    ).actions;
    const title = screen.getByRole("button", { name: "Title" });
    await userEvent.click(title);
    await userEvent.click(title);

    await userEvent.click(within(place).getByRole("button", { name: "Play all" }));

    expect(actions.onPlayAll).toHaveBeenCalledExactlyOnceWith([TRACKS[2], TRACKS[0]], false);
    expect(within(place).getByRole("button", { name: "Shuffle all" })).toBeVisible();
    place.remove();
  });

  it("shows no Play or Shuffle until the place given for them is there", () => {
    renderTable(TRACKS, undefined, new Map(), undefined, undefined, [], null);

    expect(screen.queryByRole("button", { name: "Play all" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Title" })).toBeVisible();
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

describe("what listeners elsewhere rated", () => {
  /** What MusicBrainz's listeners rated a song: 3.7, from 24 votes. */
  const HEARD: CommunityRating = {
    source: "musicbrainz",
    of: "song",
    rating: 3.7,
    votes: 24,
    link: "https://musicbrainz.org/recording/47b02a82",
  };
  /** Night Drive, which you haven't rated, and which MusicBrainz's listeners have. */
  const NIGHT_DRIVE = trackOf(5, "Night Drive", { community: HEARD });
  const stars = () => within(screen.getByRole("group", { name: "Rate Night Drive" }));
  const parts = () =>
    stars()
      .getAllByRole("button")
      .map((star) => star.dataset.community);

  it("shows a song you haven't rated in grey stars to the nearest half", () => {
    renderTable([NIGHT_DRIVE]);

    expect(parts()).toEqual(["full", "full", "full", "half", "none"]);
  });

  it("says who rated it, how highly, and how many voted", () => {
    renderTable([NIGHT_DRIVE]);

    const group = screen.getByRole("group", { name: "Rate Night Drive" });
    expect(group).toHaveAccessibleDescription("MusicBrainz: 3.7 from 24 votes");
    expect(group).toHaveAttribute("title", "MusicBrainz: 3.7 from 24 votes");
  });

  it("says when the rating is the album's, as too few rated the song", () => {
    const album = { ...HEARD, of: "album" as const, rating: 4.55, votes: 89 };
    renderTable([{ ...NIGHT_DRIVE, community: album }]);

    expect(screen.getByRole("group", { name: "Rate Night Drive" })).toHaveAccessibleDescription(
      "MusicBrainz, the album: 4.6 from 89 votes",
    );
  });

  it("shows your own rating instead, once you rate the song", () => {
    renderTable([{ ...NIGHT_DRIVE, rating: 2 }]);

    expect(parts()).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(screen.getByRole("group", { name: "Rate Night Drive" })).not.toHaveAttribute("title");
  });

  it("rates the song yourself when a star is chosen", async () => {
    const { actions } = renderTable([NIGHT_DRIVE]);

    await userEvent.click(stars().getByRole("button", { name: "5 stars" }));

    expect(actions.onRate).toHaveBeenCalledWith(NIGHT_DRIVE, 5);
  });

  it("sorts by your own rating, and the songs you haven't rated by what listeners did", async () => {
    const rated = (id: number, title: string, rating: number) =>
      trackOf(id, title, { community: { ...HEARD, rating } });
    renderTable([
      rated(1, "Low", 2),
      trackOf(2, "Yours", { rating: 1 }),
      trackOf(3, "Nobody's"),
      rated(4, "High", 4.5),
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Rating" }));

    expect(titles()).toEqual(["Nobody's", "Low", "High", "Yours"]);
  });
});

describe("your rating of a song's album", () => {
  /** Night Drive, which you haven't rated, on an album you rated 4 stars. */
  const NIGHT_DRIVE = trackOf(5, "Night Drive", { album_rating: 4 });
  const group = () => screen.getByRole("group", { name: "Rate Night Drive" });
  const filled = () =>
    within(group())
      .getAllByRole("button")
      .map((star) => star.dataset.fromAlbum === "true");

  it("shows a song you haven't rated in solid stars, saying they are its album's", () => {
    renderTable([NIGHT_DRIVE]);

    expect(filled()).toEqual([true, true, true, true, false]);
    expect(group()).toHaveAccessibleDescription("From your album rating: 4 stars");
    expect(group()).toHaveAttribute("title", "From your album rating: 4 stars");
  });

  it("comes before what listeners elsewhere rated it", () => {
    const heard = { source: "musicbrainz", of: "song", rating: 2, votes: 9, link: "" } as const;
    renderTable([{ ...NIGHT_DRIVE, community: heard }]);

    expect(
      within(group())
        .getAllByRole("button")
        .map((star) => star.dataset.community),
    ).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(group()).toHaveAccessibleDescription("From your album rating: 4 stars");
  });

  it("gives way to your own rating of the song", () => {
    renderTable([{ ...NIGHT_DRIVE, rating: 2 }]);

    expect(filled()).toEqual([false, false, false, false, false]);
    expect(group()).not.toHaveAttribute("title");
  });

  it("rates the song alone when a star is chosen, even the album's own", async () => {
    const { actions } = renderTable([NIGHT_DRIVE]);

    await userEvent.click(within(group()).getByRole("button", { name: "4 stars" }));

    expect(actions.onRate).toHaveBeenCalledWith(NIGHT_DRIVE, 4);
  });

  it("sorts a song you haven't rated by its album's rating, as your own", async () => {
    renderTable([
      trackOf(1, "Yours", { rating: 3 }),
      trackOf(2, "Album's", { album_rating: 5 }),
      trackOf(3, "Nobody's"),
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Rating" }));

    expect(titles()).toEqual(["Nobody's", "Yours", "Album's"]);
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

describe("a Track downloading", () => {
  /** Night Drive, just added from Bilibili, its file not downloaded yet. */
  const ADDED = trackOf(4, "Night Drive", { availability: "unavailable", site: "bilibili" });
  const downloading = (job: Partial<DownloadUnderWay["job"]>) =>
    renderTable([ADDED], undefined, new Map(), undefined, undefined, [downloadUnderWayOf(4, job)]);

  /** What the row says of the Download in place of why it can't play, as heard and as seen. */
  const said = (row: HTMLElement) => {
    const words = row.querySelector(".why");
    const heard = [...(words?.children ?? [])]
      .filter((part) => part.getAttribute("aria-hidden") !== "true")
      .map((part) => part.textContent)
      .join("");
    return { heard, hover: words?.getAttribute("title") };
  };

  it("says how far it has got where a Track that can't play says why, its cover spinning", () => {
    downloading({ state: "running", progress: { fraction: 0.42, message: "" } });

    const row = rowOf(screen.getByRole("button", { name: "Night Drive" }));
    expect(said(row)).toEqual({ heard: "Downloading 42%", hover: "Downloading 42%" });
    expect(row.querySelector(".download-note-label")).toHaveTextContent("42%");
    expect(row).not.toHaveTextContent("Unavailable");
    expect(within(row).getByRole("img", { name: "Downloading 42%" })).toHaveClass("looking");
  });

  it("says it is preparing before transfer progress arrives", () => {
    downloading({ state: "running" });

    const row = rowOf(screen.getByRole("button", { name: "Night Drive" }));
    expect(said(row)).toEqual({ heard: "Preparing download", hover: "Preparing download" });
  });

  it("says it is queued to download, with a clock on its cover", () => {
    downloading({ state: "queued" });

    const row = rowOf(screen.getByRole("button", { name: "Night Drive" }));
    expect(said(row)).toEqual({
      heard: "Queued",
      hover: "Queued to download",
    });
    expect(within(row).getByRole("img", { name: "Queued to download" })).toHaveClass("waiting");
  });

  it("says it waits for Online while medleyplay is Offline", () => {
    downloading({ state: "waiting", waits_for_online: true });

    const row = rowOf(screen.getByRole("button", { name: "Night Drive" }));
    expect(said(row)).toEqual({
      heard: "Waiting for Online",
      hover: "Downloading once medleyplay is Online",
    });
    expect(
      within(row).getByRole("img", { name: "Downloading once medleyplay is Online" }),
    ).toHaveClass("waiting");
  });
});

describe("a Track whose download failed", () => {
  const FAILED = trackOf(4, "Night Drive", { download_failed: true, site: "bilibili" });

  it("says so where a Track that can't play says why, and still plays", async () => {
    const { actions } = renderTable([FAILED]);

    expect(screen.getByRole("button", { name: /^Download failed/ })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Night Drive" }));

    expect(actions.onPlay).toHaveBeenCalledOnce();
  });

  /** Open what *Download failed* holds, the server saying the Download failed as `message`. */
  const openWhy = async (message = "Bilibili refused the login.") => {
    const { calls } = serve({
      "GET /api/tracks/4/download": { body: downloadOf(4, "failed", message) },
      "POST /api/jobs/504/retry": { body: { id: 505, state: "queued", failure_message: "" } },
    });
    const { actions } = renderTable([FAILED]);
    await userEvent.click(
      screen.getByRole("button", { name: "Download failed: why, and what to do, for Night Drive" }),
    );
    await screen.findByText(message);
    return { actions, calls };
  };

  it("says why it failed when opened", async () => {
    await openWhy("Bilibili refused the login.");

    expect(screen.getByRole("menu")).toHaveTextContent("Bilibili refused the login.");
  });

  it("offers to add the file", async () => {
    const { actions } = await openWhy();

    await userEvent.click(screen.getByRole("menuitem", { name: "Add the file…" }));

    expect(actions.onAddFile).toHaveBeenCalledExactlyOnceWith(FAILED);
  });

  it("retries the Job that failed, closing once the server takes it", async () => {
    const { calls } = await openWhy();

    await userEvent.click(screen.getByRole("menuitem", { name: "Retry download" }));

    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
    expect(calls).toContain("POST /api/jobs/504/retry");
  });

  it("translates the retry refusal without closing the menu", async () => {
    const detail = "Only the Account that asked for a Job, or an admin, can change it.";
    serve({
      "GET /api/tracks/4/download": { body: downloadOf(4, "failed", "Refused.") },
      "POST /api/jobs/504/retry": {
        status: 403,
        body: { detail },
      },
    });
    render(<LanguageSelect />);
    renderTable([FAILED]);
    await userEvent.click(
      screen.getByRole("button", { name: "Download failed: why, and what to do, for Night Drive" }),
    );
    await screen.findByText("Refused.");

    await userEvent.click(screen.getByRole("menuitem", { name: "Retry download" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(detail);
    const language = screen.getByRole("combobox", { name: "Language" });
    try {
      fireEvent.change(language, { target: { value: "zh-Hans" } });

      expect(screen.getByRole("alert")).toHaveTextContent(
        "只有发起此任务的账号或管理员可以更改它。",
      );
      expect(screen.getByRole("menu")).toBeInTheDocument();
    } finally {
      fireEvent.change(language, { target: { value: "auto" } });
    }
  });

  it("cannot retry an old job if the next status read fails", async () => {
    let read = 0;
    serve({
      "GET /api/tracks/4/download": () =>
        ++read === 1
          ? { body: downloadOf(4, "failed", "Earlier failure.") }
          : { status: 503, body: { detail: "Try again later." } },
    });
    renderTable([FAILED]);
    const trigger = screen.getByRole("button", { name: /^Download failed/u });
    await userEvent.click(trigger);
    await screen.findByText("Earlier failure.");

    await userEvent.keyboard("{Escape}");
    await userEvent.click(trigger);

    expect(await screen.findByRole("alert")).toHaveTextContent("Try again later.");
    expect(screen.queryByText("Reading why it failed…")).not.toBeInTheDocument();
    expect(screen.queryByText("Earlier failure.")).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Retry download" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("cannot retry an active download returned by the new status read", async () => {
    serve({
      "GET /api/tracks/4/download": {
        body: { ...downloadOf(4, "downloading", ""), job_id: 505 },
      },
    });
    renderTable([FAILED]);

    await userEvent.click(screen.getByRole("button", { name: /^Download failed/u }));

    expect(await screen.findByText("This download is already in progress.")).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Retry download" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("says nothing of a Track whose download did not fail", () => {
    renderTable();

    expect(screen.queryByRole("button", { name: /^Download failed/ })).toBeNull();
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
  it("translates filter labels without translating the selected artist or changing the results", async () => {
    renderTable([
      trackOf(1, "First", { artist: "Search" }),
      trackOf(2, "Second", { artist: "Other artist" }),
    ]);
    render(<LanguageSelect />);
    const filters = await openFilters();
    const user = userEvent.setup();
    await user.selectOptions(within(filters).getByLabelText("Artist"), "Search");
    const language = screen.getByRole("combobox", { name: "Language" });

    try {
      await user.selectOptions(language, "zh-Hans");

      const translated = within(screen.getByRole("group", { name: "筛选条件" }));
      expect(translated.getByLabelText("艺人")).toHaveValue("Search");
      expect(translated.getByRole("option", { name: "Search（1）" })).toBeInTheDocument();
      expect(shownTitles()).toEqual(["First"]);
      await user.click(screen.getByRole("button", { name: "移除筛选条件：艺人：Search" }));

      expect(screen.getByRole("status")).toHaveTextContent("已移除筛选条件。");
      expect(shownTitles()).toEqual(["First", "Second"]);
    } finally {
      await user.selectOptions(language, "auto");
    }
  });

  it("shows the rows before building the choices for the closed Filter", async () => {
    renderTable(LIBRARY);
    const filter = screen.getByText("Filter");

    expect(shownTitles()).toHaveLength(5);
    expect(screen.queryByText("Radiohead (2)")).not.toBeInTheDocument();

    await userEvent.click(filter);

    const filters = await screen.findByRole("group", { name: "Filters" });
    expect(within(filters).getByRole("option", { name: "Radiohead (2)" })).toBeInTheDocument();
  });

  it("keeps the selected artist and updates album counts when Filter reopens", async () => {
    const { actions, rerender } = renderTable(LIBRARY);
    const filters = await openFilters();
    await userEvent.selectOptions(within(filters).getByLabelText("Artist"), "Radiohead");
    await userEvent.click(screen.getByLabelText("Filter, 1 on"));

    rerender(
      <TrackTable
        tracks={[
          ...LIBRARY,
          trackOf(6, "Climbing Up the Walls", {
            artist: "Radiohead",
            album: "OK Computer",
          }),
        ]}
        playingId={undefined}
        actions={actions}
        empty={<p>No music yet.</p>}
      />,
    );
    await userEvent.click(screen.getByLabelText("Filter, 1 on"));

    const reopened = await screen.findByRole("group", { name: "Filters" });
    expect(within(reopened).getByLabelText("Artist")).toHaveValue("Radiohead");
    expect(within(reopened).getByRole("option", { name: "OK Computer (3)" })).toBeInTheDocument();
  });

  it.each([false, true])(
    "keeps album options when playback changes (filtered: %s)",
    async (filtered) => {
      const { actions, rerender } = renderTable(LIBRARY);
      const filters = await openFilters();
      if (filtered) {
        await userEvent.selectOptions(within(filters).getByLabelText("Artist"), "Radiohead");
      }
      const album = within(filters).getByRole("option", { name: "OK Computer (2)" });

      rerender(
        <TrackTable
          tracks={LIBRARY}
          playingId={3}
          actions={actions}
          empty={<p>No music yet.</p>}
        />,
      );

      expect(within(filters).getByRole("option", { name: "OK Computer (2)" })).toBe(album);
    },
  );

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
    renderTable([...LIBRARY, trackOf(9, "Album's", { album_rating: 4 })]);
    const filters = await openFilters();
    const rating = within(filters).getByLabelText("Rating");

    await userEvent.selectOptions(rating, "At least 4 stars");
    const rated = shownTitles();
    await userEvent.selectOptions(rating, "Unrated");

    expect(rated).toEqual(["Colorful Days", "Let Down", "Album's"]);
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

/**
 * The Library's items: a song, an album in one file split into three songs, and an
 * album in one file not split, as the server lists them:
 *
 * ```text
 * 1   Melt        song
 * 9   生如夏花     album, split into 11 傲慢的上校, 12 浮游 (a favorite), 13 生如夏花
 * 20  Bremen      album
 * ```
 */
const ITEMS = [
  trackOf(1, "Melt", { album: "Re:Start" }),
  trackOf(9, "生如夏花", { album: "生如夏花", kind: "album", split: true }),
  trackOf(20, "Bremen", { album: "Bremen", kind: "album", duration_ms: 3_600_000 }),
];
const SONGS_OF_9 = [
  trackOf(11, "傲慢的上校", { album: "生如夏花", segment_of: 9, track_number: 1 }),
  trackOf(12, "浮游", { album: "生如夏花", segment_of: 9, track_number: 2, favorite: true }),
  trackOf(13, "生如夏花", { album: "生如夏花", segment_of: 9, track_number: 3 }),
];

/** Return the row `element` is in. */
function rowOf(element: HTMLElement): HTMLElement {
  const row = element.closest("tr");
  if (row === null) {
    throw new Error("The element is in no row.");
  }
  return row;
}

const renderLibrary = () => renderTable(ITEMS, undefined, new Map(), songsByFile(SONGS_OF_9));
const idsOf = (tracks: readonly Track[] | undefined) => tracks?.map((track) => track.id);

describe("the Library", () => {
  it("folds a split file's songs under it, showing them when asked", async () => {
    renderLibrary();
    const folded = shownTitles();

    await userEvent.click(screen.getByRole("button", { name: "Show the songs of 生如夏花" }));

    expect(folded).toEqual(["Melt", "生如夏花", "Bremen"]);
    expect(shownTitles()).toEqual(["Melt", "生如夏花", "傲慢的上校", "浮游", "生如夏花", "Bremen"]);
    expect(screen.getByRole("button", { name: "Hide the songs of 生如夏花" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("sets an album's songs in under it, its guide ending at the last song", async () => {
    renderLibrary();

    await userEvent.click(screen.getByRole("button", { name: "Show the songs of 生如夏花" }));

    const rows = screen.getAllByRole("button", { name: /^(傲慢的上校|浮游|生如夏花)$/ }).map(rowOf);
    expect(rows.map((row) => row.className)).toEqual(["", "child", "child", "child last-child"]);
  });

  it("marks each item a song or an album, saying when it is a guess", () => {
    renderLibrary();

    const kindOf = (title: string) =>
      within(rowOf(screen.getByRole("button", { name: title }))).getByRole("img", {
        name: /^(Song|Album)/u,
      }).title;
    expect(["Melt", "生如夏花", "Bremen"].map(kindOf)).toEqual([
      "Song, guessed from its length",
      "Album",
      "Album, guessed from its length",
    ]);
  });

  it("draws a guessed kind apart from a settled one", () => {
    renderLibrary();

    const markOf = (title: string) =>
      within(rowOf(screen.getByRole("button", { name: title }))).getByRole("img", {
        name: /^(Song|Album)/u,
      });
    expect(markOf("Bremen")).toHaveClass("guessed");
    expect(markOf("生如夏花")).not.toHaveClass("guessed");
  });

  it("keeps only albums when the Kind filter asks for albums", async () => {
    renderLibrary();

    await userEvent.click(screen.getByText("Filter"));
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Kind" }),
      screen.getByRole("option", { name: "Albums (2)" }),
    );

    expect(shownTitles()).toEqual(["生如夏花", "Bremen"]);
    expect(screen.getByRole("button", { name: "Remove the filter Albums only" })).toBeVisible();
  });

  it("counts the songs of a split file among the songs the Kind filter offers", async () => {
    renderLibrary();

    await userEvent.click(screen.getByText("Filter"));

    expect(
      within(screen.getByRole("combobox", { name: "Kind" }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Songs and albums", "Songs (4)", "Albums (2)"]);
  });

  it("uses the same counted items for both sides of a grouped Library filter", async () => {
    renderLibrary();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Group by"), "Album");
    const filters = await openFilters();

    await user.selectOptions(within(filters).getByRole("combobox", { name: "Kind" }), "song");

    expect(screen.getByRole("status")).toHaveTextContent("4 of 5 songs and albums");
  });

  it("plays the whole file when the Kind filter keeps the album", async () => {
    const { actions } = renderLibrary();
    await userEvent.click(screen.getByText("Filter"));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Kind" }), "album");

    await userEvent.click(screen.getByRole("button", { name: "生如夏花" }));

    const [shown, index] = vi.mocked(actions.onPlay).mock.calls[0] ?? [];
    expect(idsOf(shown)).toEqual([9, 20]);
    expect(index).toBe(0);
  });

  it("plays a split album as one whole file in its Library position", async () => {
    const { actions } = renderLibrary();

    await userEvent.click(screen.getByRole("button", { name: "生如夏花" }));

    const [shown, index, unitOf] = vi.mocked(actions.onPlay).mock.calls[0] ?? [];
    expect(idsOf(shown)).toEqual([1, 9, 20]);
    expect(index).toBe(1);
    expect(shown?.map((track) => unitOf?.(track))).toEqual([undefined, undefined, undefined]);
  });

  it("plays the selected child as a song without queuing the rest of its album", async () => {
    const { actions } = renderLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Show the songs of 生如夏花" }));

    await userEvent.click(screen.getByRole("button", { name: "浮游" }));

    const [shown, index, unitOf] = vi.mocked(actions.onPlay).mock.calls[0] ?? [];
    expect(idsOf(shown)).toEqual([1, 12, 20]);
    expect(index).toBe(1);
    expect(shown?.map((track) => unitOf?.(track))).toEqual([undefined, undefined, undefined]);
  });

  it("plays every item in its place, or shuffles them", async () => {
    const { actions } = renderLibrary();

    await userEvent.click(screen.getByRole("button", { name: "Shuffle all" }));

    const [shown, shuffled] = vi.mocked(actions.onPlayAll).mock.calls[0] ?? [];
    expect([idsOf(shown), shuffled]).toEqual([[1, 11, 12, 13, 20], true]);
  });

  it.each<[string, string, number[], boolean, UnitOf | undefined]>([
    ["Play", "Play by song", [1, 11, 12, 13], false, undefined],
    ["Shuffle", "Shuffle by album", [1, 11, 12, 13, 20], true, albumUnit],
  ])("from %s's menu, plays %s", async (button, choice, ids, shuffled, unit) => {
    const { actions } = renderLibrary();

    await userEvent.click(
      screen.getByRole("button", { name: `More ways to ${button.toLowerCase()}` }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: choice }));

    const [shown, shuffledAs, unitOf] = vi.mocked(actions.onPlayAll).mock.calls[0] ?? [];
    expect([idsOf(shown), shuffledAs]).toEqual([ids, shuffled]);
    expect(shown?.map((track) => unitOf?.(track))).toEqual(shown?.map((track) => unit?.(track)));
  });

  it("keeps a split file whose songs a filter keeps, with only those songs", async () => {
    const { actions } = renderLibrary();
    const filters = await openFilters();
    await userEvent.click(within(filters).getByLabelText("Favorites only"));

    await userEvent.click(screen.getByRole("button", { name: "Show the songs of 生如夏花" }));
    await userEvent.click(screen.getByRole("button", { name: "Play all" }));

    expect(shownTitles()).toEqual(["生如夏花", "浮游"]);
    expect(screen.getByText("1 of 3 songs and albums")).toBeInTheDocument();
    expect(idsOf(vi.mocked(actions.onPlayAll).mock.calls[0]?.[0])).toEqual([12]);
  });

  it("lists every song in place of its split file when grouped", async () => {
    renderLibrary();

    await userEvent.selectOptions(screen.getByLabelText("Group by"), "Album");

    expect(shownTitles()).toEqual(["Melt", "傲慢的上校", "浮游", "生如夏花", "Bremen"]);
  });
});

describe("folding all", () => {
  it("opens every split file's songs, then folds them again", async () => {
    renderLibrary();

    await userEvent.click(screen.getByRole("button", { name: "Expand all" }));
    const opened = shownTitles();
    await userEvent.click(screen.getByRole("button", { name: "Collapse all" }));

    expect(opened).toEqual(["Melt", "生如夏花", "傲慢的上校", "浮游", "生如夏花", "Bremen"]);
    expect(shownTitles()).toEqual(["Melt", "生如夏花", "Bremen"]);
  });

  it("folds every group, then opens them again", async () => {
    renderTable(LIBRARY);
    await userEvent.selectOptions(screen.getByLabelText("Group by"), "Artist");

    await userEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    const folded = shownTitles();
    await userEvent.click(screen.getByRole("button", { name: "Expand all" }));

    expect(folded).toEqual([]);
    expect(shownTitles()).toHaveLength(5);
  });

  it("keeps the last choice in this browser for the next visit", async () => {
    const first = renderLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Expand all" }));
    first.unmount();

    renderLibrary();

    expect(shownTitles()).toEqual(["Melt", "生如夏花", "傲慢的上校", "浮游", "生如夏花", "Bremen"]);
    expect(screen.getByRole("button", { name: "Collapse all" })).toBeVisible();
  });

  it("opens new groups folded once Collapse all was chosen", async () => {
    renderTable(LIBRARY);
    await userEvent.selectOptions(screen.getByLabelText("Group by"), "Artist");
    await userEvent.click(screen.getByRole("button", { name: "Collapse all" }));

    await userEvent.selectOptions(screen.getByLabelText("Group by"), "Album");

    expect(shownTitles()).toEqual([]);
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(3);
  });

  it("plays every song of the folded groups that can play, in the order shown", async () => {
    const { actions } = renderTable(LIBRARY);
    await userEvent.selectOptions(screen.getByLabelText("Group by"), "Artist");
    await userEvent.click(screen.getByRole("button", { name: "Collapse all" }));

    await userEvent.click(screen.getByRole("button", { name: "Play all" }));

    expect(vi.mocked(actions.onPlayAll).mock.calls[0]?.[0].map((track) => track.title)).toEqual([
      "Colorful Days",
      "生如夏花",
      "Let Down",
      "New Song",
    ]);
  });

  it("is not offered when nothing folds", () => {
    renderTable(LIBRARY);

    expect(screen.queryByRole("button", { name: /^(Expand|Collapse) all$/u })).toBeNull();
  });
});

describe("showing a song asked for", () => {
  it("lights the song and moves to its title, once", async () => {
    const onFocused = vi.fn();
    renderTable(LIBRARY, undefined, new Map(), undefined, { id: 3, onFocused });

    const title = screen.getByRole("button", { name: "Let Down" });

    await waitFor(() => {
      expect(title).toHaveFocus();
    });
    expect(rowOf(title)).toHaveClass("lit");
    expect(onFocused).toHaveBeenCalledOnce();
  });

  it("clears the filters that hide it", async () => {
    const onFocused = vi.fn();
    const { rerender, actions } = renderTable(LIBRARY);
    const filters = await openFilters();
    await userEvent.selectOptions(within(filters).getByLabelText("Artist"), "Radiohead");

    rerender(
      <TrackTable
        tracks={LIBRARY}
        playingId={undefined}
        actions={actions}
        empty={<p>No music yet.</p>}
        focus={5}
        onFocused={onFocused}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New Song" })).toHaveFocus();
    });
    expect(shownTitles()).toHaveLength(5);
  });

  it("opens the split file a song asked for is in", async () => {
    const onFocused = vi.fn();
    renderTable(ITEMS, undefined, new Map(), songsByFile(SONGS_OF_9), { id: 12, onFocused });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "浮游" })).toHaveFocus();
    });
    expect(rowOf(screen.getByRole("button", { name: "浮游" }))).toHaveClass("lit");
  });
});
