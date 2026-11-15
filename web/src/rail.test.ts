import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { setRailCollapsed, useRailCollapsed } from "./rail";

afterEach(() => {
  localStorage.clear();
});

describe("the rail of views", () => {
  it("shows its names until it is collapsed, and remembers that in the browser", () => {
    const { result, unmount } = renderHook(() => useRailCollapsed());
    expect(result.current).toBe(false);

    act(() => {
      setRailCollapsed(true);
    });
    unmount();

    expect(renderHook(() => useRailCollapsed()).result.current).toBe(true);
  });

  it("shows its names again once opened", () => {
    setRailCollapsed(true);
    const { result } = renderHook(() => useRailCollapsed());

    act(() => {
      setRailCollapsed(false);
    });

    expect(result.current).toBe(false);
    expect(localStorage.getItem("medleyplay.rail")).toBeNull();
  });
});
