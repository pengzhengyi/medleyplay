import {
  act,
  type BoundFunctions,
  fireEvent,
  type queries,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useContext } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  ApiError,
  type Details,
  type MissingDetailReview,
  type VideoRead,
  type VideoText,
} from "../api";
import { LOOKUPS, type Lookup } from "../library/lookups";
import { useLanguageChoice } from "../locale";
import type { TrackLookup } from "../library/useLibrary";
import {
  ALBUM_FILE_ORIGINS,
  TAGGED_ORIGINS,
  albumCoversOf,
  detailsOf,
  namesakeOf,
  serve,
  trackArtistOf,
  trackOf,
} from "../testing/server";
import { EditDetails } from "./EditDetails";
import { LanguageSelect } from "./LanguageSelect";
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
    onUseCover?: (cover: string) => Promise<Details>;
    onChooseArtist?: (written: string, id: string | null) => Promise<Details>;
    /** The lookups the song may be asked about now. */
    findable?: readonly Lookup[];
    /** The lookup last asked about the song. */
    lookup?: TrackLookup;
    /** The details read again once a lookup is done. */
    reloaded?: Details;
    review?: MissingDetailReview;
    /** The way to the songs of the song's file. */
    songs?: { readonly label: string; readonly editor: ReactNode };
    /** Whether the dialog opens on the songs, as *Split into songs* opens it. */
    startOnSongs?: boolean;
    /** The way to the song's lyrics. */
    lyrics?: { readonly label: string; readonly editor: ReactNode };
  } = {},
) {
  const onClose = vi.fn();
  const onFind = vi.fn<(lookup: Lookup) => void>();
  const onAskAi = vi.fn<(note: string) => void>();
  const load = vi.fn(() => Promise.resolve(details));
  const dialogOf = (lookup: TrackLookup | undefined) => (
    <EditDetails
      track={ALBUM_FILE}
      review={more.review}
      load={load}
      onSave={onSave}
      onReadVideo={onReadVideo}
      onSetCover={more.onSetCover ?? (() => Promise.reject(new Error("No cover in this test.")))}
      onRemoveCover={
        more.onRemoveCover ?? (() => Promise.reject(new Error("No cover in this test.")))
      }
      onUseCover={more.onUseCover ?? (() => Promise.reject(new Error("No cover in this test.")))}
      {...(more.onChooseArtist !== undefined && { onChooseArtist: more.onChooseArtist })}
      findable={more.findable ?? []}
      lookup={lookup}
      online
      onFind={onFind}
      onAskAi={onAskAi}
      songs={more.songs}
      lyrics={more.lyrics}
      startOnSongs={more.startOnSongs ?? false}
      onClose={onClose}
    />
  );
  const { rerender } = render(dialogOf(more.lookup));
  const dialog = screen.getByRole("dialog");
  if (more.startOnSongs !== true) {
    await within(dialog).findByRole("textbox", { name: "Title" });
  }
  /** Show the dialog as the page would once the song's lookup is `lookup`. */
  const lookUp = (lookup: TrackLookup) => {
    if (more.reloaded !== undefined) {
      load.mockResolvedValue(more.reloaded);
    }
    rerender(dialogOf(lookup));
  };
  return { dialog, onSave, onClose, onFind, onAskAi, load, lookUp };
}

/** The lookup that asks MusicBrainz. */
const MUSICBRAINZ = ((): Lookup => {
  const found = LOOKUPS.find((lookup) => lookup.enricher === "musicbrainz");
  if (found === undefined) {
    throw new Error("No lookup asks MusicBrainz.");
  }
  return found;
})();

