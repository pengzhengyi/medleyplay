import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MissingDetailsItem } from "../api";
import { serve, settingsOf } from "../testing/server";
import { MissingDetails } from "./MissingDetails";
import { MissingDetailsSettings } from "./MissingDetailsSettings";

const LIST = "GET /api/missing-details?after=0";
const DECIDE = "POST /api/missing-details/7/decision";
const ASK = "POST /api/missing-details/7/ask";

function intro(change: Partial<MissingDetailsItem> = {}): MissingDetailsItem {
  return {
    track_id: 7,
    title: "Intro",
    artist: "Trio",
    album: "",
    kind: "song",
    key: "reviewed-intro",
    ai: "off",
    fields: [{ field: "album", candidates: [{ value: "Live", origin: "library" }] }],
    ...change,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("missing details in Clean up", () => {
  it("opens Edit with the reviewed suggestion and its impact when Use cannot save it alone", async () => {
    const impact = {
      details: [{ field: "year", before: 1974, after: "" }],
      split_songs: 11,
      affected_songs: 11,
      song_fields: ["year"],
    };
    const edit = vi.fn();
    serve({
      [LIST]: { body: { tracks: [intro()], next_after: null } },
      [DECIDE]: {
        status: 409,
        body: {
          code: "missing_detail_review_required",
          detail: "This change also affects other details or songs. Use Edit details.",
          impact,
        },
      },
    });
    render(<MissingDetails revision="0" onEdit={edit} />);

    await userEvent.click(await screen.findByRole("button", { name: "Use Live for Album" }));

    expect(edit).toHaveBeenCalledExactlyOnceWith(7, { field: "album", value: "Live", impact });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports a stale suggestion without opening Edit or using the stale value", async () => {
    const edit = vi.fn();
    serve({
      [LIST]: { body: { tracks: [intro()], next_after: null } },
      [DECIDE]: {
        status: 409,
        body: { detail: "The Track or suggestion changed. Review the current details." },
      },
    });
    render(<MissingDetails revision="0" onEdit={edit} />);

    await userEvent.click(await screen.findByRole("button", { name: "Use Live for Album" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The Track or suggestion changed.");
    expect(edit).not.toHaveBeenCalled();
  });

  it("uses a reviewed Library candidate without asking AI", async () => {
    const accept = vi.fn(() => ({ status: 204 }));
    const { calls } = serve({
      [LIST]: () => ({
        body: { tracks: accept.mock.calls.length ? [] : [intro()], next_after: null },
      }),
      [DECIDE]: accept,
    });
    render(<MissingDetails revision="0" onEdit={vi.fn()} />);
    const section = screen.getByRole("region", { name: "Missing artist or album" });

    await userEvent.click(
      await within(section).findByRole("button", { name: "Use Live for Album" }),
    );

    expect(await within(section).findByText("No missing details on this page.")).toBeVisible();
    expect(accept).toHaveBeenCalledExactlyOnceWith({
      key: "reviewed-intro",
      field: "album",
      value: "Live",
      origin: "library",
    });
    expect(calls).not.toContain(ASK);
  });

  it("uses only the chosen album when more than one candidate is offered", async () => {
    const accept = vi.fn(() => ({ status: 204 }));
    serve({
      [LIST]: {
        body: {
          tracks: [
            intro({
              fields: [
                {
                  field: "album",
                  candidates: [
                    { value: "Live", origin: "library" },
                    { value: "Sessions", origin: "ai" },
                  ],
                },
              ],
            }),
          ],
          next_after: null,
        },
      },
      [DECIDE]: accept,
    });
    render(<MissingDetails revision="0" onEdit={vi.fn()} />);
    const album = within(await screen.findByRole("group", { name: "Album" }));
    const sessions = album.getByRole("radio", { name: "Sessions" });
    expect(album.getByRole("radio", { name: "Live" })).toHaveAccessibleDescription(
      "Already in Library",
    );
    expect(sessions).toHaveAccessibleDescription("Suggested by AI");

    await userEvent.click(album.getByRole("button", { name: "Suggested by AI" }));

    expect(await screen.findByRole("tooltip", { name: "Suggested by AI" })).toBeVisible();
    expect(sessions).not.toBeChecked();
    expect(album.getByRole("button", { name: "Use" })).toBeDisabled();

    await userEvent.click(sessions);
    expect(accept).not.toHaveBeenCalled();
    await userEvent.click(album.getByRole("button", { name: "Use Sessions for Album" }));

    expect(accept).toHaveBeenCalledExactlyOnceWith({
      key: "reviewed-intro",
      field: "album",
      value: "Sessions",
      origin: "ai",
    });
  });

  it("offers Edit and Skip for a field without a suggestion and skips only that field", async () => {
    const accept = vi.fn(() => ({ status: 204 }));
    const edit = vi.fn();
    serve({
      [LIST]: {
        body: {
          tracks: [
            intro({
              artist: "",
              fields: [
                { field: "artist", candidates: [] },
                { field: "album", candidates: [{ value: "Live", origin: "library" }] },
              ],
            }),
          ],
          next_after: null,
        },
      },
      [DECIDE]: accept,
    });
    render(<MissingDetails revision="0" onEdit={edit} />);
    const artist = within(await screen.findByRole("group", { name: "Artist" }));
    expect(artist.queryByRole("button", { name: /use/iu })).not.toBeInTheDocument();

    await userEvent.click(artist.getByRole("button", { name: "Edit details" }));
    expect(edit).toHaveBeenCalledExactlyOnceWith(7);
    expect(accept).not.toHaveBeenCalled();
    const skip = artist.getByRole("button", { name: "Skip Artist" });
    expect(skip).toHaveAccessibleDescription(/keeps this field blank/u);
    await userEvent.click(skip);

    expect(accept).toHaveBeenCalledExactlyOnceWith({ key: "reviewed-intro", field: "artist" });
  });

  it("puts Ask AI first in the compact actions and asks only after the listener clicks", async () => {
    const ask = vi.fn(() => ({ status: 202, body: { id: 8 } }));
    const { calls } = serve({
      [LIST]: () => ({
        body: {
          tracks: [intro({ ai: ask.mock.calls.length ? "working" : "ready" })],
          next_after: null,
        },
      }),
      [ASK]: ask,
    });
    render(<MissingDetails revision="0" onEdit={vi.fn()} />);
    const album = within(await screen.findByRole("group", { name: "Album" }));
    const button = album.getByRole("button", { name: "Ask AI" });

    expect(
      album
        .getAllByRole("button")
        .map((each) => each.textContent)
        .filter(Boolean),
    ).toEqual(["Ask AI", "Use", "Edit", "Skip"]);
    expect(button).toHaveAccessibleDescription(/all missing fields on this track/u);
    expect(button).toHaveAccessibleDescription(/enabled providers, which may be tried in turn/u);
    expect(calls).not.toContain(ASK);
    await userEvent.click(button);

    expect(ask).toHaveBeenCalledExactlyOnceWith({ key: "reviewed-intro" });
    await waitFor(() => {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-busy", "true");
    });
  });

  it("offers Ask again once for the track, even if the first field has no candidate", async () => {
    serve({
      [LIST]: {
        body: {
          tracks: [
            intro({
              ai: "answered",
              artist: "",
              fields: [
                { field: "artist", candidates: [] },
                { field: "album", candidates: [{ value: "Live", origin: "library" }] },
              ],
            }),
          ],
          next_after: null,
        },
      },
    });
    render(<MissingDetails revision="0" onEdit={vi.fn()} />);
    const artist = within(await screen.findByRole("group", { name: "Artist" }));

    expect(artist.getAllByRole("button").map((each) => each.textContent)).toEqual([
      "Ask again",
      "Edit",
      "Skip",
    ]);
    expect(screen.getByRole("button", { name: "Ask again" })).toBeEnabled();
    expect(screen.getByText("AI had no additional suggestions.")).toBeVisible();
  });

  it("preserves the current settings when an admin enables manual AI requests", async () => {
    const settings = settingsOf({ revision: 3 });
    const saved = settingsOf({ revision: 4, suggest_missing_details_by_ai: true });
    const save = vi.fn(() => ({ body: saved }));
    const onSettings = vi.fn();
    const { calls } = serve({ "PUT /api/settings": save });
    render(<MissingDetailsSettings settings={settings} onSettings={onSettings} />);

    await userEvent.click(screen.getByRole("switch", { name: "Suggest missing details with AI" }));

    expect(await screen.findByText("Saved.")).toBeVisible();
    expect(save).toHaveBeenCalledExactlyOnceWith({
      ...settings,
      suggest_missing_details_by_ai: true,
    });
    expect(onSettings).toHaveBeenCalledExactlyOnceWith(saved);
    expect(calls).not.toContain(ASK);
  });
});
