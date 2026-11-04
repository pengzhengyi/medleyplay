/**
 * @file Splitting one long file into its songs, or editing the songs it is split into.
 *
 * A row per song: where it starts, its title, and its artist. Rows can be added,
 * removed, and moved, by dragging or with the buttons, filled from a song list found
 * in the video's details, or read from a pasted list. The file plays in the dialog
 * from any row's start, and a row's start can be taken from where it is playing. A row keeps its song by id, so a song moved, renamed, or
 * retimed keeps its ratings and plays; saving says first how many songs it would
 * remove with theirs, and so does unsplitting.
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
  DotsSixVerticalIcon,
  MapPinIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { type SubmitEvent, useEffect, useRef, useState } from "react";

import type { PlaybackAnswer, Song, SongRowIn, Songs, Track } from "../api";
import { newId } from "../ids";
import { formatStart, parseStart } from "../library/songTimes";
import { Modal } from "./Modal";

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

/** The most songs a file is split into, as the server keeps them. */
const MAX_SONGS = 300;
/** The longest list to paste, as the server reads it. */
const MAX_LIST = 100_000;

const MODIFIERS = [restrictToVerticalAxis, restrictToParentElement];
const INSTRUCTIONS = {
  draggable:
    "To reorder, press Space to pick the song up, the arrow keys to move it, and Space again to drop it. Escape puts it back.",
};

/**
 * Edit the songs `album`'s file is split into, read with `load`; `onSave` sends the
 * rows, `readList` reads a pasted list, and `onUnsplit` removes every song.
 * `loadAudio` says how the file plays, and `onListen` quiets other music as it does.
 */
