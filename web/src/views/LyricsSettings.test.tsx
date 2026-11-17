import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { enricherOf, serve } from "../testing/server";
import { LyricsSettings } from "./LyricsSettings";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the lyrics lookup", () => {
  it("says what it sends to LRCLIB, and offers the songs coming up or manually only", async () => {
    serve({
      "GET /api/enrichers/lyrics": { body: { ...enricherOf("lyrics", [1, 2]), mode: "next" } },
    });

    render(<LyricsSettings />);

    expect(await screen.findByText("2 songs' lyrics can be looked up.")).toBeInTheDocument();
    expect(screen.getByText(/sending its\s+title, artist, album, and length/u)).toBeInTheDocument();
    const ways = within(screen.getByRole("group", { name: "Ask LRCLIB" }));
    expect(ways.getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual([
      "manual",
      "next",
    ]);
    expect(ways.getByRole("radio", { name: "Next to play" })).toBeChecked();
  });
});
