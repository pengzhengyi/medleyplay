import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { beatlesPictures, helpFound, serve } from "../testing/server";
import { MAX_PICTURE_BYTES, PictureEditor, type PictureSources } from "./PictureEditor";

const COVERS = `GET /api/album-covers?${new URLSearchParams({ album: "Help!", artist: "The Beatles" }).toString()}`;

/** The cover of *Help!* by The Beatles, shown now as `cover-now`. */
function helpCover(change: Partial<PictureSources> = {}): PictureSources {
  return {
    kind: "cover",
    of: "Help!",
    shown: "cover-now",
    album: { album: "Help!", artist: "The Beatles" },
    pictured: { kind: "album", album: "Help!", artist: "The Beatles" },
    upload: vi.fn(() => Promise.resolve()),
    use: vi.fn(() => Promise.resolve()),
    ...change,
  };
}

/** The Beatles' photo, none yet, to add from this device, Deezer, or the AI. */
function beatlesPhoto(): PictureSources {
  return helpCover({
    kind: "photo",
    of: "The Beatles",
    shown: null,
    album: undefined,
    artistId: "b10bbbfc",
    pictured: { kind: "artist", artistId: "b10bbbfc" },
  });
}

function editing(sources: PictureSources) {
  const onClose = vi.fn();
  render(<PictureEditor sources={sources} onClose={onClose} />);
  return { onClose, dialog: within(screen.getByRole("dialog", { name: "Replace the cover" })) };
}

