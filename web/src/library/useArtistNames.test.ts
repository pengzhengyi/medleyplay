import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { artistNameOf, serve } from "../testing/server";
import { useArtistNames } from "./useArtistNames";

/** How many times the artist names were asked for. */
const asked = (calls: readonly string[]) =>
  calls.filter((call) => call === "GET /api/artist-names").length;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the artist names", () => {
  it("asks again every 2 seconds while a name is found, though the server says nothing changed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const finding = { names: [{ ...artistNameOf("周杰伦"), finding: true }], artists: [] };
    const { calls } = serve({ "GET /api/artist-names": { body: finding, etag: 'W/"n"' } });
    const { result } = renderHook(() => useArtistNames(1));
    await waitFor(() => {
      expect(result.current.names.names).toHaveLength(1);
    });

    await act(() => vi.advanceTimersByTimeAsync(2000));
    await act(() => vi.advanceTimersByTimeAsync(2000));

    expect(asked(calls)).toBe(3);
  });

  it("stops asking once no name is being found", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const found = { names: [artistNameOf("周杰伦")], artists: [] };
    const { calls } = serve({ "GET /api/artist-names": { body: found, etag: 'W/"n"' } });
    const { result } = renderHook(() => useArtistNames(1));
    await waitFor(() => {
      expect(result.current.names.names).toHaveLength(1);
    });

    await act(() => vi.advanceTimersByTimeAsync(4000));

    expect(asked(calls)).toBe(1);
  });

  it("keeps the very answer it holds when the server says nothing changed", async () => {
    const found = { names: [artistNameOf("周杰伦")], artists: [] };
    serve({ "GET /api/artist-names": { body: found, etag: 'W/"n"' } });
    const { result, rerender } = renderHook(({ version }) => useArtistNames(version), {
      initialProps: { version: 1 },
    });
    await waitFor(() => {
      expect(result.current.names.names).toHaveLength(1);
    });
    const held = result.current.names;

    rerender({ version: 2 });
    await act(() => new Promise((settled) => setTimeout(settled, 50)));

    expect(result.current.names).toBe(held);
  });
});