/** The lookup that asks the AI. */
const AI = ((): Lookup => {
  const found = LOOKUPS.find((lookup) => lookup.enricher === "ai-details");
  if (found === undefined) {
    throw new Error("The AI is a lookup.");
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
  it("locks the fields and suggestions until the submitted save finishes", async () => {
    let finish: () => void = () => undefined;
    const saving = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const submit = vi.fn(() => saving);
    const { dialog } = await renderDialog(SUGGESTED, submit);
    const title = box(dialog, "Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Night Drive");

    await save(dialog);

    expect(title).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: /^Use “Sick Human”, suggested by/u }),
    ).toBeDisabled();
    expect(submit).toHaveBeenCalledExactlyOnceWith({ title: "Night Drive" });
    await act(async () => {
      finish();
      await saving;
    });
    expect(title).toBeEnabled();
  });

  it("keeps the draft while translating the field, provenance, and pasted-video guidance", async () => {
    const { dialog } = await renderDialog(detailsOf(7, {}, TAGGED_ORIGINS));
    const words = within(dialog);
    const input = words.getByRole("textbox", { name: "Title" });
    const language = render(<LanguageSelect />).getByRole("combobox", { name: "Language" });
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, "Night Drive");

    try {
      await user.selectOptions(language, "zh-Hans");

      expect(dialog).toHaveAccessibleName("编辑详情");
      expect(words.getByRole("textbox", { name: "标题" })).toHaveValue("Night Drive");
      expect(input).toHaveAccessibleDescription("手动设置");
      await user.click(words.getByText("粘贴视频详情"));
      expect(words.getByText(/保留你手动设置的值/u)).toBeVisible();
    } finally {
      await user.selectOptions(language, "auto");
    }
  });

  it("prefills a Cleanup suggestion, explains the impact, and keeps the year only if entered", async () => {
    const details: Details = {
      ...detailsOf(7, {}, { video: { title: "Live at Home", year: 1974 } }),
      kind: { value: "album", reason: "split" },
    };
    const { dialog, onSave } = await renderDialog(details, undefined, undefined, {
      review: {
        field: "album",
        value: "Live at Home",
        impact: {
          details: [{ field: "year", before: 1974, after: "" }],
          split_songs: 11,
          affected_songs: 11,
          song_fields: ["year"],
        },
      },
    });

    expect(box(dialog, "Album")).toHaveValue("Live at Home");
    expect(box(dialog, "Year")).toHaveValue(null);
    const warning = within(dialog).getByRole("region", { name: "Review before saving" });
    expect(warning).toHaveTextContent("Year: 1974 → blank");
    expect(warning).toHaveTextContent("11 split songs would also change: Year.");
    expect(onSave).not.toHaveBeenCalled();

    await userEvent.type(box(dialog, "Year"), "1974");

    expect(warning).not.toHaveTextContent("1974 → blank");
    expect(warning).not.toHaveTextContent("11 split songs would also change");
    await save(dialog);
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ album: "Live at Home", year: 1974 });
  });

  it("preserves the household cover when previewing and saving an artist suggestion", async () => {
    const { dialog, onSave } = await renderDialog(
      detailsOf(7, { cover: "custom-cover" }, { video: { title: "Night Drive" } }),
      undefined,
      undefined,
      {
        review: {
          field: "artist",
          value: "Trio",
          impact: { details: [], split_songs: 0, affected_songs: 0, song_fields: [] },
        },
      },
    );

    const warning = within(dialog).getByRole("region", { name: "Review before saving" });
    expect(warning).not.toHaveTextContent(/cover would/u);
    await save(dialog);

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ artist: "Trio" });
  });

  it("does not prefill a Cleanup suggestion after someone else fills that field", async () => {
    const { dialog, onSave } = await renderDialog(
      detailsOf(7, { album: "Newer title" }, { video: { title: "Live at Home", year: 1974 } }),
      undefined,
      undefined,
      {
        review: {
          field: "album",
          value: "Live at Home",
          impact: { details: [], split_songs: 1, affected_songs: 1, song_fields: ["album"] },
        },
      },
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The field changed before Edit details opened.",
    );
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("can remove a saved blank artist even when no other origin gives the artist", async () => {
    const { dialog, onSave } = await renderDialog(
      detailsOf(7, { artist: "" }, { files: { title: "Uncredited song" } }),
    );

    await userEvent.click(within(dialog).getByRole("button", { name: "Remove blank override" }));
    await save(dialog);

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ artist: null });
  });

  it("saves a track number beyond 999 for a song in a large album", async () => {
    const { dialog, onSave } = await renderDialog();

    await userEvent.type(box(dialog, "Track"), "1000");
    await save(dialog);

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ track_number: 1000 });
  });

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

  it("saves only the details changed, and stays open on them, saying so", async () => {
    const { dialog, onSave, onClose, load } = await renderDialog();
    load.mockResolvedValue(detailsOf(7, { album: "Re:Start", year: 2014 }));

    await userEvent.type(box(dialog, "Album"), "Re:Start");
    await userEvent.type(box(dialog, "Year"), "2014");
    await save(dialog);

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ album: "Re:Start", year: 2014 });
    const said = await within(dialog).findByText("Saved");
    expect(said).toHaveRole("status");
    expect(box(dialog, "Album")).toHaveValue("Re:Start");
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(
      () => {
        expect(said).not.toBeInTheDocument();
      },
      { timeout: 4000 },
    );
  });

  it("closes only when asked, from its ✕", async () => {
    const { dialog, onClose } = await renderDialog();

    await userEvent.type(box(dialog, "Album"), "Re:Start");
    await save(dialog);
    await userEvent.click(await within(dialog).findByRole("button", { name: "Close" }));

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

  it("has nothing to save until something changes, keeping the household's empty text", async () => {
    const { dialog, onSave } = await renderDialog(detailsOf(7, { genre: "" }));

    await save(dialog);

    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
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

    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
    expect(dialog).toHaveAttribute("open");
  });

  it("is dismissed from its ✕, saving nothing", async () => {
    const { dialog, onSave, onClose } = await renderDialog();

    await userEvent.type(box(dialog, "Title"), " (Live)");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));

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
        onUseCover={vi.fn()}
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

    /** Open the picture editor from the cover's `label` tool, as *Add a cover*. */
    async function pictureEditor(dialog: HTMLElement, label: string) {
      await userEvent.click(within(dialog).getByRole("button", { name: `${label}…` }));
      return within(screen.getByRole("dialog", { name: label }));
    }

    /** Choose `image` on the picture editor's Upload tab and use it. */
    async function uploaded(editor: BoundFunctions<typeof queries>, image: File) {
      await userEvent.upload(editor.getByLabelText("Choose a cover file"), image);
      await userEvent.click(await editor.findByRole("button", { name: "Use this cover" }));
    }

    it("uploads an image chosen as the household's cover, and shows it", async () => {
      const onSetCover = vi.fn(() => Promise.resolve(detailsOf(7, { cover: COVER })));
      const { dialog } = await renderDialog(detailsOf(7), undefined, undefined, { onSetCover });

      await uploaded(await pictureEditor(dialog, "Add a cover"), PNG);

      expect(onSetCover).toHaveBeenCalledExactlyOnceWith(PNG);
      expect(await within(dialog).findByRole("img", { name: "Cover" })).toHaveAttribute(
        "src",
        `/api/covers/${COVER}`,
      );
      expect(within(dialog).getByText("Yours")).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Add a cover" })).toBeNull();
    });

    it("returns to Edit details once a cover is used, rather than closing it", async () => {
      const onSetCover = vi.fn(() => Promise.resolve(detailsOf(7, { cover: COVER })));
      const { dialog, onClose } = await renderDialog(detailsOf(7), undefined, undefined, {
        onSetCover,
      });

      await uploaded(await pictureEditor(dialog, "Add a cover"), PNG);

      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "Add a cover" })).toBeNull();
      });
      expect(dialog).toHaveAttribute("open");
      expect(onClose).not.toHaveBeenCalled();
    });

    it("offers the cover shown to save as an image, or to replace", async () => {
      const onSetCover = vi.fn(() => Promise.resolve(detailsOf(7, { cover: COVER })));
      const { dialog } = await renderDialog(
        detailsOf(7, {}, { video: { cover: COVER } }),
        undefined,
        undefined,
        { onSetCover },
      );

      const saveImage = within(dialog).getByRole("link", { name: "Save the image" });
      await uploaded(await pictureEditor(dialog, "Replace the cover"), PNG);

      expect(saveImage).toHaveAttribute("href", `/api/covers/${COVER}`);
      expect(saveImage).toHaveAttribute("download");
      expect(onSetCover).toHaveBeenCalledExactlyOnceWith(PNG);
    });

    it("finds covers of the song's album on MusicBrainz, and uses the one chosen", async () => {
      serve({
        [`GET /api/album-covers?${new URLSearchParams({ album: "Re:Start", artist: "MAYU" }).toString()}`]:
          { body: albumCoversOf(["cover-a", "cover-b"]) },
      });
      const onUseCover = vi.fn(() =>
        Promise.resolve(detailsOf(7, { cover: "cover-b" }, TAGGED_ORIGINS)),
      );
      const { dialog } = await renderDialog(
        detailsOf(7, {}, TAGGED_ORIGINS),
        undefined,
        undefined,
        {
          onUseCover,
        },
      );
      const editor = await pictureEditor(dialog, "Add album cover");

      await userEvent.click(editor.getByRole("tab", { name: "MusicBrainz" }));
      const found = await editor.findByRole("region", { name: "Covers on MusicBrainz" });
      await userEvent.click(
        within(found).getAllByRole("button", { name: /^Use the cover of/u })[1] ?? found,
      );

      expect(onUseCover).toHaveBeenCalledExactlyOnceWith("cover-b");
      expect(await within(dialog).findByRole("img", { name: "Cover" })).toHaveAttribute(
        "src",
        "/api/covers/cover-b",
      );
    });

    it("finds covers of an album file naming no album by its title", async () => {
      const { calls } = serve({
        [`GET /api/album-covers?${new URLSearchParams({ album: "ケビョウニンゲン", artist: "GUMI/MAYU" }).toString()}`]:
          { body: albumCoversOf(["cover-a"]) },
      });
      const { dialog } = await renderDialog({
        ...detailsOf(7),
        kind: { value: "album", reason: "length" },
      });
      const editor = await pictureEditor(dialog, "Add album cover");

      await userEvent.click(editor.getByRole("tab", { name: "MusicBrainz" }));

      expect(await editor.findByRole("region", { name: "Covers on MusicBrainz" })).toBeVisible();
      expect(calls).toContain(
        `GET /api/album-covers?${new URLSearchParams({ album: "ケビョウニンゲン", artist: "GUMI/MAYU" }).toString()}`,
      );
    });

    it("says covers are found for a song once its album is filled in", async () => {
      const { dialog } = await renderDialog();
      const editor = await pictureEditor(dialog, "Add a cover");
      const find = editor.getByRole("tab", { name: "MusicBrainz" });

      await userEvent.click(find);

      expect(find).toBeDisabled();
      expect(find).toHaveAttribute("title", "Fill in the album to find its covers.");
      expect(editor.queryByRole("region", { name: "Covers on MusicBrainz" })).toBeNull();
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
      const editor = await pictureEditor(dialog, "Add a cover");

      await userEvent.upload(editor.getByLabelText("Choose a cover file"), large);

      expect(onSetCover).not.toHaveBeenCalled();
      expect(await editor.findByRole("alert")).toHaveTextContent("at most 10 MiB");
    });

    it("keeps the picture editor waiting while a cover uploads", async () => {
      const { dialog } = await renderDialog(detailsOf(7), undefined, undefined, {
        onSetCover: () => new Promise<never>(() => undefined),
      });
      const editor = await pictureEditor(dialog, "Add a cover");

      await uploaded(editor, PNG);

      expect(editor.getByRole("button", { name: "Use this cover" })).toBeDisabled();
      expect(editor.getByRole("button", { name: "Close" })).toBeDisabled();
      expect(editor.getByRole("status")).toHaveTextContent("Saving the cover…");
    });

    it("says the household chose no cover over a found one", async () => {
      const { dialog } = await renderDialog(
        detailsOf(7, { cover: "" }, { video: { cover: COVER } }),
      );

      expect(within(dialog).queryByRole("img", { name: "Cover" })).toBeNull();
      expect(within(dialog).getByText("None, as you chose")).toBeInTheDocument();
    });

    it("says why an image was refused, in the picture editor", async () => {
      const { dialog } = await renderDialog(detailsOf(7), undefined, undefined, {
        onSetCover: () =>
          Promise.reject(new ApiError(422, "A cover is a JPEG, PNG, or WebP image.")),
      });
      const editor = await pictureEditor(dialog, "Add a cover");

      await uploaded(editor, PNG);

      expect(await editor.findByRole("alert")).toHaveTextContent("JPEG, PNG, or WebP");
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

  it("names the model that suggested, and where it was asked, once it is known", async () => {
    const { dialog } = await renderDialog({
      ...SUGGESTED,
      ai_answered_by: {
        model: "deepseek-chat",
        host: "api.deepseek.com",
        at: "2026-11-14T08:00:00Z",
      },
    });

    const suggestion = within(dialog).getByRole("group", {
      name: "deepseek-chat's suggestion for Artist",
    });
    expect(suggestion).toHaveTextContent("deepseek-chat suggests “GUMI”");
    expect(within(suggestion).getByText(/suggests/u)).toHaveAttribute(
      "title",
      "Answered by deepseek-chat at api.deepseek.com",
    );
    expect(
      within(suggestion).getByRole("button", { name: "Use “GUMI”, suggested by deepseek-chat" }),
    ).toBeInTheDocument();
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

  it("asks the AI with a note from ▾ beside its button", async () => {
    const { dialog, onAskAi, onFind } = await renderDialog(detailsOf(7), undefined, undefined, {
      findable: [AI],
    });

    await userEvent.click(within(dialog).getByRole("button", { name: "Ask AI with a note" }));
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "More details" }),
      "It's Taylor Swift's 1989{Enter}",
    );

    expect(onAskAi).toHaveBeenCalledExactlyOnceWith("It's Taylor Swift's 1989");
    expect(onFind).not.toHaveBeenCalled();
  });

  it("opens the note to ask the AI with on a right-click of its button", async () => {
    const { dialog } = await renderDialog(detailsOf(7), undefined, undefined, { findable: [AI] });

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(dialog).getByRole("button", { name: "Suggest details with AI" }),
    });

    expect(within(dialog).getByRole("group", { name: "Ask AI with a note" })).toBeVisible();
  });

  it("offers a note only beside the AI's button", async () => {
    const { dialog } = await renderDialog(detailsOf(7), undefined, undefined, {
      findable: [MUSICBRAINZ],
    });

    expect(within(dialog).queryByRole("button", { name: "Ask AI with a note" })).toBeNull();
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
    const find = within(dialog).getByRole("button", { name: "Find on MusicBrainz" });
    expect(find).toBeDisabled();
    expect(find).toHaveAttribute("aria-busy", "true");
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

  it("saves only the edited title after the lookup refresh adds a household genre", async () => {
    const { dialog, lookUp, onSave } = await renderDialog(detailsOf(7), undefined, undefined, {
      findable: [MUSICBRAINZ],
      reloaded: detailsOf(7, { genre: "Jazz" }),
    });
    const title = box(dialog, "Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Night Drive");
    lookUp({ enricher: "musicbrainz", state: "succeeded", message: "" });
    await within(dialog).findByDisplayValue("Jazz");

    await save(dialog);

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ title: "Night Drive" });
  });

  it("says why a lookup failed beside it", async () => {
    const detail = "MusicBrainz didn't answer.";
    const { dialog } = await renderDialog(detailsOf(7), undefined, undefined, {
      findable: [MUSICBRAINZ],
      lookup: { enricher: "musicbrainz", state: "failed", message: detail },
    });
    const user = userEvent.setup();
    const language = render(<LanguageSelect />).getByRole("combobox", { name: "Language" });
    expect(
      within(dialog).getByRole("status", { name: `Looking up on MusicBrainz failed: ${detail}` }),
    ).toBeVisible();

    try {
      await user.selectOptions(language, "zh-Hans");

      expect(
        within(dialog).getByRole("status", { name: `失败：正在 MusicBrainz 查询（${detail}）` }),
      ).toBeVisible();
    } finally {
      await user.selectOptions(language, "auto");
    }
  });
});

