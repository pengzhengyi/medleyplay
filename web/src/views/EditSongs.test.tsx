import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError, type PlaybackAnswer, type Song, type SongRowIn, type Songs } from "../api";
import { fakeMedia } from "../testing/media";
import { splitSongsOf, trackOf } from "../testing/server";
import { EditSongs } from "./EditSongs";

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

async function renderEditor(
  songs: Songs = SPLIT,
  {
    onSave = vi.fn<(rows: readonly SongRowIn[], known: readonly number[]) => Promise<void>>(() =>
      Promise.resolve(),
    ),
    onUnsplit = vi.fn<() => Promise<void>>(() => Promise.resolve()),
    readList = vi.fn<(trackId: number, text: string) => Promise<readonly Song[]>>(() =>
      Promise.resolve(LISTED),
    ),
    loadAudio = vi.fn<(trackId: number) => Promise<PlaybackAnswer>>(() =>
      Promise.resolve(BREMEN_AUDIO),
    ),
    onListen = vi.fn(),
  } = {},
) {
  const onClose = vi.fn();
  const { unmount } = render(
    <EditSongs
      album={BREMEN}
      load={() => Promise.resolve(songs)}
      readList={readList}
      loadAudio={loadAudio}
      onListen={onListen}
      onSave={onSave}
      onUnsplit={onUnsplit}
      onClose={onClose}
    />,
  );
  const dialog = screen.getByRole("dialog");
  await within(dialog).findByRole("button", { name: "Add a song" });
  const media = fakeMedia(audioOf(dialog));
  return { dialog, media, onSave, onUnsplit, readList, loadAudio, onListen, onClose, unmount };
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
const press = (dialog: HTMLElement, name: string | RegExp) =>
  userEvent.click(within(dialog).getByRole("button", { name }));

describe("editing a file's songs", () => {
  it("shows each song's start, title, and artist", async () => {
    const { dialog } = await renderEditor();

    expect(dialog).toHaveAccessibleName("Edit songs");
    expect(box(dialog, "Start of song 2")).toHaveValue("4:12");
    expect(box(dialog, "Title of song 2")).toHaveValue("ゴーゴー幽霊船");
    expect(box(dialog, "Start of song 3")).toHaveValue("8:00");
  });

  it("splits a file from the list found in its video's details, as new songs", async () => {
    const { dialog, onSave, onClose } = await renderEditor(splitSongsOf(104, [], [LISTED]));

    expect(dialog).toHaveAccessibleName("Split into songs");
    await press(dialog, "Use the 2 songs from the video's details");
    await press(dialog, "Save");

    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      [
        { id: null, start_ms: 0, title: "アイネクライネ", artist: "" },
        { id: null, start_ms: 252_000, title: "ゴーゴー幽霊船", artist: "ハチ" },
      ],
      [],
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("splits a file from the list the AI suggested, as new songs", async () => {
    const { dialog, onSave } = await renderEditor(splitSongsOf(104, [], [], LISTED));

    await press(dialog, "Use the 2 songs the AI suggested");
    await press(dialog, "Save");

    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      [
        { id: null, start_ms: 0, title: "アイネクライネ", artist: "" },
        { id: null, start_ms: 252_000, title: "ゴーゴー幽霊船", artist: "ハチ" },
      ],
      [],
    );
  });

  it("offers the list the AI suggested for a file already split, replacing its rows when used", async () => {
    const { dialog } = await renderEditor({ ...SPLIT, suggested: LISTED });

    await press(dialog, "Use the 2 songs the AI suggested");

    expect(box(dialog, "Title of song 1")).toHaveValue("アイネクライネ");
    expect(box(dialog, "Artist of song 2")).toHaveValue("ハチ");
    expect(within(dialog).queryByRole("textbox", { name: "Title of song 3" })).toBeNull();
  });

  it("offers no AI list when the AI suggested none", async () => {
    const { dialog } = await renderEditor();

    expect(within(dialog).queryByRole("button", { name: /the AI suggested/u })).toBeNull();
  });

  it("reads a pasted list into its rows", async () => {
    const { dialog, readList } = await renderEditor(splitSongsOf(104, []));

    await userEvent.click(within(dialog).getByText("Paste a list"));
    await userEvent.click(box(dialog, "Song list"));
    await userEvent.paste("00:00 アイネクライネ\n04:12 ゴーゴー幽霊船 - ハチ");
    await press(dialog, "Read the list");

    expect(readList).toHaveBeenCalledExactlyOnceWith(
      104,
      "00:00 アイネクライネ\n04:12 ゴーゴー幽霊船 - ハチ",
    );
    expect(box(dialog, "Artist of song 2")).toHaveValue("ハチ");
  });

  it("keeps each song by its id when its row is moved and renamed", async () => {
    const { dialog, onSave } = await renderEditor();

    await press(dialog, "Move “Last” up");
    await userEvent.clear(box(dialog, "Start of song 2"));
    await userEvent.type(box(dialog, "Start of song 2"), "3:00");
    await userEvent.type(box(dialog, "Title of song 2"), " (Reprise)");
    await press(dialog, "Save");

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
    await press(dialog, "Save");

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
    await press(dialog, "Save");

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

    await press(dialog, "Save");

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
    await press(dialog, "Save");

    await userEvent.type(box(dialog, "Title of song 1"), "!");
    await press(dialog, "Save");

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

    await press(dialog, "Save");

    expect(onSave.mock.calls[0]?.[0][1]?.start_ms).toBe(192_500);
  });

  it("says which song starts after its file ends", async () => {
    const { dialog, onSave } = await renderEditor();

    await userEvent.clear(box(dialog, "Start of song 3"));
    await userEvent.type(box(dialog, "Start of song 3"), "2:00:00");
    await press(dialog, "Save");

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Song 3 starts after the file ends",
    );
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("listening in the songs editor", () => {
  it("plays the file from a song's start, pausing the music playing", async () => {
    const { dialog, loadAudio, onListen } = await renderEditor();

    await press(dialog, "Listen from song 2");

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
    await press(dialog, "Listen from song 2");
    await waitFor(() => {
      expect(audioOf(dialog).paused).toBe(false);
    });

    media.playTo(300.5);
    await press(dialog, "Start song 3 here");

    expect(box(dialog, "Start of song 3")).toHaveValue("5:00");
    await press(dialog, "Save");
    expect(onSave.mock.calls[0]?.[0][2]).toMatchObject({ start_ms: 300_500 });
  });

  it("says when the file is still being prepared", async () => {
    const { dialog } = await renderEditor(SPLIT, {
      loadAudio: vi.fn(() =>
        Promise.resolve<PlaybackAnswer>({ state: "preparing", source_id: 104, job_id: 9 }),
      ),
    });

    await press(dialog, "Listen from song 1");

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

    await press(dialog, "Listen from song 2");
    await press(dialog, "Listen from song 3");
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

    await press(dialog, "Listen from song 2");
    unmount();
    answer.give(BREMEN_AUDIO);
    await Promise.resolve();

    expect(audio).not.toHaveAttribute("src");
    expect(audio.paused).toBe(true);
    expect(onListen).not.toHaveBeenCalled();
  });

  it("stops the file when it closes", async () => {
    const { dialog, media, unmount } = await renderEditor();
    await press(dialog, "Listen from song 2");
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
    await press(dialog, "Listen from song 2");
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
