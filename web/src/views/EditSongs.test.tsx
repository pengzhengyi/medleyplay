import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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
import { detailsOf, serve, splitSongsOf, trackOf } from "../testing/server";
import { EditDetails } from "./EditDetails";
import { LyricsEditor } from "./LyricsEditor";
import { type AiAsk, type SilenceFinder, SongsEditor } from "./EditSongs";
import { type AiSetUp, AiSetUpContext } from "./aiSetUp";

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
const AI_UNASKED: AiAsk = {
  can: true,
  state: undefined,
  message: "",
  ask: vi.fn(),
  askAgain: vi.fn(),
  stop: vi.fn(),
};

/** A server that has never looked for the gaps, and can't find them: ffmpeg isn't installed. */
const NO_GAPS_KNOWN: SilenceFinder = {
  read: () => Promise.resolve({ state: "not_found", silences: [] }),
  find: () => Promise.resolve({ state: "no_tool", silences: [] }),
};

/** An AI provider set up, as the page says once the server has. */
const SET_UP: AiSetUp = { missing: false, admin: true };

// The details typed in the note to the AI are remembered in this browser, test to test too.
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

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
    silences = NO_GAPS_KNOWN,
    aiSetUp = SET_UP,
    loadLyrics = vi.fn<(id: number) => Promise<null>>(() => Promise.resolve(null)),
  } = {},
) {
  const onClose = vi.fn();
  const load = vi.fn<(trackId: number) => Promise<Songs>>(() => Promise.resolve(songs));
  const dialogOf = (asked: AiAsk, matchRevision = 0) => (
    <EditDetails
      track={BREMEN}
      load={() => Promise.resolve(detailsOf(104))}
      onSave={() => Promise.resolve()}
      onReadVideo={() => Promise.reject(new Error("No video in this test."))}
      onSetCover={() => Promise.reject(new Error("No cover in this test."))}
      onRemoveCover={() => Promise.reject(new Error("No cover in this test."))}
      onUseCover={() => Promise.reject(new Error("No cover in this test."))}
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
            silences={silences}
            onListen={onListen}
            onSave={onSave}
            onUnsplit={onUnsplit}
            lyricsOf={(id) => (
              <LyricsEditor
                load={() => loadLyrics(id)}
                save={() => Promise.resolve()}
                forget={() => Promise.resolve()}
                player={{
                  current: false,
                  playing: false,
                  seconds: 0,
                  start: vi.fn(),
                  toggle: vi.fn(),
                  seek: vi.fn(),
                }}
              />
            )}
            matchOnline
            matchRevision={matchRevision}
          />
        ),
      }}
      startOnSongs
      onClose={onClose}
    />
  );
  const { rerender, unmount } = render(dialogOf(ai), {
    wrapper: ({ children }) => <AiSetUpContext value={aiSetUp}>{children}</AiSetUpContext>,
  });
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
    loadLyrics,
    onSave,
    onUnsplit,
    check,
    loadAudio,
    onListen,
    onClose,
    unmount,
    answerAi,
    readMatchesAgain: () => {
      rerender(dialogOf(ai, 1));
    },
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
const lyricsButton = (dialog: HTMLElement, title: string) =>
  within(dialog).getByRole("button", { name: `Lyrics for “${title}”` });

const MATCH_URL = "/api/tracks/104/songs/lyrics-match";

