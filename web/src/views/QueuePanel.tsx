/**
 * @file The queue: what plays next, in order, to drag into another order or remove.
 *
 * A Track is dragged by its handle, with a pointer or a finger; from the
 * keyboard, Space picks it up, the arrow keys move it, and Space drops it.
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
import { DotsSixVerticalIcon, XIcon } from "@phosphor-icons/react";

import type { Track } from "../api";
import { formatQueueLength } from "../format";
import { type Entry, upNext } from "../player/queue";
import type { Player } from "../player/usePlayer";
import { useNow } from "../useNow";
import { Cover } from "./Cover";

const MODIFIERS = [restrictToVerticalAxis, restrictToParentElement];
const INSTRUCTIONS = {
  draggable:
    "To reorder, press Space to pick the Track up, the arrow keys to move it, and Space again to drop it. Escape puts it back.",
};

/** What plays after the current Track. */
export function QueuePanel({
  player,
  tracks,
  id = "queue",
  announceIn,
}: {
  readonly player: Player;
  readonly tracks: ReadonlyMap<number, Track>;
  /** The panel's id, for a second panel on the page such as Now Playing's. */
  readonly id?: string;
  /** Where dragging is announced: inside a modal dialog, which leaves the page behind inert. */
  readonly announceIn?: HTMLElement | null;
}) {
  const entries = upNext(player.queue);
  const now = useNow();
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
            items={entries.map((entry) => entry.key)}
            strategy={verticalListSortingStrategy}
          >
            <ol>
              {entries.map((entry) => (
                <QueueItem
                  key={entry.key}
                  entry={entry}
                  track={tracks.get(entry.trackId)}
                  onRemove={() => {
                    player.remove(entry.key);
                  }}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

function QueueItem({
  entry,
  track,
  onRemove,
}: {
  readonly entry: Entry;
  readonly track: Track | undefined;
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
      className={isDragging ? "dragging" : undefined}
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
