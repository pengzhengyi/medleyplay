import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Lyrics } from "../api";
import { lyricsOf, serve } from "../testing/server";
import { useLyrics } from "./useLyrics";

/** *Melt*'s lyrics, found on LRCLIB: one timed line. */
const MELT: Lyrics = lyricsOf();

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
      expect(result.current.lyrics).toEqual(MELT);
    });
    rerender({ id: 2 });

    expect(result.current.lyrics).toBeUndefined();
    await waitFor(() => {
      expect(result.current.lyrics).toBeNull();
    });
  });

  it("are read again when the version changes, as when a lookup finishes", async () => {
    let found: Lyrics | null = null;
    const { calls } = serve({ "GET /api/tracks/1/lyrics": () => ({ body: found }) });
    const { result, rerender } = renderHook(({ version }) => useLyrics(1, version), {
      initialProps: { version: "running" },
    });
    await waitFor(() => {
      expect(result.current.lyrics).toBeNull();
    });

    found = MELT;
    rerender({ version: "succeeded" });

    await waitFor(() => {
      expect(result.current.lyrics).toEqual(MELT);
    });
    expect(calls).toEqual(["GET /api/tracks/1/lyrics", "GET /api/tracks/1/lyrics"]);
  });

  it("are none while no song plays", () => {
    const { calls } = serve({});

    const { result } = renderHook(() => useLyrics(undefined));

    expect(result.current.lyrics).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("reports a failed initial read separately from a song without lyrics", async () => {
    serve({ "GET /api/tracks/1/lyrics": { status: 503, body: { detail: "Try again later." } } });
    const { result } = renderHook(() => useLyrics(1));

    await waitFor(() => {
      expect(result.current).toMatchObject({ lyrics: undefined, failed: true });
    });
  });

  it("keeps previously read lyrics for the same song when a refresh fails", async () => {
    let failed = false;
    let release: () => void = () => undefined;
    const answer = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { calls } = serve({
      "GET /api/tracks/1/lyrics": () =>
        failed
          ? { status: 503, body: { detail: "Try again later." }, after: answer }
          : { body: MELT },
    });
    const { result, rerender } = renderHook(({ version }) => useLyrics(1, version), {
      initialProps: { version: 1 },
    });
    await waitFor(() => {
      expect(result.current.lyrics).toEqual(MELT);
    });

    failed = true;
    await act(async () => {
      rerender({ version: 2 });
      release();
      await answer;
    });

    expect(calls).toHaveLength(2);
    expect(result.current).toMatchObject({ lyrics: MELT, failed: false });
  });
});
