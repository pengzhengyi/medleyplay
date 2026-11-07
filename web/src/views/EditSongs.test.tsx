import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EditorView } from "@codemirror/view";

import {
  ApiError,
  type ListCheck,
  type PlaybackAnswer,
  type Song,
  type SongRowIn,
  type Songs,
} from "../api";
import { fakeMedia } from "../testing/media";
import { detailsOf, splitSongsOf, trackOf } from "../testing/server";
import { EditDetails } from "./EditDetails";
import { type AiAsk, SongsEditor } from "./EditSongs";

/** *Bremen*, a whole album uploaded as one video. */
const BREMEN = trackOf(104, "BV1dm4y1s7ak", { split: true });

/** *Bremen* split into three songs. */
const SPLIT = splitSongsOf(104, [
  [1, 0, "アイネクライネ"],
  [2, 252_000, "ゴーゴー幽霊船"],
  [3, 480_000, "Last"],
]);

/** *Bremen*'s file, ready to play whole. */
const BREMEN_AUDIO: PlaybackAnswer = {
  state: "ready",
  source_id: 104,
  audio_url: "/api/sources/104/audio",
  media_type: "audio/mp4",
  start_ms: null,
  end_ms: null,
};

/** The song list the video's description gives. */
const LISTED: readonly Song[] = [
  { start_ms: 0, title: "アイネクライネ", artist: "" },
  { start_ms: 252_000, title: "ゴーゴー幽霊船", artist: "ハチ" },
];

/** The AI, set up and never asked about the file. */
const AI_UNASKED: AiAsk = { can: true, state: undefined, message: "", ask: vi.fn() };

/**
 * Open *Bremen*'s details on its songs, as its menu's *Edit songs…* does, its file
 * holding `songs`; the AI is as `ai` says, and `answerAi` shows it as it goes later.
 */
async function renderEditor(
  songs: Songs = SPLIT,
  {
    onSave = vi.fn<(rows: readonly SongRowIn[], known: readonly number[]) => Promise<void>>(() =>
      Promise.resolve(),
    ),
    onUnsplit = vi.fn<() => Promise<void>>(() => Promise.resolve()),
    check = vi.fn<(trackId: number, text: string) => Promise<ListCheck>>(() =>
      Promise.resolve({ songs: LISTED, problems: [] }),
    ),
    loadAudio = vi.fn<(trackId: number) => Promise<PlaybackAnswer>>(() =>
      Promise.resolve(BREMEN_AUDIO),
    ),
    onListen = vi.fn(),
    ai = AI_UNASKED,
  } = {},
) {
  const onClose = vi.fn();
  const load = vi.fn<(trackId: number) => Promise<Songs>>(() => Promise.resolve(songs));
  const dialogOf = (asked: AiAsk) => (
    <EditDetails
      track={BREMEN}
      load={() => Promise.resolve(detailsOf(104))}
      onSave={() => Promise.resolve()}
      onReadVideo={() => Promise.reject(new Error("No video in this test."))}
      onSetCover={() => Promise.reject(new Error("No cover in this test."))}
      onRemoveCover={() => Promise.reject(new Error("No cover in this test."))}
      findable={[]}
      lookup={undefined}
      online
      onFind={vi.fn()}
      songs={{
        label: "3 songs",
        editor: (
          <SongsEditor
            album={BREMEN}
            load={load}
            check={check}
            artists={["ハチ"]}
            ai={asked}
            loadAudio={loadAudio}
            onListen={onListen}
            onSave={onSave}
            onUnsplit={onUnsplit}
          />
        ),
      }}
      startOnSongs
      onClose={onClose}
    />
  );
  const { rerender, unmount } = render(dialogOf(ai));
  const dialog = screen.getByRole("dialog");
  await within(dialog).findByRole("button", { name: "Add a song" });
  const media = fakeMedia(audioOf(dialog));
  /** Show the editor as the page would once the AI's lookup is `asked`. */
  const answerAi = (asked: AiAsk) => {
    rerender(dialogOf(asked));
  };
  return {
    dialog,
    media,
    load,
    onSave,
    onUnsplit,
    check,
    loadAudio,
    onListen,
    onClose,
    unmount,
    answerAi,
  };
}

function audioOf(dialog: HTMLElement): HTMLAudioElement {
  const audio = dialog.querySelector("audio");
  if (audio === null) {
    throw new Error("The songs editor has no player.");
  }
  return audio;
}

