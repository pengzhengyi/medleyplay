/**
 * @file The queue: what plays next, in order, to drag into another order or remove.
 *
 * A Track is dragged by its handle, with a pointer or a finger; from the
 * keyboard, Space picks it up, the arrow keys move it, and Space drops it.
 * Songs of one split file queued one after another show under a row naming the
 * file and where they start in it, such as *3 of 11*, to fold away or remove at once.
 */

import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  closestCenter,
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
import { CaretRightIcon, DotsSixVerticalIcon, XIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import type { Track } from "../api";
import { formatQueueLength } from "../format";
import { songsByFile } from "../library/playOrder";
import { type Entry, upNext } from "../player/queue";
import type { Player } from "../player/usePlayer";
import type { SleepTimer } from "../player/useSleepTimer";
import { useNow } from "../useNow";
import { Cover } from "./Cover";
import { KindMark } from "./KindMark";
import { SleepTimerMenu } from "./SleepTimerMenu";

const MODIFIERS = [restrictToVerticalAxis, restrictToParentElement];
const INSTRUCTIONS = {
  draggable:
    "To reorder, press Space to pick the Track up, the arrow keys to move it, and Space again to drop it. Escape puts it back.",
};

/** What plays after the current Track. */
export function QueuePanel({
  player,
  sleep,
  tracks,
  id = "queue",
  announceIn,
}: {
  readonly player: Player;
  /** The sleep timer, set from the panel's header. */
  readonly sleep: SleepTimer;
  readonly tracks: ReadonlyMap<number, Track>;
  /** The panel's id, for a second panel on the page such as Now Playing's. */
  readonly id?: string;
  /** Where dragging is announced: inside a modal dialog, which leaves the page behind inert. */
  readonly announceIn?: HTMLElement | null;
}) {
  const entries = upNext(player.queue);
  const now = useNow();
  const songsIn = useMemo(() => songsByFile([...tracks.values()]), [tracks]);
  // The split files whose songs are folded away, by the file's id.
  const [folded, setFolded] = useState<ReadonlySet<number>>(new Set());
  const rows = rowsOf(entries, tracks);
  const shown = rows.flatMap((row) =>
    row.kind === "album" && folded.has(row.fileId) ? [] : row.entries,
  );
  const sensors = useSensors(
    // A few pixels of movement first, so a tap on the handle isn't a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const titleOf = (entry: Entry | undefined) =>
    entry === undefined
      ? "A Track"
      : (tracks.get(entry.trackId)?.title ?? "A Track no longer here");
  const placeOf = (id: UniqueIdentifier | undefined) =>
    entries.findIndex((entry) => entry.key === id);
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(entries[placeOf(active.id)])}.`,
    // Over its own place, it hasn't moved yet: "Picked up" stays the last word.
    onDragOver: ({ active, over }) =>
      over === null || over.id === active.id
        ? undefined
        : `${titleOf(entries[placeOf(active.id)])} would play ${ordinal(placeOf(over.id))}.`,
    onDragEnd: ({ active, over }) =>
      `${titleOf(entries[placeOf(active.id)])} plays ${ordinal(placeOf(over?.id ?? active.id))}.`,
    onDragCancel: ({ active }) => `${titleOf(entries[placeOf(active.id)])} stays where it was.`,
  };

  const lengthMs = entries.reduce(
    (sum, entry) => sum + (tracks.get(entry.trackId)?.duration_ms ?? 0),
    0,
  );
  // Only a queue playing on to its end ends at a time on the clock.
  const leftMs = lengthMs + Math.max(0, (player.duration ?? 0) - player.position) * 1000;
  const ending =
    player.status.kind === "playing" && player.repeat === "off"
      ? { now: new Date(now), at: new Date(now + leftMs) }
      : undefined;

  const drop = ({ active, over }: DragEndEvent) => {
    if (over !== null && active.id !== over.id) {
      player.move(String(active.id), placeOf(over.id));
    }
  };

  return (
    <section id={id} className="queue" aria-label="Up next" tabIndex={-1}>
      <header>
        <h2>Up next</h2>
        <SleepTimerMenu timer={sleep} container={announceIn} />
        <button
          type="button"
          className="text"
          onClick={player.clear}
          disabled={entries.length === 0}
        >
          Clear
        </button>
      </header>
      {entries.length > 0 && (
        <p className="queue-length">{formatQueueLength(entries.length, lengthMs, ending)}</p>
      )}
      {entries.length === 0 ? (
        <p className="empty">Nothing queued. Add a Track from the list to play it later.</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={MODIFIERS}
          accessibility={{
            announcements,
            screenReaderInstructions: INSTRUCTIONS,
            ...(announceIn ? { container: announceIn } : {}),
          }}
          onDragEnd={drop}
        >
          <SortableContext
            items={shown.map((entry) => entry.key)}
            strategy={verticalListSortingStrategy}
          >
            <ol>
              {rows.map((row) => {
                const items = (inAlbum: boolean) =>
                  row.entries.map((entry) => (
                    <QueueItem
                      key={entry.key}
                      entry={entry}
                      track={tracks.get(entry.trackId)}
                      inAlbum={inAlbum}
                      onRemove={() => {
                        player.remove(entry.key);
                      }}
                    />
                  ));
                if (row.kind === "entry") {
                  return items(false);
                }
                const songs = songsIn.get(row.fileId) ?? [];
                const first = songs.findIndex((song) => song.id === row.entries[0]?.trackId);
                const isFolded = folded.has(row.fileId);
                return [
                  <AlbumRow
                    key={`album:${row.entries[0]?.key ?? ""}`}
                    file={tracks.get(row.fileId)}
                    place={first + 1}
                    count={songs.length}
                    folded={isFolded}
                    onFold={() => {
                      setFolded((was) => {
                        const next = new Set(was);
                        if (!next.delete(row.fileId)) {
                          next.add(row.fileId);
                        }
                        return next;
                      });
                    }}
                    onRemove={() => {
                      for (const entry of row.entries) {
                        player.remove(entry.key);
                      }
                    }}
                  />,
                  ...(isFolded ? [] : items(true)),
                ];
              })}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

/** A queued entry on its own, or songs of one split file queued one after another. */
type Row =
  | { readonly kind: "entry"; readonly entries: readonly [Entry] }
  | { readonly kind: "album"; readonly fileId: number; readonly entries: readonly Entry[] };

/** Return `entries` as rows: two or more songs of one file in a row are one album's. */
function rowsOf(entries: readonly Entry[], tracks: ReadonlyMap<number, Track>): Row[] {
  const rows: Row[] = [];
  let run: Entry[] = [];
  let runFile: number | null = null;
  const end = () => {
    if (runFile !== null && run.length > 1) {
      rows.push({ kind: "album", fileId: runFile, entries: run });
    } else {
      rows.push(...run.map((entry): Row => ({ kind: "entry", entries: [entry] })));
    }
    run = [];
  };
  for (const entry of entries) {
    const file = tracks.get(entry.trackId)?.segment_of ?? null;
    if (file === null || file !== runFile) {
      end();
    }
    runFile = file;
    run.push(entry);
  }
  end();
  return rows;
}

/** The row naming a split file whose songs follow, where they start in it, and how many it has. */
function AlbumRow({
  file,
  place,
  count,
  folded,
  onFold,
  onRemove,
}: {
  readonly file: Track | undefined;
  /** The place in the file of the first song queued, from 1. */
  readonly place: number;
  readonly count: number;
  readonly folded: boolean;
  readonly onFold: () => void;
  readonly onRemove: () => void;
}) {
  const title = file?.title ?? "An album no longer here";
  const where = `${String(place)} of ${String(count)}`;
  return (
    <li className="queue-album" aria-label={`${title}, ${where}`}>
      <button
        type="button"
        className="icon fold"
        aria-expanded={!folded}
        aria-label={`${folded ? "Show" : "Hide"} the songs of ${title}`}
        title={folded ? "Show its songs" : "Hide its songs"}
        onClick={onFold}
      >
        <CaretRightIcon className="fold-caret" weight="bold" aria-hidden />
      </button>
      <KindMark kind="album" reason="split" />
      <span className="album-title">{title}</span>
      <span className="album-place" title={`From song ${where}`}>
        {where}
      </span>
      <button
        type="button"
        className="icon remove"
        aria-label={`Remove the rest of ${title}`}
        title="Remove the rest of the album"
        onClick={onRemove}
      >
        <XIcon weight="bold" aria-hidden />
      </button>
    </li>
  );
}

function QueueItem({
  entry,
  track,
  inAlbum,
  onRemove,
}: {
  readonly entry: Entry;
  readonly track: Track | undefined;
  /** Whether it shows under its album's row. */
  readonly inAlbum: boolean;
  readonly onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.key });
  const title = track?.title ?? "A Track no longer here";
  return (
    <li
      ref={setNodeRef}
      className={
        [inAlbum ? "in-album" : "", isDragging ? "dragging" : ""].join(" ").trim() || undefined
      }
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button
        type="button"
        className="icon handle"
        ref={setActivatorNodeRef}
        aria-label={`Reorder ${title}`}
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <DotsSixVerticalIcon weight="bold" aria-hidden />
      </button>
      <Cover cover={track?.cover ?? null} className="thumb" />
      {track !== undefined && <KindMark kind={track.kind} reason={track.kind_reason} />}
      <span className="entry-title">{title}</span>
      <span className="entry-artist">{track?.artist}</span>
      <button
        type="button"
        className="icon remove"
        aria-label={`Remove ${title}`}
        title="Remove"
        onClick={onRemove}
      >
        <XIcon weight="bold" aria-hidden />
      </button>
    </li>
  );
}

/** Return "next", "second", and so on, for a place in what plays next. */
function ordinal(place: number): string {
  const words = ["next", "second", "third", "fourth", "fifth"];
  return words[place] ?? `at place ${String(place + 1)}`;
}