export function EditSongs({
  album,
  load,
  readList,
  loadAudio,
  onListen,
  onSave,
  onUnsplit,
  onClose,
}: {
  readonly album: Track;
  readonly load: (trackId: number) => Promise<Songs>;
  readonly readList: (trackId: number, text: string) => Promise<readonly Song[]>;
  readonly loadAudio: (trackId: number) => Promise<PlaybackAnswer>;
  readonly onListen: () => void;
  /** Save `rows`, refused when the file's songs are no longer the `known` ones the editor saw. */
  readonly onSave: (rows: readonly SongRowIn[], known: readonly number[]) => Promise<void>;
  readonly onUnsplit: () => Promise<void>;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => {
    dialog.current?.close();
  };
  const [songs, setSongs] = useState<Songs | undefined>(undefined);
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Set once saving or unsplitting has said what it removes, so the next press goes ahead.
  const [confirming, setConfirming] = useState<"save" | "unsplit" | undefined>(undefined);
  const audio = useRef<HTMLAudioElement>(null);
  const [heard, setHeard] = useState(false);
  const [audioNote, setAudioNote] = useState("");
  const sensors = useSensors(
    // A few pixels of movement first, so a tap on the handle isn't a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
  };
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
  // A list found or pasted starts over: its songs are new, and the rows' songs go.
  const startFrom = (list: readonly Song[]) => {
    edit(list.map((song) => rowOf(song, null)));
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

  const listen = async (startMs: number) => {
    const element = audio.current;
    if (element === null) {
      return;
    }
    setAudioNote("");
    try {
      if (element.getAttribute("src") === null) {
        const answer = await loadAudio(album.id);
        if (answer.state !== "ready") {
          setAudioNote(
            answer.state === "preparing"
              ? "The file is being prepared; listen again in a moment."
              : "This file can't be played.",
          );
          return;
        }
        element.src = answer.audio_url;
        setHeard(true);
      }
      seek(element, startMs / 1000);
      onListen();
      await element.play();
    } catch (failure) {
      setAudioNote(messageOf(failure));
    }
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
      close();
    });
  };
  const unsplit = () => {
    if (confirming !== "unsplit") {
      setConfirming("unsplit");
      return;
    }
    void run(async () => {
      await onUnsplit();
      close();
    });
  };

  return (
    <Modal
      ref={dialog}
      className="edit-songs"
      labelledBy="edit-songs-title"
      describedBy="edit-songs-file"
      locked={busy}
      onClose={onClose}
    >
      <form className="card" onSubmit={save}>
        <h2 id="edit-songs-title">{split ? "Edit songs" : "Split into songs"}</h2>
        <p id="edit-songs-file" className="edit-details-song">
          {album.title}
        </p>
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
            {songs.found.map((list, index) => (
              <button
                key={index}
                type="button"
                className="secondary outline songs-found"
                disabled={busy}
                onClick={() => {
                  startFrom(list);
                }}
              >
                {`Use the ${String(list.length)} songs from the video's details`}
              </button>
            ))}
            <details className="paste-video">
              <summary className="paste-video-summary">Paste a list</summary>
              <div className="paste-video-body">
                <label htmlFor="songs-list" className="detail-label">
                  Song list
                </label>
                <textarea
                  id="songs-list"
                  className="detail-input"
                  rows={5}
                  maxLength={MAX_LIST}
                  placeholder={"00:00 Intro\n03:12 Night Drive - Blue Room"}
                  value={pasted}
                  onChange={(event) => {
                    setPasted(event.currentTarget.value);
                  }}
                />
                <button
                  type="button"
                  className="secondary paste-video-read"
                  disabled={busy || pasted.trim() === ""}
                  onClick={() =>
                    void run(async () => {
                      startFrom(await readList(album.id, pasted));
                    })
                  }
                >
                  Read the list
                </button>
              </div>
            </details>
            <audio
              ref={audio}
              className="songs-audio"
              controls
              preload="metadata"
              hidden={!heard}
            />
            {audioNote !== "" && (
              <p className="songs-note" role="status">
                {audioNote}
              </p>
            )}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={MODIFIERS}
              accessibility={{ announcements, screenReaderInstructions: INSTRUCTIONS }}
              onDragEnd={drop}
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
                      onChange={(field, value) => {
                        change(row.key, field, value);
                      }}
                      onMove={(by) => {
                        move(index, index + by);
                      }}
                      onRemove={() => {
                        edit(rows.filter((each) => each.key !== row.key));
                      }}
                      onListen={() => {
                        const start =
                          row.start === row.loaded.text ? row.loaded.ms : parseStart(row.start);
                        if (start === undefined) {
                          setAudioNote(
                            `Song ${String(index + 1)} starts at no time; write it as 3:12 or 1:07:40.`,
                          );
                        } else {
                          void listen(start);
                        }
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
            onClick={close}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="dialog-button"
            disabled={songs === undefined || busy}
            aria-busy={busy}
          >
            {confirming === "save" ? `Save and remove ${songCount(removing)}` : "Save"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

/**
 * One song's row: a handle to drag it, its start, title, and artist, and buttons to
 * listen from its start, start it where the file is playing (once it has been
 * `heard`), and move or remove it.
 */
function SongRow({
  row,
  place,
  first,
  last,
  heard,
  onChange,
  onMove,
  onRemove,
  onListen,
  onStartHere,
}: {
  readonly row: Row;
  readonly place: number;
  readonly first: boolean;
  readonly last: boolean;
  readonly heard: boolean;
  readonly onChange: (field: "start" | "title" | "artist", value: string) => void;
  readonly onMove: (by: -1 | 1) => void;
  readonly onRemove: () => void;
  readonly onListen: () => void;
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
          className="icon"
          aria-label={`Listen from song ${String(place)}`}
          title="Listen from here"
          onClick={onListen}
        >
          <PlayIcon aria-hidden />
        </button>
        <button
          type="button"
          className="icon"
          aria-label={`Start song ${String(place)} here`}
          title="Start where it is playing"
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
    </li>
  );
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
    const start = row.start === row.loaded.text ? row.loaded.ms : parseStart(row.start);
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
