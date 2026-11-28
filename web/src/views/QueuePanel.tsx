/**
 * @file The queue: what plays next, in order, to drag into another order or remove.
 *
 * Its History tab, beside it, lists what played.
 *
 * A mouse or pen drags a Track by its handle; a finger holds the handle first.
 * From the keyboard, Space picks it up, the arrow keys move it, and Space drops it.
 * Songs of one split file queued one after another show under a row naming the
 * file and where they start in it, such as *3 of 11*, to fold away or remove at once.
 */

import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  type UniqueIdentifier,
  closestCenter,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownIcon,
  ArrowLineDownIcon,
  ArrowLineUpIcon,
  ArrowUpIcon,
  ArrowsInLineVerticalIcon,
  ArrowsOutLineVerticalIcon,
  CaretRightIcon,
  DotsSixVerticalIcon,
  DotsThreeIcon,
  XIcon,
} from "@phosphor-icons/react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  type ComponentPropsWithRef,
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

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
import { useReorderSensors } from "./useReorderSensors";

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
  const entries = useMemo(() => upNext(player.queue), [player.queue]);
  const now = useNow();
  // The split files whose songs are folded away, by the file's id.
  const [folded, setFolded] = useState<ReadonlySet<number>>(new Set());
  const rows = useMemo(() => rowsOf(entries, tracks), [entries, tracks]);
  const albums = useMemo(
    () => rows.flatMap((row) => (row.kind === "album" ? [row.fileId] : [])),
    [rows],
  );
  const allExpanded = useMemo(() => albums.every((file) => !folded.has(file)), [albums, folded]);
  const fold = useCallback((file: number) => {
    setFolded((was) => {
      const next = new Set(was);
      if (!next.delete(file)) {
        next.add(file);
      }
      return next;
    });
  }, []);
  const foldAllLabel = allExpanded ? words("Collapse all") : words("Expand all");
  const clearLabel = words("Clear Up next");
  const lengthMs = useMemo(() => {
    const durations = entries.map((entry) => tracks.get(entry.trackId)?.duration_ms);
    return durations.every((duration) => typeof duration === "number")
      ? durations.reduce((sum, duration) => sum + duration, 0)
      : undefined;
  }, [entries, tracks]);
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
            <Hint name={clearLabel} keys={[]}>
              <button
                type="button"
                className="icon"
                aria-label={clearLabel}
                onClick={player.clear}
                disabled={entries.length === 0}
              >
                <XIcon aria-hidden />
              </button>
            </Hint>
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
            <QueueContents
              entries={entries}
              rows={rows}
              tracks={tracks}
              folded={folded}
              onFold={fold}
              playAt={player.playAt}
              move={player.move}
              remove={player.remove}
              announceIn={announceIn}
            />
          )}
        </div>
      )}
    </section>
  );
}

