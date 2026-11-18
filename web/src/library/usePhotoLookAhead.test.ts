import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serve } from "../testing/server";
import { usePhotoLookAhead } from "./usePhotoLookAhead";

const FIND = "POST /api/artist-photos/find";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("looking up photos of the artists of the songs coming up", () => {
  it("sends each song coming up once, however often it comes round", async () => {
    const sent: unknown[] = [];
    serve({
      [FIND]: (body) => {
        sent.push(body);
        return { body: { asked: 0 } };
      },
    });
    const { rerender } = renderHook(
      ({ ids }) => {
        usePhotoLookAhead(ids);
      },
      { initialProps: { ids: [1, 2] as readonly (number | undefined)[] } },
    );

    rerender({ ids: [2, 3] });
    rerender({ ids: [3, undefined] });

    await vi.waitFor(() => {
      expect(sent).toEqual([{ track_ids: [1, 2] }, { track_ids: [3] }]);
    });
  });
});
