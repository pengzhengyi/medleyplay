import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RatingsImport } from "../api";
import { type Routes, serve } from "../testing/server";
import { RatingsSettings } from "./RatingsSettings";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * What importing an export of three albums would change: the Library has *Bremen*,
 * whose song joins the *4 stars* smart playlist and leaves *To rate*.
 */
const THREE_ALBUMS: RatingsImport = {
  albums: 3,
  matched_albums: 1,
  songs: 1,
  unmatched: [
    { artist: "Tony Allen", album: "Film of Life" },
    { artist: "スズム", album: "八日目" },
  ],
  playlists: [
    { id: "p1", name: "4 stars", joining: 1, leaving: 0 },
    { id: "p2", name: "To rate", joining: 0, leaving: 1 },
  ],
  replaced_albums: 0,
};

const EXPORT = new File(['RYM Album, First Name,...\n"1001",...\n'], "export.csv", {
  type: "text/csv",
});

/** Serve the section with `kept` albums imported before, and `routes` besides. */
function renderSettings(kept: number, routes: Routes = {}) {
  const served = serve({ "GET /api/ratings/import": { body: { albums: kept } }, ...routes });
  const onChanged = vi.fn();
  render(<RatingsSettings onChanged={onChanged} />);
  return { ...served, onChanged };
}

const choose = async () => {
  await userEvent.upload(await screen.findByLabelText("Rate Your Music export"), EXPORT);
};

describe("importing your Rate Your Music ratings", () => {
  it("says what importing changes before it imports", async () => {
    renderSettings(0, { "POST /api/ratings/import/preview": { body: THREE_ALBUMS } });

    await choose();

    const preview = await screen.findByRole("region", { name: "Before you import" });
    expect(preview).toHaveTextContent("3 albums rated or reviewed; your Library has 1 of them.");
    expect(preview).toHaveTextContent("1 song takes a new rating.");
    const playlists = within(preview).getByRole("list", { name: "Your smart playlists" });
    expect(
      within(playlists)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["4 stars: 1 song joins", "To rate: 1 song leaves"]);
  });

  it("lists the albums your Library hasn't, to save as a text file", async () => {
    renderSettings(0, { "POST /api/ratings/import/preview": { body: THREE_ALBUMS } });

    await choose();
    await userEvent.click(await screen.findByText("2 albums aren't in your Library"));

    const save = screen.getByRole("link", { name: "Save the list" });
    expect(save).toHaveAttribute("download", "albums-not-in-the-library.txt");
    expect(decodeURIComponent(save.getAttribute("href") ?? "")).toBe(
      "data:text/plain;charset=utf-8,Tony Allen – Film of Life\nスズム – 八日目\n",
    );
  });

  it("says which earlier import it replaces", async () => {
    renderSettings(5, {
      "POST /api/ratings/import/preview": { body: { ...THREE_ALBUMS, replaced_albums: 5 } },
    });

    await choose();

    expect(await screen.findByRole("region", { name: "Before you import" })).toHaveTextContent(
      "It replaces your earlier import of 5 albums.",
    );
  });

  it("imports once you say so, then says it did", async () => {
    const { calls, onChanged } = renderSettings(0, {
      "POST /api/ratings/import/preview": { body: THREE_ALBUMS },
      "POST /api/ratings/import": { body: THREE_ALBUMS },
    });
    await choose();

    await userEvent.click(await screen.findByRole("button", { name: "Import" }));

    expect(await screen.findByText("Imported 3 albums.")).toBeInTheDocument();
    expect(calls).toContain("POST /api/ratings/import");
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region", { name: "Before you import" })).toBeNull();
  });

  it("imports nothing when you cancel", async () => {
    const { calls } = renderSettings(0, {
      "POST /api/ratings/import/preview": { body: THREE_ALBUMS },
    });
    await choose();

    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("region", { name: "Before you import" })).toBeNull();
    expect(calls).not.toContain("POST /api/ratings/import");
  });

  it("says why an export can't be imported, beside where it was chosen", async () => {
    renderSettings(0, {
      "POST /api/ratings/import/preview": {
        status: 422,
        body: { detail: "The export's column 1 is 'Artist', not 'RYM Album'." },
      },
    });

    await choose();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The export's column 1 is 'Artist', not 'RYM Album'.",
    );
  });
});

describe("the import you keep", () => {
  it("can be forgotten, and says how many albums it has", async () => {
    const { calls, onChanged } = renderSettings(3, {
      "DELETE /api/ratings/import": { status: 204 },
    });

    expect(await screen.findByText("Your import has 3 albums.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Forget the import" }));

    expect(await screen.findByText("Forgot the import.")).toBeInTheDocument();
    expect(calls).toContain("DELETE /api/ratings/import");
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Forget the import" })).toBeNull();
  });

  it("isn't offered before you import", async () => {
    const { calls } = renderSettings(0);

    await vi.waitFor(() => {
      expect(calls).toContain("GET /api/ratings/import");
    });

    expect(screen.queryByRole("button", { name: "Forget the import" })).toBeNull();
  });
});

describe("exporting your ratings", () => {
  it("downloads them as a CSV file", async () => {
    renderSettings(0);

    const link = await screen.findByRole("link", { name: "Export your ratings" });

    expect(link).toHaveAttribute("href", "/api/ratings/export");
    expect(link).toHaveAttribute("download");
  });
});