/** A stand-in for the songs or lyrics editor: its heading, `title`, its way back, and Save. */
function PanelStandIn({ title }: { readonly title: string }) {
  const { headingId, onBack, onDone } = useContext(SongsControlsContext);
  return (
    <form>
      <h2 id={headingId} tabIndex={-1}>
        {title}
      </h2>
      <button type="button" onClick={onBack}>
        Details
      </button>
      <button type="button" onClick={onDone}>
        Save
      </button>
    </form>
  );
}

describe("the songs of a song's file", () => {
  it("open in place of the details, and the way back keeps what was typed", async () => {
    const { dialog } = await renderDialog(detailsOf(7), undefined, undefined, {
      songs: { label: "11 songs", editor: <PanelStandIn title="Songs" /> },
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

  it("opened first, the way back shows the details instead of closing", async () => {
    const { dialog, onClose } = await renderDialog(detailsOf(7), undefined, undefined, {
      songs: { label: "11 songs", editor: <PanelStandIn title="Songs" /> },
      startOnSongs: true,
    });
    await within(dialog).findByRole("heading", { name: "Songs" });

    await userEvent.click(within(dialog).getByRole("button", { name: "Details" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(await within(dialog).findByRole("textbox", { name: "Title" })).toHaveValue(
      "ケビョウニンゲン",
    );
    expect(within(dialog).getByRole("button", { name: "11 songs" })).toHaveFocus();
  });

  it("opened first, close the dialog once saved", async () => {
    const { dialog, onClose } = await renderDialog(detailsOf(7), undefined, undefined, {
      songs: { label: "11 songs", editor: <PanelStandIn title="Songs" /> },
      startOnSongs: true,
    });

    await userEvent.click(await within(dialog).findByRole("button", { name: "Save" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("are not offered when the dialog has no way to them", async () => {
    const { dialog } = await renderDialog();

    expect(within(dialog).queryByRole("button", { name: /songs/u })).not.toBeInTheDocument();
  });
});

describe("the lyrics of a song", () => {
  it("open in place of the details, and the way back returns to the way to them", async () => {
    const { dialog } = await renderDialog(detailsOf(7), undefined, undefined, {
      lyrics: { label: "Lyrics", editor: <PanelStandIn title="Lyrics" /> },
    });

    await userEvent.click(within(dialog).getByRole("button", { name: "Lyrics" }));
    const named = dialog.getAttribute("aria-labelledby");
    const heading = within(dialog).getByRole("heading", { name: "Lyrics" });
    const focused = document.activeElement;
    const details = within(dialog).queryByRole("textbox", { name: "Title" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Details" }));

    expect(named).toBe(heading.id);
    expect(focused).toBe(heading);
    expect(details).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Lyrics" })).toHaveFocus();
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

describe("a song's album", () => {
  const fold = (dialog: HTMLElement) => dialog.querySelector<HTMLDetailsElement>(".detail-fold");
  const summary = (dialog: HTMLElement) => fold(dialog)?.querySelector("summary");
  const markSingle = async (dialog: HTMLElement) => {
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Remove album and mark as single" }),
    );
    const confirmation = screen.getByRole("dialog", { name: "Mark as single?" });
    await userEvent.click(within(confirmation).getByRole("button", { name: "Mark as single" }));
  };

  it("translates the remove control and confirmation into Simplified Chinese", async () => {
    const { result } = renderHook(() => useLanguageChoice());
    const original = result.current[0];
    const { dialog, onSave } = await renderDialog();
    act(() => {
      result.current[1]("zh-Hans");
    });
    try {
      const remove = within(dialog).getByRole("button", { name: "移除专辑归属并标记为单曲" });
      expect(remove).toHaveAttribute("title", "移除专辑归属并标记为单曲");

      await userEvent.click(remove);

      const confirmation = screen.getByRole("dialog", { name: "标记为单曲？" });
      expect(confirmation).toHaveTextContent(
        "移除此歌曲的专辑归属并标记为单曲？不会删除已保存的详情或文件，但来自专辑的详情可能不再显示。请在「编辑详情」中选择「保存」以应用此更改。",
      );
      await userEvent.click(within(confirmation).getByRole("button", { name: "标记为单曲" }));
      expect(summary(dialog)).toHaveTextContent("无专辑（单曲）");
      expect(onSave).not.toHaveBeenCalled();
    } finally {
      act(() => {
        result.current[1](original);
      });
    }
  });

  it.each([false, true])("asks before removing an album with the fields open: %s", async (open) => {
    const { dialog, onSave } = await renderDialog(detailsOf(7, { album: "Sessions" }));
    if (open) await userEvent.click(within(dialog).getByText("Sessions", { selector: "span" }));
    const remove = within(dialog).getByRole("button", { name: "Remove album and mark as single" });

    expect(remove).toHaveAttribute("title", "Remove album and mark as single");
    await userEvent.click(remove);

    const confirmation = screen.getByRole("dialog", { name: "Mark as single?" });
    expect(confirmation).toHaveTextContent(
      "Remove this song’s album assignment and mark it as a single? Stored details and files are not deleted, but album-derived details may no longer appear. Choose Save in Edit details to apply this change.",
    );
    expect(fold(dialog)?.open).toBe(open);
    expect(summary(dialog)).toHaveTextContent("Sessions");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
    expect(confirmation).toHaveFocus();
  });

  it.each(["Close", "Escape"])(
    "keeps the draft when dismissing confirmation with %s",
    async (action) => {
      const { dialog, onSave, onClose } = await renderDialog(detailsOf(7, { album: "Sessions" }));
      await userEvent.type(box(dialog, "Title"), " draft");
      const remove = within(dialog).getByRole("button", {
        name: "Remove album and mark as single",
      });
      await userEvent.click(remove);
      const confirmation = screen.getByRole("dialog", { name: "Mark as single?" });

      if (action === "Close")
        await userEvent.click(within(confirmation).getByRole("button", { name: "Close" }));
      else await userEvent.keyboard("{Escape}");

      expect(screen.queryByRole("dialog", { name: "Mark as single?" })).toBeNull();
      expect(summary(dialog)).toHaveTextContent("Sessions");
      expect(box(dialog, "Title")).toHaveValue("ケビョウニンゲン draft");
      expect(remove).toHaveFocus();
      expect(dialog).toHaveAttribute("open");
      expect(onClose).not.toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
    },
  );

  it("stages only the album assignment until Save and returns focus to the fold", async () => {
    const { dialog, onSave } = await renderDialog(
      detailsOf(7, {
        album: "Sessions",
        title: "Song",
        artist: "Blue Room",
        year: 2025,
        genre: "Pop",
      }),
    );
    const remove = within(dialog).getByRole("button", { name: "Remove album and mark as single" });
    remove.focus();
    await userEvent.keyboard("{Enter}");
    const confirmation = screen.getByRole("dialog", { name: "Mark as single?" });

    await userEvent.click(within(confirmation).getByRole("button", { name: "Mark as single" }));

    expect(screen.queryByRole("dialog", { name: "Mark as single?" })).toBeNull();
    expect(summary(dialog)).toHaveTextContent("No album (single)");
    expect(summary(dialog)).toHaveFocus();
    expect(fold(dialog)).not.toHaveAttribute("open");
    expect(
      within(dialog).queryByRole("button", { name: "Remove album and mark as single" }),
    ).toBeNull();
    expect(box(dialog, "Title")).toHaveValue("Song");
    expect(box(dialog, "Genre")).toHaveValue("Pop");
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByText("No album (single)", { selector: "span" }));
    expect(box(dialog, "Year")).toHaveValue(2025);

    await save(dialog);
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ album: "" });
  });

  it("leaves an unreviewed blank album unknown, even when Song is chosen", async () => {
    const { dialog, onSave } = await renderDialog();

    expect(fold(dialog)).not.toHaveAttribute("open");
    expect(summary(dialog)).toHaveTextContent("AlbumUnknown");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Album" }));
    await userEvent.click(within(dialog).getByRole("radio", { name: "Song" }));
    expect(summary(dialog)).not.toHaveTextContent("single");
    await save(dialog);
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ kind: "song" });
  });

  it("dismisses the prompt when new metadata arrives without accepting the old assignment", async () => {
    const { dialog, onSave, lookUp } = await renderDialog(detailsOf(7), undefined, undefined, {
      reloaded: detailsOf(7, {}, { files: { title: "Song", album: "New album" } }),
    });
    await userEvent.type(box(dialog, "Genre"), "Pop");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Remove album and mark as single" }),
    );

    lookUp({ enricher: "musicbrainz", state: "succeeded", message: "" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Mark as single?" })).toBeNull();
    });
    expect(summary(dialog)).toHaveTextContent("New album");
    expect(box(dialog, "Genre")).toHaveValue("Pop");
    expect(
      within(dialog).getByRole("button", { name: "Remove album and mark as single" }),
    ).toHaveFocus();
    expect(onSave).not.toHaveBeenCalled();
    await save(dialog);
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ genre: "Pop" });
  });

  it("dismisses the prompt when the kind changes and does not reopen it on Song", async () => {
    const { dialog, onSave } = await renderDialog(detailsOf(7, { album: "Sessions" }));
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Remove album and mark as single" }),
    );

    fireEvent.click(within(dialog).getByRole("radio", { name: "Album" }));
    expect(screen.queryByRole("dialog", { name: "Mark as single?" })).toBeNull();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Song" }));

    expect(screen.queryByRole("dialog", { name: "Mark as single?" })).toBeNull();
    expect(summary(dialog)).toHaveTextContent("Sessions");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("closes the pending confirmation with the editor without saving", async () => {
    const { dialog, onSave, onClose } = await renderDialog();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Remove album and mark as single" }),
    );

    fireEvent(dialog, new Event("close"));

    expect(screen.queryByRole("dialog", { name: "Mark as single?" })).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves a deliberate single on an unknown album and keeps it after reloading", async () => {
    const { dialog, onSave, load } = await renderDialog();
    await userEvent.click(within(dialog).getByText("Unknown"));

    await markSingle(dialog);

    expect(summary(dialog)).toHaveTextContent("No album (single)");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();
    load.mockResolvedValue(detailsOf(7, { album: "" }));
    await save(dialog);

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ album: "" });
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    });
    expect(summary(dialog)).toHaveTextContent("No album (single)");
    expect(within(dialog).getByRole("button", { name: "Remove blank override" })).toBeVisible();
  });

  it("reopens a saved single and can remove its blank album override", async () => {
    const { dialog, onSave, load } = await renderDialog(detailsOf(7, { album: "" }));
    expect(summary(dialog)).toHaveTextContent("No album (single)");
    expect(
      within(dialog).queryByRole("button", { name: "Remove album and mark as single" }),
    ).toBeNull();
    await userEvent.click(within(dialog).getByText("No album (single)", { selector: "span" }));

    await userEvent.click(within(dialog).getByRole("button", { name: "Remove blank override" }));
    expect(summary(dialog)).toHaveTextContent("AlbumUnknown");
    load.mockResolvedValue(detailsOf(7));
    await save(dialog);

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ album: null });
  });

  it("undoes a draft single without removing a refreshed household album", async () => {
    const { dialog, lookUp } = await renderDialog(detailsOf(7), undefined, undefined, {
      reloaded: detailsOf(7, { album: "Corrected title", genre: "Jazz" }),
    });
    await userEvent.click(within(dialog).getByText("Unknown"));
    await markSingle(dialog);
    lookUp({ enricher: "musicbrainz", state: "succeeded", message: "" });
    await within(dialog).findByDisplayValue("Jazz");

    await userEvent.click(within(dialog).getByRole("button", { name: "Undo single choice" }));

    expect(box(dialog, "Album")).toHaveValue("Corrected title");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves a later album edit rather than the earlier single choice", async () => {
    const { dialog, onSave } = await renderDialog();
    await userEvent.click(within(dialog).getByText("Unknown"));
    await markSingle(dialog);

    await userEvent.type(box(dialog, "Album"), "Sessions");
    await save(dialog);

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ album: "Sessions" });
  });

  it("does not keep single intent after typing and then clearing an album", async () => {
    const { dialog } = await renderDialog();
    await userEvent.click(within(dialog).getByText("Unknown"));
    await markSingle(dialog);

    await userEvent.type(box(dialog, "Album"), "Sessions");
    await userEvent.clear(box(dialog, "Album"));

    expect(summary(dialog)).toHaveTextContent("AlbumUnknown");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it.each([
    ["the file", detailsOf(7, {}, { files: { title: "Album song", album: "Sessions" } })],
    ["the household", detailsOf(7, { album: "Sessions" })],
  ] as const)(
    "restores the album from %s when changing a draft single to an album file",
    async (_, details) => {
      const { dialog, onSave } = await renderDialog(details);
      await userEvent.click(
        within(dialog).getByText("Sessions", { selector: ".detail-fold-value" }),
      );
      await markSingle(dialog);

      await userEvent.click(within(dialog).getByRole("radio", { name: "Album" }));

      expect(box(dialog, "Album")).toHaveValue("Sessions");
      await save(dialog);
      expect(onSave).toHaveBeenCalledExactlyOnceWith({ kind: "album" });
    },
  );

  it.each([undefined, "Old title"])(
    "keeps a refreshed household album rather than restoring %s when changing a draft single's kind",
    async (previous) => {
      const { dialog, lookUp, onSave } = await renderDialog(
        detailsOf(7, previous === undefined ? {} : { album: previous }),
        undefined,
        undefined,
        { reloaded: detailsOf(7, { album: "Corrected title", genre: "Jazz" }) },
      );
      await userEvent.click(
        within(dialog).getByText(previous ?? "Unknown", {
          selector: ".detail-fold-value",
        }),
      );
      await markSingle(dialog);
      lookUp({ enricher: "musicbrainz", state: "succeeded", message: "" });
      await within(dialog).findByDisplayValue("Jazz");

      await userEvent.click(within(dialog).getByRole("radio", { name: "Album" }));
      await save(dialog);

      expect(box(dialog, "Album")).toHaveValue("Corrected title");
      expect(onSave).toHaveBeenCalledExactlyOnceWith({ kind: "album" });
    },
  );

  it("drops a draft single but keeps other edits when refreshed details classify the file as an album", async () => {
    const { dialog, lookUp, onSave } = await renderDialog(detailsOf(7), undefined, undefined, {
      reloaded: {
        ...detailsOf(7, { album: "Sessions", genre: "Jazz" }),
        kind: { value: "album", reason: "named" },
      },
    });
    const title = box(dialog, "Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Edited title");
    await userEvent.click(within(dialog).getByText("Unknown"));
    await markSingle(dialog);
    lookUp({ enricher: "musicbrainz", state: "succeeded", message: "" });
    await within(dialog).findByDisplayValue("Jazz");

    await save(dialog);

    expect(
      within(dialog).queryByRole("button", { name: "Remove album and mark as single" }),
    ).toBeNull();
    expect(box(dialog, "Album")).toHaveValue("Sessions");
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ title: "Edited title" });
  });

  it("discards a draft song and single when a refresh fixes the file's kind as a split album", async () => {
    const { dialog, lookUp, onSave } = await renderDialog(
      { ...detailsOf(7), kind: { value: "album", reason: "named" } },
      undefined,
      undefined,
      {
        reloaded: {
          ...detailsOf(7, { album: "Sessions", genre: "Jazz" }),
          kind: { value: "album", reason: "split" },
        },
      },
    );
    const title = box(dialog, "Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Edited title");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Song" }));
    await userEvent.click(within(dialog).getByText("Unknown"));
    await markSingle(dialog);
    lookUp({ enricher: "musicbrainz", state: "succeeded", message: "" });
    await within(dialog).findByDisplayValue("Jazz");

    await save(dialog);

    expect(within(dialog).getByRole("radio", { name: "Album" })).toBeChecked();
    expect(
      within(dialog).queryByRole("button", { name: "Remove album and mark as single" }),
    ).toBeNull();
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ title: "Edited title" });
  });

  it("restores an unsaved album edit when changing a draft single to an album file", async () => {
    const { dialog, onSave } = await renderDialog();
    await userEvent.click(within(dialog).getByText("Unknown"));
    await userEvent.type(box(dialog, "Album"), "Draft album");
    await markSingle(dialog);

    await userEvent.click(within(dialog).getByRole("radio", { name: "Album" }));

    expect(box(dialog, "Album")).toHaveValue("Draft album");
    await save(dialog);
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ album: "Draft album", kind: "album" });
  });

  it("does not offer a single while the server has yet to guess the kind again", async () => {
    const { dialog, onSave, load } = await renderDialog({
      ...detailsOf(7, { kind: "song" }),
      kind: { value: "song", reason: "named" },
    });
    await userEvent.click(within(dialog).getByText("Unknown"));
    await markSingle(dialog);

    await userEvent.click(within(dialog).getByRole("button", { name: "Guess again" }));

    expect(
      within(dialog).queryByRole("button", { name: "Remove album and mark as single" }),
    ).toBeNull();
    expect(summary(dialog)).toHaveTextContent("AlbumUnknown");
    load.mockResolvedValue({ ...detailsOf(7), kind: { value: "album", reason: "length" } });
    await save(dialog);
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ kind: null });
    await waitFor(() => {
      expect(within(dialog).getByRole("radio", { name: "Album" })).toBeChecked();
    });
    expect(
      within(dialog).queryByRole("button", { name: "Remove album and mark as single" }),
    ).toBeNull();
  });

  it("labels a whitespace-only album edit as the single that Save records", async () => {
    const { dialog, onSave } = await renderDialog(
      detailsOf(7, {}, { files: { title: "Album song", album: "Sessions" } }),
    );
    await userEvent.click(within(dialog).getByText("Sessions", { selector: ".detail-fold-value" }));

    await userEvent.clear(box(dialog, "Album"));
    await userEvent.type(box(dialog, "Album"), "   ");

    expect(summary(dialog)).toHaveTextContent("No album (single)");
    await save(dialog);
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ album: "" });
  });

  it("does not offer the single choice for a song inside an album file", async () => {
    const { dialog } = await renderDialog({
      ...detailsOf(7),
      kind: { value: "song", reason: "segment" },
    });
    await userEvent.click(within(dialog).getByText("Unknown"));

    expect(
      within(dialog).queryByRole("button", { name: "Remove album and mark as single" }),
    ).toBeNull();
  });

  it("is folded, saying the album a song is on", async () => {
    const { dialog } = await renderDialog(detailsOf(7, { album: "Re:Start" }));

    expect(fold(dialog)).toHaveTextContent("AlbumRe:Start");
  });

  it("opens to be filled in when asked", async () => {
    const { dialog } = await renderDialog();

    await userEvent.click(within(dialog).getByText("Unknown"));

    expect(fold(dialog)).toHaveAttribute("open");
    expect(box(dialog, "Album")).toBeVisible();
  });

  it("is open for an album in one file, whose album it is", async () => {
    const { dialog } = await renderDialog({
      ...detailsOf(7),
      kind: { value: "album", reason: "length" },
    });

    expect(within(dialog).queryByText("Album", { selector: ".detail-fold-title" })).toBeNull();
    expect(within(dialog).getByRole("group", { name: "Album" })).toContainElement(
      box(dialog, "Album"),
    );
    expect(
      within(dialog).queryByRole("button", { name: "Remove album and mark as single" }),
    ).toBeNull();
  });
});

