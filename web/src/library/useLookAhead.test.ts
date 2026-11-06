import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EnricherMode, Track } from "../api";
import { trackOf } from "../testing/server";
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
  };
}

const byId = (tracks: readonly Track[]) => new Map(tracks.map((track) => [track.id, track]));

describe("asking about the songs coming up", () => {
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
