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

  it("discloses which providers are tried and only asks after the listener clicks", async () => {
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
    const button = await screen.findByRole("button", { name: "Ask AI" });

    expect(button).toHaveAccessibleDescription(/enabled providers, which may be tried in turn/u);
    expect(calls).not.toContain(ASK);
    await userEvent.click(button);

    expect(ask).toHaveBeenCalledExactlyOnceWith({ key: "reviewed-intro" });
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
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