describe("a song's artists, one chip each", () => {
  /** *ケビョウニンゲン*, whose video names スズム as its one artist. */
  const ONE_ARTIST = detailsOf(7, {}, { video: { title: "ケビョウニンゲン", artist: "スズム" } });

  /** The song showing スズム featuring GUMI, as the name it writes was split; GUMI linked. */
  const SPLIT: Details = {
    ...detailsOf(7, {}, { video: { title: "ケビョウニンゲン", artist: "スズム feat. GUMI" } }),
    artists: [
      trackArtistOf("スズム"),
      trackArtistOf("GUMI", "featured", { musicbrainz_id: "gumi", name: "GUMI", photo: null }),
    ],
  };

  const chips = (dialog: HTMLElement) =>
    within(within(dialog).getByRole("list", { name: "Artists" }))
      .getAllByRole("listitem")
      .map((chip) => chip.textContent);

  it("turns the artist into a chip and adds the next one typed", async () => {
    const { dialog, onSave } = await renderDialog(ONE_ARTIST);

    await userEvent.click(within(dialog).getByRole("button", { name: "More artists" }));
    await userEvent.type(box(dialog, "Artists"), "GUMI{Enter}");
    const added = chips(dialog);
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(added).toEqual([expect.stringContaining("スズム"), expect.stringContaining("GUMI")]);
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({}, [
        { written: "スズム", role: "main" },
        { written: "GUMI", role: "main" },
      ]);
    });
  });

  it("credits an artist as featured in its place", async () => {
    const { dialog, onSave } = await renderDialog(ONE_ARTIST);
    await userEvent.click(within(dialog).getByRole("button", { name: "More artists" }));
    await userEvent.type(box(dialog, "Artists"), "GUMI{Enter}");

    const featured = within(dialog).getByRole("button", { name: "GUMI, featured" });
    await userEvent.click(featured);
    expect(box(dialog, "Title")).toHaveAccessibleDescription("From the video");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(featured).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({}, [
        { written: "スズム", role: "main" },
        { written: "GUMI", role: "featured" },
      ]);
    });
  });

  it("shows the artists a song shows as chips, saving nothing while they stay", async () => {
    const { dialog } = await renderDialog(SPLIT);

    expect(chips(dialog)).toEqual([
      expect.stringContaining("not linked"),
      expect.stringContaining("linked to GUMI"),
    ]);
    expect(within(dialog).getByRole("button", { name: "GUMI, featured" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("puts the one main artist left back in the box, focused, saying who went", async () => {
    const { dialog, onSave } = await renderDialog(SPLIT);

    await userEvent.click(within(dialog).getByRole("button", { name: "Remove GUMI" }));
    const listed = within(dialog).queryByRole("list", { name: "Artists" });
    const focused = box(dialog, "Artist");
    await waitFor(() => {
      expect(focused).toHaveFocus();
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(listed).toBeNull();
    expect(within(dialog).getByText("Removed GUMI")).toBeInTheDocument();
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ artist: "スズム" });
    });
  });

  it("makes the artist left main once the last main one is removed", async () => {
    const { dialog, onSave } = await renderDialog(SPLIT);

    await userEvent.click(within(dialog).getByRole("button", { name: "Remove スズム" }));
    const left = (box(dialog, "Artist") as HTMLInputElement).value;
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(left).toBe("GUMI");
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ artist: "GUMI" });
    });
  });

  it("adds no chip with Enter while a word is being composed", async () => {
    const { dialog } = await renderDialog(SPLIT);
    const adding = box(dialog, "Artists");
    await userEvent.type(adding, "初音ミク");

    fireEvent.keyDown(adding, { key: "Enter", isComposing: true });

    expect(chips(dialog)).toHaveLength(2);
    expect(adding).toHaveValue("初音ミク");
  });

  it("uses another origin's artist in place of the chips", async () => {
    const { dialog, onSave } = await renderDialog({
      ...SPLIT,
      origins: { ...SPLIT.origins, file_name: { title: "x", artist: "DECO*27" } },
    });

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Use “DECO*27”, from the file's name" }),
    );
    const listed = within(dialog).queryByRole("list", { name: "Artists" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(listed).toBeNull();
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ artist: "DECO*27" });
    });
  });

  it("offers no chips for a file split into songs, which takes its artists from them", async () => {
    const { dialog } = await renderDialog({
      ...ONE_ARTIST,
      kind: { value: "album", reason: "split" },
    });

    expect(within(dialog).queryByRole("button", { name: "More artists" })).toBeNull();
  });
});

