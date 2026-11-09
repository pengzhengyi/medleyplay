import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useContext } from "react";
import { describe, expect, it, vi } from "vitest";

import { ApiError, type Details, type VideoRead, type VideoText } from "../api";
import { LOOKUPS, type Lookup } from "../library/lookups";
import type { TrackLookup } from "../library/useLibrary";
import { ALBUM_FILE_ORIGINS, TAGGED_ORIGINS, detailsOf, trackOf } from "../testing/server";
import { EditDetails } from "./EditDetails";
import { SongsControlsContext } from "./songsControls";

const ALBUM_FILE = trackOf(7, "ケビョウニンゲン");

async function renderDialog(
  details: Details = detailsOf(7),
  onSave = vi.fn<(changes: object) => Promise<void>>(() => Promise.resolve()),
  onReadVideo = vi.fn<(text: VideoText) => Promise<VideoRead>>(() =>
    Promise.reject(new Error("No video read in this test.")),
  ),
  more: {
    onSetCover?: (image: Blob) => Promise<Details>;
    onRemoveCover?: () => Promise<Details>;
    /** The lookups the song may be asked about now. */
    findable?: readonly Lookup[];
    /** The lookup last asked about the song. */
    lookup?: TrackLookup;
    /** The details read again once a lookup is done. */
    reloaded?: Details;
    /** The way to the songs of the song's file. */
    songs?: { readonly label: string; readonly editor: ReactNode };
  } = {},
) {
  const onClose = vi.fn();
  const onFind = vi.fn<(lookup: Lookup) => void>();
  const load = vi.fn(() => Promise.resolve(details));
  const dialogOf = (lookup: TrackLookup | undefined) => (
    <EditDetails
      track={ALBUM_FILE}
      load={load}
      onSave={onSave}
      onReadVideo={onReadVideo}
      onSetCover={more.onSetCover ?? (() => Promise.reject(new Error("No cover in this test.")))}
      onRemoveCover={
        more.onRemoveCover ?? (() => Promise.reject(new Error("No cover in this test.")))
      }
      findable={more.findable ?? []}
      lookup={lookup}
      online
      onFind={onFind}
      songs={more.songs}
      onClose={onClose}
    />
  );
  const { rerender } = render(dialogOf(more.lookup));
  const dialog = screen.getByRole("dialog", { name: "Edit details" });
  await within(dialog).findByRole("textbox", { name: "Title" });
  /** Show the dialog as the page would once the song's lookup is `lookup`. */
  const lookUp = (lookup: TrackLookup) => {
    if (more.reloaded !== undefined) {
      load.mockResolvedValue(more.reloaded);
    }
    rerender(dialogOf(lookup));
  };
  return { dialog, onSave, onClose, onFind, load, lookUp };
}

/** The lookup that asks MusicBrainz. */
const MUSICBRAINZ = ((): Lookup => {
  const found = LOOKUPS.find((lookup) => lookup.enricher === "musicbrainz");
  if (found === undefined) {
    throw new Error("No lookup asks MusicBrainz.");
  }
  return found;
})();

const NUMBERS = new Set(["Track", "Disc", "Year"]);

/** The box of the detail labelled `name`. */
const box = (dialog: HTMLElement, name: string) =>
  within(dialog).getByRole(NUMBERS.has(name) ? "spinbutton" : "textbox", { name });

const use = (dialog: HTMLElement, value: string, from: string) =>
  userEvent.click(within(dialog).getByRole("button", { name: `Use “${value}”, from ${from}` }));

const save = (dialog: HTMLElement) =>
  userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

/**
 * The details of a video with an AI model's suggestion:
 *
 * ```text
 * video   title "ケビョウニンゲン", artist "GUMI/MAYU"
 * ai      title "Sick Human", artist "GUMI", album "Re:Start", year 2014
 * ```
 */
