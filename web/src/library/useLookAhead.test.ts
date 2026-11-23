import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, type EnricherMode, type Track } from "../api";
import { FakeEventSource, stream } from "../testing/events";
import { enricherOf, serve, signedIn, trackOf } from "../testing/server";
import { useLibrary } from "./useLibrary";
import { useLookAhead } from "./useLookAhead";

/** A Library of `tracks`, each enricher as `modes` says, that may ask about `findable`. */
function libraryOf(
  modes: Record<string, EnricherMode>,
  findable: Record<string, readonly number[]>,
) {
  return {
    modes: new Map(Object.entries(modes)),
    findable: new Map(Object.entries(findable).map(([name, ids]) => [name, new Set(ids)])),
    find: vi.fn(() => Promise.resolve()),
    lyricsMatchEnds: new Map<number, { jobId: number; saved: boolean }>(),
    lyricsStreamConnections: 0,
  };
}

const byId = (tracks: readonly Track[]) => new Map(tracks.map((track) => [track.id, track]));

describe("asking about the songs coming up", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeEventSource.last = undefined;
  });

  it("retries only the deferred lyrics lookup after that song's Auto-Match ends", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let refuse: () => void = () => undefined;
    const deferred = new Promise<void>((resolve) => {
      refuse = resolve;
    });
    const post = vi
      .fn()
      .mockReturnValueOnce({
        status: 409,
        body: { detail: "Auto-Match is working on this song.", code: "lyrics_match_in_progress" },
        after: deferred,
      })
      .mockReturnValue({ status: 202, body: { id: 9, state: "queued", failure_message: "" } });
    const tracks = [trackOf(1, "Melt"), trackOf(2, "Shiver")];
    serve({
      ...signedIn(tracks),
      "GET /api/enrichers/lyrics": { body: { ...enricherOf("lyrics", [1, 2]), mode: "next" } },
      "POST /api/enrichers/lyrics/tracks/1": post,
    });

    const known = byId(tracks);
    const { result } = renderHook(() => {
      const library = useLibrary(vi.fn());
      useLookAhead([1], known, library);
      return library;
    });
    const notify = (kind: string, state: string, track: number, id: number) => {
      act(() => {
        stream().send("job", { id, kind, state, target: `lyrics-match:${String(track)}` });
      });
    };
    await waitFor(() => {
      expect(post).toHaveBeenCalledOnce();
    });

    notify("auto_match_find", "succeeded", 1, 30);
    notify("auto_match_choose", "failed", 2, 32);
    expect(post).toHaveBeenCalledOnce();

    notify("auto_match_choose", "failed", 1, 31);
    await act(async () => {
      refuse();
      await deferred;
    });
    await waitFor(() => {
      expect(post).toHaveBeenCalledTimes(2);
      expect(result.current.lookups.get(1)?.state).toBe("queued");
    });
    notify("auto_match_choose", "failed", 1, 31);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a deferred request on ordinary updates or after Auto-Match saved", async () => {
    const library = libraryOf({ lyrics: "next" }, { lyrics: [1] });
    library.find.mockRejectedValueOnce(
      new ApiError(409, "Auto-Match is working on this song.", "lyrics_match_in_progress"),
    );
    const tracks = byId([trackOf(1, "Melt")]);
    const { rerender } = renderHook(
      ({ current }) => {
        useLookAhead([1], tracks, current);
      },
      { initialProps: { current: library } },
    );
    await act(async () => {
      await Promise.resolve();
    });
    rerender({ current: { ...library, findable: new Map(library.findable) } });
    expect(library.find).toHaveBeenCalledOnce();

    rerender({
      current: { ...library, lyricsMatchEnds: new Map([[1, { jobId: 30, saved: true }]]) },
    });
    expect(library.find).toHaveBeenCalledOnce();
  });

  it("asks each enricher set to the next to play about the song playing and the one after", () => {
    const library = libraryOf(
      { "bilibili-details": "next", musicbrainz: "manual" },
      { "bilibili-details": [1, 2, 3], musicbrainz: [1, 2] },
    );

    renderHook(() => {
      useLookAhead([1, 2], byId([trackOf(1, "Melt"), trackOf(2, "Shiver")]), library);
    });

    expect(library.find.mock.calls).toEqual([
      ["bilibili-details", 1],
      ["bilibili-details", 2],
    ]);
  });

  it("asks about a song of a split file through its file", () => {
    const library = libraryOf({ "bilibili-details": "next" }, { "bilibili-details": [9] });
    const tracks = byId([
      trackOf(9, "Bremen", { split: true }),
      trackOf(11, "Last", { segment_of: 9 }),
    ]);

    renderHook(() => {
      useLookAhead([11], tracks, library);
    });

    expect(library.find).toHaveBeenCalledExactlyOnceWith("bilibili-details", 9);
  });

  it("asks for the lyrics of a song of a split file by the song itself", () => {
    const library = libraryOf({ lyrics: "next" }, { lyrics: [11] });
    const tracks = byId([
      trackOf(9, "Bremen", { split: true }),
      trackOf(11, "Last", { segment_of: 9 }),
    ]);

    renderHook(() => {
      useLookAhead([11], tracks, library);
    });

    expect(library.find).toHaveBeenCalledExactlyOnceWith("lyrics", 11);
  });

  it("asks about a song once, however often it comes up, and never one it may not ask about", () => {
    const library = libraryOf({ "bilibili-details": "next" }, { "bilibili-details": [1] });
    const tracks = byId([trackOf(1, "Melt"), trackOf(2, "Shiver")]);

    const { rerender } = renderHook(
      ({ ids }) => {
        useLookAhead(ids, tracks, library);
      },
      { initialProps: { ids: [1, 2] as readonly number[] } },
    );
    rerender({ ids: [2, 1] });

    expect(library.find).toHaveBeenCalledExactlyOnceWith("bilibili-details", 1);
  });
});
