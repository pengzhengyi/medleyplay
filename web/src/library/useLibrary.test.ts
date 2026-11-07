import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import { PAGE_ID } from "../page";
import {
  detailsOf,
  downloadOf,
  favoritesPlaylistOf,
  playlistOf,
  serve,
  signedIn,
  speakerStateOf,
  trackOf,
} from "../testing/server";
import { FakeEventSource, stream } from "../testing/events";
import { FakeUploads } from "../testing/uploads";
import { useLibrary } from "./useLibrary";

/** How many times the page asked for the Tracks. */
const asked = (calls: readonly string[]) =>
  calls.filter((call) => call === "GET /api/tracks").length;

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  FakeEventSource.last = undefined;
});

describe("the Library", () => {
  it("asks for the Tracks again when the event stream reconnects, not when it first opens", async () => {
    const { calls } = serve(signedIn([trackOf(1, "Intro")]));
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    act(() => {
      stream().send("ready");
    });
    expect(asked(calls)).toBe(1);
    act(() => {
      stream().send("ready");
    });

    await waitFor(() => {
      expect(asked(calls)).toBe(2);
    });
  });

  it("asks for the Tracks once, a moment after the last scan or Download to finish", async () => {
    const { calls } = serve(signedIn([trackOf(1, "Intro")]));
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    vi.useFakeTimers();

    act(() => {
      stream().send("job", { id: 1, kind: "scan_library", state: "running" });
      stream().send("job", { id: 1, kind: "scan_library", state: "succeeded" });
      stream().send("job", { id: 2, kind: "download_source", state: "failed" });
      stream().send("job", { id: 3, kind: "cache_source", state: "succeeded" });
    });
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(asked(calls)).toBe(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(asked(calls)).toBe(2);
  });

  it("closes the event stream when the page goes", async () => {
    serve(signedIn([]));
    const { result, unmount } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    unmount();

    expect(stream().closed).toBe(true);
  });

  it("puts a refused favorite back, saying why", async () => {
    serve({
      ...signedIn([trackOf(1, "Intro")]),
      "PUT /api/tracks/1/favorite": { status: 404, body: { detail: "No Track has the id 1." } },
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    act(() => {
      result.current.setFavorite(1, true);
    });
    expect(result.current.tracks.get(1)?.favorite).toBe(true);

    await waitFor(() => {
      expect(result.current.error).toBe("No Track has the id 1.");
    });
    expect(result.current.tracks.get(1)?.favorite).toBe(false);
  });
});

describe("remote play", () => {
  it("names this page on the event stream", () => {
    serve(signedIn([]));

    renderHook(() => useLibrary(vi.fn()));

    expect(stream().url).toBe(`/api/events?page=${PAGE_ID}`);
  });

  it("knows the computer playing for the Account, and when it reported by this page's clock", () => {
    serve(signedIn([]));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 10, 8, 20, 0, 3));
    const { result } = renderHook(() => useLibrary(vi.fn()));

    act(() => {
      stream().send("remote", { page: "host-page-0001", state: speakerStateOf(), age_ms: 3000 });
    });

    expect(result.current.speaker).toEqual({
      page: "host-page-0001",
      state: speakerStateOf(),
      reportedAt: Date.UTC(2026, 10, 8, 20, 0, 0),
    });
  });

  it("forgets the computer once it stops playing for the Account", () => {
    serve(signedIn([]));
    const { result } = renderHook(() => useLibrary(vi.fn()));
    act(() => {
      stream().send("remote", { page: "host-page-0001", state: speakerStateOf(), age_ms: 0 });
    });

    act(() => {
      stream().send("remote", { page: null, state: null, age_ms: null });
    });

    expect(result.current.speaker).toBeNull();
  });

  it("tells each command for this page to whoever listens, until they stop", () => {
    serve(signedIn([]));
    const { result } = renderHook(() => useLibrary(vi.fn()));
    const heard = vi.fn();
    const stop = result.current.onCommand(heard);

    act(() => {
      stream().send("command", { kind: "next" });
    });
    stop();
    act(() => {
      stream().send("command", { kind: "pause" });
    });

    expect(heard.mock.calls).toEqual([[{ kind: "next" }]]);
  });
});

describe("adding a song to Playlists", () => {
  /** Mornings holds Intro; Car is kept downloaded and holds nothing yet. */
  const MORNINGS = playlistOf("p1", "Mornings", [1]);
  const CAR = { ...playlistOf("p2", "Car", []), keep_downloaded: true };

  async function libraryWith(routes: Parameters<typeof serve>[0]) {
    const sent: { path: string; body: unknown }[] = [];
    const answer = (path: string) => (body: unknown) => {
      sent.push({ path, body });
      const playlist = body as { name: string; track_ids: number[]; keep_downloaded: boolean };
      return {
        body: {
          ...playlistOf(path.split("/").at(-1) ?? "", playlist.name, playlist.track_ids),
          keep_downloaded: playlist.keep_downloaded,
        },
      };
    };
    serve({
      ...signedIn(
        [trackOf(1, "Intro"), trackOf(2, "Outro")],
        [favoritesPlaylistOf(), MORNINGS, CAR],
      ),
      "PUT /api/playlists/p1": answer("/api/playlists/p1"),
      "PUT /api/playlists/p2": answer("/api/playlists/p2"),
      ...routes,
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(result.current.playlists).toHaveLength(3);
    });
    return { result, sent };
  }

  it("puts each Playlist chosen with the song at its end, keeping its Keep downloaded", async () => {
    const { result, sent } = await libraryWith({});

    await act(() => result.current.addToPlaylists(trackOf(2, "Outro"), ["p1", "p2"], []));

    expect(sent).toEqual([
      {
        path: "/api/playlists/p1",
        body: { name: "Mornings", track_ids: [1, 2], keep_downloaded: false },
      },
      { path: "/api/playlists/p2", body: { name: "Car", track_ids: [2], keep_downloaded: true } },
    ]);
    expect(result.current.playlists.map((playlist) => playlist.track_ids)).toEqual([
      [],
      [2],
      [1, 2],
    ]);
  });

  it("makes each new Playlist named, holding just the song, listed by name", async () => {
    const created: unknown[] = [];
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(0) });
    const { result } = await libraryWith({
      "PUT /api/playlists/00000000-0000-4000-8000-000000000000": (body: unknown) => {
        created.push(body);
        return { body: playlistOf("00000000-0000-4000-8000-000000000000", "Beach", [2]) };
      },
    });

    await act(() => result.current.addToPlaylists(trackOf(2, "Outro"), [], ["Beach"]));

    expect(created).toEqual([{ name: "Beach", track_ids: [2], keep_downloaded: false }]);
    expect(result.current.playlists.map((playlist) => playlist.name)).toEqual([
      "Favorites",
      "Beach",
      "Car",
      "Mornings",
    ]);
  });

  it("keeps the Playlists the server saved when another is refused, and says why", async () => {
    const { result } = await libraryWith({
      "PUT /api/playlists/p2": {
        status: 409,
        body: { detail: "The Playlist id p2 is already in use." },
      },
    });

    let refused: unknown;
    await act(async () => {
      await result.current
        .addToPlaylists(trackOf(2, "Outro"), ["p1", "p2"], [])
        .catch((failure: unknown) => {
          refused = failure;
        });
    });

    expect(String(refused)).toContain("already in use");

    expect(result.current.playlists.find((playlist) => playlist.id === "p1")?.track_ids).toEqual([
      1, 2,
    ]);
  });
});

