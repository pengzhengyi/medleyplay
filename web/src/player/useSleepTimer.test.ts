import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSleepTimer } from "./useSleepTimer";

afterEach(() => {
  vi.useRealTimers();
});

const MINUTE = 60_000;

describe("useSleepTimer", () => {
  it("pauses once the time chosen is up, then is off", () => {
    vi.useFakeTimers({ now: new Date("2026-11-07T23:00:00Z") });
    const pause = vi.fn();
    const { result } = renderHook(() => useSleepTimer(pause));

    act(() => {
      result.current.start(30);
    });
    const endsAt = result.current.endsAt;
    act(() => {
      vi.advanceTimersByTime(30 * MINUTE - 1);
    });
    const pausedEarly = pause.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(endsAt).toBe(Date.parse("2026-11-07T23:30:00Z"));
    expect(pausedEarly).toBe(0);
    expect(pause).toHaveBeenCalledOnce();
    expect(result.current.endsAt).toBeNull();
  });

  it("pauses nothing once turned off", () => {
    vi.useFakeTimers();
    const pause = vi.fn();
    const { result } = renderHook(() => useSleepTimer(pause));

    act(() => {
      result.current.start(15);
      result.current.stop();
      vi.advanceTimersByTime(60 * MINUTE);
    });

    expect(pause).not.toHaveBeenCalled();
  });

  it("counts from the latest choice, replacing the one before", () => {
    vi.useFakeTimers();
    const pause = vi.fn();
    const { result } = renderHook(() => useSleepTimer(pause));

    act(() => {
      result.current.start(15);
      vi.advanceTimersByTime(10 * MINUTE);
      result.current.start(60);
      vi.advanceTimersByTime(30 * MINUTE);
    });

    expect(pause).not.toHaveBeenCalled();
  });
});