describe("which artist going by a name a song is by", () => {
  /** The song by Jay, the name's first artist, where another Jay has three songs on *Blue Night*. */
  const BY_JAY: Details = {
    ...detailsOf(7, {}, { video: { title: "星晴", artist: "Jay" } }),
    artists: [
      trackArtistOf("Jay", "main", null, [
        namesakeOf("jay-2", { songs: 3, albums: ["Blue Night"] }),
      ]),
    ],
  };

  const openMenu = async (dialog: HTMLElement) => {
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Another artist named Jay?" }),
    );
    return screen.findByRole("menu");
  };

  it("shows the saved artist as a tag the width of its column, edited as text once clicked", async () => {
    const { dialog } = await renderDialog(BY_JAY, undefined, undefined, {
      onChooseArtist: vi.fn(() => Promise.resolve(BY_JAY)),
    });
    expect(within(dialog).queryByRole("textbox", { name: "Artist" })).toBeNull();

    await userEvent.click(within(dialog).getByRole("button", { name: "Edit the artist Jay" }));

    expect(box(dialog, "Artist")).toHaveValue("Jay");
    expect(box(dialog, "Artist")).toHaveFocus();
  });

  it("asks which artist of the name from ? in the artist's tag, never while it is typed", async () => {
    const { dialog } = await renderDialog(BY_JAY, undefined, undefined, {
      onChooseArtist: vi.fn(() => Promise.resolve(BY_JAY)),
    });
    expect(
      within(dialog).getByRole("button", { name: "Another artist named Jay?" }),
    ).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Edit the artist Jay" }));

    expect(within(dialog).queryByRole("button", { name: "Another artist named Jay?" })).toBeNull();
  });

  it("says in the tooltips why there is another artist of the name, and why more artists", async () => {
    const { dialog } = await renderDialog(BY_JAY, undefined, undefined, {
      onChooseArtist: vi.fn(() => Promise.resolve(BY_JAY)),
    });

    expect(
      within(dialog).getByRole("button", { name: "Another artist named Jay?" }),
    ).toHaveAttribute("title", "Choose the artist for this song. Changes apply immediately.");
    expect(within(dialog).getByRole("button", { name: "More artists" })).toHaveAttribute(
      "title",
      "This song is by more than one artist: add each one",
    );
  });

  it("offers another artist called the song's artist, and binds the song to it at once", async () => {
    const onChooseArtist = vi.fn(() => Promise.resolve(BY_JAY));
    const { dialog, onSave } = await renderDialog(BY_JAY, undefined, undefined, {
      onChooseArtist,
    });

    const menu = await openMenu(dialog);
    await userEvent.click(
      within(menu).getByRole("menuitem", { name: "Create another artist named Jay" }),
    );

    expect(onChooseArtist).toHaveBeenCalledWith("Jay", null);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("tells the other artists going by the name apart by their albums, and binds to one", async () => {
    const onChooseArtist = vi.fn(() => Promise.resolve(BY_JAY));
    const { dialog } = await renderDialog(BY_JAY, undefined, undefined, { onChooseArtist });

    const menu = await openMenu(dialog);
    const now = within(menu).getByRole("menuitemradio", { name: "The one it is by now" });
    await userEvent.click(
      within(menu).getByRole("menuitemradio", { name: "On Blue Night · 3 songs" }),
    );

    expect(now).toHaveAttribute("aria-checked", "true");
    expect(onChooseArtist).toHaveBeenCalledWith("Jay", "artist-jay-2");
  });

  it("says why the server refused a choice, and stays open", async () => {
    const onChooseArtist = vi.fn(() => Promise.reject(new ApiError(404, "No artist called Jay.")));
    const { dialog, onClose } = await renderDialog(BY_JAY, undefined, undefined, {
      onChooseArtist,
    });

    const menu = await openMenu(dialog);
    await userEvent.click(
      within(menu).getByRole("menuitem", { name: "Create another artist named Jay" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("No artist called Jay.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("is not offered where the artist can't be chosen", async () => {
    const { dialog } = await renderDialog(BY_JAY);

    expect(within(dialog).queryByRole("button", { name: "Another artist named Jay?" })).toBeNull();
  });
});
