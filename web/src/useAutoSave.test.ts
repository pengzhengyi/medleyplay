import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTO_SAVE_MS, type Outcome, useAutoSave } from "./useAutoSave";

afterEach(() => {
  vi.useRealTimers();
});

/** A save the test settles by hand: each call waits until `finish` answers it. */
function heldSave() {
  const calls: number[] = [];
  const answers: ((outcome: Outcome) => void)[] = [];
  const save = vi.fn(
    (value: number) =>
      new Promise<Outcome>((resolve) => {
        calls.push(value);
        answers.push(resolve);
      }),
  );
  const finish = async (outcome: Outcome = "saved") => {
    await act(async () => {
      answers.shift()?.(outcome);
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

  it("confirms nothing when a save is held for confirmation, leaving its note", async () => {
    const { save, finish } = heldSave();
    const { result } = renderHook(() => useAutoSave(save));

    act(() => {
      result.current.now(1);
    });
    await finish("held");

    expect(result.current.note.text).toBe("Saving…");
  });

  it("tries a value that failed again once the device is back online", async () => {
    const { save, calls, finish } = heldSave();
    const { result } = renderHook(() => useAutoSave(save));
    act(() => {
      result.current.now(3);
    });
    await finish("failed");

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(calls).toEqual([3, 3]);
  });

  it("tries the newer value instead when one was changed while the failed one saved", async () => {
    const { save, calls, finish } = heldSave();
    const { result } = renderHook(() => useAutoSave(save));
    act(() => {
      result.current.now(3);
      result.current.later(4);
    });
    await finish("failed");

    act(() => {
      result.current.flush();
    });

    expect(calls).toEqual([3, 4]);
  });

  it("drops a value waiting behind a save that met a conflict", async () => {
    const { save, calls, finish } = heldSave();
    const { result } = renderHook(() => useAutoSave(save));
    act(() => {
      result.current.now(3);
      result.current.now(4);
    });

    await finish("conflict");

    expect(calls).toEqual([3]);
    expect(result.current.busy()).toBe(false);
  });

  it("says a save that threw was not saved, and tries it again", async () => {
    const save = vi
      .fn<(value: number) => Promise<Outcome>>()
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValue("saved");
    const { result } = renderHook(() => useAutoSave(save));

    await act(async () => {
      result.current.now(8);
      await Promise.resolve();
    });
    const said = result.current.note;
    await act(async () => {
      result.current.flush();
      await Promise.resolve();
    });

    expect(said).toMatchObject({ text: "Not saved: Failed to fetch", refused: true });
    expect(save.mock.calls.map(([value]) => value)).toEqual([8, 8]);
  });

  it("saves a waiting value when the page is hidden", () => {
    vi.useFakeTimers();
    const { save, calls } = heldSave();
    const { result } = renderHook(() => useAutoSave(save));

    act(() => {
      result.current.later(6);
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(calls).toEqual([6]);
  });

  it("is busy while a value waits or saves, and not once it saved", async () => {
    const { save, finish } = heldSave();
    const { result } = renderHook(() => useAutoSave(save));

    act(() => {
      result.current.now(1);
    });
    const saving = result.current.busy();
    await finish();

    expect(saving).toBe(true);
    expect(result.current.busy()).toBe(false);
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
