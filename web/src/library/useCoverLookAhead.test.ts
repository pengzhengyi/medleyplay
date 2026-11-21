import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serve } from "../testing/server";
import { MAX_COMING, useCoverLookAhead } from "./useCoverLookAhead";

const FIND = "POST /api/album-covers/missing/find";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Serve the look-ahead, keeping the songs each request sends. */
function sending() {
  const sent: unknown[] = [];
  serve({
    [FIND]: (body) => {
      sent.push(body);
      return { body: { asked: 0 } };
    },
  });
  return sent;
}

describe("the album covers look-ahead", () => {
  it("sends the song playing and those coming up, in the order they play", async () => {
    const sent = sending();

    renderHook(() => {
      useCoverLookAhead([7, 3, undefined, 9]);
    });

    await vi.waitFor(() => {
      expect(sent).toEqual([{ track_ids: [7, 3, 9] }]);
    });
  });

  it("sends again only when the song playing changes", async () => {
    const sent = sending();
    const { rerender } = renderHook(
      ({ ids }: { readonly ids: readonly number[] }) => {
        useCoverLookAhead(ids);
      },
      { initialProps: { ids: [1, 2, 3] } },
    );

    rerender({ ids: [1, 3] });
    rerender({ ids: [2, 3] });

    await vi.waitFor(() => {
      expect(sent).toEqual([{ track_ids: [1, 2, 3] }, { track_ids: [2, 3] }]);
    });
  });

  it("sends at most fifty songs", async () => {
    const sent = sending();

    renderHook(() => {
      useCoverLookAhead(Array.from({ length: 80 }, (_, index) => index + 1));
    });

    await vi.waitFor(() => {
      expect(sent).toEqual([
        { track_ids: Array.from({ length: MAX_COMING }, (_, index) => index + 1) },
      ]);
    });
  });

  it("sends nothing while nothing plays", () => {
    const sent = sending();

    renderHook(() => {
      useCoverLookAhead([undefined]);
    });

    expect(sent).toEqual([]);
  });
});
