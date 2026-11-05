import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { ALICE, modeOf, serve, signedIn, trackOf } from "./testing/server";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("shows the Library to a signed-in browser", async () => {
    serve(signedIn([trackOf(1, "Night Drive")]));

    render(<App />);

    expect(await screen.findByRole("button", { name: "Night Drive" })).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("says in the header when medleyplay is Offline, and why, leading to Settings", async () => {
    serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/mode": { body: modeOf({ online: false, reason: "no_network", network: null }) },
    });

    render(<App />);

    const note = await screen.findByRole("link", { name: "Offline: no network" });
    expect(note).toHaveAttribute("href", "#/settings");
  });

  it("says nothing in the header while medleyplay is Online", async () => {
    serve(signedIn([trackOf(1, "Night Drive")]));

    render(<App />);

    expect(await screen.findByRole("button", { name: "Night Drive" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Offline/ })).not.toBeInTheDocument();
  });

  it("offers Find details online in the menu of a Track that can be looked up, not of another", async () => {
    serve({
      ...signedIn([trackOf(1, "Night Drive"), trackOf(2, "Melt")]),
      "GET /api/enrichers/bilibili-details": {
        body: { name: "bilibili-details", available: true, stopped: null, eligible: [1] },
      },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "More actions for Night Drive" }));
    expect(
      await screen.findByRole("menuitem", { name: "Find details online" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "More actions for Melt" }));

    expect(await screen.findByRole("menuitem", { name: "Edit details…" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Find details online" })).toBeNull();
  });

  it("asks for the Track's details and says so when Find details online is chosen", async () => {
    const { calls } = serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/enrichers/bilibili-details": {
        body: { name: "bilibili-details", available: true, stopped: null, eligible: [1] },
      },
      "POST /api/enrichers/bilibili-details/tracks/1": {
        body: { id: 9, state: "queued", failure_message: "" },
      },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "More actions for Night Drive" }));
    await user.click(await screen.findByRole("menuitem", { name: "Find details online" }));

    expect(await screen.findByText("Looking up “Night Drive” on Bilibili.")).toBeInTheDocument();
    expect(calls).toContain("POST /api/enrichers/bilibili-details/tracks/1");
  });

  it("offers Find on MusicBrainz in the menu of a Track that can be found there, not of another", async () => {
    serve({
      ...signedIn([trackOf(1, "Night Drive"), trackOf(2, "Melt")]),
      "GET /api/enrichers/musicbrainz": {
        body: { name: "musicbrainz", available: true, stopped: null, eligible: [2] },
      },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "More actions for Melt" }));
    expect(
      await screen.findByRole("menuitem", { name: "Find on MusicBrainz" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "More actions for Night Drive" }));

    expect(await screen.findByRole("menuitem", { name: "Edit details…" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Find on MusicBrainz" })).toBeNull();
  });

  it("asks MusicBrainz about the Track and says so when Find on MusicBrainz is chosen", async () => {
    const { calls } = serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/enrichers/musicbrainz": {
        body: { name: "musicbrainz", available: true, stopped: null, eligible: [1] },
      },
      "POST /api/enrichers/musicbrainz/tracks/1": {
        body: { id: 9, state: "queued", failure_message: "" },
      },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "More actions for Night Drive" }));
    await user.click(await screen.findByRole("menuitem", { name: "Find on MusicBrainz" }));

    expect(await screen.findByText("Looking up “Night Drive” on MusicBrainz.")).toBeInTheDocument();
    expect(calls).toContain("POST /api/enrichers/musicbrainz/tracks/1");
  });

  it("asks the AI about the Track and says so when Suggest details with AI is chosen", async () => {
    const { calls } = serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/enrichers/ai-details": {
        body: { name: "ai-details", available: true, stopped: null, eligible: [1] },
      },
      "POST /api/enrichers/ai-details/tracks/1": {
        body: { id: 9, state: "queued", failure_message: "" },
      },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "More actions for Night Drive" }));
    await user.click(await screen.findByRole("menuitem", { name: "Suggest details with AI" }));

    expect(await screen.findByText("Asking the AI about “Night Drive”.")).toBeInTheDocument();
    expect(calls).toContain("POST /api/enrichers/ai-details/tracks/1");
  });

  it("says the lookup waits while medleyplay is Offline", async () => {
    serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/mode": { body: modeOf({ online: false, reason: "no_network", network: null }) },
      "GET /api/enrichers/bilibili-details": {
        body: { name: "bilibili-details", available: true, stopped: null, eligible: [1] },
      },
      "POST /api/enrichers/bilibili-details/tracks/1": {
        body: { id: 9, state: "queued", failure_message: "" },
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await screen.findByRole("link", { name: "Offline: no network" });

    await user.click(await screen.findByRole("button", { name: "More actions for Night Drive" }));
    await user.click(await screen.findByRole("menuitem", { name: "Find details online" }));

    expect(
      await screen.findByText(
        "Looking up “Night Drive” on Bilibili. It waits until medleyplay is Online.",
      ),
    ).toBeInTheDocument();
  });

  it("says why the server refused a lookup", async () => {
    serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/enrichers/bilibili-details": {
        body: { name: "bilibili-details", available: true, stopped: null, eligible: [1] },
      },
      "POST /api/enrichers/bilibili-details/tracks/1": {
        status: 409,
        body: { detail: "This video was looked up in the last 24 hours." },
      },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "More actions for Night Drive" }));
    await user.click(await screen.findByRole("menuitem", { name: "Find details online" }));

    expect(
      await screen.findByText("This video was looked up in the last 24 hours."),
    ).toBeInTheDocument();
  });

  it("asks a signed-out browser to sign in, then shows the Library", async () => {
    serve({
      "GET /api/me": { status: 401, body: { detail: "Sign in first." } },
      "GET /api/setup": { body: { set_up: true, multiple_accounts: false } },
      "POST /api/session": (body) =>
        JSON.stringify(body) === JSON.stringify({ username: "alice", password: "secret words" })
          ? { body: ALICE }
          : { status: 401, body: { detail: "The username or password is wrong." } },
      "GET /api/tracks": { body: [trackOf(1, "Night Drive")] },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "secret words");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("button", { name: "Night Drive" })).toBeInTheDocument();
  });

  it("returns to the sign-in form after signing out", async () => {
    serve({
      ...signedIn([]),
      "DELETE /api/session": { status: 204 },
      "GET /api/setup": { body: { set_up: true, multiple_accounts: false } },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("form", { name: "Sign in" })).toBeInTheDocument();
  });
});
