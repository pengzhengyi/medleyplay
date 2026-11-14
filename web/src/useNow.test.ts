import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useNow } from "./useNow";

afterEach(() => {
  vi.useRealTimers();
});

describe("useNow", () => {
  it("reads the time when shown, and again every 15 seconds", () => {
    vi.useFakeTimers({ now: new Date("2026-11-06T16:30:00Z") });

    const { result } = renderHook(() => useNow());
    const shown = result.current;
    act(() => {
      vi.advanceTimersByTime(14_000);
    });
    const before = result.current;
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(shown).toBe(Date.parse("2026-11-06T16:30:00Z"));
    expect(before).toBe(shown);
    expect(result.current).toBe(Date.parse("2026-11-06T16:30:15Z"));
  });

  it("shows the time now from its first render, however long ago it was last read", () => {
    vi.useFakeTimers({ now: new Date("2026-11-06T16:30:00Z") });
    renderHook(() => useNow()).unmount();
    vi.setSystemTime(new Date("2026-11-13T09:00:00Z"));
    const rendered: number[] = [];

    renderHook(() => {
      rendered.push(useNow());
    });

    expect(rendered[0]).toBe(Date.parse("2026-11-13T09:00:00Z"));
  });
});
