import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_RAIL_ORDER,
  type RailView,
  moved,
  railOrderOf,
  resetRailOrder,
  setRailOrder,
  useRailOrder,
} from "./railOrder";

afterEach(() => {
  resetRailOrder();
  localStorage.clear();
});

describe("the order of the views in the rail", () => {
  it("puts Radio below Albums and above Playlists by default", () => {
    expect(DEFAULT_RAIL_ORDER).toEqual([
      "library",
      "artists",
      "albums",
      "radio",
      "playlists",
      "downloaded",
      "insights",
    ]);
  });

  it("reads an order this browser saved", () => {
    const saved = ["radio", "library", "artists", "albums", "playlists", "downloaded", "insights"];

    expect(railOrderOf(saved)).toEqual(saved);
  });

  it("drops a view it doesn't know, and a view named twice", () => {
    const saved = [
      "radio",
      "podcasts",
      "radio",
      "library",
      "artists",
      "albums",
      "playlists",
      "downloaded",
      "insights",
    ];

    expect(railOrderOf(saved)).toEqual([
      "radio",
      "library",
      "artists",
      "albums",
      "playlists",
      "downloaded",
      "insights",
    ]);
  });

  it("puts a view missing from the saved order after the view it follows by default", () => {
    const saved = ["albums", "library", "artists", "playlists", "downloaded", "insights"];

    expect(railOrderOf(saved)).toEqual([
      "albums",
      "radio",
      "library",
      "artists",
      "playlists",
      "downloaded",
      "insights",
    ]);
  });

  it.each([null, "library", 7, [3, 4]])("reads %j as the default order", (saved) => {
    expect(railOrderOf(saved)).toEqual(DEFAULT_RAIL_ORDER);
  });

  it("moves a view up or down by one, and nowhere past either end", () => {
    const order: readonly RailView[] = ["library", "radio", "albums"];

    expect(moved(order, "radio", -1)).toEqual(["radio", "library", "albums"]);
    expect(moved(order, "radio", 1)).toEqual(["library", "albums", "radio"]);
    expect(moved(order, "library", -1)).toBe(order);
    expect(moved(order, "albums", 1)).toBe(order);
  });

  it("keeps a chosen order in this browser, and forgets it on reset", () => {
    const { result } = renderHook(() => useRailOrder());
    const chosen = moved(DEFAULT_RAIL_ORDER, "insights", -1);

    act(() => {
      setRailOrder(chosen);
    });
    expect(result.current).toEqual(chosen);
    expect(
      railOrderOf(JSON.parse(localStorage.getItem("medleyplay.rail-order") ?? "null")),
    ).toEqual(chosen);

    act(() => {
      resetRailOrder();
    });
    expect(result.current).toEqual(DEFAULT_RAIL_ORDER);
    expect(localStorage.getItem("medleyplay.rail-order")).toBeNull();
  });
});
