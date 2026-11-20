import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useReadAgain } from "./useReadAgain";

afterEach(() => {
  vi.useRealTimers();
});

/** A read that answers the very same object each time, as a 304 does. */
function sameEachTime<T>(answer: T): {
  readonly read: () => Promise<T>;
  readonly count: () => number;
} {
  let reads = 0;
  return {
    read: () => {
      reads += 1;
      return Promise.resolve(answer);
    },
    count: () => reads,
  };
}

describe("a read read again", () => {
  it("counts each answer that comes while it is still changing, the same one too", async () => {
    const { read, count } = sameEachTime({ finding: true });
    const { result } = renderHook(() =>
      useReadAgain(read, { finding: false }, 1, (value) => value.finding),
    );
    await waitFor(() => {
      expect(result.current.answered).toBe(1);
    });

    act(() => {
      result.current.reload();
    });

    await waitFor(() => {
      expect(result.current.answered).toBe(2);
    });
    expect(count()).toBe(2);
  });

  it("leaves the count alone for an answer no longer changing", async () => {
    const { read } = sameEachTime({ finding: false });
    const { result } = renderHook(() =>
      useReadAgain(read, { finding: false }, 1, (value) => value.finding),
    );
    await waitFor(() => {
      expect(result.current.value).not.toEqual(undefined);
    });

    act(() => {
      result.current.reload();
    });
    await act(() => new Promise((settled) => setTimeout(settled, 400)));

    expect(result.current.answered).toBe(0);
  });
});
