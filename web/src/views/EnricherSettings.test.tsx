import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Enricher } from "../api";
import { type Routes, enricherOf, serve } from "../testing/server";
import { EnricherSettings, type EnricherWords } from "./EnricherSettings";

/** An enricher of a made-up site, worded as each enricher's part words itself. */
const WORDS: EnricherWords = {
  enricher: "example",
  site: "Example",
  heading: "Example details",
  description: "Asks Example for a song's details.",
  count: (tracks) => `${String(tracks)} Tracks can be asked about.`,
  off: "Asking Example is turned off.",
};

function open(enricher: Enricher, routes: Routes = {}) {
  const onChanged = vi.fn();
  const served = serve({ "GET /api/enrichers/example": { body: enricher }, ...routes });
  render(<EnricherSettings words={WORDS} onChanged={onChanged} />);
  return { ...served, onChanged };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("when an enricher is asked", () => {
  it("shows the mode the household keeps, with what it does", async () => {
    open(enricherOf("example", [1], { mode: "next" }));

    const next = await screen.findByRole("radio", { name: "Next to play" });

    expect(next).toBeChecked();
    expect(screen.getByRole("group", { name: "Ask Example" })).toHaveAccessibleDescription(
      "For the song playing and the one after it, as each comes up.",
    );
  });

  it("saves a mode chosen at once, says so, and tells the page", async () => {
    const { calls, onChanged } = open(enricherOf("example", [1, 2]), {
      "PUT /api/enrichers/example/mode": (body) => ({
        body: enricherOf("example", [1, 2], body as { mode: Enricher["mode"] }),
      }),
    });

    await userEvent.click(await screen.findByRole("radio", { name: "All missing" }));

    expect(await screen.findByText("Saved.")).toHaveRole("status");
    expect(calls).toContain("PUT /api/enrichers/example/mode");
    expect(screen.getByRole("radio", { name: "All missing" })).toBeChecked();
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("keeps the mode it had, and says why, when the server refuses", async () => {
    const { onChanged } = open(enricherOf("example", [1]), {
      "PUT /api/enrichers/example/mode": {
        status: 403,
        body: { detail: "Only an admin manages what the enrichers do for every Track." },
      },
    });

    await userEvent.click(await screen.findByRole("radio", { name: "All missing" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only an admin manages what the enrichers do for every Track.",
    );
    expect(screen.getByRole("radio", { name: "Manually" })).toBeChecked();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("offers no mode while the enricher is turned off", async () => {
    open(enricherOf("example", [], { available: false }));

    expect(await screen.findByText("Asking Example is turned off.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});