/** An answer the test gives when it chooses, as a slow server would. */
function later<T>() {
  let give: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    give = resolve;
  });
  return { promise, give };
}

/** The note on what listening came to, a status a screen reader hears. */
function listeningNote(dialog: HTMLElement): HTMLElement {
  const note = dialog.querySelector<HTMLElement>(".songs-audio-note");
  if (note === null) {
    throw new Error("The songs editor has no note on listening.");
  }
  expect(note).toHaveRole("status");
  return note;
}

const box = (dialog: HTMLElement, name: string) => within(dialog).getByRole("textbox", { name });
const press = (dialog: HTMLElement, name: string | RegExp | HTMLElement) =>
  userEvent.click(
    name instanceof HTMLElement ? name : within(dialog).getByRole("button", { name }),
  );

describe("editing a file's songs", () => {
  it("shows each song's start, title, and artist", async () => {
    const { dialog } = await renderEditor();

    expect(dialog).toHaveAccessibleName("Songs");
    expect(box(dialog, "Start of song 2")).toHaveValue("4:12");
    expect(box(dialog, "Title of song 2")).toHaveValue("ゴーゴー幽霊船");
    expect(box(dialog, "Start of song 3")).toHaveValue("8:00");
  });

  it("splits a file from the list found in its video's details, as new songs", async () => {
    const { dialog, onSave, onClose } = await renderEditor(splitSongsOf(104, [], [LISTED]));

    expect(dialog).toHaveAccessibleName("Split into songs");
    await press(dialog, "Fill from the video's 2 songs");
    await press(dialog, "Save songs");

    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      [
        { id: null, start_ms: 0, title: "アイネクライネ", artist: "" },
        { id: null, start_ms: 252_000, title: "ゴーゴー幽霊船", artist: "ハチ" },
      ],
      [],
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("splits a file from the list the AI suggested, saying where the songs came from", async () => {
    const { dialog, onSave } = await renderEditor(splitSongsOf(104, [], [], LISTED));

    await press(dialog, "Fill with AI");
    await press(dialog, "Save songs");

    expect(within(dialog).getByText("2 songs from the AI")).toHaveRole("status");
    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      [
        { id: null, start_ms: 0, title: "アイネクライネ", artist: "" },
        { id: null, start_ms: 252_000, title: "ゴーゴー幽霊船", artist: "ハチ" },
      ],
      [],
    );
  });

  it("keeps each song the AI's list still names when it fills a file already split", async () => {
    const { dialog, onSave } = await renderEditor({ ...SPLIT, suggested: LISTED });

    await press(dialog, "Fill with AI");
    const filled = [(box(dialog, "Artist of song 2") as HTMLInputElement).value];
    const third = within(dialog).queryByRole("textbox", { name: "Title of song 3" });
    await press(dialog, "Save songs");
    await press(dialog, "Save and remove 1 song");

    expect(filled).toEqual(["ハチ"]);
    expect(third).toBeNull();
    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      [
        { id: 1, start_ms: 0, title: "アイネクライネ", artist: "" },
        { id: 2, start_ms: 252_000, title: "ゴーゴー幽霊船", artist: "ハチ" },
      ],
      [1, 2, 3],
    );
  });

  it("asks the AI when it has suggested nothing, and fills the songs once it answers", async () => {
    const ask = vi.fn();
    const unsplit = splitSongsOf(104, []);
    const { dialog, load, answerAi } = await renderEditor(unsplit, {
      ai: { ...AI_UNASKED, ask },
    });

    await press(dialog, "Fill with AI");
    answerAi({ ...AI_UNASKED, ask, state: "running" });
    const asking = within(dialog).getByText("Asking the AI…");
    load.mockResolvedValue({ ...unsplit, suggested: LISTED });
    answerAi({ ...AI_UNASKED, ask, state: "succeeded" });

    expect(ask).toHaveBeenCalledOnce();
    expect(asking).toHaveRole("status");
    expect(await within(dialog).findByText("2 songs from the AI")).toBeInTheDocument();
    expect(box(dialog, "Title of song 2")).toHaveValue("ゴーゴー幽霊船");
  });

  it("says when the AI found no song list", async () => {
    const { dialog, answerAi } = await renderEditor(splitSongsOf(104, []));

    await press(dialog, "Fill with AI");
    answerAi({ ...AI_UNASKED, state: "succeeded" });

    expect(await within(dialog).findByText("The AI found no song list for this file.")).toHaveRole(
      "status",
    );
  });

  it("can't ask an AI that isn't set up, and says where to set one up", async () => {
    const { dialog } = await renderEditor(SPLIT, { ai: { ...AI_UNASKED, can: false } });

    const button = within(dialog).getByRole("button", { name: "Fill with AI" });

    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("Set up an AI provider in Settings to ask it");
  });

  it("types the songs as a list, starting from the rows, and keeps the songs it still names", async () => {
    const check = vi.fn((_: number, text: string) =>
      Promise.resolve<ListCheck>({
        songs: text.includes("ハチ") ? LISTED : [],
        problems: text.includes("ハチ") ? [] : [{ line: null, message: "Not yet." }],
      }),
    );
    const { dialog, onSave } = await renderEditor(SPLIT, { check });

    await press(dialog, "Fill from a list");
    const text = await within(dialog).findByRole("textbox", { name: "Song list" });
    const view = EditorView.findFromDOM(text);
    const typed = view?.state.doc.toString();
    act(() => {
      view?.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: "0:00 アイネクライネ\n4:12 ゴーゴー幽霊船 - ハチ",
        },
      });
    });
    await press(dialog, await within(dialog).findByRole("button", { name: "Use these 2 songs" }));
    await press(dialog, "Save songs");
    await press(dialog, "Save and remove 1 song");

    expect(typed).toBe("0:00 アイネクライネ\n4:12 ゴーゴー幽霊船\n8:00 Last");
    expect(check).toHaveBeenLastCalledWith(104, "0:00 アイネクライネ\n4:12 ゴーゴー幽霊船 - ハチ");
    expect(onSave.mock.calls[0]?.[0].map((row) => row.id)).toEqual([1, 2]);
  });

  it("keeps each song by its id when its row is moved and renamed", async () => {
    const { dialog, onSave } = await renderEditor();

    await press(dialog, "Move “Last” up");
    await userEvent.clear(box(dialog, "Start of song 2"));
    await userEvent.type(box(dialog, "Start of song 2"), "3:00");
    await userEvent.type(box(dialog, "Title of song 2"), " (Reprise)");
    await press(dialog, "Save songs");

    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      [
        { id: 1, start_ms: 0, title: "アイネクライネ", artist: "" },
        { id: 3, start_ms: 180_000, title: "Last (Reprise)", artist: "" },
        { id: 2, start_ms: 252_000, title: "ゴーゴー幽霊船", artist: "" },
      ],
      [1, 2, 3],
    );
  });

  it("says what saving removes first, and saves on the second press", async () => {
    const { dialog, onSave } = await renderEditor();

    await press(dialog, "Remove “Last”");
    await press(dialog, "Save songs");

    expect(onSave).not.toHaveBeenCalled();
    expect(
      within(dialog).getByText("Saving removes 1 song, with their ratings and plays."),
    ).toHaveRole("status");
    await press(dialog, "Save and remove 1 song");
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("says what unsplitting removes first, and unsplits on the second press", async () => {
    const { dialog, onUnsplit } = await renderEditor();

    await press(dialog, "Unsplit");

    expect(onUnsplit).not.toHaveBeenCalled();
    await press(dialog, "Unsplit and remove 3 songs");
    expect(onUnsplit).toHaveBeenCalledOnce();
  });

  it("says which song starts at no time, saving nothing", async () => {
    const { dialog, onSave } = await renderEditor();

    await press(dialog, "Add a song");
    await userEvent.type(box(dialog, "Start of song 4"), "8:75");
    await press(dialog, "Save songs");

    expect(within(dialog).getByRole("alert")).toHaveTextContent("Song 4 starts at no time");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("says why the server refused, and stays open", async () => {
    const { dialog, onClose } = await renderEditor(SPLIT, {
      onSave: vi.fn(() =>
        Promise.reject(
          new ApiError(422, "Starts rise at least a second a song; song 2 breaks that."),
        ),
      ),
    });

    await press(dialog, "Save songs");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("song 2 breaks that");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the songs editor's guards", () => {
  it("takes a start typed with a colon, as a phone's keyboard offers it", async () => {
    const { dialog } = await renderEditor();

    expect(box(dialog, "Start of song 1")).not.toHaveAttribute("inputmode", "numeric");
  });

  it("asks again after any edit made once it said what saving removes", async () => {
    const { dialog, onSave } = await renderEditor();
    await press(dialog, "Remove “Last”");
    await press(dialog, "Save songs");

    await userEvent.type(box(dialog, "Title of song 1"), "!");
    await press(dialog, "Save songs");

    expect(onSave).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Save and remove 1 song" })).toBeVisible();
  });

  it("keeps a start of part of a second as it was, unless its time is edited", async () => {
    const { dialog, onSave } = await renderEditor(
      splitSongsOf(104, [
        [1, 0, "Intro"],
        [2, 192_500, "Night Drive"],
      ]),
    );

    await press(dialog, "Save songs");

    expect(onSave.mock.calls[0]?.[0][1]?.start_ms).toBe(192_500);
  });

  it("says which song starts after its file ends", async () => {
    const { dialog, onSave } = await renderEditor();

    await userEvent.clear(box(dialog, "Start of song 3"));
    await userEvent.type(box(dialog, "Start of song 3"), "2:00:00");
    await press(dialog, "Save songs");

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Song 3 starts after the file ends",
    );
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("listening in the songs editor", () => {
  it("plays just a song, from its start to where the next starts", async () => {
    const { dialog, media } = await renderEditor();
    await press(dialog, "Play song 2");
    await waitFor(() => {
      expect(audioOf(dialog).paused).toBe(false);
    });
    const pressed = within(dialog).getByRole("button", { name: "Play song 2" });

    const playingThen = pressed.getAttribute("aria-pressed");
    act(() => {
      media.playTo(480);
    });

    expect(playingThen).toBe("true");
    expect(audioOf(dialog).paused).toBe(true);
    expect(pressed).toHaveAttribute("aria-pressed", "false");
  });

  it("checks a song by ear: its first five seconds, then its last five", async () => {
    const { dialog, media } = await renderEditor();
    await press(dialog, "Check song 2 by ear");
    await waitFor(() => {
      expect(audioOf(dialog).paused).toBe(false);
    });

    const from = audioOf(dialog).currentTime;
    media.playTo(257);
    const jumped = audioOf(dialog).currentTime;
    media.playTo(480);

    expect([from, jumped]).toEqual([252, 475]);
    expect(audioOf(dialog).paused).toBe(true);
  });

  it("stops a song playing when it is pressed again", async () => {
    const { dialog } = await renderEditor();
    await press(dialog, "Play song 2");
    await waitFor(() => {
      expect(audioOf(dialog).paused).toBe(false);
    });

    await press(dialog, "Play song 2");

    expect(audioOf(dialog).paused).toBe(true);
  });

  it("plays the file from a song's start, pausing the music playing", async () => {
    const { dialog, loadAudio, onListen } = await renderEditor();

    await press(dialog, "Play song 2");

    await waitFor(() => {
      expect(audioOf(dialog).paused).toBe(false);
    });
    expect(audioOf(dialog)).toHaveAttribute("src", "/api/sources/104/audio");
    expect(audioOf(dialog).currentTime).toBe(252);
    expect(loadAudio).toHaveBeenCalledExactlyOnceWith(104);
    expect(onListen).toHaveBeenCalledOnce();
  });

  it("starts a song where the file is playing, to the millisecond", async () => {
    const { dialog, media, onSave } = await renderEditor();
    await press(dialog, "Play song 2");
    await waitFor(() => {
      expect(audioOf(dialog).paused).toBe(false);
    });

    media.playTo(300.5);
    await press(dialog, "Start song 3 here");

    expect(box(dialog, "Start of song 3")).toHaveValue("5:00");
    await press(dialog, "Save songs");
    expect(onSave.mock.calls[0]?.[0][2]).toMatchObject({ start_ms: 300_500 });
  });

  it("says when the file is still being prepared", async () => {
    const { dialog } = await renderEditor(SPLIT, {
      loadAudio: vi.fn(() =>
        Promise.resolve<PlaybackAnswer>({ state: "preparing", source_id: 104, job_id: 9 }),
      ),
    });

    await press(dialog, "Play song 1");

    await waitFor(() => {
      expect(listeningNote(dialog)).toHaveTextContent(
        "The file is being prepared; listen again in a moment.",
      );
    });
  });

  it("plays from the latest song pressed while the file is still being asked for", async () => {
    const answer = later<PlaybackAnswer>();
    const { dialog, loadAudio } = await renderEditor(SPLIT, {
      loadAudio: vi.fn(() => answer.promise),
    });

    await press(dialog, "Play song 2");
    await press(dialog, "Play song 3");
    answer.give(BREMEN_AUDIO);

    await waitFor(() => {
      expect(audioOf(dialog).paused).toBe(false);
    });
    expect(audioOf(dialog).currentTime).toBe(480);
    expect(loadAudio).toHaveBeenCalledOnce();
    expect(listeningNote(dialog)).toBeEmptyDOMElement();
  });

  it("plays nothing, and leaves the music playing, when it closes while the file is asked for", async () => {
    const answer = later<PlaybackAnswer>();
    const { dialog, onListen, unmount } = await renderEditor(SPLIT, {
      loadAudio: vi.fn(() => answer.promise),
    });
    const audio = audioOf(dialog);

    await press(dialog, "Play song 2");
    unmount();
    answer.give(BREMEN_AUDIO);
    await Promise.resolve();

    expect(audio).not.toHaveAttribute("src");
    expect(audio.paused).toBe(true);
    expect(onListen).not.toHaveBeenCalled();
  });

  it("stops the file when it closes", async () => {
    const { dialog, media, unmount } = await renderEditor();
    await press(dialog, "Play song 2");
    await waitFor(() => {
      expect(audioOf(dialog).paused).toBe(false);
    });
    const audio = audioOf(dialog);

    unmount();

    expect(audio.paused).toBe(true);
    expect(media.pauses).toBe(1);
  });

  it("forgets what it said about listening once the songs are edited", async () => {
    const { dialog } = await renderEditor();
    await userEvent.clear(box(dialog, "Start of song 2"));
    await press(dialog, "Play song 2");
    expect(listeningNote(dialog)).toHaveTextContent(/Song 2 starts at no time/);

    await userEvent.type(box(dialog, "Start of song 2"), "4:12");

    expect(listeningNote(dialog)).toBeEmptyDOMElement();
  });

  it("keeps the dialog open when Escape puts a song being dragged back", async () => {
    const { dialog, onClose } = await renderEditor();
    within(dialog).getByRole("button", { name: "Reorder “Last”" }).focus();

    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toHaveAttribute("open");
    expect(box(dialog, "Title of song 3")).toHaveValue("Last");
  });

  it("drags a song by its handle, which says how to move it with the keys", async () => {
    const { dialog } = await renderEditor();

    const handle = within(dialog).getByRole("button", { name: "Reorder “Last”" });

    expect(handle).toHaveAttribute("aria-roledescription", "sortable");
    // The instructions mount just after the rows do.
    await waitFor(() => {
      expect(handle).toHaveAccessibleDescription(/press Space to pick the song up/);
    });
  });
});

describe("what looks wrong with a split", () => {
  it("warns under a song so long it may be two, and above the songs when too few share the file", async () => {
    await renderEditor();

    expect(
      await screen.findByText("52:00 long: it may be two songs. Check where the next one starts."),
    ).toBeVisible();
    expect(screen.getByText(/^3 songs, 1 hr: an album this long usually has more/)).toBeVisible();
  });

  it("warns of nothing when the songs are of usual lengths", async () => {
    // Fifteen songs, one every four minutes, in an hour-long file.
    const usual = splitSongsOf(
      104,
      Array.from(
        { length: 15 },
        (_, index) => [index + 1, index * 240_000, `Song ${String(index + 1)}`] as const,
      ),
    );

    await renderEditor(usual);

    expect(await screen.findByRole("textbox", { name: "Title of song 15" })).toBeVisible();
    expect(screen.queryByText(/may be two songs|may be missing/)).toBeNull();
  });

  it("says when the video and the AI count different songs, as a second opinion", async () => {
    const suggested: readonly Song[] = [
      { start_ms: 0, title: "アイネクライネ", artist: "" },
      { start_ms: 252_000, title: "ゴーゴー幽霊船", artist: "" },
      { start_ms: 480_000, title: "Last", artist: "" },
      { start_ms: 900_000, title: "Encore", artist: "" },
    ];

    await renderEditor(splitSongsOf(104, [[1, 0, "アイネクライネ"]], [LISTED], suggested));

    expect(await screen.findByText("The video lists 2 songs, the AI 4.")).toBeVisible();
  });
});