const SUGGESTED = detailsOf(
  7,
  {},
  {
    ...ALBUM_FILE_ORIGINS,
    ai: { title: "Sick Human", artist: "GUMI", album: "Re:Start", year: 2014 },
  },
);

const useSuggested = (dialog: HTMLElement, value: string) =>
  userEvent.click(
    within(dialog).getByRole("button", { name: `Use “${value}”, suggested by the AI` }),
  );

describe("editing a song's details", () => {
  it("tags where each value came from in a word or two, saying it in full on hover", async () => {
    const { dialog } = await renderDialog();

    const tag = document.getElementById(
      box(dialog, "Title").getAttribute("aria-describedby") ?? "",
    );
    expect(tag).toHaveClass("origin-tag");
    expect(tag).toHaveAttribute("title", "From the video");
    expect(tag?.textContent).toContain("BV");
  });

  it("shows each detail's value and where it came from", async () => {
    const { dialog } = await renderDialog();

    expect(box(dialog, "Title")).toHaveValue("ケビョウニンゲン");
    expect(box(dialog, "Title")).toHaveAccessibleDescription("From the video");
    expect(box(dialog, "Album")).toHaveValue("");
    expect(dialog).toHaveAccessibleDescription("ケビョウニンゲン");
  });

  it("saves only the details changed", async () => {
    const { dialog, onSave, onClose } = await renderDialog();

    await userEvent.type(box(dialog, "Album"), "Re:Start");
    await userEvent.type(box(dialog, "Year"), "2014");
    await save(dialog);

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ album: "Re:Start", year: 2014 });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers what other origins say, and keeps the one chosen as the household's", async () => {
    const { dialog, onSave } = await renderDialog();

    await use(dialog, "BV1dm4y1s7ak", "the file's name");

    expect(box(dialog, "Title")).toHaveValue("BV1dm4y1s7ak");
    expect(box(dialog, "Title")).toHaveAccessibleDescription("Yours");
    await save(dialog);
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ title: "BV1dm4y1s7ak" });
  });

  it("drops the household's value when what would show anyway is chosen", async () => {
    const { dialog, onSave } = await renderDialog(detailsOf(7, { title: "Sick Human" }));

    await use(dialog, "ケビョウニンゲン", "the video");
    await save(dialog);

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ title: null });
  });

  it("drops a value typed back to what would show anyway", async () => {
    const { dialog, onSave } = await renderDialog();

    await userEvent.type(box(dialog, "Title"), "!{Backspace}");

    expect(box(dialog, "Title")).toHaveAccessibleDescription("From the video");
    await save(dialog);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("drops a value that reads as what would show anyway, so '03' is track 3", async () => {
    const { dialog, onSave } = await renderDialog(detailsOf(3, {}, TAGGED_ORIGINS));

    await userEvent.clear(box(dialog, "Track"));
    await userEvent.type(box(dialog, "Track"), "03");
    await userEvent.type(box(dialog, "Title"), " ");
    await save(dialog);

    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves nothing for a box emptied where nothing is found", async () => {
    const { dialog, onSave } = await renderDialog();

    await userEvent.type(box(dialog, "Genre"), "a{Backspace}");

    expect(box(dialog, "Genre")).not.toHaveAccessibleDescription("Yours");
    await save(dialog);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("closes without a request when nothing changed, keeping the household's empty text", async () => {
    const { dialog, onSave, onClose } = await renderDialog(detailsOf(7, { genre: "" }));

    await save(dialog);

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  describe("with the album fields, which come together from one origin", () => {
    it("empties the file's track and year once the household names another album", async () => {
      const { dialog } = await renderDialog(detailsOf(3, {}, TAGGED_ORIGINS));

      await userEvent.clear(box(dialog, "Album"));
      await userEvent.type(box(dialog, "Album"), "Other");

      expect(box(dialog, "Track")).toHaveValue(null);
      expect(box(dialog, "Track")).toHaveAccessibleDescription("Hidden, as your album differs");
      expect(box(dialog, "Year")).toHaveValue(null);
    });

    it("keeps a value of the file's chosen under the household's album", async () => {
      const { dialog, onSave } = await renderDialog(detailsOf(3, {}, TAGGED_ORIGINS));

      await userEvent.clear(box(dialog, "Album"));
      await userEvent.type(box(dialog, "Album"), "Other");
      await use(dialog, "3", "the file's tags");
      await save(dialog);

      expect(onSave).toHaveBeenCalledExactlyOnceWith({ album: "Other", track_number: 3 });
    });

    it("brings the file's album fields back when its album is chosen again", async () => {
      const { dialog, onSave } = await renderDialog(
        detailsOf(3, { album: "Other" }, TAGGED_ORIGINS),
      );

      await use(dialog, "Re:Start", "the file's tags");

      expect(box(dialog, "Album artist")).toHaveValue("MAYU");
      await save(dialog);
      expect(onSave).toHaveBeenCalledExactlyOnceWith({ album: null });
    });
  });

  it("says what shows when a number of the household's is left empty", async () => {
    const { dialog, onSave } = await renderDialog(detailsOf(3, { year: 2016 }, TAGGED_ORIGINS));

    await userEvent.clear(box(dialog, "Year"));

    expect(box(dialog, "Year")).toHaveAccessibleDescription(
      "Left empty, so 2014 from the file's tags shows",
    );
    await save(dialog);
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ year: null });
  });

  it("says why the server refused, and stays open", async () => {
    const refuse = vi.fn(() => Promise.reject(new ApiError(404, "There is no Track 7.")));
    const { dialog, onClose } = await renderDialog(detailsOf(7), refuse);

    await userEvent.type(box(dialog, "Album"), "Re:Start");
    await save(dialog);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("There is no Track 7.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("can't be cancelled while a save is under way", async () => {
    const { dialog } = await renderDialog(
      detailsOf(7),
      vi.fn(() => new Promise<void>(() => undefined)),
    );

    await userEvent.type(box(dialog, "Album"), "Re:Start");
    await save(dialog);
    await userEvent.keyboard("{Escape}");

    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(dialog).toHaveAttribute("open");
  });

  it("is dismissed with Cancel, saving nothing", async () => {
    const { dialog, onSave, onClose } = await renderDialog();

    await userEvent.type(box(dialog, "Artist"), " feat. Hatsune");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("says why the details couldn't be read, and can't be saved", async () => {
    render(
      <EditDetails
        track={ALBUM_FILE}
        load={() => Promise.reject(new ApiError(404, "There is no Track 7."))}
        onSave={vi.fn()}
        onReadVideo={vi.fn()}
        onSetCover={vi.fn()}
        onRemoveCover={vi.fn()}
        findable={[]}
        lookup={undefined}
        online
        onFind={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Edit details" });

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("There is no Track 7.");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  describe("pasting the video's details", () => {
    /** An album video's title and description, as Bilibili shows them. */
    const BREMEN: VideoText = {
      title: "ハチ 全专《Bremen》",
      description: `ハチの1stアルバム
00:00 アイネクライネ
04:12 ゴーゴー幽霊船 - ハチ`,
    };

    /** What the server reads from `BREMEN`: the album, by ハチ, and its two songs. */
    const BREMEN_READ: VideoRead = {
      details: detailsOf(
        7,
        {},
        {
          video: { title: "Bremen", artist: "ハチ", album: "Bremen", album_artist: "ハチ" },
          file_name: { title: "BV1dm4y1s7ak" },
        },
        BREMEN,
      ),
      songs: [
        { start_ms: 0, title: "アイネクライネ", artist: "" },
        { start_ms: 252_000, title: "ゴーゴー幽霊船", artist: "ハチ" },
      ],
    };

    const paste = async (dialog: HTMLElement, text: VideoText) => {
      await userEvent.click(within(dialog).getByText("Paste the video's details"));
      await userEvent.click(within(dialog).getByRole("textbox", { name: "Video title" }));
      await userEvent.paste(text.title);
      await userEvent.click(within(dialog).getByRole("textbox", { name: "Description" }));
      await userEvent.paste(text.description);
    };

    const read = (dialog: HTMLElement) =>
      userEvent.click(within(dialog).getByRole("button", { name: "Read details" }));

    it("reads a pasted title and description, and shows what they say", async () => {
      const onReadVideo = vi.fn(() => Promise.resolve(BREMEN_READ));
      const { dialog } = await renderDialog(detailsOf(7), undefined, onReadVideo);

      await paste(dialog, BREMEN);
      await read(dialog);

      expect(onReadVideo).toHaveBeenCalledExactlyOnceWith(BREMEN);
      expect(box(dialog, "Album")).toHaveValue("Bremen");
      expect(box(dialog, "Album")).toHaveAccessibleDescription("From the video");
      expect(within(dialog).getByRole("status")).toHaveTextContent(
        "Read the video's details: title, artist, album, and album artist. It lists 2 songs.",
      );
    });

    it("says when the video's details gave nothing to fill in", async () => {
      const nothing: VideoRead = { details: detailsOf(7, {}, {}, BREMEN), songs: [] };
      const { dialog } = await renderDialog(
        detailsOf(7),
        undefined,
        vi.fn(() => Promise.resolve(nothing)),
      );

      await paste(dialog, BREMEN);
      await read(dialog);

      expect(within(dialog).getByRole("status")).toHaveTextContent(
        "Read the video's details, but found no details in them.",
      );
    });

    it("shows a value the household typed as the video's once the video gives it too", async () => {
      const { dialog, onSave } = await renderDialog(
        detailsOf(7),
        undefined,
        vi.fn(() => Promise.resolve(BREMEN_READ)),
      );

      await userEvent.type(box(dialog, "Album"), "Bremen");
      await paste(dialog, BREMEN);
      await read(dialog);

      expect(box(dialog, "Album")).toHaveAccessibleDescription("From the video");
      await save(dialog);
      expect(onSave).not.toHaveBeenCalled();
    });

    it("can't read while a save is under way", async () => {
      const onReadVideo = vi.fn(() => Promise.resolve(BREMEN_READ));
      const { dialog } = await renderDialog(
        detailsOf(7),
        vi.fn(() => new Promise<void>(() => undefined)),
        onReadVideo,
      );

      await paste(dialog, BREMEN);
      await userEvent.type(box(dialog, "Genre"), "Vocaloid");
      await save(dialog);

      expect(within(dialog).getByRole("button", { name: "Read details" })).toBeDisabled();
      await userEvent.type(within(dialog).getByRole("textbox", { name: "Video title" }), "{Enter}");
      expect(onReadVideo).not.toHaveBeenCalled();
    });

    it("doesn't read on the Enter that ends composing a word", async () => {
      const onReadVideo = vi.fn(() => Promise.resolve(BREMEN_READ));
      const { dialog } = await renderDialog(detailsOf(7), undefined, onReadVideo);
      await paste(dialog, BREMEN);

      fireEvent.keyDown(within(dialog).getByRole("textbox", { name: "Video title" }), {
        key: "Enter",
        isComposing: true,
      });

      expect(onReadVideo).not.toHaveBeenCalled();
    });

    it("keeps what the household typed when the video's details are read", async () => {
      const { dialog } = await renderDialog(
        detailsOf(7),
        undefined,
        vi.fn(() => Promise.resolve(BREMEN_READ)),
      );

      await userEvent.clear(box(dialog, "Title"));
      await userEvent.type(box(dialog, "Title"), "Sick Human");
      await paste(dialog, BREMEN);
      await read(dialog);

      expect(box(dialog, "Title")).toHaveValue("Sick Human");
      expect(box(dialog, "Title")).toHaveAccessibleDescription("Yours");
    });

    it("opens with the video's text read before", async () => {
      const { dialog } = await renderDialog(detailsOf(7, {}, ALBUM_FILE_ORIGINS, BREMEN));

      await userEvent.click(within(dialog).getByText("Paste the video's details"));

      expect(within(dialog).getByRole("textbox", { name: "Video title" })).toHaveValue(
        BREMEN.title,
      );
      expect(within(dialog).getByRole("textbox", { name: "Description" })).toHaveValue(
        BREMEN.description,
      );
    });

    it("reads rather than saves on Enter in the video's title", async () => {
      const onSave = vi.fn(() => Promise.resolve());
      const onReadVideo = vi.fn(() => Promise.resolve(BREMEN_READ));
      const { dialog } = await renderDialog(detailsOf(7), onSave, onReadVideo);

      await paste(dialog, { title: BREMEN.title, description: "" });
      await userEvent.type(within(dialog).getByRole("textbox", { name: "Video title" }), "{Enter}");

      expect(onReadVideo).toHaveBeenCalledOnce();
      expect(onSave).not.toHaveBeenCalled();
    });

    it("says why the video's details couldn't be read", async () => {
      const { dialog } = await renderDialog(
        detailsOf(7),
        undefined,
        vi.fn(() => Promise.reject(new ApiError(422, "The description is too long."))),
      );

      await paste(dialog, BREMEN);
      await read(dialog);

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "The description is too long.",
      );
      expect(box(dialog, "Album")).toHaveValue("");
    });
  });

  describe("the cover", () => {
    const COVER = "5f3b6c9e0a1d2f4b8c7e6a5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c4b3a291";
    /** A PNG image the household chose. */
    const PNG = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "Bremen.png", {
      type: "image/png",
    });

    it("shows the cover and where it came from", async () => {
      const { dialog } = await renderDialog(detailsOf(7, {}, { video: { cover: COVER } }));

      expect(within(dialog).getByRole("img", { name: "Cover" })).toHaveAttribute(
        "src",
        `/api/covers/${COVER}`,
      );
      expect(within(dialog).getByText("From the video")).toBeInTheDocument();
    });

    it("uploads an image chosen as the household's cover, and shows it", async () => {
      const onSetCover = vi.fn(() => Promise.resolve(detailsOf(7, { cover: COVER })));
      const { dialog } = await renderDialog(detailsOf(7), undefined, undefined, { onSetCover });

      await userEvent.upload(within(dialog).getByLabelText("Add a cover"), PNG);

      expect(onSetCover).toHaveBeenCalledExactlyOnceWith(PNG);
      expect(await within(dialog).findByRole("img", { name: "Cover" })).toHaveAttribute(
        "src",
        `/api/covers/${COVER}`,
      );
      expect(within(dialog).getByText("Yours")).toBeInTheDocument();
    });

    it("offers the cover shown to save as an image, or to replace", async () => {
      const onSetCover = vi.fn(() => Promise.resolve(detailsOf(7, { cover: COVER })));
      const { dialog } = await renderDialog(
        detailsOf(7, {}, { video: { cover: COVER } }),
        undefined,
        undefined,
        { onSetCover },
      );

      const saveImage = within(dialog).getByRole("link", { name: "Save the cover image" });
      await userEvent.upload(within(dialog).getByLabelText("Replace the cover"), PNG);

      expect(saveImage).toHaveAttribute("href", `/api/covers/${COVER}`);
      expect(saveImage).toHaveAttribute("download");
      expect(onSetCover).toHaveBeenCalledExactlyOnceWith(PNG);
    });

    it("removes the household's cover", async () => {
      const onRemoveCover = vi.fn(() => Promise.resolve(detailsOf(7)));
      const { dialog } = await renderDialog(detailsOf(7, { cover: COVER }), undefined, undefined, {
        onRemoveCover,
      });

      await userEvent.click(within(dialog).getByRole("button", { name: "Remove your cover" }));

      expect(onRemoveCover).toHaveBeenCalledOnce();
      expect(within(dialog).queryByRole("img", { name: "Cover" })).toBeNull();
    });

    it("refuses an image over 10 MiB without sending it", async () => {
      const onSetCover = vi.fn(() => Promise.resolve(detailsOf(7)));
      const { dialog } = await renderDialog(detailsOf(7), undefined, undefined, { onSetCover });
      const large = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "Poster.png", {
        type: "image/png",
      });

      await userEvent.upload(within(dialog).getByLabelText("Add a cover"), large);

      expect(onSetCover).not.toHaveBeenCalled();
      expect(within(dialog).getByRole("alert")).toHaveTextContent("at most 10 MiB");
    });

    it("keeps the dialog's other actions waiting while a cover uploads", async () => {
      const { dialog } = await renderDialog(detailsOf(7), undefined, undefined, {
        onSetCover: () => new Promise<never>(() => undefined),
      });

      await userEvent.upload(within(dialog).getByLabelText("Add a cover"), PNG);

      expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
      expect(within(dialog).getByRole("status", { name: "Saving the cover…" })).toBeVisible();
    });

    it("says the household chose no cover over a found one", async () => {
      const { dialog } = await renderDialog(
        detailsOf(7, { cover: "" }, { video: { cover: COVER } }),
      );

      expect(within(dialog).queryByRole("img", { name: "Cover" })).toBeNull();
      expect(within(dialog).getByText("None, as you chose")).toBeInTheDocument();
    });

    it("says why an image was refused", async () => {
      const { dialog } = await renderDialog(detailsOf(7), undefined, undefined, {
        onSetCover: () =>
          Promise.reject(new ApiError(422, "A cover is a JPEG, PNG, or WebP image.")),
      });

      await userEvent.upload(within(dialog).getByLabelText("Add a cover"), PNG);

      expect(await within(dialog).findByRole("alert")).toHaveTextContent("JPEG, PNG, or WebP");
    });
  });
});

describe("the AI's suggestions", () => {
  it("shows each suggested value beside its field", async () => {
    const { dialog } = await renderDialog(SUGGESTED);

    for (const [label, value] of [
      ["Title", "Sick Human"],
      ["Artist", "GUMI"],
      ["Album", "Re:Start"],
      ["Year", "2014"],
    ] as const) {
      const suggestion = within(dialog).getByRole("group", {
        name: `The AI's suggestion for ${label}`,
      });
      expect(suggestion).toHaveTextContent(`The AI suggests “${value}”`);
    }
  });

  it("offers nothing for a detail the AI did not suggest", async () => {
    const { dialog } = await renderDialog(SUGGESTED);

    expect(
      within(dialog).queryByRole("group", { name: "The AI's suggestion for Genre" }),
    ).toBeNull();
  });

  it("offers nothing when the AI suggested nothing", async () => {
    const { dialog } = await renderDialog();

    expect(within(dialog).queryByText(/The AI suggests/u)).toBeNull();
  });

  it("changes nothing a field shows, and says where it comes from as before", async () => {
    const { dialog } = await renderDialog(SUGGESTED);

    expect(box(dialog, "Title")).toHaveValue("ケビョウニンゲン");
    expect(box(dialog, "Title")).toHaveAccessibleDescription("From the video");
    expect(box(dialog, "Album")).toHaveValue("");
  });

  it("copies a suggested value into the household's edit with Use, and saves it", async () => {
    const { dialog, onSave } = await renderDialog(SUGGESTED);

    await useSuggested(dialog, "GUMI");

    expect(box(dialog, "Artist")).toHaveValue("GUMI");
    expect(box(dialog, "Artist")).toHaveAccessibleDescription("Yours");
    await save(dialog);
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ artist: "GUMI" });
  });

  it("copies a suggested number as a number", async () => {
    const { dialog, onSave } = await renderDialog(SUGGESTED);

    await useSuggested(dialog, "2014");

    expect(box(dialog, "Year")).toHaveValue(2014);
    await save(dialog);
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ year: 2014 });
  });

  it("keeps the other values as they were when one suggestion is used", async () => {
    const { dialog, onSave } = await renderDialog(SUGGESTED);

    await useSuggested(dialog, "Re:Start");
    await useSuggested(dialog, "Sick Human");

    expect(box(dialog, "Album")).toHaveValue("Re:Start");
    expect(box(dialog, "Title")).toHaveValue("Sick Human");
    await save(dialog);
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ album: "Re:Start", title: "Sick Human" });
  });

  it("stops offering a suggestion once the box holds it", async () => {
    const { dialog } = await renderDialog(SUGGESTED);

    await useSuggested(dialog, "GUMI");

    expect(
      within(dialog).queryByRole("group", { name: "The AI's suggestion for Artist" }),
    ).toBeNull();
  });

  it("does not offer a suggestion that is what the field already shows", async () => {
    const same = detailsOf(7, {}, { ...ALBUM_FILE_ORIGINS, ai: { artist: "GUMI/MAYU" } });

    const { dialog } = await renderDialog(same);

    expect(
      within(dialog).queryByRole("group", { name: "The AI's suggestion for Artist" }),
    ).toBeNull();
  });

  it("is not among the other origins' values", async () => {
    const { dialog } = await renderDialog(SUGGESTED);

    expect(within(dialog).queryByRole("button", { name: /from the AI/u })).toBeNull();
  });

  it("is a suggestion beside a value the household chose, which stays", async () => {
    const { dialog } = await renderDialog(
      detailsOf(7, { artist: "MAYU" }, { ...ALBUM_FILE_ORIGINS, ai: { artist: "GUMI" } }),
    );

    expect(box(dialog, "Artist")).toHaveValue("MAYU");
    expect(
      within(dialog).getByRole("group", { name: "The AI's suggestion for Artist" }),
    ).toHaveTextContent("The AI suggests “GUMI”");
  });
});

