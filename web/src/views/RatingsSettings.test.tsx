import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ImportedAlbum, RatingsImport } from "../api";
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
  total_albums: 3,
};

/** The routes that preview, and import, merging with the earlier import. */
const PREVIEW = "POST /api/ratings/import/preview?mode=merge";
const IMPORT = "POST /api/ratings/import?mode=merge";

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
  await userEvent.upload(await screen.findByLabelText("Import ratings"), EXPORT);
};

describe("importing your Rate Your Music ratings", () => {
  it("says what importing changes before it imports", async () => {
    renderSettings(0, { [PREVIEW]: { body: THREE_ALBUMS } });

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
    renderSettings(0, { [PREVIEW]: { body: THREE_ALBUMS } });

    await choose();
    await userEvent.click(await screen.findByText("2 albums aren't in your Library"));

    const save = screen.getByRole("link", { name: "Save the list" });
    expect(save).toHaveAttribute("download", "albums-not-in-the-library.txt");
    expect(decodeURIComponent(save.getAttribute("href") ?? "")).toBe(
      "data:text/plain;charset=utf-8,Tony Allen – Film of Life\nスズム – 八日目\n",
    );
  });

  it("merges with your earlier import unless you choose to replace it", async () => {
    renderSettings(5, {
      [PREVIEW]: { body: { ...THREE_ALBUMS, replaced_albums: 1, total_albums: 7 } },
      "POST /api/ratings/import/preview?mode=replace": {
        body: { ...THREE_ALBUMS, replaced_albums: 5, total_albums: 3 },
      },
    });

    await choose();

    const preview = await screen.findByRole("region", { name: "Before you import" });
    expect(within(preview).getByRole("radio", { name: "Merge with it" })).toBeChecked();
    expect(preview).toHaveTextContent(
      "1 album you imported before takes its new rating. Your import will have 7 albums.",
    );
    await userEvent.click(within(preview).getByRole("radio", { name: "Replace it" }));
    expect(
      await within(preview).findByText(/It replaces your earlier import of 5 albums\./),
    ).toBeInTheDocument();
  });

  it("imports as the mode you chose", async () => {
    const { calls } = renderSettings(5, {
      "POST /api/ratings/import/preview?mode=replace": { body: THREE_ALBUMS },
      [PREVIEW]: { body: THREE_ALBUMS },
      "POST /api/ratings/import?mode=replace": { body: THREE_ALBUMS },
    });
    await choose();
    await userEvent.click(await screen.findByRole("radio", { name: "Replace it" }));

    await userEvent.click(await screen.findByRole("button", { name: "Import" }));

    expect(await screen.findByText("Imported 3 albums.")).toBeInTheDocument();
    expect(calls).toContain("POST /api/ratings/import?mode=replace");
    expect(calls).not.toContain(IMPORT);
  });

  it("offers no choice of mode before you import", async () => {
    renderSettings(0, { [PREVIEW]: { body: THREE_ALBUMS } });

    await choose();

    const preview = await screen.findByRole("region", { name: "Before you import" });
    expect(within(preview).queryByRole("radio")).toBeNull();
  });

  it("imports once you say so, then says it did", async () => {
    const { calls, onChanged } = renderSettings(0, {
      [PREVIEW]: { body: THREE_ALBUMS },
      [IMPORT]: { body: THREE_ALBUMS },
    });
    await choose();

    await userEvent.click(await screen.findByRole("button", { name: "Import" }));

    expect(await screen.findByText("Imported 3 albums.")).toBeInTheDocument();
    expect(calls).toContain(IMPORT);
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region", { name: "Before you import" })).toBeNull();
  });

  it("imports nothing when you cancel", async () => {
    const { calls } = renderSettings(0, {
      [PREVIEW]: { body: THREE_ALBUMS },
    });
    await choose();

    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("region", { name: "Before you import" })).toBeNull();
    expect(calls).not.toContain(IMPORT);
  });

  it("says why an export can't be imported, beside where it was chosen", async () => {
    renderSettings(0, {
      [PREVIEW]: {
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
  it("is discarded once you confirm it", async () => {
    const { calls, onChanged } = renderSettings(3, {
      "DELETE /api/ratings/import": { status: 204 },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Discard import" }));
    expect(screen.getByText(/Discard the 3 albums you imported\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(await screen.findByText("Discarded the import.")).toBeInTheDocument();
    expect(calls).toContain("DELETE /api/ratings/import");
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Discard import" })).toBeDisabled();
  });

  it("stays when you keep it", async () => {
    const { calls } = renderSettings(3);

    await userEvent.click(await screen.findByRole("button", { name: "Discard import" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));

    expect(screen.queryByText(/Discard the 3 albums/)).toBeNull();
    expect(calls).not.toContain("DELETE /api/ratings/import");
  });

  it("can't be discarded before you import", async () => {
    const { calls } = renderSettings(0);

    await vi.waitFor(() => {
      expect(calls).toContain("GET /api/ratings/import");
    });

    expect(screen.getByRole("button", { name: "Discard import" })).toBeDisabled();
    expect(screen.queryByText(/Your imported ratings/)).toBeNull();
  });
});

/**
 * Three imported albums: *Bremen*, 5 stars, in the Library; *Film of Life*, 4 stars
 * and reviewed; and *Now*, reviewed only.
 */
const IMPORTED: ImportedAlbum[] = [
  { artist: "ハチ", album: "Bremen", stars: 5, note: "", in_library: true },
  {
    artist: "Tony Allen",
    album: "Film of Life",
    stars: 4,
    note: "Warm & loose.",
    in_library: false,
  },
  { artist: "김정미", album: "Now", stars: null, note: "Haunting.", in_library: false },
];

describe("your imported ratings", () => {
  const openList = async () => {
    await userEvent.click(await screen.findByText("Your imported ratings (3 albums)"));
    return screen.findByRole("table");
  };

  it("lists each album with its rating and review, once opened", async () => {
    const { calls } = renderSettings(3, { "GET /api/ratings/imported": { body: IMPORTED } });
    await screen.findByText("Your imported ratings (3 albums)");
    expect(calls).not.toContain("GET /api/ratings/imported");

    const table = await openList();

    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((each) => within(each).getAllByRole("cell")[0]?.textContent)).toEqual([
      "Bremen",
      "Film of LifeNot in Library",
      "NowNot in Library",
    ]);
    const stars = within(table).getByRole("img", { name: "5 stars" });
    expect(stars).toHaveTextContent("★★★★★");
    expect(stars.closest("tr")).toHaveTextContent("Bremen");
    expect(rows[1]).toHaveTextContent("Warm & loose.");
    expect(within(table).getByText("Reviewed").closest("tr")).toHaveTextContent("Now");
  });

  it("narrows to the albums whose artist or name holds what you type", async () => {
    renderSettings(3, { "GET /api/ratings/imported": { body: IMPORTED } });
    const table = await openList();

    await userEvent.type(
      screen.getByRole("searchbox", { name: "Filter your imported ratings" }),
      "allen",
    );

    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(1);
    expect(table).toHaveTextContent("Film of Life");
  });

  it("says when no album matches", async () => {
    renderSettings(3, { "GET /api/ratings/imported": { body: IMPORTED } });
    await openList();

    await userEvent.type(
      screen.getByRole("searchbox", { name: "Filter your imported ratings" }),
      "zzz",
    );

    expect(screen.getByText("No imported album matches “zzz”.")).toBeInTheDocument();
  });
});

describe("exporting your ratings", () => {
  it("downloads them as a CSV file", async () => {
    renderSettings(0);

    const link = await screen.findByRole("button", { name: "Export ratings" });

    expect(link).toHaveAttribute("href", "/api/ratings/export");
    expect(link).toHaveAttribute("download");
  });
});
