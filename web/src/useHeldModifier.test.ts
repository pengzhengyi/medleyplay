import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HOLD_KEY, HOLD_MS, useHeldModifier } from "./useHeldModifier";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

const press = (key = HOLD_KEY, init: KeyboardEventInit = {}) => {
  fireEvent.keyDown(window, { key, ...init });
};
const release = (key = HOLD_KEY) => {
  fireEvent.keyUp(window, { key });
};
const wait = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe("holding the modifier alone", () => {
  it("is held once the key has been down alone for the hold time, until it is let go", () => {
    const { result } = renderHook(() => useHeldModifier(true));

    press();
    wait(HOLD_MS - 1);
    const early = result.current;
    wait(1);
    const held = result.current;
    act(() => {
      release();
    });

    expect(early).toBe(false);
    expect(held).toBe(true);
    expect(result.current).toBe(false);
  });

  it("isn't held after a quick press", () => {
    const { result } = renderHook(() => useHeldModifier(true));

    press();
    wait(200);
    release();
    wait(HOLD_MS);

    expect(result.current).toBe(false);
  });

  it("isn't held for a shortcut made with the key, however long it stays down", () => {
    const { result } = renderHook(() => useHeldModifier(true));

    press();
    press("k", { metaKey: true, ctrlKey: true });
    wait(HOLD_MS * 2);

    expect(result.current).toBe(false);
  });

  it("isn't held while typing in a text box", () => {
    const box = document.createElement("input");
    document.body.append(box);
    box.focus();
    const { result } = renderHook(() => useHeldModifier(true));

    press();
    wait(HOLD_MS);

    expect(result.current).toBe(false);
  });

  it("lets go when the window loses focus, as switching apps with the key does", () => {
    const { result } = renderHook(() => useHeldModifier(true));
    press();
    wait(HOLD_MS);

    act(() => {
      fireEvent.blur(window);
    });

    expect(result.current).toBe(false);
  });

  it("is never held when turned off", () => {
    const { result } = renderHook(() => useHeldModifier(false));

    press();
    wait(HOLD_MS);

    expect(result.current).toBe(false);
  });
});
