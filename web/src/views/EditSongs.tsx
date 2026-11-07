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
  CaretLeftIcon,
  CircleNotchIcon,
  DotsSixVerticalIcon,
  EarIcon,
  MapPinIcon,
  PlayIcon,
  PlusIcon,
  SparkleIcon,
  StopIcon,
  TextAlignLeftIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import {
  type SubmitEvent,
  Suspense,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import type { ListCheck, PlaybackAnswer, Song, SongRowIn, Songs, Track } from "../api";
import { newId } from "../ids";
import { formatLength, formatTime } from "../format";
import { checkParts, endOf, keptIds, listTextOf } from "../library/songList";
import { countsDisagree, doubtsOf } from "../library/splitDoubts";
import { formatStart, parseStart } from "../library/songTimes";
import type { TrackLookup } from "../library/useLibrary";
import { OriginTag } from "./OriginTag";
import { SongsControlsContext } from "./songsControls";

const ListEditor = lazy(() => import("./ListEditor"));

/** A row as the editor holds it: the start as typed, and the song it keeps, if any. */
interface Row {
  readonly key: string;
  readonly id: number | null;
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
}

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
  onListen,
  onSave,
  onUnsplit,
}: {
  readonly album: Track;
  readonly load: (trackId: number) => Promise<Songs>;
  readonly check: (trackId: number, text: string) => Promise<ListCheck>;
  /** The artists a typed list offers after a dash. */
  readonly artists: readonly string[];
  readonly ai: AiAsk;
  readonly loadAudio: (trackId: number) => Promise<PlaybackAnswer>;
  readonly onListen: () => void;
  /** Save `rows`, refused when the file's songs are no longer the `known` ones the editor saw. */
  readonly onSave: (rows: readonly SongRowIn[], known: readonly number[]) => Promise<void>;
  readonly onUnsplit: () => Promise<void>;
}) {
  const { headingId, onBack, onLock, onDone } = useContext(SongsControlsContext);
  const [songs, setSongs] = useState<Songs | undefined>(undefined);
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [typing, setTyping] = useState(false);
  const [fillNote, setFillNote] = useState("");
  const [askedAi, setAskedAi] = useState(false);
  const [busy, setBusy] = useState(false);
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
          setRows(loaded.songs.map((song) => rowOf(song, song.id)));
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
    setConfirming(undefined);
    setError("");
    setAudioNote("");
  };
  /** Fill the rows from `list`, keeping each song it still names, and say where it came from. */
  const fill = (list: readonly Song[], from: string) => {
    const ids = keptIds(
      rows.map((row) => ({ id: row.id, title: row.title, startMs: startOf(row) })),
      list,
    );
    edit(list.map((song, index) => rowOf(song, ids[index] ?? null)));
    setFillNote(`${songCount(list.length)} ${from}`);
  };

  // The AI's list, once the lookup asked here is done: the file's songs are read again.
  const aiDone = askedAi && (ai.state === "succeeded" || ai.state === "failed");
  const takeAiAnswer = useEffectEvent((loaded: Songs) => {
    setAskedAi(false);
    setSongs(loaded);
    if (loaded.suggested.length > 0) {
      fill(loaded.suggested, "from the AI");
    } else {
      setFillNote(
        ai.state === "failed"
          ? `The AI couldn't say: ${ai.message}`
          : "The AI found no song list for this file.",
      );
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

  const save = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const sent = rowsIn(rows, songs?.length_ms ?? null);
    if (typeof sent === "string") {
      setError(sent);
      return;
    }
    if (removing > 0 && confirming !== "save") {
      setConfirming("save");
      return;
    }
    void run(async () => {
      await onSave(sent, songs?.songs.map((song) => song.id) ?? []);
      onDone();
    });
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
            ? [{ name: "the AI", count: songs.suggested.length }]
            : []),
        ]);

  return (
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
            <button
              type="button"
              className="fill-button"
              disabled={busy || thinking || (songs.suggested.length === 0 && !ai.can)}
              aria-label="Fill with AI"
              aria-busy={thinking}
              title={
                songs.suggested.length > 0
                  ? `The ${songCount(songs.suggested.length)} the AI suggested`
                  : ai.can
                    ? "Ask the AI for the songs"
                    : "Set up an AI provider in Settings to ask it"
              }
              onClick={() => {
                setTyping(false);
                if (songs.suggested.length > 0) {
                  fill(songs.suggested, "from the AI");
                } else {
                  setFillNote("");
                  setAskedAi(true);
                  ai.ask();
                }
              }}
            >
              {thinking ? (
                <CircleNotchIcon className="spin" aria-hidden />
              ) : (
                <SparkleIcon aria-hidden />
              )}{" "}
              AI
            </button>
            <span className="songs-fill-note" role="status">
              {thinking ? "Asking the AI…" : fillNote}
            </span>
          </div>
          {disagree !== null && <p className="songs-note songs-doubt">{disagree}</p>}
          {typing && (
            <Suspense fallback={<p className="empty">Opening the list…</p>}>
              <ListEditor
                initial={listTextOf(rows)}
                check={(text) => check(album.id, text)}
                artists={artists}
                onUse={(list) => {
                  setTyping(false);
                  fill(list, "from the list");
                }}
                onCancel={() => {
                  setTyping(false);
                }}
              />
            </Suspense>
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
                      place={index + 1}
                      first={index === 0}
                      last={index === rows.length - 1}
                      heard={heard}
                      long={doubts.long.has(index) ? lengthOf(index) : undefined}
                      playing={playing?.key === row.key ? playing.mode : undefined}
                      onChange={(field, value) => {
                        change(row.key, field, value);
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
      <footer className="dialog-buttons" hidden={typing}>
        {split && (
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
          type="button"
          className="secondary outline dialog-button"
          disabled={busy}
          onClick={onBack}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="dialog-button"
          disabled={songs === undefined || busy || typing}
          aria-busy={busy}
        >
          {confirming === "save" ? `Save and remove ${songCount(removing)}` : "Save songs"}
        </button>
      </footer>
    </form>
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
  playing,
  onChange,
  onMove,
  onRemove,
  onPlay,
  onStartHere,
}: {
  readonly row: Row;
  readonly place: number;
  readonly first: boolean;
  readonly last: boolean;
  readonly heard: boolean;
  /** How long the song is, as `18:30`, when it is so long it may be two. */
  readonly long: string | undefined;
  /** How the row's song is playing, if it is. */
  readonly playing: Playing["mode"] | undefined;
  readonly onChange: (field: "start" | "title" | "artist", value: string) => void;
  readonly onMove: (by: -1 | 1) => void;
  readonly onRemove: () => void;
  readonly onPlay: (mode: Playing["mode"]) => void;
  readonly onStartHere: () => void;
}) {
  const named = row.title.trim() === "" ? `song ${String(place)}` : `“${row.title}”`;
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
        className="detail-input song-start"
        aria-label={`Start of song ${String(place)}`}
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
      <input
        className="detail-input song-artist"
        aria-label={`Artist of song ${String(place)}`}
        placeholder="Artist"
        value={row.artist}
        onChange={(event) => {
          onChange("artist", event.currentTarget.value);
        }}
      />
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

function rowOf(song: Song, id: number | null, start = formatStart(song.start_ms)): Row {
  return {
    key: newId(),
    id,
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