describe("saving a song's details", () => {
  async function libraryOf(routes: Parameters<typeof serve>[0]) {
    serve({ ...signedIn([trackOf(7, "BV1dm4y1s7ak")]), ...routes });
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    return result;
  }

  it("sends only the changes, then shows the Track as the server now has it", async () => {
    const sent: unknown[] = [];
    const result = await libraryOf({
      "POST /api/tracks/details": (body: unknown) => {
        sent.push(body);
        return { body: { changed: 1 } };
      },
      "GET /api/tracks/7": { body: trackOf(7, "ケビョウニンゲン", { year: 2014 }) },
    });

    await act(() => result.current.saveDetails(7, { title: "ケビョウニンゲン", genre: null }));

    expect(sent).toEqual([{ track_ids: [7], values: { title: "ケビョウニンゲン", genre: null } }]);
    await waitFor(() => {
      expect(result.current.tracks.get(7)).toMatchObject({ title: "ケビョウニンゲン", year: 2014 });
    });
  });

  it("counts the changes saved when the Track can't be read back at once", async () => {
    const result = await libraryOf({
      "POST /api/tracks/details": { body: { changed: 1 } },
      "GET /api/tracks/7": { status: 503, body: { detail: "Busy." } },
    });

    await act(() => result.current.saveDetails(7, { year: 2014 }));

    expect(result.current.error).toBe("");
  });

  it("shows the last save's read-back when an earlier one answers after it", async () => {
    const result = await libraryOf({ "POST /api/tracks/details": { body: { changed: 1 } } });
    const answers: ((track: ReturnType<typeof trackOf>) => void)[] = [];
    vi.spyOn(api, "track").mockImplementation(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );

    await act(() => result.current.saveDetails(7, { title: "Sick Human" }));
    await act(() => result.current.saveDetails(7, { title: "ケビョウニンゲン" }));
    act(() => {
      answers[1]?.(trackOf(7, "ケビョウニンゲン"));
    });
    await act(async () => {
      answers[0]?.(trackOf(7, "Sick Human"));
      await Promise.resolve();
    });

    expect(result.current.tracks.get(7)?.title).toBe("ケビョウニンゲン");
  });

  it("reads a pasted video's text, then shows the Track as the server now has it", async () => {
    const sent: unknown[] = [];
    const result = await libraryOf({
      "POST /api/tracks/7/video-text": (body: unknown) => {
        sent.push(body);
        return { body: { details: detailsOf(7), songs: [] } };
      },
      "GET /api/tracks/7": { body: trackOf(7, "ケビョウニンゲン") },
    });

    await act(() =>
      result.current.readVideoText(7, { title: "ケビョウニンゲン / wowaka", description: "" }),
    );

    expect(sent).toEqual([{ title: "ケビョウニンゲン / wowaka", description: "" }]);
    await waitFor(() => {
      expect(result.current.tracks.get(7)?.title).toBe("ケビョウニンゲン");
    });
  });

  it("shows a split file's songs as the server now has them once the file's album changes", async () => {
    const before = [
      trackOf(7, "BV1dm4y1s7ak", { split: true }),
      trackOf(8, "Opening", { segment_of: 7 }),
    ];
    const after = before.map((track) => ({ ...track, album: "Live in Osaka" }));
    let tracks = before;
    serve({
      ...signedIn(before),
      "POST /api/tracks/details": () => {
        tracks = after;
        return { body: { changed: 1 } };
      },
      "GET /api/tracks": () => ({ body: tracks }),
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    await act(() => result.current.saveDetails(7, { album: "Live in Osaka" }));

    await waitFor(() => {
      expect(result.current.tracks.get(8)?.album).toBe("Live in Osaka");
    });
  });

  it("passes on why the server refused, leaving the Track as it was", async () => {
    const result = await libraryOf({
      "POST /api/tracks/details": { status: 422, body: { detail: "year is from 1000 to 2999." } },
    });

    let refused: unknown;
    await act(async () => {
      await result.current.saveDetails(7, { year: 14 }).catch((failure: unknown) => {
        refused = failure;
      });
    });

    expect(String(refused)).toContain("year is from 1000 to 2999.");
    expect(result.current.tracks.get(7)?.title).toBe("BV1dm4y1s7ak");
  });
});

/** The enricher of Bilibili's video details, on, with the Tracks it may be asked about. */
const enricherOf = (eligible: readonly number[], change: object = {}) => ({
  body: { name: "bilibili-details", available: true, stopped: null, eligible, ...change },
});

/** The Tracks the enricher `name` may be asked about, as the library shows them. */
const findableBy = (
  library: { findable: ReadonlyMap<string, ReadonlySet<number>> },
  name: string,
) => [...(library.findable.get(name) ?? [])];

describe("finding a song's details online", () => {
  it("offers it for the Tracks the server says can be looked up, and no others", async () => {
    serve({
      ...signedIn([trackOf(1, "Intro"), trackOf(2, "Outro")]),
      "GET /api/enrichers/bilibili-details": enricherOf([2]),
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));

    await waitFor(() => {
      expect(findableBy(result.current, "bilibili-details")).toEqual([2]);
    });
  });

  it("offers it for no Track when the server can't say", async () => {
    serve(signedIn([trackOf(1, "Intro")]));
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    expect(result.current.findable.size).toBe(0);
  });

  it("asks the server to look the Track up, which then no longer offers it", async () => {
    const { calls } = serve({
      ...signedIn([trackOf(1, "Intro"), trackOf(2, "Outro")]),
      "GET /api/enrichers/bilibili-details": enricherOf([1, 2]),
      "POST /api/enrichers/bilibili-details/tracks/1": {
        body: { id: 7, state: "queued", failure_message: "" },
      },
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(findableBy(result.current, "bilibili-details")).toHaveLength(2);
    });

    await act(async () => {
      await result.current.find("bilibili-details", 1);
    });

    expect(calls).toContain("POST /api/enrichers/bilibili-details/tracks/1");
    expect(findableBy(result.current, "bilibili-details")).toEqual([2]);
  });

  it("follows the lookup's Job, so the Track says what it is doing until it is done", async () => {
    serve({
      ...signedIn([trackOf(1, "Intro")]),
      "GET /api/enrichers/musicbrainz": enricherOf([1]),
      "POST /api/enrichers/musicbrainz/tracks/1": {
        body: { id: 7, state: "queued", failure_message: "" },
      },
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(findableBy(result.current, "musicbrainz")).toEqual([1]);
    });

    await act(async () => {
      await result.current.find("musicbrainz", 1);
    });
    const asked = result.current.lookups.get(1);
    act(() => {
      stream().send("job", { id: 7, kind: "enrich_track", state: "running" });
    });
    const running = result.current.lookups.get(1);
    act(() => {
      stream().send("job", { id: 7, kind: "enrich_track", state: "succeeded" });
    });

    expect(asked).toEqual({ enricher: "musicbrainz", state: "queued", message: "" });
    expect(running?.state).toBe("running");
    expect(result.current.lookups.get(1)?.state).toBe("succeeded");
  });

  it("lets a finished lookup go after a moment", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve({
      ...signedIn([trackOf(1, "Intro")]),
      "GET /api/enrichers/musicbrainz": enricherOf([1]),
      "POST /api/enrichers/musicbrainz/tracks/1": {
        body: { id: 7, state: "queued", failure_message: "" },
      },
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(findableBy(result.current, "musicbrainz")).toEqual([1]);
    });
    await act(async () => {
      await result.current.find("musicbrainz", 1);
    });

    act(() => {
      stream().send("job", { id: 7, kind: "enrich_track", state: "succeeded" });
      vi.advanceTimersByTime(5_000);
    });

    expect(result.current.lookups.has(1)).toBe(false);
  });

  it("says why a lookup's Job failed", async () => {
    serve({
      ...signedIn([trackOf(1, "Intro")]),
      "GET /api/enrichers/musicbrainz": enricherOf([1]),
      "POST /api/enrichers/musicbrainz/tracks/1": {
        body: { id: 7, state: "queued", failure_message: "" },
      },
      "GET /api/jobs/7": {
        body: { id: 7, state: "failed", failure_message: "MusicBrainz didn't answer." },
      },
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(findableBy(result.current, "musicbrainz")).toEqual([1]);
    });
    await act(async () => {
      await result.current.find("musicbrainz", 1);
    });

    act(() => {
      stream().send("job", { id: 7, kind: "enrich_track", state: "failed" });
    });

    await waitFor(() => {
      expect(result.current.lookups.get(1)).toEqual({
        enricher: "musicbrainz",
        state: "failed",
        message: "MusicBrainz didn't answer.",
      });
    });
  });

  it("passes on why the server refused, and keeps offering it", async () => {
    serve({
      ...signedIn([trackOf(1, "Intro")]),
      "GET /api/enrichers/bilibili-details": enricherOf([1]),
      "POST /api/enrichers/bilibili-details/tracks/1": {
        status: 409,
        body: { detail: "This video was looked up in the last 24 hours." },
      },
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(findableBy(result.current, "bilibili-details")).toHaveLength(1);
    });

    await act(async () => {
      await expect(result.current.find("bilibili-details", 1)).rejects.toThrow(
        "This video was looked up in the last 24 hours.",
      );
    });

    expect(findableBy(result.current, "bilibili-details")).toEqual([1]);
    expect(result.current.lookups.get(1)).toEqual({
      enricher: "bilibili-details",
      state: "failed",
      message: "This video was looked up in the last 24 hours.",
    });
  });

  it("asks for the Tracks and what can be looked up again when a lookup finishes", async () => {
    const { calls } = serve({
      ...signedIn([trackOf(1, "Intro")]),
      "GET /api/enrichers/bilibili-details": enricherOf([1]),
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    vi.useFakeTimers();

    act(() => {
      stream().send("job", { id: 4, kind: "enrich_track", state: "succeeded" });
      vi.advanceTimersByTime(1000);
    });

    expect(asked(calls)).toBe(2);
    expect(calls.filter((call) => call === "GET /api/enrichers/bilibili-details")).toHaveLength(2);
  });

  it("keeps what each enricher may be asked about apart", async () => {
    serve({
      ...signedIn([trackOf(1, "Intro"), trackOf(2, "Outro")]),
      "GET /api/enrichers/bilibili-details": enricherOf([1]),
      "GET /api/enrichers/musicbrainz": {
        body: { name: "musicbrainz", available: true, stopped: null, eligible: [1, 2] },
      },
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));

    await waitFor(() => {
      expect(findableBy(result.current, "musicbrainz")).toEqual([1, 2]);
    });
    expect(findableBy(result.current, "bilibili-details")).toEqual([1]);
  });

  it("asks MusicBrainz about the Track, which then no longer offers that and still offers the other", async () => {
    const { calls } = serve({
      ...signedIn([trackOf(1, "Intro")]),
      "GET /api/enrichers/bilibili-details": enricherOf([1]),
      "GET /api/enrichers/musicbrainz": {
        body: { name: "musicbrainz", available: true, stopped: null, eligible: [1] },
      },
      "POST /api/enrichers/musicbrainz/tracks/1": {
        body: { id: 7, state: "queued", failure_message: "" },
      },
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(findableBy(result.current, "musicbrainz")).toEqual([1]);
    });

    await act(async () => {
      await result.current.find("musicbrainz", 1);
    });

    expect(calls).toContain("POST /api/enrichers/musicbrainz/tracks/1");
    expect(findableBy(result.current, "musicbrainz")).toEqual([]);
    expect(findableBy(result.current, "bilibili-details")).toEqual([1]);
  });

  it("offers the AI's suggestion for the Tracks the server says it may be asked about", async () => {
    serve({
      ...signedIn([trackOf(1, "Intro"), trackOf(2, "Outro")]),
      "GET /api/enrichers/ai-details": {
        body: { name: "ai-details", available: true, stopped: null, eligible: [2] },
      },
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));

    await waitFor(() => {
      expect(findableBy(result.current, "ai-details")).toEqual([2]);
    });
  });

  it("asks again which Tracks each enricher may be asked about when told a setting changed", async () => {
    let eligible: readonly number[] = [];
    const { calls } = serve({
      ...signedIn([trackOf(1, "Intro")]),
      "GET /api/enrichers/ai-details": () => ({
        body: { name: "ai-details", available: true, stopped: null, eligible },
      }),
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(result.current.findable.get("ai-details")?.size).toBe(0);
    });

    eligible = [1];
    act(() => {
      result.current.refreshFindable();
    });

    await waitFor(() => {
      expect(findableBy(result.current, "ai-details")).toEqual([1]);
    });
    expect(calls.filter((call) => call === "GET /api/enrichers/ai-details")).toHaveLength(2);
  });

  it("signs out when the server says the session is over", async () => {
    const onSignedOut = vi.fn();
    serve({
      ...signedIn([trackOf(1, "Intro")]),
      "GET /api/enrichers/bilibili-details": enricherOf([1]),
      "POST /api/enrichers/bilibili-details/tracks/1": {
        status: 401,
        body: { detail: "Sign in first." },
      },
    });
    const { result } = renderHook(() => useLibrary(onSignedOut));
    await waitFor(() => {
      expect(findableBy(result.current, "bilibili-details")).toHaveLength(1);
    });

    await expect(result.current.find("bilibili-details", 1)).rejects.toThrow("Sign in first.");

    expect(onSignedOut).toHaveBeenCalledOnce();
  });
});

describe("adding music by link and by file", () => {
  const ADDED = [{ part: 1, track_id: 9, source_id: 90, job: null }];

  it("asks for the Tracks again once a link's parts are added", async () => {
    const { calls } = serve({
      ...signedIn([trackOf(1, "Intro")]),
      "POST /api/links": { body: ADDED },
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    const added = await result.current.addLink("BV1Xx41117Tz", "best", [
      { part: 1, title: "Night Drive", artist: "Blue Room" },
    ]);

    expect(added).toEqual(ADDED);
    await waitFor(() => {
      expect(asked(calls)).toBe(2);
    });
  });

  it("looks a link up, passing on why the server refused", async () => {
    serve({
      ...signedIn([]),
      "POST /api/links/lookup": { status: 422, body: { detail: "medleyplay can't add music." } },
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    await expect(result.current.lookUpLink("https://example.com/")).rejects.toThrow(
      "medleyplay can't add music.",
    );
  });

  it("signs out when the server says the session is over", async () => {
    serve({
      ...signedIn([]),
      "POST /api/links/lookup": { status: 401, body: { detail: "Sign in first." } },
    });
    const onSignedOut = vi.fn();
    const { result } = renderHook(() => useLibrary(onSignedOut));
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    await expect(result.current.lookUpLink("BV1Xx41117Tz")).rejects.toThrow();

    expect(onSignedOut).toHaveBeenCalledOnce();
  });

  it("asks for the Tracks again once a file is added", async () => {
    const { calls } = serve(signedIn([trackOf(1, "Intro")]));
    const uploads = FakeUploads.install();
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    const sent = result.current.addFile(
      1,
      new File(["abcd"], "intro.wav"),
      () => undefined,
      new AbortController().signal,
    );
    uploads.last.answer(200, JSON.stringify(downloadOf(1, "downloaded")));
    await sent;

    await waitFor(() => {
      expect(asked(calls)).toBe(2);
    });
  });
});

describe("favorite artists and albums", () => {
  it("loads them with the Tracks, matched as the Library names them", async () => {
    serve({
      ...signedIn([trackOf(1, "Intro", { artist: "朴树" })]),
      "GET /api/favorites": {
        body: { artists: [{ name: "朴树" }], albums: [{ artist: "朴树", name: "生如夏花" }] },
      },
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));

    await waitFor(() => {
      expect(result.current.favoriteGroups.artists.has("朴树")).toBe(true);
    });
    expect(result.current.favoriteGroups.albums.has("朴树\n生如夏花")).toBe(true);
  });

  it("favorites an artist at once, then shows what the server keeps", async () => {
    const { calls } = serve({
      ...signedIn([trackOf(1, "Intro", { artist: "朴树" })]),
      "PUT /api/artists/favorite": { body: { artists: [{ name: "朴树" }], albums: [] } },
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    act(() => {
      result.current.setArtistFavorite("朴树", true);
    });
    const atOnce = result.current.favoriteGroups.artists.has("朴树");

    expect(atOnce).toBe(true);
    await waitFor(() => {
      expect(calls).toContain("PUT /api/artists/favorite");
    });
    expect(result.current.favoriteGroups.artists.has("朴树")).toBe(true);
  });

  it("takes an album's heart back, saying why, when the server refuses", async () => {
    serve({
      ...signedIn([trackOf(1, "Intro")]),
      "PUT /api/albums/favorite": {
        status: 422,
        body: { detail: "An album's name must be 1-512 characters." },
      },
    });
    const { result } = renderHook(() => useLibrary(vi.fn()));
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    act(() => {
      result.current.setAlbumFavorite("朴树", "生如夏花", true);
    });

    await waitFor(() => {
      expect(result.current.error).toBe("An album's name must be 1-512 characters.");
    });
    expect(result.current.favoriteGroups.albums.size).toBe(0);
  });
});
