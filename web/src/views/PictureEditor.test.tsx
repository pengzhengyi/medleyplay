import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { beatlesPictures, helpFound, serve } from "../testing/server";
import { LanguageSelect } from "./LanguageSelect";
import { MAX_PICTURE_BYTES, PictureEditor, type PictureSources } from "./PictureEditor";

const COVERS = `GET /api/album-covers?${new URLSearchParams({ album: "Help!", artist: "The Beatles" }).toString()}`;
const PHOTO_SEARCH = "/api/image-search/artist/b10bbbfc";

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

function editing(sources: PictureSources, heading = "Replace album cover") {
  const onClose = vi.fn();
  render(<PictureEditor sources={sources} onClose={onClose} />);
  return { onClose, dialog: within(screen.getByRole("dialog", { name: heading })) };
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
  it("translates file restrictions and source guidance while keeping the same album and link", async () => {
    serve({ "GET /api/image-search": { body: { configured: false } } });
    const { dialog } = editing(helpCover());
    const user = userEvent.setup();
    const language = render(<LanguageSelect />).getByRole("combobox", { name: "Language" });

    try {
      await user.selectOptions(language, "zh-Hans");

      expect(screen.getByRole("dialog", { name: "更换专辑封面" })).toHaveAccessibleDescription(
        "Help!",
      );
      expect(dialog.getByText(/JPEG、PNG 或 WebP，最大 10 MiB/u)).toBeVisible();
      await user.click(dialog.getByRole("tab", { name: "Google" }));
      const source = dialog.getByRole("link", { name: "在 Google 图片中搜索" });
      expect(new URL(source.getAttribute("href") ?? "").searchParams.get("q")).toBe(
        "The Beatles Help! album cover",
      );
      expect(dialog.getByText("打开来源页面，保存有权使用的图片。")).toBeVisible();
    } finally {
      await user.selectOptions(language, "auto");
    }
  });

  it("opens on Upload without the Google Images link or starting a job", () => {
    const { calls } = serve({ "GET /api/image-search": { body: { configured: false } } });

    const { dialog } = editing(helpCover());

    const panel = within(dialog.getByRole("tabpanel", { name: "Upload" }));
    expect(panel.getByRole("button", { name: "Choose a file…" })).toBeVisible();
    expect(dialog.queryByRole("link", { name: "Search Google Images" })).not.toBeInTheDocument();
    const sources = dialog.getByRole("tablist", { name: "Where the cover comes from" });
    expect(dialog.getByText(/your provider may charge/u)).toBeVisible();
    expect(sources).toHaveAccessibleDescription(/Previews may load from other sites/u);
    expect(
      within(sources)
        .getAllByRole("tab")
        .map((tab) => tab.textContent.trim()),
    ).toEqual(["Upload", "MusicBrainz", "Google", "Ask AI"]);
    expect(dialog.getByRole("tab", { name: "Upload" })).toHaveAttribute("aria-selected", "true");
    expect(dialog.getByText("Help!")).toBeVisible();
    expect(calls).toEqual(["GET /api/image-search"]);
  });

  it("asks for one file when two supported pictures are dropped together", async () => {
    serve({});
    const { dialog } = editing(helpCover());
    const files = [jpeg("first.jpg"), jpeg("second.jpg")];

    fireEvent.drop(dialog.getByRole("button", { name: "Choose a file…" }), {
      dataTransfer: {
        files,
        items: files.map((file) => ({ kind: "file", getAsFile: () => file })),
        types: ["Files"],
      },
    });

    expect(await dialog.findByRole("alert")).toHaveTextContent("Choose one picture at a time.");
    expect(dialog.queryByRole("button", { name: "Use this cover" })).toBeNull();
  });

  it("clears the previous album's covers and retries the next album's read without asking again", async () => {
    const nextAlbum = { album: "Revolver", artist: "The Beatles" };
    const nextRoute = `GET /api/album-covers?${new URLSearchParams(nextAlbum).toString()}`;
    let reads = 0;
    const { calls } = serve({
      [COVERS]: { body: helpFound() },
      [nextRoute]: () =>
        ++reads === 1
          ? { status: 503, body: { detail: "Read unavailable." } }
          : { body: helpFound({ may_find: false, choice_failure: "Provider unavailable." }) },
    });
    const onClose = vi.fn();
    const initial = helpCover();
    const next = helpCover({
      of: nextAlbum.album,
      album: nextAlbum,
      pictured: { kind: "album", ...nextAlbum },
    });
    const { rerender } = render(
      <PictureEditor sources={initial} startOn="musicbrainz" onClose={onClose} />,
    );
    const covers = await screen.findAllByRole("button", { name: /^Use the cover of Help!/u });
    expect(covers[0]).toBeVisible();

    rerender(<PictureEditor sources={next} startOn="musicbrainz" onClose={onClose} />);

    expect(screen.queryAllByRole("button", { name: /^Use the cover of Help!/u })).toHaveLength(0);
    expect(await screen.findByRole("alert")).toHaveTextContent("Read unavailable.");
    await userEvent.click(screen.getByRole("button", { name: "Retry reading results" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not get the AI's picture choice: Provider unavailable.",
    );
    expect(screen.queryByRole("button", { name: "Look again" })).not.toBeInTheDocument();
    expect(calls.filter((call) => call.startsWith("POST"))).toEqual([]);
    expect(next.use).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
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
    const onClose = vi.fn();
    const { rerender } = render(<PictureEditor sources={sources} onClose={onClose} />, {
      reactStrictMode: true,
    });
    const dialog = within(screen.getByRole("dialog"));
    const user = userEvent.setup();
    const search = await dialog.findByRole("tab", { name: "Tavily" });
    expect(dialog.getAllByRole("tab").map((tab) => tab.textContent.trim())).toEqual([
      "Upload",
      "MusicBrainz",
      "Tavily",
      "Google",
      "Ask AI",
    ]);
    search.focus();
    expect(search).toHaveFocus();
    expect(calls).not.toContain("POST /api/image-search/results");

    await user.keyboard("{Enter}");

    expect(await dialog.findByRole("link", { name: /Original pressing/u })).toHaveAttribute(
      "href",
      page,
    );
    expect(searched).toEqual(subject);
    rerender(<PictureEditor sources={helpCover()} onClose={onClose} />);
    expect(calls.filter((call) => call === "POST /api/image-search/results")).toHaveLength(1);
    expect(sources.use).not.toHaveBeenCalled();
  });

  it("follows an already waiting Tavily job without submitting another search", async () => {
    const { calls } = serve({
      "GET /api/image-search": { body: { configured: true } },
      "GET /api/image-search/results?album=Help%21&artist=The+Beatles": {
        body: { searching: true, waiting: true, failure: null, images: [] },
      },
    });
    const { dialog } = editing(helpCover());

    await userEvent.click(await dialog.findByRole("tab", { name: "Tavily" }));

    expect(await dialog.findByText("Waiting to search.")).toBeVisible();
    expect(calls).not.toContain("POST /api/image-search/results");
  });

  it("shows a prefilled Google Images link and uses a saved file from below the instructions", async () => {
    const { calls } = serve({ "GET /api/image-search": { body: { configured: false } } });
    const sources = helpCover();
    const { dialog, onClose } = editing(sources);
    const user = userEvent.setup();

    await user.click(dialog.getByRole("tab", { name: "Google" }));

    const panel = within(dialog.getByRole("tabpanel", { name: "Google" }));
    const instructions = panel.getByRole("list");
    const steps = within(instructions).getAllByRole("listitem");
    const link = panel.getByRole<HTMLAnchorElement>("link", { name: "Search Google Images" });
    const search = new URL(link.href);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toContainElement(link);
    expect(search.hostname).toBe("www.google.com");
    expect(search.searchParams.get("q")).toBe("The Beatles Help! album cover");
    expect(search.searchParams.get("udm")).toBe("2");
    expect(steps[1]).toHaveTextContent(/permission/u);
    expect(steps[2]).toHaveTextContent("Replace the cover below.");
    expect(dialog.queryByRole("tab", { name: "Tavily" })).toBeNull();
    const file = jpeg("found.jpg");
    const choose = panel.getByLabelText("Choose a cover file");
    expect(instructions).not.toContainElement(choose);
    await user.upload(choose, file);
    expect(await panel.findByRole("img", { name: "The cover chosen" })).toBeVisible();
    expect(sources.upload).not.toHaveBeenCalled();
    await user.click(panel.getByRole("button", { name: "Use this cover" }));
    expect(sources.upload).toHaveBeenCalledWith(file);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
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

    const { dialog } = editing(
      helpCover({ album: undefined, pictured: undefined }),
      "Replace the cover",
    );

    for (const name of ["MusicBrainz", "Google", "Ask AI"]) {
      const tab = dialog.getByRole("tab", { name });
      expect(tab).toBeDisabled();
      expect(tab).toHaveAttribute("title", expect.stringMatching(/^Fill in the album/u));
    }
  });

  it("searches for the artist only when Tavily is selected and does not apply the results", async () => {
    const page = "https://label.example/artists/beatles";
    const images = [{ url: "https://label.example/portrait.jpg", page, title: "Band photo" }];
    const search = `POST ${PHOTO_SEARCH}/results`;
    let asked = false;
    const { calls } = serve({
      [`GET ${PHOTO_SEARCH}`]: { body: { configured: true, name: "The Beatles" } },
      [`GET ${PHOTO_SEARCH}/results`]: () => ({
        body: { searching: false, waiting: false, failure: null, images: asked ? images : [] },
      }),
      [search]: (body) => {
        expect(body).toBeUndefined();
        asked = true;
        return { status: 202, body: null };
      },
    });
    const sources = beatlesPhoto();
    const onClose = vi.fn();
    const { rerender } = render(<PictureEditor sources={sources} onClose={onClose} />, {
      reactStrictMode: true,
    });
    const dialog = within(screen.getByRole("dialog"));
    const tab = await dialog.findByRole("tab", { name: "Tavily" });
    expect(dialog.getAllByRole("tab").map((each) => each.textContent.trim())).toEqual([
      "Upload",
      "Deezer",
      "Tavily",
      "Google",
      "Ask AI",
    ]);
    tab.focus();
    expect(calls.filter((call) => call.endsWith("/results"))).toEqual([]);

    await userEvent.keyboard("{Enter}");

    expect(await dialog.findByRole("link", { name: "Band photo" })).toHaveAttribute("href", page);
    rerender(<PictureEditor sources={beatlesPhoto()} onClose={onClose} />);
    expect(calls.filter((call) => call.startsWith("POST "))).toEqual([search]);
    expect(sources.use).not.toHaveBeenCalled();
    expect(sources.upload).not.toHaveBeenCalled();
  });

  it("opens a keyless Google search and only uses the chosen photo when asked", async () => {
    const { calls } = serve({
      [`GET ${PHOTO_SEARCH}`]: { body: { configured: false, name: "The Beatles" } },
    });
    const sources = { ...beatlesPhoto(), of: "A library nickname" };
    const user = userEvent.setup();
    render(<PictureEditor sources={sources} onClose={vi.fn()} />);
    const dialog = within(screen.getByRole("dialog"));
    const google = await dialog.findByRole("tab", { name: "Google" });
    expect(dialog.queryByRole("link", { name: "Search Google Images" })).toBeNull();
    expect(dialog.queryByRole("tab", { name: "Tavily" })).toBeNull();

    await user.click(google);

    const panel = within(dialog.getByRole("tabpanel", { name: "Google" }));
    const link = panel.getByRole<HTMLAnchorElement>("link", { name: "Search Google Images" });
    const search = new URL(link.href);
    expect(search.hostname).toBe("www.google.com");
    expect(search.searchParams.get("q")).toBe("The Beatles artist photo");
    expect(search.searchParams.get("udm")).toBe("2");
    expect(panel.getByText(/source page.*permission/u)).toBeVisible();
    const file = jpeg("portrait.jpg");
    await user.upload(panel.getByLabelText("Choose a photo file"), file);
    expect(await panel.findByRole("img", { name: "The photo chosen" })).toBeVisible();
    expect(sources.upload).not.toHaveBeenCalled();
    await user.click(panel.getByRole("button", { name: "Use this photo" }));
    expect(sources.upload).toHaveBeenCalledWith(file);
    expect(calls).toEqual([`GET ${PHOTO_SEARCH}`]);
  });

  it("returns to Upload when the profile changes even if the name is the same", async () => {
    const other = "/api/image-search/artist/other-beatles";
    const settings = { body: { configured: true, name: "The Beatles" } };
    const { calls } = serve({
      [`GET ${PHOTO_SEARCH}`]: settings,
      [`GET ${PHOTO_SEARCH}/results`]: {
        body: { searching: true, waiting: true, failure: null, images: [] },
      },
      [`GET ${other}`]: settings,
    });
    const onClose = vi.fn();
    const { rerender } = render(<PictureEditor sources={beatlesPhoto()} onClose={onClose} />);
    const dialog = within(screen.getByRole("dialog"));
    await userEvent.click(await dialog.findByRole("tab", { name: "Tavily" }));
    expect(await dialog.findByText("Waiting to search.")).toBeVisible();

    rerender(
      <PictureEditor
        sources={{ ...beatlesPhoto(), artistId: "other-beatles" }}
        onClose={onClose}
      />,
    );

    const nextDialog = within(screen.getByRole("dialog"));
    expect(await nextDialog.findByRole("tab", { name: "Tavily" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(nextDialog.getByRole("tab", { name: "Upload" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(calls).toEqual([`GET ${PHOTO_SEARCH}`, `GET ${PHOTO_SEARCH}/results`, `GET ${other}`]);
  });

  it("does not offer web searches for a photo with no artist profile", () => {
    const { calls } = serve({});
    const sources = { ...beatlesPhoto(), artistId: undefined, pictured: undefined };

    render(<PictureEditor sources={sources} onClose={vi.fn()} />);

    expect(screen.queryByRole("tab", { name: "Google" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Tavily" })).toBeNull();
    expect(calls).toEqual([]);
  });

  it("uses a picture found on Deezer as the artist's photo, and closes", async () => {
    serve({
      [`GET ${PHOTO_SEARCH}`]: { body: { configured: false, name: "The Beatles" } },
      "GET /api/artists/b10bbbfc/pictures": { body: beatlesPictures() },
    });
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
