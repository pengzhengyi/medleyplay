import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONFIRMED_MS, FADE_MS, useNote } from "./useNote";

afterEach(() => {
  vi.useRealTimers();
});

describe("useNote", () => {
  it("fades a confirmation, then clears it", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNote());

    act(() => {
      result.current.confirm("Saved.");
    });
    const shown = result.current.note;
    act(() => {
      vi.advanceTimersByTime(CONFIRMED_MS - FADE_MS);
    });
    const fading = result.current.note;
    act(() => {
      vi.advanceTimersByTime(FADE_MS);
    });

    expect(shown).toEqual({ text: "Saved.", refused: false, fading: false });
    expect(fading).toEqual({ text: "Saved.", refused: false, fading: true });
    expect(result.current.note.text).toBe("");
  });

  it("keeps what it tells and what it refuses until the next note", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNote());

    act(() => {
      result.current.tell("The setting changed elsewhere.");
      vi.advanceTimersByTime(10 * CONFIRMED_MS);
    });
    const told = result.current.note;
    act(() => {
      result.current.refuse("Press other keys.");
      vi.advanceTimersByTime(10 * CONFIRMED_MS);
    });

    expect(told).toEqual({ text: "The setting changed elsewhere.", refused: false, fading: false });
    expect(result.current.note).toEqual({
      text: "Press other keys.",
      refused: true,
      fading: false,
    });
  });

  it("shows a confirmation that comes again for its whole time", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNote());

    act(() => {
      result.current.confirm("Saved.");
      vi.advanceTimersByTime(CONFIRMED_MS - 1);
      result.current.confirm("Saved.");
      vi.advanceTimersByTime(CONFIRMED_MS - FADE_MS - 1);
    });

    expect(result.current.note).toEqual({ text: "Saved.", refused: false, fading: false });
  });

  it("keeps a note told after a confirmation", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNote());

    act(() => {
      result.current.confirm("Saved.");
      result.current.tell("Changed elsewhere.");
      vi.advanceTimersByTime(2 * CONFIRMED_MS);
    });

    expect(result.current.note.text).toBe("Changed elsewhere.");
  });
});