describe("looking a song up from its details", () => {
  it("asks the lookup chosen, beside the cover", async () => {
    const { dialog, onFind } = await renderDialog(detailsOf(7), undefined, undefined, {
      findable: [MUSICBRAINZ],
    });

    await userEvent.click(within(dialog).getByRole("button", { name: "Find on MusicBrainz" }));

    expect(onFind).toHaveBeenCalledExactlyOnceWith(MUSICBRAINZ);
  });

  it("offers no lookup the song can't be asked about", async () => {
    const { dialog } = await renderDialog();

    expect(within(dialog).queryByRole("button", { name: "Find on MusicBrainz" })).toBeNull();
  });

  it("says how the lookup goes beside it, and can't ask again meanwhile", async () => {
    const { dialog, lookUp } = await renderDialog(detailsOf(7), undefined, undefined, {
      findable: [MUSICBRAINZ],
    });

    lookUp({ enricher: "musicbrainz", state: "running", message: "" });

    expect(within(dialog).getByRole("status", { name: "Looking up on MusicBrainz" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Find on MusicBrainz" })).toBeDisabled();
  });

  it("reads the details again once the lookup is done, keeping what was typed", async () => {
    const { dialog, lookUp, load } = await renderDialog(detailsOf(7), undefined, undefined, {
      findable: [MUSICBRAINZ],
      reloaded: detailsOf(7, {}, { ...ALBUM_FILE_ORIGINS, musicbrainz: { album: "Re:Start" } }),
    });
    await userEvent.type(box(dialog, "Genre"), "Vocaloid");

    lookUp({ enricher: "musicbrainz", state: "succeeded", message: "" });

    expect(await within(dialog).findByDisplayValue("Re:Start")).toBe(box(dialog, "Album"));
    expect(box(dialog, "Genre")).toHaveValue("Vocaloid");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("says why a lookup failed beside it", async () => {
    const { dialog } = await renderDialog(detailsOf(7), undefined, undefined, {
      findable: [MUSICBRAINZ],
      lookup: { enricher: "musicbrainz", state: "failed", message: "MusicBrainz didn't answer." },
    });

    expect(
      within(dialog).getByRole("status", {
        name: "Looking up on MusicBrainz failed: MusicBrainz didn't answer.",
      }),
    ).toBeVisible();
  });
});

/** A stand-in for the songs editor: its heading, and its way back. */
function SongsStandIn() {
  const { headingId, onBack } = useContext(SongsControlsContext);
  return (
    <form>
      <h2 id={headingId} tabIndex={-1}>
        Songs
      </h2>
      <button type="button" onClick={onBack}>
        Details
      </button>
    </form>
  );
}

describe("the songs of a song's file", () => {
  it("open in place of the details, and the way back keeps what was typed", async () => {
    const { dialog } = await renderDialog(detailsOf(7), undefined, undefined, {
      songs: { label: "11 songs", editor: <SongsStandIn /> },
    });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Title" }), "!");

    await userEvent.click(within(dialog).getByRole("button", { name: "11 songs" }));
    const named = dialog.getAttribute("aria-labelledby");
    const heading = within(dialog).getByRole("heading", { name: "Songs" });
    const focused = document.activeElement;
    await userEvent.click(within(dialog).getByRole("button", { name: "Details" }));

    expect(named).toBe(heading.id);
    expect(focused).toBe(heading);
    expect(within(dialog).getByRole("textbox", { name: "Title" })).toHaveValue("ケビョウニンゲン!");
    expect(within(dialog).getByRole("button", { name: "11 songs" })).toHaveFocus();
  });

  it("are not offered when the dialog has no way to them", async () => {
    const { dialog } = await renderDialog();

    expect(within(dialog).queryByRole("button", { name: /songs/u })).not.toBeInTheDocument();
  });
});

describe("the kind", () => {
  it("says a song no one named is guessed one from its length", async () => {
    const { dialog } = await renderDialog();

    const kind = within(dialog).getByRole("radiogroup", { name: "Kind" });
    expect(within(kind).getByRole("radio", { name: "Song" })).toBeChecked();
    expect(within(kind).getByText("Guessed from its length")).toBeVisible();
  });

  it("saves the album the household calls it", async () => {
    const { dialog, onSave } = await renderDialog();

    await userEvent.click(within(dialog).getByRole("radio", { name: "Album" }));
    await save(dialog);

    expect(onSave).toHaveBeenCalledWith({ kind: "album" });
  });

  it("guesses again once the household's word is dropped", async () => {
    const { dialog, onSave } = await renderDialog({
      ...detailsOf(7, { kind: "album" }),
      kind: { value: "album", reason: "named" },
    });

    await userEvent.click(within(dialog).getByRole("button", { name: "Guess again" }));
    await save(dialog);

    expect(onSave).toHaveBeenCalledWith({ kind: null });
  });

  it.each([
    ["split", "Album", "Split into songs, so an album"],
    ["segment", "Song", "A song of an album file"],
  ] as const)("can't be changed for a file %s, saying why", async (reason, checked, why) => {
    const { dialog } = await renderDialog({
      ...detailsOf(7),
      kind: { value: checked === "Album" ? "album" : "song", reason },
    });

    const kind = within(dialog).getByRole("radiogroup", { name: "Kind" });
    expect(within(kind).getByRole("radio", { name: checked })).toBeChecked();
    expect(within(kind).getByRole("radio", { name: "Song" })).toBeDisabled();
    expect(within(kind).getByText(why)).toBeVisible();
  });
});
