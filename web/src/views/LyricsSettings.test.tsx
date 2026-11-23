import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { enricherOf, preferencesOf, serve } from "../testing/server";
import { LyricsSettings } from "./LyricsSettings";
import { SettingsView } from "./SettingsView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps the confirmation choice for a member when Settings is reopened", async () => {
  const { calls } = serve(preferencesOf());
  const settings = (
    <SettingsView
      admin={false}
      mode={null}
      onModeChecked={vi.fn()}
      onEnrichersChanged={vi.fn()}
      onKindsChanged={vi.fn()}
    />
  );
  const opened = render(settings);
  const choice = () => screen.getByRole("combobox", { name: "Auto-Match lyrics" });
  const direct = () => within(choice()).getByRole("option", { name: "Search directly" });
  expect(await screen.findByRole("combobox", { name: "Auto-Match lyrics" })).toHaveDisplayValue(
    "Ask before searching",
  );

  await userEvent.selectOptions(choice(), direct());
  await screen.findByText("Saved.", { exact: true });
  opened.unmount();
  render(settings);

  expect(await screen.findByRole("combobox", { name: "Auto-Match lyrics" })).toHaveDisplayValue(
    "Search directly",
  );
  expect(calls.filter((call) => call === "PUT /api/me/preferences")).toHaveLength(1);
  expect(calls.some((call) => call.includes("/lyrics/match/"))).toBe(false);
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
