import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Lyrics } from "../api";
import { serve } from "../testing/server";
import { useLyrics } from "./useLyrics";

/** *Melt*'s lyrics, found on LRCLIB: one timed line. */
const MELT: Lyrics = {
  origin: "lrclib",
  synced: true,
  instrumental: false,
  lines: [{ at_ms: 12_340, text: "朝目が覚めて", translation: "", words: [] }],
  plain: "",
  found_at: "2026-11-17T12:00:00Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the lyrics of the song playing", () => {
  it("are read for the song, and are none for a song without", async () => {
    serve({
      "GET /api/tracks/1/lyrics": { body: MELT },
      "GET /api/tracks/2/lyrics": { body: null },
    });
    const { result, rerender } = renderHook(({ id }) => useLyrics(id), {
      initialProps: { id: 1 },
    });

    await waitFor(() => {
      expect(result.current).toEqual(MELT);
    });
    rerender({ id: 2 });

    expect(result.current).toBeUndefined();
    await waitFor(() => {
      expect(result.current).toBeNull();
    });
  });

  it("are read again when the version changes, as when a lookup finishes", async () => {
    let found: Lyrics | null = null;
    const { calls } = serve({ "GET /api/tracks/1/lyrics": () => ({ body: found }) });
    const { result, rerender } = renderHook(({ version }) => useLyrics(1, version), {
      initialProps: { version: "running" },
    });
    await waitFor(() => {
      expect(result.current).toBeNull();
    });

    found = MELT;
    rerender({ version: "succeeded" });

    await waitFor(() => {
      expect(result.current).toEqual(MELT);
    });
    expect(calls).toEqual(["GET /api/tracks/1/lyrics", "GET /api/tracks/1/lyrics"]);
  });

  it("are none while no song plays", () => {
    const { calls } = serve({});

    const { result } = renderHook(() => useLyrics(undefined));

    expect(result.current).toBeUndefined();
    expect(calls).toEqual([]);
  });
});
