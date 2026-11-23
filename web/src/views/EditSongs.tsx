/**
 * @file The songs a long file is split into, edited in place of its details.
 *
 * The rows are the songs: where each starts, its title, and its artist. Rows can be
 * added, removed, and moved, by dragging or with the buttons. Beside them, ways to
 * fill them: a list typed as text, the list found in the video's details, or one
 * the AI suggests, asked for here. A list filled in keeps each song it still names,
 * so a song retimed, moved, or renamed in place keeps its ratings and plays; saving
 * says first how many songs it would remove with theirs, and so does unsplitting.
 *
 * Each row plays just its song, or its first and last five seconds to check where
 * it starts and ends; a row's start can be taken from where the file is playing.
 */

import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CircleNotchIcon,
  DotsSixVerticalIcon,
  EarIcon,
  MapPinIcon,
  MicrophoneStageIcon,
  PlayIcon,
  PlusIcon,
  SparkleIcon,
  StopIcon,
  TextAlignLeftIcon,
  TrashIcon,
  WarningIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import {
  type ReactNode,
  type SubmitEvent,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";

import type { ListCheck, PlaybackAnswer, Silences, Song, SongRowIn, Songs, Track } from "../api";
import { newId } from "../ids";
import { formatLength, formatTime } from "../format";
import { checkParts, endOf, keptIds, listTextOf } from "../library/songList";
import { countsDisagree, doubtsOf } from "../library/splitDoubts";
import { formatStart, parseStart } from "../library/songTimes";
import type { TrackLookup } from "../library/useLibrary";
import { aiNameOf } from "../library/aiAnswer";
import { snapStarts } from "../library/snap";
import { AiNotePanel } from "./AiNotePanel";
import { AlbumLyricsMatch } from "./AlbumLyricsMatch";
import { AiSetUpHint } from "./AiSetUpHint";
import { useAiSetUp } from "./aiSetUp";
import { LazyPart } from "./LazyPart";
import { Modal } from "./Modal";
import { OriginTag } from "./OriginTag";
import { ListEditor } from "./parts";
import { SongsControlsContext } from "./songsControls";

/** A row as the editor holds it: the start as typed, and the song it keeps, if any. */
interface Row {
  readonly key: string;
  readonly id: number | null;
  readonly trackId: number | null;
  readonly start: string;
  /** The start as loaded, kept to the millisecond while its text is as it was shown. */
  readonly loaded: { readonly text: string; readonly ms: number };
  readonly title: string;
  readonly artist: string;
}

/** What a row's file is playing: just its song, or a check of each end. */
interface Playing {
  readonly key: string;
  readonly mode: "song" | "check";
}

/** The AI asked for a song list, as far as its lookup has gone. */
export interface AiAsk {
  /** Whether the AI can be asked about the file now. */
  readonly can: boolean;
  /** How the lookup asked last goes, if the AI's. */
  readonly state: TrackLookup["state"] | undefined;
  readonly message: string;
  readonly ask: () => void;
  /** Ask the AI again at once, with a note of the listener's, which may be empty. */
  readonly askAgain: (hint: string) => void;
  /** Stop asking the AI, while it waits or works. */
  readonly stop: () => void;
}

/** Reads what is known of the gaps in a file's audio, and finds them. */
export interface SilenceFinder {
  readonly read: (trackId: number) => Promise<Silences>;
  readonly find: (trackId: number) => Promise<Silences>;
}

/** How often the gaps are asked for while they are being found. */
const GAPS_EVERY_MS = 500;

/** The longest note to the AI, as the server takes it. */

/** The most songs a file is split into, as the server keeps them. */
const MAX_SONGS = 300;

const MODIFIERS = [restrictToVerticalAxis, restrictToParentElement];
const INSTRUCTIONS = {
  draggable:
    "To reorder, press Space to pick the song up, the arrow keys to move it, and Space again to drop it. Escape puts it back.",
};

/**
 * Edit the songs `album`'s file is split into, read with `load`; `check` checks a
 * list as it is typed, `onSave` sends the rows, and `onUnsplit` removes every song.
 * `loadAudio` says how the file plays, and `onListen` quiets other music as it does.
 * The dialog it is shown in gives its heading's id, its way back, and what follows a
 * save, and hears while it must stay open.
 */
export function SongsEditor({
  album,
  load,
  check,
  artists,
  ai,
  loadAudio,
  silences,
  onListen,
  onSave,
  onUnsplit,
  lyricsOf,
  matchOnline,
}: {
  readonly album: Track;
  readonly load: (trackId: number) => Promise<Songs>;
  readonly check: (trackId: number, text: string) => Promise<ListCheck>;
  /** The artists a typed list offers after a dash. */
  readonly artists: readonly string[];
  readonly ai: AiAsk;
  readonly loadAudio: (trackId: number) => Promise<PlaybackAnswer>;
  /** Read what is known of the gaps in a file's audio, and find them. */
  readonly silences: SilenceFinder;
  readonly onListen: () => void;
  /** Save `rows`, refused when the file's songs are no longer the `known` ones the editor saw. */
  readonly onSave: (rows: readonly SongRowIn[], known: readonly number[]) => Promise<void>;
  readonly onUnsplit: () => Promise<void>;
  readonly lyricsOf: (trackId: number) => ReactNode;
  readonly matchOnline: boolean;
}) {
  const { headingId, onBack, onLock, onDone } = useContext(SongsControlsContext);
  const [songs, setSongs] = useState<Songs | undefined>(undefined);
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [lyricsTrack, setLyricsTrack] = useState<number | null>(null);
  const [lyricsLocked, setLyricsLocked] = useState(false);
  const lyricsDialog = useRef<HTMLDialogElement>(null);
  const lyricsEntry = useRef<HTMLButtonElement | null>(null);
  const lyricsHeading = useId();
  const closeLyrics = () => lyricsDialog.current?.close();
  const [typing, setTyping] = useState(false);
  // The songs the list typed comes to, once it checks clean.
  const [listed, setListed] = useState<readonly Song[] | undefined>(undefined);
  const [fillNote, setFillNote] = useState("");
  const [askedAi, setAskedAi] = useState(false);
  // Whether the rows are the AI's answer as it gave it, so pressing AI asks again.
  const [fromAi, setFromAi] = useState(false);
  // Whether the rows were changed while the AI was asked, so its answer waits to be used.
  const [editedSinceAsking, setEditedSinceAsking] = useState(false);
  // The last answer of the AI asked here: shown in its button until it is asked again.
  const [aiOutcome, setAiOutcome] = useState<"answered" | "failed" | undefined>(undefined);
  // The note to ask the AI with: opened by ▾ beside its button, a right-click, or asking again.
  const [noting, setNoting] = useState(false);
  const noteToggle = useRef<HTMLButtonElement>(null);
  const notePanel = useId();
  const [busy, setBusy] = useState(false);
  const [snapping, setSnapping] = useState(false);
  // The rows a snap moved, until the next edit, and the rows before it, to undo it.
  const [snapped, setSnapped] = useState<ReadonlySet<string>>(new Set());
  const [beforeSnap, setBeforeSnap] = useState<readonly Row[] | undefined>(undefined);
  const [error, setError] = useState("");
  // Set once saving or unsplitting has said what it removes, so the next press goes ahead.
  const [confirming, setConfirming] = useState<"save" | "unsplit" | undefined>(undefined);
  const audio = useRef<HTMLAudioElement | null>(null);
  // The parts left to play of what is playing, and which row's it is.
  const plan = useRef<{ key: string; parts: { from: number; to: number }[] } | null>(null);
  const [playing, setPlaying] = useState<Playing | undefined>(undefined);
  const stopPlan = useCallback(() => {
    plan.current = null;
    setPlaying(undefined);
  }, []);
  // The file stops when the editor goes, and a part stops where it ends.
  const holdAudio = useCallback(
    (element: HTMLAudioElement) => {
      audio.current = element;
      const onTime = () => {
        const left = plan.current;
        const [part, next] = left?.parts ?? [];
        if (left === null || part === undefined || element.currentTime * 1000 < part.to) {
          return;
        }
        if (next === undefined) {
          stopPlan();
          element.pause();
        } else {
          left.parts.shift();
          seek(element, next.from / 1000);
        }
      };
      element.addEventListener("timeupdate", onTime);
      // Paused from its own controls, or at its end: nothing plays any more.
      element.addEventListener("pause", stopPlan);
      return () => {
        element.removeEventListener("timeupdate", onTime);
        element.removeEventListener("pause", stopPlan);
        element.pause();
        audio.current = null;
      };
    },
    [stopPlan],
  );
  const [heard, setHeard] = useState(false);
  const [audioNote, setAudioNote] = useState("");
  // Each play's number, so only the latest seeks and plays.
  const listening = useRef(0);
  // The file's answer while it is asked for, so plays pressed meanwhile ask once.
  const asking = useRef<Promise<PlaybackAnswer> | null>(null);
  // While a song is dragged, Escape puts it back rather than closing the dialog.
  const [dragging, setDragging] = useState(false);
  const sensors = useSensors(
    // A few pixels of movement first, so a tap on the handle isn't a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    onLock(busy || dragging);
  }, [busy, dragging, onLock]);

  useEffect(() => {
    let open = true;
    load(album.id).then(
      (loaded) => {
        if (open) {
          setSongs(loaded);
          setRows(
            loaded.songs.map((song) => ({ ...rowOf(song, song.id), trackId: song.track_id })),
          );
        }
      },
      (failure: unknown) => {
        if (open) {
          setError(messageOf(failure));
        }
      },
    );
    return () => {
      open = false;
    };
  }, [album.id, load]);

  const edit = (next: readonly Row[]) => {
    setRows(next);
    setSnapped(new Set());
    setBeforeSnap(undefined);
    setFromAi(false);
    setEditedSinceAsking(true);
    setConfirming(undefined);
    setError("");
    setAudioNote("");
  };
  /**
   * Fill the rows from `list`, keeping each song it still names, and say where it came
   * from; `byAi` says the list is the AI's answer.
   */
  /** The rows `list` comes to, each keeping the song it most likely is of those now. */
  const rowsOfList = (list: readonly Song[]) => {
    const ids = keptIds(
      rows.map((row) => ({ id: row.id, title: row.title, startMs: startOf(row) })),
      list,
    );
    return list.map((song, index) => rowOf(song, ids[index] ?? null));
  };
  const fill = (list: readonly Song[], from: string, byAi = false) => {
    edit(rowsOfList(list));
    setFillNote(`${songCount(list.length)} ${from}${byAi ? ", starts estimated" : ""}`);
    setFromAi(byAi);
  };
  /** Move each start to the gap in the audio nearest it, finding the gaps first if need be. */
  const snap = async () => {
    setSnapping(true);
    setFillNote("Finding the gaps in the audio…");
    try {
      const known = await gapsOf(album.id, silences);
      if (known.state !== "found") {
        setFillNote(
          known.state === "no_tool"
            ? "Snapping needs ffmpeg installed on the server."
            : "The audio couldn't be read to find its gaps.",
        );
        return;
      }
      const starts = rows.map(startOf);
      const next = snapStarts(starts, known.silences);
      const moved = new Set(rows.filter((_, i) => next[i] !== starts[i]).map((row) => row.key));
      setBeforeSnap(rows);
      setSnapped(moved);
      setRows(
        rows.map((row, i) => {
          const start = next[i];
          return start === undefined || !moved.has(row.key) ? row : startingAt(row, start);
        }),
      );
      setFillNote(
        moved.size === 0
          ? "No start had a gap in the audio within half a minute."
          : `Moved ${String(moved.size)} of ${String(rows.length - 1)} starts to the gaps in the audio.`,
      );
    } catch (failure) {
      setFillNote(messageOf(failure));
    } finally {
      setSnapping(false);
    }
  };
  /** Ask the AI, at once or `again` with a note, and keep the rows as they are until it answers. */
  const askAi = (again?: string) => {
    setTyping(false);
    setNoting(false);
    setFillNote("");
    setAiOutcome(undefined);
    setAskedAi(true);
    setEditedSinceAsking(false);
    if (again === undefined) {
      ai.ask();
    } else {
      ai.askAgain(again);
    }
  };

  // The AI's list, once the lookup asked here is done: the file's songs are read again.
  const aiDone = askedAi && (ai.state === "succeeded" || ai.state === "failed");
  const takeAiAnswer = useEffectEvent((loaded: Songs) => {
    setAskedAi(false);
    setSongs(loaded);
    if (ai.state === "failed") {
      // The songs stay as they were; any earlier answer is still there to use.
      setAiOutcome("failed");
      setFillNote(`The AI couldn't say: ${ai.message}`);
      return;
    }
    setAiOutcome("answered");
    if (loaded.suggested.length > 0 && editedSinceAsking) {
      // Rows changed while it was asked stay; pressing AI uses its songs.
      setFillNote(
        `${aiNameOf(loaded.suggested_by, true)} answered with ${songCount(loaded.suggested.length)}: press AI to use them.`,
      );
    } else if (loaded.suggested.length > 0) {
      fill(loaded.suggested, `from ${aiNameOf(loaded.suggested_by)}`, true);
    } else {
      setFillNote(`${aiNameOf(loaded.suggested_by, true)} found no song list for this file.`);
    }
  });
  useEffect(() => {
    if (!aiDone) {
      return undefined;
    }
    let open = true;
    load(album.id).then(
      (loaded) => {
        if (open) {
          takeAiAnswer(loaded);
        }
      },
      (failure: unknown) => {
        if (open) {
          setAskedAi(false);
          setFillNote(messageOf(failure));
        }
      },
    );
    return () => {
      open = false;
    };
  }, [aiDone, album.id, load]);

  const change = (key: string, field: "start" | "title" | "artist", value: string) => {
    edit(rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  };
  // An artist typed into one row is offered to the rows with none, until Tab fills them,
  // or Escape or leaving the field another way drops the offer.
  const [offering, setOffering] = useState<string | undefined>(undefined);
  const offered = rows.find((row) => row.key === offering)?.artist.trim() ?? "";
  const without = rows.filter((row) => row.key !== offering && row.artist.trim() === "").length;
  const offer = offered !== "" && without > 0 ? offered : undefined;
  const fillArtist = (artist: string) => {
    edit(rows.map((row) => (row.artist.trim() === "" ? { ...row, artist } : row)));
    setOffering(undefined);
  };
  const move = (from: number, to: number) => {
    const next = [...rows];
    const [moving] = next.splice(from, 1);
    if (moving !== undefined) {
      next.splice(to, 0, moving);
      edit(next);
    }
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  /** Play `parts` of the file, one after another, as row `key`'s `mode`. */
  const listen = async (parts: { from: number; to: number }[], now: Playing) => {
    const turn = ++listening.current;
    const element = audio.current;
    const [first] = parts;
    if (element === null || first === undefined) {
      return;
    }
    setAudioNote("");
    try {
      if (element.getAttribute("src") === null) {
        asking.current ??= loadAudio(album.id);
        let answer: PlaybackAnswer;
        try {
          answer = await asking.current;
        } finally {
          asking.current = null;
        }
        if (turn !== listening.current || audio.current !== element) {
          return;
        }
        if (answer.state !== "ready") {
          setAudioNote(
            answer.state === "preparing"
              ? "The file is being prepared; listen again in a moment."
              : "This file can't be played.",
          );
          return;
        }
        if (element.getAttribute("src") === null) {
          element.src = answer.audio_url;
          setHeard(true);
        }
      }
      seek(element, first.from / 1000);
      plan.current = { key: now.key, parts: [...parts] };
      setPlaying(now);
      await element.play();
      if (turn === listening.current) {
        onListen();
      }
    } catch (failure) {
      // A newer file or the editor closing stopped this play, which isn't a fault.
      if (!(failure instanceof DOMException && failure.name === "AbortError")) {
        stopPlan();
        setAudioNote(messageOf(failure));
      }
    }
  };
  /** Play row `index` as `mode`, or stop it when it is playing so already. */
  const play = (index: number, mode: Playing["mode"]) => {
    const row = rows[index];
    if (row === undefined) {
      return;
    }
    if (playing?.key === row.key && playing.mode === mode) {
      audio.current?.pause();
      return;
    }
    const starts = rows.map(startOf);
    const from = starts[index];
    if (from === undefined) {
      setAudioNote(`Song ${String(index + 1)} starts at no time; write it as 3:12 or 1:07:40.`);
      return;
    }
    const to = endOf(starts, index, songs?.length_ms ?? null) ?? Number.POSITIVE_INFINITY;
    void listen(mode === "song" ? [{ from, to }] : checkParts(from, to), { key: row.key, mode });
  };
  const startHere = (key: string) => {
    const element = audio.current;
    if (element !== null) {
      const ms = Math.round(element.currentTime * 1000);
      const text = formatStart(ms);
      edit(
        rows.map((row) => (row.key === key ? { ...row, start: text, loaded: { text, ms } } : row)),
      );
    }
  };
  const named = (row: Row | undefined, place: number) =>
    row === undefined || row.title.trim() === "" ? `Song ${String(place + 1)}` : `“${row.title}”`;
  const placeOf = (id: UniqueIdentifier | undefined) => rows.findIndex((row) => row.key === id);
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${named(rows[placeOf(active.id)], placeOf(active.id))}.`,
    onDragOver: ({ active, over }) =>
      over === null || over.id === active.id
        ? undefined
        : `${named(rows[placeOf(active.id)], placeOf(active.id))} would be song ${String(placeOf(over.id) + 1)}.`,
    onDragEnd: ({ active, over }) =>
      `${named(rows[placeOf(active.id)], placeOf(active.id))} is song ${String(placeOf(over?.id ?? active.id) + 1)}.`,
    onDragCancel: ({ active }) =>
      `${named(rows[placeOf(active.id)], placeOf(active.id))} stays where it was.`,
  };
  const drop = ({ active, over }: DragEndEvent) => {
    if (over !== null && active.id !== over.id) {
      move(placeOf(active.id), placeOf(over.id));
    }
  };

  const split = (songs?.songs.length ?? 0) > 0;
  const kept = new Set(rows.flatMap((row) => (row.id === null ? [] : [row.id])));
  const removing = songs?.songs.filter((song) => !kept.has(song.id)).length ?? 0;
  const thinking = askedAi && !aiDone;
  /** Stop asking the AI; the rows stay as they are. */
  const stopAi = () => {
    ai.stop();
    setAskedAi(false);
    setFillNote("Stopped asking the AI.");
  };
  // Left while the AI is asked, as on Details or closing, the asking stops: nothing waits on it.
  const stopOnLeaving = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    stopOnLeaving.current = thinking ? ai.stop : undefined;
  });
  useEffect(
    () => () => {
      stopOnLeaving.current?.();
    },
    [],
  );
  // What the AI button shows of the AI: working on it, its songs in use, or why it failed.
  const aiStatus = thinking
    ? "working"
    : aiOutcome === "failed"
      ? "failed"
      : fromAi
        ? "answered"
        : undefined;
  // Unavailable until something changes, so each says why on hover rather than being disabled.
  const noAi = !fromAi && (songs?.suggested.length ?? 0) === 0 && !ai.can;
  const aiSetUp = useAiSetUp();
  const tooFewToSnap = rows.length < 2;

  /** Save `saved`, asking first when that removes songs. */
  const saveRows = (saved: readonly Row[], confirmed: boolean) => {
    const sent = rowsIn(saved, songs?.length_ms ?? null);
    if (typeof sent === "string") {
      setError(sent);
      return;
    }
    const keeps = new Set(saved.flatMap((row) => (row.id === null ? [] : [row.id])));
    if (!confirmed && (songs?.songs.some((song) => !keeps.has(song.id)) ?? false)) {
      setConfirming("save");
      return;
    }
    void run(async () => {
      await onSave(sent, songs?.songs.map((song) => song.id) ?? []);
      onDone();
    });
  };
  const save = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!typing) {
      saveRows(rows, confirming === "save");
      return;
    }
    if (listed === undefined) {
      return;
    }
    // The list becomes the rows, shown while they save, or while removing songs is asked.
    const next = rowsOfList(listed);
    fill(listed, "from the list");
    setTyping(false);
    saveRows(next, false);
  };
  const unsplit = () => {
    if (confirming !== "unsplit") {
      setConfirming("unsplit");
      return;
    }
    void run(async () => {
      await onUnsplit();
      onDone();
    });
  };

  const starts = rows.map(startOf);
  const doubts = doubtsOf(starts, songs?.length_ms ?? null);
  const lengthOf = (index: number) => {
    const start = starts[index] ?? 0;
    return formatTime(((endOf(starts, index, songs?.length_ms ?? null) ?? start) - start) / 1000);
  };
  const disagree =
    songs === undefined
      ? null
      : countsDisagree([
          ...songs.found
            .filter((list) => list.length > 0)
            .map((list) => ({ name: "the video", count: list.length })),
          ...(songs.suggested.length > 0
            ? [{ name: aiNameOf(songs.suggested_by), count: songs.suggested.length }]
            : []),
        ]);

  const childLyrics = lyricsTrack !== null && (
    <Modal
      ref={lyricsDialog}
      className="edit-details"
      labelledBy={lyricsHeading}
      describedBy={`${lyricsHeading}-song`}
      locked={lyricsLocked}
      onClose={() => {
        setLyricsTrack(null);
        lyricsEntry.current?.focus();
      }}
    >
      <div className="card lyrics-card">
        <p id={`${lyricsHeading}-song`} className="edit-details-song">
          {songs?.songs.find((song) => song.track_id === lyricsTrack)?.title}
        </p>
        <SongsControlsContext
          value={{
            headingId: lyricsHeading,
            backLabel: "Songs",
            onBack: closeLyrics,
            onDone: closeLyrics,
            onLock: setLyricsLocked,
          }}
        >
          {lyricsOf(lyricsTrack) ?? (
            <h2 id={lyricsHeading}>This song is no longer in the album.</h2>
          )}
        </SongsControlsContext>
      </div>
    </Modal>
  );
  const listForm = (
    <form className="songs-panel" onSubmit={save}>
      <header className="songs-heading">
        <button type="button" className="songs-back" onClick={onBack}>
          <CaretLeftIcon weight="bold" aria-hidden />
          Details
        </button>
        <h2 id={headingId} className="songs-title" tabIndex={-1}>
          {split ? "Songs" : "Split into songs"}
        </h2>
        <p className="edit-details-song">{album.title}</p>
      </header>
      {songs === undefined && error === "" && (
        <p className="empty" role="status">
          Reading the songs…
        </p>
      )}
      {songs !== undefined && (
        <>
          {songs.needs_check && (
            <p className="songs-note">
              The file's length changed since it was split; check where each song starts.
            </p>
          )}
          <div className="songs-fill">
            <button
              type="button"
              className={typing ? "fill-button on" : "fill-button"}
              aria-label="Fill from a list"
              aria-pressed={typing}
              disabled={busy}
              title="Type or paste the songs as a list"
              onClick={() => {
                setTyping((open) => !open);
              }}
            >
              <TextAlignLeftIcon aria-hidden /> List
            </button>
            {songs.found.map((list, index) => (
              <button
                key={index}
                type="button"
                className="fill-button"
                disabled={busy}
                aria-label={`Fill from the video's ${songCount(list.length)}`}
                title={`The ${songCount(list.length)} the video's details list`}
                onClick={() => {
                  setTyping(false);
                  fill(list, "from the video");
                }}
              >
                <OriginTag origin="video" full="From the video" /> {list.length}
              </button>
            ))}
            <span className="ai-split">
              <button
                type="button"
                className="fill-button ai-button"
                data-status={aiStatus}
                onContextMenu={(event) => {
                  if (!noAi && !thinking && !busy) {
                    event.preventDefault();
                    setTyping(false);
                    setNoting(true);
                  }
                }}
                disabled={busy}
                aria-disabled={noAi}
                aria-label={
                  thinking ? "Stop asking the AI" : fromAi ? "Ask the AI again" : "Fill with AI"
                }
                aria-expanded={fromAi && !thinking ? noting : undefined}
                aria-busy={thinking}
                title={
                  thinking
                    ? "Stop asking the AI"
                    : fromAi
                      ? "Ask the AI again, with a note if you like"
                      : songs.suggested.length > 0
                        ? `The ${songCount(songs.suggested.length)} ${aiNameOf(songs.suggested_by)} suggested`
                        : ai.can
                          ? "Ask the AI for the songs"
                          : aiSetUp.missing
                            ? aiSetUp.why
                            : "The AI can't be asked about this file now"
                }
                onClick={() => {
                  if (thinking) {
                    stopAi();
                    return;
                  }
                  if (noAi) {
                    return;
                  }
                  setTyping(false);
                  if (fromAi) {
                    setNoting((open) => !open);
                  } else if (songs.suggested.length > 0) {
                    fill(songs.suggested, `from ${aiNameOf(songs.suggested_by)}`, true);
                  } else {
                    askAi();
                  }
                }}
              >
                {thinking ? (
                  <CircleNotchIcon className="spin" aria-hidden />
                ) : (
                  <SparkleIcon aria-hidden />
                )}{" "}
                AI
                {aiStatus !== undefined && <span className="ai-status" aria-hidden />}
              </button>
              <button
                ref={noteToggle}
                type="button"
                className="fill-button ai-note-toggle"
                disabled={busy || thinking}
                aria-disabled={noAi}
                aria-label="Ask AI with a note"
                title="Ask AI with a note"
                aria-expanded={noting}
                aria-controls={notePanel}
                onClick={() => {
                  if (!noAi) {
                    setTyping(false);
                    setNoting((open) => !open);
                  }
                }}
              >
                <CaretDownIcon weight="bold" aria-hidden />
              </button>
            </span>
            {noAi && <AiSetUpHint newTab />}
            <button
              type="button"
              className="fill-button"
              disabled={busy || snapping}
              aria-disabled={tooFewToSnap}
              aria-label="Snap the starts to the gaps in the audio"
              aria-busy={snapping}
              title={
                tooFewToSnap
                  ? "Add two songs or more to snap their starts"
                  : "Move each start to the gap in the audio nearest it, within half a minute"
              }
              onClick={() => {
                if (!tooFewToSnap) {
                  void snap();
                }
              }}
            >
              {snapping ? (
                <CircleNotchIcon className="spin" aria-hidden />
              ) : (
                <WaveformIcon aria-hidden />
              )}{" "}
              Snap
            </button>
            <AlbumLyricsMatch
              songs={songs.songs.filter((song) =>
                rows.some(
                  (row) =>
                    row.trackId === song.track_id &&
                    row.trackId !== lyricsTrack &&
                    row.title === song.title &&
                    row.artist === song.artist &&
                    startOf(row) === song.start_ms,
                ),
              )}
              unavailable={
                !matchOnline
                  ? "Go Online to match lyrics"
                  : aiSetUp.missing
                    ? aiSetUp.why
                    : typing || busy || snapping || thinking
                      ? "Finish editing the song list first"
                      : ""
              }
            />
            <span className="songs-fill-note" role="status">
              {thinking ? "Asking the AI…" : fillNote}
            </span>
            {beforeSnap !== undefined && !snapping && (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setRows(beforeSnap);
                  setSnapped(new Set());
                  setBeforeSnap(undefined);
                  setFillNote("The starts are back where they were.");
                }}
              >
                Undo
              </button>
            )}
          </div>
          {noting && (
            <div id={notePanel}>
              <AiNotePanel
                ask="songs"
                onAsk={(note) => {
                  if (note === "") {
                    askAi();
                  } else {
                    askAi(note);
                  }
                }}
                onClose={() => {
                  setNoting(false);
                  noteToggle.current?.focus();
                }}
              />
            </div>
          )}
          {disagree !== null && <p className="songs-note songs-doubt">{disagree}</p>}
          {typing && (
            <LazyPart doing="Opening the list…">
              <ListEditor.Component
                initial={listTextOf(rows)}
                check={(text) => check(album.id, text)}
                artists={artists}
                onListed={setListed}
              />
            </LazyPart>
          )}
          <audio
            ref={holdAudio}
            className="songs-audio"
            controls
            preload="metadata"
            hidden={!heard || typing}
          />
          {/* On the page while empty, so a screen reader hears what it comes to say. */}
          <p className="songs-note songs-audio-note" role="status">
            {audioNote}
          </p>
          <div hidden={typing}>
            {doubts.few && rows.length > 1 && (
              <p className="songs-note songs-doubt">
                <WarningIcon weight="bold" aria-hidden />
                {formatLength(rows.length, songs.length_ms ?? 0)}: an album this long usually has
                more, so a song may be missing.
              </p>
            )}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={MODIFIERS}
              accessibility={{ announcements, screenReaderInstructions: INSTRUCTIONS }}
              onDragStart={() => {
                setDragging(true);
              }}
              onDragEnd={(event) => {
                setDragging(false);
                drop(event);
              }}
              onDragCancel={() => {
                setDragging(false);
              }}
            >
              <SortableContext
                items={rows.map((row) => row.key)}
                strategy={verticalListSortingStrategy}
              >
                <ol className="song-rows">
                  {rows.map((row, index) => (
                    <SongRow
                      key={row.key}
                      row={row}
                      onLyrics={(button) => {
                        audio.current?.pause();
                        lyricsEntry.current = button;
                        setLyricsTrack(row.trackId);
                      }}
                      place={index + 1}
                      first={index === 0}
                      last={index === rows.length - 1}
                      heard={heard}
                      long={doubts.long.has(index) ? lengthOf(index) : undefined}
                      snapped={snapped.has(row.key)}
                      playing={playing?.key === row.key ? playing.mode : undefined}
                      onChange={(field, value) => {
                        change(row.key, field, value);
                        if (field === "artist") {
                          setOffering(row.key);
                        }
                      }}
                      artistOffer={
                        offer === undefined
                          ? undefined
                          : row.key === offering
                            ? { hint: fillHintOf(offer, without) }
                            : { ghost: offer }
                      }
                      onArtistKey={(key) => {
                        if (row.key !== offering || offer === undefined) {
                          return false;
                        }
                        if (key === "Tab") {
                          fillArtist(offer);
                          return false;
                        }
                        setOffering(undefined);
                        return true;
                      }}
                      onArtistLeft={() => {
                        if (row.key === offering) {
                          setOffering(undefined);
                        }
                      }}
                      onMove={(by) => {
                        move(index, index + by);
                      }}
                      onRemove={() => {
                        edit(rows.filter((each) => each.key !== row.key));
                      }}
                      onPlay={(mode) => {
                        play(index, mode);
                      }}
                      onStartHere={() => {
                        startHere(row.key);
                      }}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
            <button
              type="button"
              className="secondary outline songs-add"
              disabled={rows.length >= MAX_SONGS}
              onClick={() => {
                edit([...rows, rowOf({ start_ms: 0, title: "", artist: "" }, null, "")]);
              }}
            >
              <PlusIcon aria-hidden /> Add a song
            </button>
          </div>
        </>
      )}
      {confirming !== undefined && (
        <p className="songs-note" role="status">
          {confirming === "save"
            ? `Saving removes ${songCount(removing)}, with their ratings and plays.`
            : `Unsplitting removes ${songCount(songs?.songs.length ?? 0)}, with their ratings and plays.`}
        </p>
      )}
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer className="dialog-buttons">
        {split && !typing && (
          <button
            type="button"
            className="secondary outline dialog-button songs-unsplit"
            disabled={busy}
            onClick={unsplit}
          >
            {confirming === "unsplit"
              ? `Unsplit and remove ${songCount(songs?.songs.length ?? 0)}`
              : "Unsplit"}
          </button>
        )}
        <button
          type="submit"
          className="dialog-button"
          disabled={songs === undefined || busy || (typing && listed === undefined)}
          aria-busy={busy}
        >
          {confirming === "save" ? `Save and remove ${songCount(removing)}` : "Save"}
        </button>
      </footer>
    </form>
  );
  return (
    <>
      {listForm}
      {childLyrics}
    </>
  );
}

