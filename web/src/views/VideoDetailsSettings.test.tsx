import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Enricher } from "../api";
import { type Routes, serve } from "../testing/server";
import { VideoDetailsSettings } from "./VideoDetailsSettings";

/** The lookup on, not stopped, and able to look up the Tracks `eligible`. */
const running = (eligible: readonly number[]): Enricher => ({
  name: "bilibili-details",
  available: true,
  stopped: null,
  eligible,
});

/** The lookup after Bilibili refused a request with a 412, with nothing left to look up. */
const STOPPED: Enricher = {
  ...running([]),
  stopped: { at: "2026-11-05T12:00:00Z", reason: "Bilibili refused the request (412)." },
};

function open(enricher: Enricher, routes: Routes = {}) {
  const served = serve({ "GET /api/enrichers/bilibili-details": { body: enricher }, ...routes });
  render(<VideoDetailsSettings />);
  return served;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Bilibili video details", () => {
  it("says how many Tracks can have their details found", async () => {
    open(running([1, 2, 3]));

    expect(await screen.findByText("3 Tracks can have their details found.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find details for all" })).toBeEnabled();
  });

  it("says so for a single Track", async () => {
    open(running([4]));

    expect(await screen.findByText("1 Track can have its details found.")).toBeInTheDocument();
  });

  it("has nothing to queue when no Track can be looked up", async () => {
    open(running([]));

    expect(await screen.findByText("0 Tracks can have their details found.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find details for all" })).toBeDisabled();
  });

  it("queues every Track and says how many were queued", async () => {
    let eligible = [1, 2];
    const user = userEvent.setup();
    const { calls } = open(running([1, 2]), {
      "GET /api/enrichers/bilibili-details": () => ({ body: running(eligible) }),
      "POST /api/enrichers/bilibili-details/find-all": () => {
        eligible = [];
        return { body: { queued: 2 } };
      },
    });

    await user.click(await screen.findByRole("button", { name: "Find details for all" }));

    expect(await screen.findByText("Queued 2 Tracks.")).toBeInTheDocument();
    expect(calls).toContain("POST /api/enrichers/bilibili-details/find-all");
  });

  it("says when a single Track was queued", async () => {
    const user = userEvent.setup();
    open(running([1]), {
      "POST /api/enrichers/bilibili-details/find-all": { body: { queued: 1 } },
    });

    await user.click(await screen.findByRole("button", { name: "Find details for all" }));

    expect(await screen.findByText("Queued 1 Track.")).toBeInTheDocument();
  });

  it("shows the lookup stopped, with why, and offers a reset instead of queueing", async () => {
    open(STOPPED);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Stopped after Bilibili refused a request: Bilibili refused the request (412). Nothing more is asked until it is reset.",
    );
    expect(screen.getByRole("button", { name: "Find details for all" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset" })).toBeEnabled();
  });

  it("resets a stopped lookup and shows it running again", async () => {
    let answer = STOPPED;
    const user = userEvent.setup();
    const { calls } = open(STOPPED, {
      "GET /api/enrichers/bilibili-details": () => ({ body: answer }),
      "POST /api/enrichers/bilibili-details/reset": () => {
        answer = running([5]);
        return { status: 204 };
      },
    });

    await user.click(await screen.findByRole("button", { name: "Reset" }));

    expect(await screen.findByText("Reset.")).toBeInTheDocument();
    expect(calls).toContain("POST /api/enrichers/bilibili-details/reset");
    expect(screen.getByText("1 Track can have its details found.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("offers no reset while the lookup runs", async () => {
    open(running([1]));

    await screen.findByText("1 Track can have its details found.");

    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("says the lookup is turned off, with nothing to press, when its plugin is off", async () => {
    open({ ...running([]), available: false });

    expect(await screen.findByText("Finding video details is turned off.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the server's refusal when queueing fails", async () => {
    const user = userEvent.setup();
    open(running([1]), {
      "POST /api/enrichers/bilibili-details/find-all": {
        status: 403,
        body: { detail: "Only an admin manages what the enrichers do for every Track." },
      },
    });

    await user.click(await screen.findByRole("button", { name: "Find details for all" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only an admin manages what the enrichers do for every Track.",
    );
  });

  it("shows why the lookup could not be read", async () => {
    serve({
      "GET /api/enrichers/bilibili-details": { status: 500, body: { detail: "Something broke." } },
    });
    render(<VideoDetailsSettings />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Something broke.");
  });
});
