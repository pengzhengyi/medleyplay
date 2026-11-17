import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { helpFound, serve } from "../testing/server";
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
  it("offers a cover from this device, from MusicBrainz, or from the AI, starting on Upload", () => {
    serve({});

    const { dialog } = editing(helpCover());

    const sources = dialog.getByRole("tablist", { name: "Where the cover comes from" });
    expect(
      within(sources)
        .getAllByRole("tab")
        .map((tab) => tab.textContent.trim()),
    ).toEqual(["Upload", "MusicBrainz", "Ask AI"]);
    expect(dialog.getByRole("tab", { name: "Upload" })).toHaveAttribute("aria-selected", "true");
    expect(dialog.getByText("Help!")).toBeVisible();
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

    for (const name of ["MusicBrainz", "Ask AI"]) {
      const tab = dialog.getByRole("tab", { name });
      expect(tab).toBeDisabled();
      expect(tab).toHaveAttribute("title", expect.stringMatching(/^Fill in the album/u));
    }
  });

  it("offers an artist's photo from this device or from the AI, MusicBrainz having none", () => {
    serve({});

    render(
      <PictureEditor
        sources={helpCover({
          kind: "photo",
          of: "The Beatles",
          shown: null,
          album: undefined,
          pictured: { kind: "artist", artistId: "b10bbbfc" },
        })}
        onClose={vi.fn()}
      />,
    );

    const dialog = within(screen.getByRole("dialog", { name: "Add a photo" }));
    expect(dialog.getAllByRole("tab").map((tab) => tab.textContent.trim())).toEqual([
      "Upload",
      "Ask AI",
    ]);
  });
});
