/**
 * @file The queue: what plays next, in order, to drag into another order or remove.
 *
 * Its History tab, beside it, lists what played.
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
import {
  ArrowsInLineVerticalIcon,
  ArrowsOutLineVerticalIcon,
  CaretRightIcon,
  DotsSixVerticalIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type KeyboardEvent, useMemo, useState } from "react";

import type { Track } from "../api";
import { formatQueueLength } from "../format";
import { songsByFile } from "../library/playOrder";
import { type Words, useFormattingLocale, useWords } from "../locale";
import { type Entry, upNext } from "../player/queue";
import type { Player } from "../player/usePlayer";
import { useHistory } from "../player/useHistory";
import type { SleepTimer } from "../player/useSleepTimer";
import { useNow } from "../useNow";
import { Cover } from "./Cover";
import { ClearQuestion, HistoryClear, HistoryList } from "./HistoryPanel";
import { Hint } from "./Hint";
import { KindMark } from "./KindMark";
import { SleepTimerMenu } from "./SleepTimerMenu";

const MODIFIERS = [restrictToVerticalAxis, restrictToParentElement];

type Tab = "queue" | "history";
const TABS: readonly (readonly [Tab, string])[] = [
  ["queue", "Up next"],
  ["history", "History"],
];

/** What plays after the current Track, and in its History tab, what played. */
export function QueuePanel({
  player,
  sleep,
  tracks,
  id = "queue",
  announceIn,
  showFoldAll = false,
}: {
  readonly player: Player;
  /** The sleep timer, set from the panel's header. */
  readonly sleep: SleepTimer;
  readonly tracks: ReadonlyMap<number, Track>;
  /** The panel's id, for a second panel on the page such as Now Playing's. */
  readonly id?: string;
  /** Where dragging is announced: inside a modal dialog, which leaves the page behind inert. */
  readonly announceIn?: HTMLElement | null;
  readonly showFoldAll?: boolean;
}) {
  const words = useWords();
  const locale = useFormattingLocale();
  const [tab, setTab] = useState<Tab>("queue");
  const history = useHistory(tab === "history");
  // Whether History's Clear is asking once more.
  const [asking, setAsking] = useState(false);
  const entries = upNext(player.queue);
  const now = useNow();
  const songsIn = useMemo(() => songsByFile([...tracks.values()]), [tracks]);
  // The split files whose songs are folded away, by the file's id.
  const [folded, setFolded] = useState<ReadonlySet<number>>(new Set());
  const rows = rowsOf(entries, tracks);
  const albums = rows.flatMap((row) => (row.kind === "album" ? [row.fileId] : []));
  const allExpanded = albums.every((file) => !folded.has(file));
  const foldAllLabel = allExpanded ? words("Collapse all") : words("Expand all");
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
      ? words("A Track")
      : (tracks.get(entry.trackId)?.title ?? words("A Track no longer here"));
  const placeOf = (id: UniqueIdentifier | undefined) =>
    entries.findIndex((entry) => entry.key === id);
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      words("Picked up {{title}}.", { title: titleOf(entries[placeOf(active.id)]) }),
    // Over its own place, it hasn't moved yet: "Picked up" stays the last word.
    onDragOver: ({ active, over }) =>
      over === null || over.id === active.id
        ? undefined
        : words("{{title}} would play {{place}}.", {
            title: titleOf(entries[placeOf(active.id)]),
            place: ordinal(placeOf(over.id), words),
          }),
    onDragEnd: ({ active, over }) =>
      words("{{title}} plays {{place}}.", {
        title: titleOf(entries[placeOf(active.id)]),
        place: ordinal(placeOf(over?.id ?? active.id), words),
      }),
    onDragCancel: ({ active }) =>
      words("{{title}} stays where it was.", { title: titleOf(entries[placeOf(active.id)]) }),
  };

  const durations = entries.map((entry) => tracks.get(entry.trackId)?.duration_ms);
  const lengthMs = durations.every((duration) => typeof duration === "number")
    ? durations.reduce((sum, duration) => sum + duration, 0)
    : undefined;
  // Only a queue playing on to its end ends at a time on the clock.
  const ending =
    player.status.kind === "playing" &&
    player.repeat === "off" &&
    lengthMs !== undefined &&
    player.duration !== undefined
      ? {
          now: new Date(now),
          at: new Date(now + lengthMs + Math.max(0, player.duration - player.position) * 1000),
        }
      : undefined;

  const drop = ({ active, over }: DragEndEvent) => {
    if (over !== null && active.id !== over.id) {
      player.move(String(active.id), placeOf(over.id));
    }
  };

  return (
    <section id={id} className="queue" aria-label={words("Up next")}>
      <header>
        <div className="queue-tabs" role="tablist" aria-label={words("Up next or History")}>
          {TABS.map(([each, name]) => (
            <button
              key={each}
              type="button"
              role="tab"
              id={`${id}-${each}-tab`}
              aria-selected={tab === each}
              aria-controls={`${id}-${each}`}
              tabIndex={tab === each ? 0 : -1}
              onClick={() => {
                setTab(each);
              }}
              onKeyDown={(event: KeyboardEvent) => {
                // The arrow keys move between the two tabs, as a tab list's do.
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  const other = each === "queue" ? "history" : "queue";
                  setTab(other);
                  document.getElementById(`${id}-${other}-tab`)?.focus();
                }
              }}
            >
              {words(name)}
            </button>
          ))}
        </div>
        {tab === "queue" ? (
          <div className="queue-actions">
            <SleepTimerMenu timer={sleep} container={announceIn} />
            {showFoldAll && albums.length > 0 && (
              <Hint name={foldAllLabel} keys={[]}>
                <button
                  type="button"
                  className="icon"
                  aria-label={foldAllLabel}
                  aria-controls={`${id}-queue`}
                  onClick={() => {
                    setFolded(allExpanded ? new Set(albums) : new Set());
                  }}
                >
                  {allExpanded ? (
                    <ArrowsInLineVerticalIcon aria-hidden />
                  ) : (
                    <ArrowsOutLineVerticalIcon aria-hidden />
                  )}
                </button>
              </Hint>
            )}
            <button
              type="button"
              className="text"
              onClick={player.clear}
              disabled={entries.length === 0}
            >
              {words("Clear")}
            </button>
          </div>
        ) : (
          <HistoryClear
            history={history}
            onAsk={() => {
              setAsking(true);
            }}
          />
        )}
      </header>
      {tab === "history" ? (
        <div role="tabpanel" id={`${id}-history`} aria-labelledby={`${id}-history-tab`}>
          {asking && (
            <ClearQuestion
              history={history}
              onDone={() => {
                setAsking(false);
              }}
            />
          )}
          <HistoryList history={history} player={player} tracks={tracks} />
        </div>
      ) : (
        <div role="tabpanel" id={`${id}-queue`} aria-labelledby={`${id}-queue-tab`}>
          {entries.length > 0 && (
            <p className="queue-length">
              {formatQueueLength(entries.length, lengthMs, ending, { locale, t: words })}
            </p>
          )}
          {entries.length === 0 ? (
            <p className="empty">
              {words("Nothing queued. Add a Track from the list to play it later.")}
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={MODIFIERS}
              accessibility={{
                announcements,
                screenReaderInstructions: {
                  draggable: words(
                    "To reorder, press Space to pick the Track up, the arrow keys to move it, and Space again to drop it. Escape puts it back.",
                  ),
                },
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
                          onPlay={() => {
                            player.playAt(entry.key, 0);
                          }}
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
                        onPlay={() => {
                          const [start] = row.entries;
                          if (start !== undefined) {
                            player.playAt(start.key, 0);
                          }
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
        </div>
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
  onPlay,
  onRemove,
}: {
  readonly file: Track | undefined;
  /** The place in the file of the first song queued, from 1. */
  readonly place: number;
  readonly count: number;
  readonly folded: boolean;
  readonly onFold: () => void;
  /** Play its first song queued now. */
  readonly onPlay: () => void;
  readonly onRemove: () => void;
}) {
  const t = useWords();
  const title = file?.title ?? t("An album no longer here");
  const where = t("{{place}} of {{total}}", { place, total: count });
  return (
    <li className="queue-album" aria-label={t("{{title}}, {{where}}", { title, where })}>
      <button
        type="button"
        className="icon fold"
        aria-expanded={!folded}
        aria-label={t(folded ? "Show the songs of {{title}}" : "Hide the songs of {{title}}", {
          title,
        })}
        title={folded ? t("Show its songs") : t("Hide its songs")}
        onClick={onFold}
      >
        <CaretRightIcon className="fold-caret" weight="bold" aria-hidden />
      </button>
      <KindMark kind="album" reason="split" lyrics={file} />
      <button
        type="button"
        className="album-title"
        aria-label={t("Play {{title}} from song {{place}}", { title, place })}
        title={t("Play now")}
        onClick={onPlay}
      >
        {title}
      </button>
      <span className="album-place" title={t("From song {{where}}", { where })}>
        {where}
      </span>
      <button
        type="button"
        className="icon remove"
        aria-label={t("Remove the rest of {{title}}", { title })}
        title={t("Remove the rest of the album")}
        onClick={onRemove}
      >
        <XIcon weight="bold" aria-hidden />
      </button>
    </li>
  );
}

/**
 * One entry of what plays next: clicked anywhere but its own buttons, or its title
 * pressed, it plays now.
 */
function QueueItem({
  entry,
  track,
  inAlbum,
  onPlay,
  onRemove,
}: {
  readonly entry: Entry;
  readonly track: Track | undefined;
  /** Whether it shows under its album's row. */
  readonly inAlbum: boolean;
  readonly onPlay: () => void;
  readonly onRemove: () => void;
}) {
  const t = useWords();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.key });
  const title = track?.title ?? t("A Track no longer here");
  return (
    <li
      ref={setNodeRef}
      className={
        [inAlbum ? "in-album" : "", isDragging ? "dragging" : ""].join(" ").trim() || undefined
      }
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onClick={(event) => {
        // The title is a button of its own; the handle and Remove do their own thing.
        if (!(event.target instanceof Element) || event.target.closest("button") === null) {
          onPlay();
        }
      }}
    >
      <button
        type="button"
        className="icon handle"
        ref={setActivatorNodeRef}
        aria-label={t("Reorder {{view}}", { view: title })}
        title={t("Drag to reorder")}
        {...attributes}
        {...listeners}
        data-sortable-handle=""
        aria-roledescription={t("sortable")}
      >
        <DotsSixVerticalIcon weight="bold" aria-hidden />
      </button>
      <Cover size="small" cover={track?.cover ?? null} className="thumb" />
      {track !== undefined && (
        <KindMark kind={track.kind} reason={track.kind_reason} lyrics={track} />
      )}
      <button
        type="button"
        className="entry-title"
        aria-label={t("Play {{title}} now", { title })}
        title={t("Play now")}
        onClick={onPlay}
      >
        {title}
      </button>
      <span className="entry-artist">{track?.artist}</span>
      <button
        type="button"
        className="icon remove"
        aria-label={t("Remove {{title}}", { title })}
        title={t("Remove")}
        onClick={onRemove}
      >
        <XIcon weight="bold" aria-hidden />
      </button>
    </li>
  );
}

/** Return "next", "second", and so on, for a place in what plays next. */
function ordinal(place: number, t: Words): string {
  const labels = ["next", "second", "third", "fourth", "fifth"];
  const label = labels[place];
  return label === undefined ? t("at place {{place}}", { place: place + 1 }) : t(label);
}