/** A JPEG named `name`, of `size` bytes. */
function jpeg(name: string, size?: number): File {
  const file = new File(["jpeg"], name, { type: "image/jpeg" });
  if (size !== undefined) {
    Object.defineProperty(file, "size", { value: size });
  }
  return file;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the picture editor", () => {
  it("opens on Upload with a keyless image search for this album and makes no request", () => {
    const { calls } = serve({});

    const { dialog } = editing(helpCover());

    const sources = dialog.getByRole("tablist", { name: "Where the cover comes from" });
    expect(
      within(sources)
        .getAllByRole("tab")
        .map((tab) => tab.textContent.trim()),
    ).toEqual(["Upload", "MusicBrainz", "Image search", "Ask AI"]);
    expect(dialog.getByRole("tab", { name: "Upload" })).toHaveAttribute("aria-selected", "true");
    expect(dialog.getByText("Help!")).toBeVisible();
    const link = dialog.getByRole("link", { name: "Search Google Images" });
    const search = new URL((link as HTMLAnchorElement).href);
    expect(search.hostname).toBe("www.google.com");
    expect(search.searchParams.get("q")).toBe("The Beatles Help! album cover");
    expect(search.searchParams.get("udm")).toBe("2");
    expect(calls).toEqual([]);
  });

  it("searches with Tavily only on request and opens the candidate's source without saving", async () => {
    const subject = { album: "Help!", artist: "The Beatles" };
    const read = `GET /api/image-search/results?${new URLSearchParams(subject).toString()}`;
    const page = "https://label.example/albums/help";
    const images = [{ url: "https://label.example/art.jpg", page, title: "Original pressing" }];
    let searched: unknown;
    const { calls } = serve({
      "GET /api/image-search": { body: { configured: true } },
      [read]: () => ({
        body: { searching: false, waiting: false, failure: null, images: searched ? images : [] },
      }),
      "POST /api/image-search/results": (body) => {
        searched = body;
        return { status: 202, body: null };
      },
    });
    const sources = helpCover();
    const { dialog } = editing(sources);
    const user = userEvent.setup();
    await user.click(dialog.getByRole("tab", { name: "Image search" }));
    const search = await dialog.findByRole("button", { name: "Search with Tavily" });
    expect(calls).not.toContain("POST /api/image-search/results");

    await user.click(search);

    expect(await dialog.findByRole("link", { name: /Original pressing/u })).toHaveAttribute(
      "href",
      page,
    );
    expect(searched).toEqual(subject);
    expect(sources.use).not.toHaveBeenCalled();
  });

  it("keeps external search available without a Tavily key", async () => {
    const { calls } = serve({ "GET /api/image-search": { body: { configured: false } } });
    const { dialog } = editing(helpCover());

    await userEvent.click(dialog.getByRole("tab", { name: "Image search" }));

    expect(await dialog.findByText(/key in Settings/u)).toBeVisible();
    expect(dialog.getByRole("link", { name: "Search Google Images" })).toBeVisible();
    expect(dialog.queryByRole("button", { name: "Search with Tavily" })).toBeNull();
    expect(calls).toEqual(["GET /api/image-search"]);
  });

  it("shows a picture chosen before using it, and closes once it is used", async () => {
    serve({});
    const sources = helpCover();
    const { onClose, dialog } = editing(sources);
    const user = userEvent.setup();

    await user.upload(dialog.getByLabelText("Choose a cover file"), jpeg("help.jpg"));
    expect(await dialog.findByRole("img", { name: "The cover chosen" })).toHaveAttribute(
      "src",
      "blob:picture",
    );
    expect(sources.upload).not.toHaveBeenCalled();
    await user.click(dialog.getByRole("button", { name: "Use this cover" }));

    expect(sources.upload).toHaveBeenCalledWith(expect.objectContaining({ name: "help.jpg" }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it("refuses a picture past 10 MiB, or one that is no image, saying why", async () => {
    serve({});
    const { dialog } = editing(helpCover());
    const user = userEvent.setup({ applyAccept: false });

    await user.upload(
      dialog.getByLabelText("Choose a cover file"),
      jpeg("huge.jpg", MAX_PICTURE_BYTES + 1),
    );
    expect(await dialog.findByRole("alert")).toHaveTextContent("A picture is at most 10 MiB.");
    await user.upload(
      dialog.getByLabelText("Choose a cover file"),
      new File(["%PDF"], "notes.pdf", { type: "application/pdf" }),
    );

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Choose a JPEG, PNG, or WebP image.",
    );
    expect(dialog.queryByRole("button", { name: "Use this cover" })).toBeNull();
  });

  it("uses a cover chosen on MusicBrainz, and closes", async () => {
    serve({ [COVERS]: { body: helpFound() } });
    const sources = helpCover();
    const { onClose, dialog } = editing(sources);
    const user = userEvent.setup();

    await user.click(dialog.getByRole("tab", { name: "MusicBrainz" }));
    await user.click(await dialog.findByRole("button", { name: /1987, GB, CD/u }));

    expect(sources.use).toHaveBeenCalledWith("cover-1987");
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it("stays open and says why when the cover can't be used", async () => {
    serve({ [COVERS]: { body: helpFound() } });
    const sources = helpCover({
      use: vi.fn(() => Promise.reject(new Error("The cover is gone."))),
    });
    const { onClose, dialog } = editing(sources);
    const user = userEvent.setup();

    await user.click(dialog.getByRole("tab", { name: "MusicBrainz" }));
    await user.click(await dialog.findByRole("button", { name: /1987, GB, CD/u }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("The cover is gone.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("can't look up the cover of a song on no album, and says how to", () => {
    serve({});

    const { dialog } = editing(helpCover({ album: undefined, pictured: undefined }));

    for (const name of ["MusicBrainz", "Image search", "Ask AI"]) {
      const tab = dialog.getByRole("tab", { name });
      expect(tab).toBeDisabled();
      expect(tab).toHaveAttribute("title", expect.stringMatching(/^Fill in the album/u));
    }
  });

  it("offers an artist's photo from this device, Deezer, or the AI, MusicBrainz having none", () => {
    serve({});

    render(<PictureEditor sources={beatlesPhoto()} onClose={vi.fn()} />);

    const dialog = within(screen.getByRole("dialog", { name: "Add a photo" }));
    expect(dialog.getAllByRole("tab").map((tab) => tab.textContent.trim())).toEqual([
      "Upload",
      "Deezer",
      "Ask AI",
    ]);
  });

  it("uses a picture found on Deezer as the artist's photo, and closes", async () => {
    serve({ "GET /api/artists/b10bbbfc/pictures": { body: beatlesPictures() } });
    const sources = beatlesPhoto();
    const onClose = vi.fn();
    render(<PictureEditor sources={sources} onClose={onClose} />);
    const dialog = within(screen.getByRole("dialog", { name: "Add a photo" }));
    const user = userEvent.setup();

    await user.click(dialog.getByRole("tab", { name: "Deezer" }));
    await user.click(
      await dialog.findByRole("button", { name: /^Use the picture of The Beatles,/u }),
    );

    expect(sources.use).toHaveBeenCalledWith("picture-beatles");
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
