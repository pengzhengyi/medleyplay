import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Enricher } from "../api";
import { type Routes, enricherOf, serve } from "../testing/server";
import { MusicBrainzSettings } from "./MusicBrainzSettings";

/** MusicBrainz on, not stopped, and able to be asked about the Tracks `eligible`. */
const running = (eligible: readonly number[]): Enricher => enricherOf("musicbrainz", eligible);

/** MusicBrainz after it refused a request with a 403, with nothing left to ask about. */
const STOPPED: Enricher = {
  ...running([]),
  stopped: { at: "2026-11-05T12:00:00Z", reason: "MusicBrainz refused the request (403)." },
};

function open(enricher: Enricher, routes: Routes = {}) {
  const served = serve({ "GET /api/enrichers/musicbrainz": { body: enricher }, ...routes });
  render(<MusicBrainzSettings />);
  return served;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the MusicBrainz lookup", () => {
  it("says how many Tracks can be found there", async () => {
    open(running([1, 2, 3]));

    expect(await screen.findByText("3 Tracks can be found on MusicBrainz.")).toBeInTheDocument();
  });

  it("says so for a single Track", async () => {
    open(running([4]));

    expect(await screen.findByText("1 Track can be found on MusicBrainz.")).toBeInTheDocument();
  });

  it("says when no Track can be found there", async () => {
    open(running([]));

    expect(await screen.findByText("0 Tracks can be found on MusicBrainz.")).toBeInTheDocument();
  });

  it("shows the lookup stopped, with why, and offers a reset", async () => {
    open(STOPPED);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Stopped after MusicBrainz refused a request: MusicBrainz refused the request (403). Nothing more is asked until it is reset.",
    );
    expect(screen.getByRole("button", { name: "Reset" })).toBeEnabled();
  });

  it("resets a stopped lookup and shows it running again", async () => {
    let answer = STOPPED;
    const user = userEvent.setup();
    const { calls } = open(STOPPED, {
      "GET /api/enrichers/musicbrainz": () => ({ body: answer }),
      "POST /api/enrichers/musicbrainz/reset": () => {
        answer = running([5]);
        return { status: 204 };
      },
    });

    await user.click(await screen.findByRole("button", { name: "Reset" }));

    expect(await screen.findByText("Reset.")).toBeInTheDocument();
    expect(calls).toContain("POST /api/enrichers/musicbrainz/reset");
    expect(screen.getByText("1 Track can be found on MusicBrainz.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("offers no reset while the lookup runs", async () => {
    open(running([1]));

    await screen.findByText("1 Track can be found on MusicBrainz.");

    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("says the lookup is turned off, with nothing to press, when its plugin is off", async () => {
    open({ ...running([]), available: false });

    expect(
      await screen.findByText("Finding Tracks on MusicBrainz is turned off."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
