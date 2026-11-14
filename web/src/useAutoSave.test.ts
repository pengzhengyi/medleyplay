import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTO_SAVE_MS, useAutoSave } from "./useAutoSave";

afterEach(() => {
  vi.useRealTimers();
});

/** A save the test settles by hand: each call waits until `finish` answers it. */
function heldSave() {
  const calls: number[] = [];
  const answers: ((saved: boolean) => void)[] = [];
  const save = vi.fn(
    (value: number) =>
      new Promise<boolean>((resolve) => {
        calls.push(value);
        answers.push(resolve);
      }),
  );
  const finish = async (saved = true) => {
    await act(async () => {
      answers.shift()?.(saved);
      await Promise.resolve();
    });
  };
  return { save, calls, finish };
}

describe("useAutoSave", () => {
  it("saves a typed value once typing pauses, saying it saves and then that it saved", async () => {
    vi.useFakeTimers();
    const { save, calls, finish } = heldSave();
    const { result } = renderHook(() => useAutoSave(save));

    act(() => {
      result.current.later(2);
      vi.advanceTimersByTime(AUTO_SAVE_MS - 1);
      result.current.later(20);
      vi.advanceTimersByTime(AUTO_SAVE_MS - 1);
    });
    const waiting = [...calls];
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const saving = result.current.note.text;
    await finish();

    expect(waiting).toEqual([]);
    expect(calls).toEqual([20]);
    expect(saving).toBe("Saving…");
    expect(result.current.note.text).toBe("Saved.");
  });

  it("saves a chosen value at once", () => {
    const { save, calls } = heldSave();
    const { result } = renderHook(() => useAutoSave(save));

    act(() => {
      result.current.now(5);
    });

    expect(calls).toEqual([5]);
  });

  it("saves a waiting value when asked to flush, as when the field loses focus", () => {
    vi.useFakeTimers();
    const { save, calls } = heldSave();
    const { result } = renderHook(() => useAutoSave(save));

    act(() => {
      result.current.later(7);
      result.current.flush();
    });

    expect(calls).toEqual([7]);
  });

  it("saves only the latest value after the save in flight, never two at once", async () => {
    const { save, calls, finish } = heldSave();
    const { result } = renderHook(() => useAutoSave(save));

    act(() => {
      result.current.now(1);
      result.current.now(2);
      result.current.now(3);
    });
    const during = [...calls];
    await finish();

    expect(during).toEqual([1]);
    expect(calls).toEqual([1, 3]);
  });

  it("drops a waiting value when cancelled, as when it is typed back to the saved one", () => {
    vi.useFakeTimers();
    const { save, calls } = heldSave();
    const { result } = renderHook(() => useAutoSave(save));

    act(() => {
      result.current.later(9);
      result.current.cancel();
      vi.advanceTimersByTime(10 * AUTO_SAVE_MS);
    });

    expect(calls).toEqual([]);
  });

  it("confirms nothing when the save says it did not save, leaving its note", async () => {
    const { save, finish } = heldSave();
    const { result } = renderHook(() => useAutoSave(save));

    act(() => {
      result.current.now(1);
    });
    await finish(false);

    expect(result.current.note.text).toBe("Saving…");
  });

  it("saves a waiting value when it goes away, as when the page is left", () => {
    vi.useFakeTimers();
    const { save, calls } = heldSave();
    const { result, unmount } = renderHook(() => useAutoSave(save));

    act(() => {
      result.current.later(4);
    });
    unmount();

    expect(calls).toEqual([4]);
  });
});