describe("editing a file's songs", () => {
  it("confirms only saved rows and reopens to show the background save without resubmitting", async () => {
    let finished = false;
    let started = false;
    const searching = { track_id: 102, job_id: 27, state: "searching", note: "" };
    const start = vi.fn(() => {
      started = true;
      return {
        status: 202,
        body: [
          { track_id: 101, job_id: null, state: "skipped", note: "Already has lyrics" },
          searching,
        ],
      };
    });
    const { calls } = serve({
      "GET /api/me/preferences": { body: { shortcuts: null, history_length: 25, revision: 1 } },
      [`GET ${MATCH_URL}`]: () => ({
        body: started ? [finished ? { ...searching, state: "saved" } : searching] : [],
      }),
      [`POST ${MATCH_URL}`]: start,
    });
    const { dialog, onSave, unmount } = await renderEditor();
    const matched = lyricsButton(dialog, "ゴーゴー幽霊船");
    const existing = lyricsButton(dialog, "アイネクライネ");
    await userEvent.type(box(dialog, "Title of song 3"), " draft");
    await press(dialog, "Auto-Match lyrics");
    expect(await within(dialog).findByText(/may make.*AI calls/i)).toBeVisible();
    expect(calls).not.toContain(`POST ${MATCH_URL}`);
    await press(dialog, "Start matching");
    await waitFor(() => expect(matched).toHaveAccessibleDescription("Searching lyrics sites…"));
    expect(existing).toHaveAccessibleDescription("Already has lyrics");
    expect(matched).toHaveAttribute("title", expect.stringContaining("Searching lyrics sites…"));
    unmount();
    finished = true;
    const { dialog: reopened } = await renderEditor();

    await waitFor(() =>
      expect(lyricsButton(reopened, "ゴーゴー幽霊船")).toHaveAccessibleDescription("Saved lyrics."),
    );
    const announcement = within(reopened)
      .getAllByRole("status")
      .find((status) => status.textContent.includes("Saved lyrics."));
    expect(announcement).toHaveClass("visually-hidden");
    expect(start).toHaveBeenCalledExactlyOnceWith(
      SPLIT.songs.slice(0, 2).map(({ id, track_id, start_ms, title, artist }) => ({
        segment_id: id,
        track_id,
        start_ms,
        title,
        artist,
      })),
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("searches only on an explicit click with direct matching, once despite repeat presses", async () => {
    const preference = later<undefined>();
    const find = later<undefined>();
    const missed = { track_id: 101, job_id: 27, state: "skipped", note: "No candidates found." };
    let finished = false;
    const { calls } = serve({
      "GET /api/me/preferences": {
        body: { lyrics_match_confirmation: "direct", revision: 1 },
        after: preference.promise,
      },
      [`GET ${MATCH_URL}`]: () => ({ body: finished ? [missed] : [] }),
      [`POST ${MATCH_URL}`]: {
        status: 202,
        body: [missed],
        after: find.promise,
      },
    });
    const { dialog } = await renderEditor();
    const search = `POST ${MATCH_URL}`;
    await userEvent.type(box(dialog, "Title of song 3"), " draft");
    expect(calls).not.toContain(search);

    const autoMatch = within(dialog).getByRole("button", { name: "Auto-Match lyrics" });
    await userEvent.dblClick(autoMatch);
    expect(calls).not.toContain(search);
    preference.give(undefined);
    await waitFor(() => {
      expect(calls).toContain(search);
    });
    await userEvent.click(autoMatch);
    finished = true;
    find.give(undefined);

    await waitFor(() =>
      expect(lyricsButton(dialog, "アイネクライネ")).toHaveAccessibleDescription(
        "No candidates found.",
      ),
    );
    expect(within(dialog).queryByRole("button", { name: "Start matching" })).toBeNull();
    expect(calls.filter((call) => call === "GET /api/me/preferences")).toHaveLength(1);
    expect(calls.filter((call) => call === search)).toHaveLength(1);
    expect(calls.some((call) => call.endsWith("/match/apply"))).toBe(false);
  });

  it("displays the server's skip when the saved song changed", async () => {
    const { calls } = serve({
      "GET /api/me/preferences": { body: { lyrics_match_confirmation: "direct", revision: 1 } },
      [`GET ${MATCH_URL}`]: { body: [] },
      [`POST ${MATCH_URL}`]: {
        status: 202,
        body: [{ track_id: 101, job_id: null, state: "skipped", note: "Skipped: song changed." }],
      },
    });
    const { dialog } = await renderEditor();
    await press(dialog, "Auto-Match lyrics");

    await waitFor(() =>
      expect(lyricsButton(dialog, "アイネクライネ")).toHaveAccessibleDescription(
        "Skipped: song changed.",
      ),
    );
    expect(calls.filter((call) => call.startsWith("POST "))).toEqual([`POST ${MATCH_URL}`]);
  });

  it("keeps a submission skip over an older save but shows a new run", async () => {
    const saved = { track_id: 101, job_id: 27, state: "saved", note: "" };
    let current = saved;
    const { calls } = serve({
      "GET /api/me/preferences": { body: { lyrics_match_confirmation: "direct", revision: 1 } },
      [`GET ${MATCH_URL}`]: () => ({ body: [current] }),
      [`POST ${MATCH_URL}`]: {
        status: 202,
        body: [
          {
            track_id: 101,
            job_id: null,
            previous_job_id: 27,
            state: "skipped",
            note: "Already has lyrics",
          },
        ],
      },
    });
    const { dialog, readMatchesAgain } = await renderEditor();
    const song = lyricsButton(dialog, "アイネクライネ");
    await waitFor(() => expect(song).toHaveAccessibleDescription("Saved lyrics."));

    await press(dialog, "Auto-Match lyrics");

    await waitFor(() => {
      expect(calls.filter((call) => call === `GET ${MATCH_URL}`)).toHaveLength(2);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(song).toHaveAccessibleDescription("Already has lyrics");
    current = { ...saved, job_id: 28, state: "searching" };
    readMatchesAgain();
    await waitFor(() => expect(song).toHaveAccessibleDescription("Searching lyrics sites…"));
  });

  it("explains next to Auto-Match when the server refuses to start", async () => {
    serve({
      "GET /api/me/preferences": { body: { lyrics_match_confirmation: "direct", revision: 1 } },
      [`GET ${MATCH_URL}`]: { body: [] },
      [`POST ${MATCH_URL}`]: { status: 409, body: { detail: "Go Online to auto-match lyrics." } },
    });
    const { dialog } = await renderEditor();

    await press(dialog, "Auto-Match lyrics");

    expect(await within(dialog).findByText("Go Online to auto-match lyrics.")).toHaveRole("status");
  });

  it("opens the moved song's lyrics without saving or losing the list draft", async () => {
    const { dialog, loadLyrics, onSave } = await renderEditor();
    await press(dialog, "Move “Last” up");
    await userEvent.type(box(dialog, "Title of song 2"), " draft");
    await press(dialog, "Add a song");
    expect(within(dialog).getByRole("button", { name: "Lyrics for song 4" })).toBeDisabled();
    expect(loadLyrics).not.toHaveBeenCalled();

    const entry = within(dialog).getByRole("button", { name: "Lyrics for “Last draft”" });
    await press(dialog, entry);
    const lyrics = screen.getByRole("dialog", { name: "Lyrics" });
    await within(lyrics).findByText("None yet");
    expect(loadLyrics).toHaveBeenCalledExactlyOnceWith(103);
    await press(lyrics, "Songs");

    expect(entry).toHaveFocus();
    expect(box(dialog, "Title of song 2")).toHaveValue("Last draft");
    expect(box(dialog, "Title of song 4")).toHaveValue("");
    expect(onSave).not.toHaveBeenCalled();
  });

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

  it("stops asking the AI from its button, keeping the songs as they are", async () => {
    const ai = { ...AI_UNASKED, stop: vi.fn() };
    const { dialog } = await renderEditor(SPLIT, { ai });

    await press(dialog, "Fill with AI");
    await press(dialog, "Stop asking the AI");

    expect(ai.stop).toHaveBeenCalledOnce();
    expect(within(dialog).getByText("Stopped asking the AI.")).toHaveRole("status");
    expect(within(dialog).getByRole("button", { name: "Fill with AI" })).toBeEnabled();
  });

  it("stops asking the AI when the editor closes while it asks", async () => {
    const ai = { ...AI_UNASKED, stop: vi.fn() };
    const { dialog, unmount } = await renderEditor(SPLIT, { ai });

    await press(dialog, "Fill with AI");
    // Closed, the page takes the editor away.
    unmount();

    expect(ai.stop).toHaveBeenCalledOnce();
  });

  it("stops nothing when the editor closes with the AI not asked", async () => {
    const ai = { ...AI_UNASKED, stop: vi.fn() };
    const { unmount } = await renderEditor(SPLIT, { ai });

    unmount();

    expect(ai.stop).not.toHaveBeenCalled();
  });

  it("says which model suggested the songs, once it is known", async () => {
    const { dialog } = await renderEditor({
      ...splitSongsOf(104, [], [], LISTED),
      suggested_by: { model: "llama3.2", host: "127.0.0.1:11434", at: "2026-11-14T08:00:00Z" },
    });

    await press(dialog, "Fill with AI");

    expect(within(dialog).getByText("2 songs from llama3.2, starts estimated")).toHaveRole(
      "status",
    );
    expect(within(dialog).getByRole("button", { name: "Ask the AI again" })).toBeInTheDocument();
  });

  it("splits a file from the list the AI suggested, saying where the songs came from", async () => {
    const { dialog, onSave } = await renderEditor(splitSongsOf(104, [], [], LISTED));

    await press(dialog, "Fill with AI");
    await press(dialog, "Save");

    expect(within(dialog).getByText("2 songs from the AI, starts estimated")).toHaveRole("status");
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
    await press(dialog, "Save");
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
    expect(
      await within(dialog).findByText("2 songs from the AI, starts estimated"),
    ).toBeInTheDocument();
    expect(box(dialog, "Title of song 2")).toHaveValue("ゴーゴー幽霊船");
  });

  it("shows in the AI button that it works, then that its songs are in", async () => {
    const unsplit = splitSongsOf(104, []);
    const { dialog, load, answerAi } = await renderEditor(unsplit);
    const button = within(dialog).getByRole("button", { name: "Fill with AI" });

    await userEvent.click(button);
    answerAi({ ...AI_UNASKED, state: "running" });
    const working = button.dataset.status;
    load.mockResolvedValue({ ...unsplit, suggested: LISTED });
    answerAi({ ...AI_UNASKED, state: "succeeded" });
    await within(dialog).findByText("2 songs from the AI, starts estimated");

    expect([
      working,
      within(dialog).getByRole("button", { name: "Ask the AI again" }).dataset.status,
    ]).toEqual(["working", "answered"]);
  });

  it("shows in the AI button that it failed, and says why", async () => {
    const { dialog, answerAi } = await renderEditor(splitSongsOf(104, []));
    const button = within(dialog).getByRole("button", { name: "Fill with AI" });

    await userEvent.click(button);
    answerAi({ ...AI_UNASKED, state: "failed", message: "The provider refused the key." });

    expect(
      await within(dialog).findByText("The AI couldn't say: The provider refused the key."),
    ).toHaveRole("status");
    expect(button.dataset.status).toBe("failed");
  });

  it("asks the AI again with a note once its songs are in", async () => {
    const askAgain = vi.fn();
    const { dialog } = await renderEditor(splitSongsOf(104, [], [], LISTED), {
      ai: { ...AI_UNASKED, askAgain },
    });
    await press(dialog, "Fill with AI");

    await press(dialog, "Ask the AI again");
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "More details" }),
      "It's the 2007 concert, with 22 songs{Enter}",
    );

    expect(askAgain).toHaveBeenCalledExactlyOnceWith("It's the 2007 concert, with 22 songs");
    expect(within(dialog).getByText("Asking the AI…")).toHaveRole("status");
  });

  it("asks the AI with a note from ▾ beside its button, before it was ever asked", async () => {
    const askAgain = vi.fn();
    const { dialog } = await renderEditor(splitSongsOf(104, []), {
      ai: { ...AI_UNASKED, askAgain },
    });

    await press(dialog, "Ask AI with a note");
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "More details" }),
      "One song per track{Enter}",
    );

    expect(askAgain).toHaveBeenCalledExactlyOnceWith("One song per track");
    expect(within(dialog).queryByRole("group", { name: "Ask AI with a note" })).toBeNull();
  });

  it("opens the note to ask the AI with on a right-click of its button", async () => {
    const { dialog } = await renderEditor(splitSongsOf(104, []));

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(dialog).getByRole("button", { name: "Fill with AI" }),
    });

    expect(within(dialog).getByRole("group", { name: "Ask AI with a note" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Ask AI with a note" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("says why asking again failed, keeping the songs the AI gave before", async () => {
    const { dialog, answerAi } = await renderEditor(splitSongsOf(104, [], [], LISTED));
    await press(dialog, "Fill with AI");
    await press(dialog, "Ask the AI again");
    await press(dialog, "Ask AI");

    answerAi({ ...AI_UNASKED, state: "failed", message: "DeepSeek refused the key." });

    expect(
      await within(dialog).findByText("The AI couldn't say: DeepSeek refused the key."),
    ).toHaveRole("status");
    expect(within(dialog).getByRole("button", { name: "Ask the AI again" }).dataset.status).toBe(
      "failed",
    );
    expect(box(dialog, "Title of song 2")).toHaveValue("ゴーゴー幽霊船");
  });

  it("keeps songs edited while the AI was asked, and offers its answer instead", async () => {
    const unsplit = splitSongsOf(104, []);
    const { dialog, load, answerAi } = await renderEditor(unsplit);
    await press(dialog, "Fill with AI");
    answerAi({ ...AI_UNASKED, state: "running" });

    await press(dialog, "Add a song");
    load.mockResolvedValue({ ...unsplit, suggested: LISTED });
    answerAi({ ...AI_UNASKED, state: "succeeded" });

    expect(
      await within(dialog).findByText("The AI answered with 2 songs: press AI to use them."),
    ).toHaveRole("status");
    expect(within(dialog).queryByRole("textbox", { name: "Title of song 2" })).toBeNull();
  });

  it("says when the AI found no song list", async () => {
    const { dialog, answerAi } = await renderEditor(splitSongsOf(104, []));

    await press(dialog, "Fill with AI");
    answerAi({ ...AI_UNASKED, state: "succeeded" });

    expect(await within(dialog).findByText("The AI found no song list for this file.")).toHaveRole(
      "status",
    );
  });

  it("can't ask an AI that can't be asked about the file, and says so on hover", async () => {
    const ask = vi.fn();
    const { dialog } = await renderEditor(SPLIT, { ai: { ...AI_UNASKED, can: false, ask } });
    const button = within(dialog).getByRole("button", { name: "Fill with AI" });

    await userEvent.click(button);

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription("The AI can't be asked about this file now");
    expect(ask).not.toHaveBeenCalled();
  });

  it("links an admin to set up AI when no provider is", async () => {
    const { dialog } = await renderEditor(SPLIT, {
      ai: { ...AI_UNASKED, can: false },
      aiSetUp: { missing: true, admin: true },
    });

    const button = within(dialog).getByRole("button", { name: "Fill with AI" });

    expect(button).toHaveAccessibleDescription("No AI provider is set up; set one up in Settings");
    expect(within(dialog).getByRole("link", { name: "Set up AI" })).toHaveAttribute(
      "href",
      "#/settings?section=ai",
    );
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
    // Save waits for the list to check clean.
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();
    });
    await press(dialog, "Save");
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
    await press(dialog, "Save");
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

/** The gaps in *Bremen*'s audio: a moment of silence at its start, then one before each song. */
const BREMEN_GAPS: SilenceFinder = {
  read: () =>
    Promise.resolve({
      state: "found",
      silences: [
        { start_ms: 0, end_ms: 600 },
        { start_ms: 249_000, end_ms: 251_400 },
        { start_ms: 482_000, end_ms: 483_250 },
      ],
    }),
  find: () => Promise.reject(new Error("The gaps are known already.")),
};

const startOfSong = (dialog: HTMLElement, place: number) =>
  within(dialog).getByRole("textbox", { name: `Start of song ${String(place)}` });

describe("snapping the starts to the gaps in the audio", () => {
  it("can't snap fewer than two songs, and says on hover why", async () => {
    const { dialog } = await renderEditor(splitSongsOf(104, []), { silences: BREMEN_GAPS });
    const button = within(dialog).getByRole("button", {
      name: "Snap the starts to the gaps in the audio",
    });

    await userEvent.click(button);

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription("Add two songs or more to snap their starts");
    expect(within(dialog).queryByRole("status", { name: /Moved/ })).not.toBeInTheDocument();
  });

  it("moves each start but the first to the gap nearest it, and says so", async () => {
    const { dialog } = await renderEditor(SPLIT, { silences: BREMEN_GAPS });

    await press(dialog, "Snap the starts to the gaps in the audio");

    expect(startOfSong(dialog, 1)).toHaveValue("0:00");
    expect(startOfSong(dialog, 2)).toHaveValue("4:11");
    expect(startOfSong(dialog, 3)).toHaveValue("8:03");
    expect(startOfSong(dialog, 2)).toHaveAccessibleDescription("Moved to the gap in the audio");
    expect(within(dialog).getByText("Moved 2 of 2 starts to the gaps in the audio.")).toHaveRole(
      "status",
    );
  });

  it("saves a snapped start to the millisecond", async () => {
    const { dialog, onSave } = await renderEditor(SPLIT, { silences: BREMEN_GAPS });

    await press(dialog, "Snap the starts to the gaps in the audio");
    await press(dialog, "Save");

    expect(onSave.mock.calls[0]?.[0].map((row) => row.start_ms)).toEqual([0, 251_400, 483_250]);
  });

  it("puts the starts back as they were", async () => {
    const { dialog } = await renderEditor(SPLIT, { silences: BREMEN_GAPS });
    await press(dialog, "Snap the starts to the gaps in the audio");

    await press(dialog, "Undo");

    expect(startOfSong(dialog, 2)).toHaveValue("4:12");
    expect(startOfSong(dialog, 2)).not.toHaveAccessibleDescription();
  });

  it("finds the gaps first when they were never looked for", async () => {
    let found = false;
    const silences: SilenceFinder = {
      read: () =>
        found ? BREMEN_GAPS.read(104) : Promise.resolve({ state: "not_found", silences: [] }),
      find: () => {
        found = true;
        return Promise.resolve({ state: "finding", silences: [] });
      },
    };
    const { dialog } = await renderEditor(SPLIT, { silences });

    await press(dialog, "Snap the starts to the gaps in the audio");

    await waitFor(() => {
      expect(startOfSong(dialog, 2)).toHaveValue("4:11");
    });
  });

  it("says snapping needs ffmpeg when the server has none", async () => {
    const { dialog } = await renderEditor(SPLIT);

    await press(dialog, "Snap the starts to the gaps in the audio");

    expect(
      await within(dialog).findByText("Snapping needs ffmpeg installed on the server."),
    ).toBeInTheDocument();
    expect(startOfSong(dialog, 2)).toHaveValue("4:12");
  });
});

const artistOfSong = (dialog: HTMLElement, place: number) =>
  within(dialog).getByRole("textbox", { name: `Artist of song ${String(place)}` });

describe("filling one artist into every song", () => {
  it("offers the artist typed to the songs with none, and Tab fills them", async () => {
    const { dialog } = await renderEditor(SPLIT);

    await userEvent.type(artistOfSong(dialog, 1), "ハチ");

    expect(artistOfSong(dialog, 2)).toHaveAttribute("placeholder", "ハチ");
    expect(artistOfSong(dialog, 1)).toHaveAccessibleDescription(
      "Tab fills “ハチ” into the 2 songs with no artist",
    );
    await userEvent.tab();
    expect(artistOfSong(dialog, 2)).toHaveValue("ハチ");
    expect(artistOfSong(dialog, 3)).toHaveValue("ハチ");
  });

  it("drops the offer once the artist is left another way, filling nothing", async () => {
    const { dialog } = await renderEditor(SPLIT);

    await userEvent.type(artistOfSong(dialog, 1), "ハチ");
    await userEvent.click(within(dialog).getByRole("textbox", { name: "Title of song 2" }));

    expect(artistOfSong(dialog, 2)).toHaveValue("");
    expect(artistOfSong(dialog, 2)).toHaveAttribute("placeholder", "Artist");
  });

  it("drops the offer on Escape, keeping the editor open", async () => {
    const { dialog } = await renderEditor(SPLIT);

    await userEvent.type(artistOfSong(dialog, 1), "ハチ{Escape}");

    expect(artistOfSong(dialog, 1)).not.toHaveAccessibleDescription();
    expect(dialog).toHaveAttribute("open");
    await userEvent.tab();
    expect(artistOfSong(dialog, 2)).toHaveValue("");
  });
});