const QueueContents = memo(function QueueContents({
  entries,
  rows,
  tracks,
  folded,
  onFold,
  playAt,
  move,
  remove,
  announceIn,
}: {
  readonly entries: readonly Entry[];
  readonly rows: readonly Row[];
  readonly tracks: ReadonlyMap<number, Track>;
  readonly folded: ReadonlySet<number>;
  readonly onFold: (file: number) => void;
  readonly announceIn: HTMLElement | null | undefined;
} & Pick<Player, "playAt" | "move" | "remove">) {
  const words = useWords();
  const songsIn = useMemo(() => songsByFile([...tracks.values()]), [tracks]);
  const places = useMemo(() => new Map(entries.map(({ key }, index) => [key, index])), [entries]);
  const list = useRef<HTMLOListElement>(null);
  const [requestedMove, setRequestedMove] = useState<{
    readonly key: string;
    readonly from: number;
    readonly to: number;
  }>();
  const [finishedMove, setFinishedMove] = useState<{
    readonly key: string;
    readonly arrived: { readonly entry: Entry | undefined; readonly place: number } | undefined;
  }>();
  if (requestedMove !== undefined) {
    const place = places.get(requestedMove.key);
    if (place !== requestedMove.from) {
      setRequestedMove(undefined);
      setFinishedMove({
        key: requestedMove.key,
        arrived: place === requestedMove.to ? { entry: entries[place], place } : undefined,
      });
    }
  }
  const focusMoved = useEffectEvent((key: string) => {
    if (document.activeElement !== document.body) return;
    const album = rows.find(
      (row) => row.kind === "album" && row.entries.some((entry) => entry.key === key),
    );
    const buttons = [
      ...(list.current?.querySelectorAll<HTMLButtonElement>("[data-queue-focus]") ?? []),
    ];
    const find = (key: string | undefined) =>
      buttons.find((button) => button.dataset.queueFocus === key);
    const target =
      find(key) ??
      find(album === undefined ? undefined : `album:${album.entries[0].key}`) ??
      list.current
        ?.closest(".queue")
        ?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    target?.focus({ preventScroll: true });
  });
  useEffect(() => {
    if (finishedMove !== undefined) focusMoved(finishedMove.key);
  }, [finishedMove]);
  const shown = rows.flatMap((row) =>
    row.kind === "album" && folded.has(row.fileId) ? [] : row.entries,
  );
  const sensors = useReorderSensors();
  const titleOf = (entry: Entry | undefined) =>
    entry === undefined
      ? words("A Track")
      : (tracks.get(entry.trackId)?.title ?? words("A Track no longer here"));
  const placeOf = (id: UniqueIdentifier | undefined) =>
    typeof id === "string" ? (places.get(id) ?? -1) : -1;
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
  const drop = ({ active, over }: DragEndEvent) => {
    const to = placeOf(over?.id);
    if (to >= 0 && active.id !== over?.id) {
      move(String(active.id), to);
    }
  };

  return (
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
        <ol ref={list}>
          {rows.flatMap((row) => {
            const items = (inAlbum: boolean) =>
              row.entries.map((entry) => (
                <QueueItem
                  key={entry.key}
                  entry={entry}
                  track={tracks.get(entry.trackId)}
                  inAlbum={inAlbum}
                  place={placeOf(entry.key)}
                  last={entries.length - 1}
                  container={announceIn}
                  onMove={(to) => {
                    const from = places.get(entry.key);
                    if (from !== undefined && to !== from) {
                      setRequestedMove({ key: entry.key, from, to });
                      move(entry.key, to);
                    }
                  }}
                  onPlay={() => {
                    playAt(entry.key, 0);
                  }}
                  onRemove={() => {
                    remove(entry.key);
                  }}
                />
              ));
            if (row.kind === "entry") {
              return items(false);
            }
            const songs = songsIn.get(row.fileId) ?? [];
            const first = songs.findIndex((song) => song.id === row.entries[0]?.trackId);
            const isFolded = folded.has(row.fileId);
            const albumKey = `album:${row.entries[0]?.key ?? ""}`;
            return [
              <AlbumRow
                key={albumKey}
                focusKey={albumKey}
                file={tracks.get(row.fileId)}
                place={first + 1}
                count={songs.length}
                folded={isFolded}
                onFold={() => {
                  onFold(row.fileId);
                }}
                onPlay={() => {
                  const [start] = row.entries;
                  if (start !== undefined) {
                    playAt(start.key, 0);
                  }
                }}
                onRemove={() => {
                  for (const entry of row.entries) {
                    remove(entry.key);
                  }
                }}
              />,
              ...(isFolded ? [] : items(true)),
            ];
          })}
        </ol>
        <span className="visually-hidden" role="status">
          {finishedMove?.arrived !== undefined &&
            words("{{title}} plays {{place}}.", {
              title: titleOf(finishedMove.arrived.entry),
              place: ordinal(finishedMove.arrived.place, words),
            })}
        </span>
      </SortableContext>
    </DndContext>
  );
});

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
  focusKey,
  file,
  place,
  count,
  folded,
  onFold,
  onPlay,
  onRemove,
}: {
  readonly focusKey: string;
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
        data-queue-focus={focusKey}
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
  place,
  last,
  container,
  onMove,
  onPlay,
  onRemove,
}: {
  readonly entry: Entry;
  readonly track: Track | undefined;
  /** Whether it shows under its album's row. */
  readonly inAlbum: boolean;
  readonly place: number;
  readonly last: number;
  readonly container: HTMLElement | null | undefined;
  readonly onMove: (to: number) => void;
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
        if (
          event.target instanceof Element &&
          event.currentTarget.contains(event.target) &&
          event.target.closest("button") === null
        ) {
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
      <QueueItemMenu
        entryKey={entry.key}
        title={title}
        place={place}
        last={last}
        container={container}
        onMove={onMove}
        onRemove={onRemove}
      />
    </li>
  );
}

function QueueItemMenu({
  entryKey,
  title,
  place,
  last,
  container,
  onMove,
  onRemove,
}: {
  readonly entryKey: string;
  readonly title: string;
  readonly place: number;
  readonly last: number;
  readonly container: HTMLElement | null | undefined;
  readonly onMove: (to: number) => void;
  readonly onRemove: () => void;
}) {
  const t = useWords();
  const [open, setOpen] = useState(false);
  const moves = [
    { label: "Move to top", to: 0, icon: ArrowLineUpIcon },
    { label: "Move up", to: place - 1, icon: ArrowUpIcon },
    { label: "Move down", to: place + 1, icon: ArrowDownIcon },
    { label: "Move to end", to: last, icon: ArrowLineDownIcon },
  ];
  return (
    <Menu.Root modal={false} open={open} onOpenChange={setOpen}>
      <Menu.Trigger asChild>
        <QueueMenuButton
          type="button"
          className="icon queue-more"
          data-queue-focus={entryKey}
          aria-label={t("Up next actions for {{title}}", { title })}
          title={t("More actions")}
          onClick={() => {
            setOpen((was) => !was);
          }}
        >
          <DotsThreeIcon weight="bold" aria-hidden />
        </QueueMenuButton>
      </Menu.Trigger>
      <Menu.Portal container={container}>
        <Menu.Content
          className="track-menu"
          align="end"
          sideOffset={4}
          collisionPadding={8}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
        >
          {moves.map(({ label, to, icon: Icon }) => (
            <Menu.Item
              key={label}
              className="track-menu-item"
              disabled={to < 0 || to > last || to === place}
              onSelect={() => {
                onMove(to);
              }}
            >
              <Icon className="track-menu-icon" aria-hidden />
              {t(label)}
            </Menu.Item>
          ))}
          <Menu.Separator className="track-menu-separator" />
          <Menu.Item className="track-menu-item" onSelect={onRemove}>
            <XIcon className="track-menu-icon" aria-hidden />
            {t("Remove")}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

// Open on click, not pointer down, so a swipe starting on the button scrolls.
function QueueMenuButton(props: ComponentPropsWithRef<"button">) {
  return <button {...props} onPointerDown={undefined} />;
}

/** Return "next", "second", and so on, for a place in what plays next. */
function ordinal(place: number, t: Words): string {
  const labels = ["next", "second", "third", "fourth", "fifth"];
  const label = labels[place];
  return label === undefined ? t("at place {{place}}", { place: place + 1 }) : t(label);
}