/**
 * One song's row: a handle to drag it, its start, title, and artist, and buttons to
 * play just it or check each end, start it where the file is playing (once it has
 * been `heard`), and move or remove it.
 */
function SongRow({
  row,
  place,
  first,
  last,
  heard,
  long,
  snapped,
  playing,
  onLyrics,
  onChange,
  artistOffer,
  onArtistKey,
  onArtistLeft,
  onMove,
  onRemove,
  onPlay,
  onStartHere,
}: {
  readonly row: Row;
  readonly onLyrics: (button: HTMLButtonElement) => void;
  readonly place: number;
  readonly first: boolean;
  readonly last: boolean;
  readonly heard: boolean;
  /** How long the song is, as `18:30`, when it is so long it may be two. */
  readonly long: string | undefined;
  /** Whether the last snap moved its start to a gap in the audio. */
  readonly snapped: boolean;
  /** How the row's song is playing, if it is. */
  readonly playing: Playing["mode"] | undefined;
  readonly onChange: (field: "start" | "title" | "artist", value: string) => void;
  /**
   * An artist typed in another row, shown faintly in this one while it has none; or,
   * in the row typed in, what Tab does with it.
   */
  readonly artistOffer?: { readonly ghost: string } | { readonly hint: string } | undefined;
  /** Tab or Escape pressed in the artist; `true` when it was the offer's, so taken. */
  readonly onArtistKey?: (key: "Tab" | "Escape") => boolean;
  readonly onArtistLeft?: () => void;
  readonly onMove: (by: -1 | 1) => void;
  readonly onRemove: () => void;
  readonly onPlay: (mode: Playing["mode"]) => void;
  readonly onStartHere: () => void;
}) {
  const named = row.title.trim() === "" ? `song ${String(place)}` : `“${row.title}”`;
  const hintId = useId();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.key });
  return (
    <li
      ref={setNodeRef}
      className={isDragging ? "song-row dragging" : "song-row"}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button
        type="button"
        className="icon song-handle"
        ref={setActivatorNodeRef}
        aria-label={`Reorder ${named}`}
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <DotsSixVerticalIcon weight="bold" aria-hidden />
      </button>
      <input
        className={snapped ? "detail-input song-start snapped" : "detail-input song-start"}
        aria-label={`Start of song ${String(place)}`}
        aria-description={snapped ? "Moved to the gap in the audio" : undefined}
        title={snapped ? "Moved to the gap in the audio" : undefined}
        placeholder="0:00"
        value={row.start}
        onChange={(event) => {
          onChange("start", event.currentTarget.value);
        }}
      />
      <input
        className="detail-input song-title"
        aria-label={`Title of song ${String(place)}`}
        value={row.title}
        onChange={(event) => {
          onChange("title", event.currentTarget.value);
        }}
      />
      <span className="song-artist-cell">
        <input
          className={
            artistOffer !== undefined && "ghost" in artistOffer
              ? "detail-input song-artist ghost"
              : "detail-input song-artist"
          }
          aria-label={`Artist of song ${String(place)}`}
          aria-describedby={artistOffer !== undefined && "hint" in artistOffer ? hintId : undefined}
          placeholder={
            artistOffer !== undefined && "ghost" in artistOffer ? artistOffer.ghost : "Artist"
          }
          value={row.artist}
          onChange={(event) => {
            onChange("artist", event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if ((event.key === "Tab" && !event.shiftKey) || event.key === "Escape") {
              if (onArtistKey?.(event.key) === true) {
                // Escape drops the offer only; the editor stays open.
                event.preventDefault();
                event.stopPropagation();
              }
            }
          }}
          onBlur={onArtistLeft}
        />
        {artistOffer !== undefined && "hint" in artistOffer && (
          <small id={hintId} className="song-artist-hint">
            {artistOffer.hint}
          </small>
        )}
      </span>
      <span className="song-row-buttons">
        <button
          type="button"
          className={playing === "song" ? "icon on" : "icon"}
          aria-label={`Play song ${String(place)}`}
          aria-pressed={playing === "song"}
          title={playing === "song" ? "Stop" : "Play just this song"}
          onClick={() => {
            onPlay("song");
          }}
        >
          {playing === "song" ? <StopIcon aria-hidden /> : <PlayIcon aria-hidden />}
        </button>
        <button
          type="button"
          className={playing === "check" ? "icon on" : "icon"}
          aria-label={`Check song ${String(place)} by ear`}
          aria-pressed={playing === "check"}
          title={playing === "check" ? "Stop" : "Hear its first and last 5 seconds"}
          onClick={() => {
            onPlay("check");
          }}
        >
          {playing === "check" ? <StopIcon aria-hidden /> : <EarIcon aria-hidden />}
        </button>
        <button
          type="button"
          className="icon"
          aria-label={`Start song ${String(place)} here`}
          title={
            heard ? "Start where it is playing" : "Listen first, then start it where it is playing"
          }
          disabled={!heard}
          onClick={onStartHere}
        >
          <MapPinIcon aria-hidden />
        </button>
        <button
          type="button"
          className="icon"
          aria-label={`Move ${named} up`}
          disabled={first}
          onClick={() => {
            onMove(-1);
          }}
        >
          <ArrowUpIcon aria-hidden />
        </button>
        <button
          type="button"
          className="icon"
          aria-label={`Move ${named} down`}
          disabled={last}
          onClick={() => {
            onMove(1);
          }}
        >
          <ArrowDownIcon aria-hidden />
        </button>
        <button
          type="button"
          className="icon"
          aria-label={`Lyrics for ${named}`}
          title={
            row.trackId === null
              ? "Save the songs first to edit lyrics"
              : `Edit lyrics for ${named}`
          }
          disabled={row.trackId === null}
          onClick={(event) => {
            onLyrics(event.currentTarget);
          }}
        >
          <MicrophoneStageIcon aria-hidden />
        </button>
        <button type="button" className="icon" aria-label={`Remove ${named}`} onClick={onRemove}>
          <TrashIcon aria-hidden />
        </button>
      </span>
      {long !== undefined && (
        <p className="song-doubt">
          <WarningIcon weight="bold" aria-hidden />
          {long} long: it may be two songs. Check where the next one starts.
        </p>
      )}
    </li>
  );
}

/** Where `row` starts, to the millisecond while its text is as loaded, or nothing for no time. */
function startOf(row: Row): number | undefined {
  return row.start === row.loaded.text ? row.loaded.ms : parseStart(row.start);
}

/** Return `row` starting at `ms`, kept to the millisecond while its text stays. */
function startingAt(row: Row, ms: number): Row {
  const start = formatStart(ms);
  return { ...row, start, loaded: { text: start, ms } };
}

/** Return the file's gaps once found, finding them first, or say why they can't be. */
async function gapsOf(trackId: number, finder: SilenceFinder): Promise<Silences> {
  let known = await finder.read(trackId);
  if (known.state === "found") {
    return known;
  }
  known = await finder.find(trackId);
  while (known.state === "finding" || known.state === "preparing") {
    await new Promise((resolve) => setTimeout(resolve, GAPS_EVERY_MS));
    known = await (known.state === "preparing" ? finder.find(trackId) : finder.read(trackId));
  }
  return known;
}

function rowOf(song: Song, id: number | null, start = formatStart(song.start_ms)): Row {
  return {
    key: newId(),
    id,
    trackId: null,
    start,
    loaded: { text: start, ms: song.start_ms },
    title: song.title,
    artist: song.artist,
  };
}

/** Return the rows as the server takes them, or why one can't be, in a file `lengthMs` long. */
function rowsIn(rows: readonly Row[], lengthMs: number | null): SongRowIn[] | string {
  const sent: SongRowIn[] = [];
  for (const [index, row] of rows.entries()) {
    const start = startOf(row);
    const song = `Song ${String(index + 1)}`;
    if (start === undefined) {
      return `${song} starts at no time; write it as 3:12 or 1:07:40.`;
    }
    if (lengthMs !== null && start >= lengthMs) {
      return `${song} starts after the file ends, at ${formatStart(lengthMs)}.`;
    }
    sent.push({ id: row.id, start_ms: start, title: row.title.trim(), artist: row.artist.trim() });
  }
  return sent;
}

/**
 * Move `element` to `seconds`: at once, which a file still loading takes as where to
 * start, and again once it knows its length, in case it didn't.
 */
function seek(element: HTMLAudioElement, seconds: number): void {
  element.currentTime = seconds;
  if (element.readyState < HTMLMediaElement.HAVE_METADATA) {
    element.addEventListener(
      "loadedmetadata",
      () => {
        element.currentTime = seconds;
      },
      { once: true },
    );
  }
}

function songCount(count: number): string {
  return count === 1 ? "1 song" : `${String(count)} songs`;
}

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** What Tab does with `artist`, typed in one row, for the `count` rows with no artist. */
function fillHintOf(artist: string, count: number): string {
  return `Tab fills “${artist}” into the ${count === 1 ? "song" : `${String(count)} songs`} with no artist`;
}
