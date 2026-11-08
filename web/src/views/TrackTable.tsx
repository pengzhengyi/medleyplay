/**
 * @file The song table: Tracks to sort, rate, and play, drawing only the rows on screen.
 *
 * The one module that knows TanStack Table and TanStack Virtual; the rest of the
 * client hands it Tracks and callbacks. Rows above and below the screen are
 * spacer rows hidden from screen readers, while `aria-rowcount` and
 * `aria-rowindex` count every Track.
 *
 * Given the songs of each split file, it is the Library: each item a row, a split
 * file's songs folded under it, and Play and Shuffle offering to play by album or
 * by song too.
 */

import {
  CaretDownIcon,
  CaretRightIcon,
  CaretUpIcon,
  HeartIcon,
  ListPlusIcon,
  MusicNoteSimpleIcon,
  PlayIcon,
  QueueIcon,
  ShuffleIcon,
  SlidersHorizontalIcon,
  StarIcon,
  VinylRecordIcon,
} from "@phosphor-icons/react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnSizingState,
  type ColumnVisibilityState,
  type ExpandedState,
  type FilterFn,
  type GroupingState,
  type Row,
  columnFacetingFeature,
  columnFilteringFeature,
  columnGroupingFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createExpandedRowModel,
  createFacetedRowModel,
  createFilteredRowModel,
  createGroupedRowModel,
  createSortedRowModel,
  rowExpandingFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";

import type { CommunityRating, Track } from "../api";
import { formatTime } from "../format";
import type { CoverStatus } from "../library/lookups";
import { albumUnit, byAlbum, bySong, fileUnit, inLibraryOrder } from "../library/playOrder";
import type { UnitOf } from "../player/usePlayer";
import { Cover } from "./Cover";
import {
  type Choice,
  type ChoiceField,
  type FilterField,
  type Filters,
  FiltersOn,
  SongFilters,
} from "./SongFilters";
import { KindMark } from "./KindMark";
import { MoreWays, TrackMenu, type TrackMenuActions } from "./TrackMenu";
import { STATUS_ICONS } from "./statusIcons";

/** What every cell may need: the page's callbacks, which Track is playing, and the songs of files. */
interface Meta {
  readonly actions: TrackActions;
  readonly playingId: number | undefined;
  /** In the Library, the songs of each split file; elsewhere none. */
  readonly songsIn: ReadonlyMap<number, readonly Track[]> | undefined;
}

const features = tableFeatures({
  rowSortingFeature,
  columnVisibilityFeature,
  columnSizingFeature,
  columnResizingFeature,
  columnFilteringFeature,
  columnFacetingFeature,
  columnGroupingFeature,
  rowExpandingFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  facetedRowModel: createFacetedRowModel(),
  groupedRowModel: createGroupedRowModel(),
  expandedRowModel: createExpandedRowModel(),
  tableMeta: {} as Meta,
});

type Column = ColumnDef<typeof features, Track>;

const WHY: Record<string, string> = {
  offline: "Drive unplugged",
  waiting_online: "When online",
  unavailable: "Unavailable",
  missing: "Missing",
  cant_play: "Can't play",
};

const STARS = [1, 2, 3, 4, 5] as const;
// A row with its cover, as measured; rows are measured once on screen.
const ROW_HEIGHT = 54;
const SAVED = "medleyplay.columns.v1";

/** Compare as people read names: by locale, numbers in order, ignoring case. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const byText = (a: Row<typeof features, Track>, b: Row<typeof features, Track>, id: string) =>
  collator.compare(a.getValue<string>(id), b.getValue<string>(id));
const byNumber = (a: Row<typeof features, Track>, b: Row<typeof features, Track>, id: string) =>
  (a.getValue<number | null>(id) ?? -1) - (b.getValue<number | null>(id) ?? -1);
/** Your own rating first; the songs you haven't rated by what listeners elsewhere did, below any of yours. */
const ratingKey = (track: Track) =>
  track.rating ?? (track.community === null ? -2 : track.community.rating / 10 - 1);
const byRating = (a: Row<typeof features, Track>, b: Row<typeof features, Track>) =>
  ratingKey(a.original) - ratingKey(b.original);

/** Each site that rates songs, as the page names it. */
const SOURCES: Readonly<Record<string, string>> = { musicbrainz: "MusicBrainz" };

/** How a rating from elsewhere reads: `MusicBrainz: 3.7 from 24 votes`, saying when it is the album's. */
function heardFrom(community: CommunityRating): string {
  const site = SOURCES[community.source] ?? community.source;
  const who = community.of === "album" ? `${site}, the album` : site;
  const rating = (Math.round(community.rating * 10) / 10).toFixed(1);
  return `${who}: ${rating} from ${String(community.votes)} votes`;
}

/** How much of the star `stars` a rating from elsewhere fills, to the nearest half. */
function partOf(rating: number, stars: number): "full" | "half" | "none" {
  const halves = Math.round(rating * 2) / 2;
  return halves >= stars ? "full" : halves >= stars - 0.5 ? "half" : "none";
}

type TrackFilter = FilterFn<typeof features, Track>;

/** A genre such as `alternative rock; britpop` is each of its parts. */
const genresOf = (genre: string): string[] =>
  genre
    .split(/[;,/]/u)
    .map((part) => part.trim())
    .filter((part) => part !== "");

const isText: TrackFilter = (row, id, value) => row.getValue<string>(id) === value;
const hasGenre: TrackFilter = (row, id, value) =>
  genresOf(row.getValue<string>(id)).includes(String(value));
const isYear: TrackFilter = (row, id, value) =>
  String(row.getValue<number | null>(id) ?? "") === value;
const isRated: TrackFilter = (row, id, value) => {
  const rating = row.getValue<number | null>(id);
  return value === "unrated" ? rating === null : rating !== null && rating >= Number(value);
};
const isOn: TrackFilter = (row, id) =>
  row.getValue<number | boolean>(id) === 1 || row.getValue(id) === true;

/** The columns a filter of the panel works on. */
const FILTER_COLUMNS: Record<FilterField, string> = {
  kind: "kind",
  artist: "artist",
  album: "album",
  genre: "genre",
  year: "year",
  rating: "rating",
  favorite: "favorite",
  playable: "playable",
};

/** What the table can be grouped by, as the Group by control names it. */
const GROUP_BY: readonly { id: string; label: string }[] = [
  { id: "album", label: "Album" },
  { id: "artist", label: "Artist" },
  { id: "album_artist", label: "Album artist" },
  { id: "year", label: "Year" },
  { id: "genre", label: "Genre" },
];

const albumArtistOf = (track: Track): string => track.album_artist || track.artist;

/** How a group's row names it, from its first song: `生如夏花 · 朴树`. */
function groupName(by: string, track: Track): string {
  switch (by) {
    case "album":
      return `${track.album || "No album"} · ${albumArtistOf(track) || "No artist"}`;
    case "artist":
      return track.artist || "No artist";
    case "album_artist":
      return albumArtistOf(track) || "No artist";
    case "year":
      return track.year === null ? "No year" : String(track.year);
    default:
      return track.genre || "No genre";
  }
}

const songs = (count: number) => (count === 1 ? "1 song" : `${String(count)} songs`);

const filtersOf = (state: ColumnFiltersState): Filters =>
  Object.fromEntries(
    (Object.entries(FILTER_COLUMNS) as [FilterField, string][]).flatMap(([field, column]) => {
      const found = state.find((each) => each.id === column);
      return found === undefined ? [] : [[field, found.value]];
    }),
  );

/** What the table does when a Track is chosen, queued, rated, or added to a Playlist. */
export interface TrackActions extends TrackMenuActions {
  /** Play `shown`, the Tracks in the order the table shows them, from its entry `index`. */
  readonly onPlay: (shown: readonly Track[], index: number, unitOf?: UnitOf) => void;
  /** Play every Track of `playable` from the first, in the table's order or shuffled. */
  readonly onPlayAll: (playable: readonly Track[], shuffled: boolean, unitOf?: UnitOf) => void;
  readonly onFavorite: (track: Track, favorite: boolean) => void;
  readonly onRate: (track: Track, rating: number | null) => void;
  /** What the Track's cover shows of a lookup asked about it, if any. */
  readonly statusOf: (track: Track) => CoverStatus | undefined;
}

/** The columns a browser shows and their widths, as it last left them. */
interface Layout {
  readonly visibility: ColumnVisibilityState;
  readonly sizing: ColumnSizingState;
}

const DEFAULT_LAYOUT: Layout = {
  visibility: { plays: false, added: false, album_artist: false, year: false, genre: false },
  sizing: {},
};
// A column only filters and groups read; it is never shown.
const NEVER_SHOWN: ColumnVisibilityState = { playable: false, kind: false };

function savedLayout(): Layout {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SAVED) ?? "null");
    if (typeof saved === "object" && saved !== null && "visibility" in saved && "sizing" in saved) {
      return saved as Layout;
    }
  } catch {
    // A layout this browser can't read or keep starts from the default.
  }
  return DEFAULT_LAYOUT;
}

function saveLayout(layout: Layout): void {
  try {
    localStorage.setItem(SAVED, JSON.stringify(layout));
  } catch {
    // Best effort: the next visit starts from the default.
  }
}

/**
 * Tracks in a table; with no Tracks, `empty` shows instead. Given `songsIn`, the songs
 * of each split file, it is the Library: `tracks` are its items.
 */
export function TrackTable({
  tracks,
  playingId,
  empty,
  actions,
  songsIn,
}: {
  readonly tracks: readonly Track[];
  readonly playingId: number | undefined;
  readonly empty: ReactNode;
  readonly actions: TrackActions;
  readonly songsIn?: ReadonlyMap<number, readonly Track[]> | undefined;
}) {
  const [layout, setLayout] = useState(savedLayout);
  useEffect(() => {
    saveLayout(layout);
  }, [layout]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [grouping, setGrouping] = useState<GroupingState>([]);
  // Groups open when made; a split file's songs stay folded until asked for.
  const folded: ExpandedState = songsIn === undefined ? true : {};
  const [expanded, setExpanded] = useState<ExpandedState>(folded);
  // Grouped, the Library lists every song in its split file's place, as other tables do.
  const nested = songsIn !== undefined && grouping.length === 0;
  const data = useMemo(
    () => (songsIn === undefined || nested ? tracks : inLibraryOrder(tracks, songsIn)),
    [tracks, songsIn, nested],
  );

  const table = useTable({
    features,
    columns: COLUMNS,
    // The columns stay put, so a new callback or Track playing doesn't sort again.
    meta: { actions, playingId, songsIn: nested ? songsIn : undefined },
    data,
    // Grouped, `data` holds no split file, so no row has songs under it.
    getSubRows: (track) => (track.split ? songsIn?.get(track.id) : undefined),
    // A split file stays while a filter keeps any of its songs, showing only those.
    filterFromLeafRows: nested,
    // A Playlist may hold a Track twice, so a row is a Track at its place.
    getRowId: (track, index) => `${String(track.id)}:${String(index)}`,
    enableMultiSort: false,
    columnResizeMode: "onChange",
    // A grouped column stays where it is, rather than moving first.
    groupedColumnMode: false,
    // Groups open when made; choosing another grouping opens them all again.
    autoResetExpanded: false,
    state: {
      columnVisibility: { ...DEFAULT_LAYOUT.visibility, ...layout.visibility, ...NEVER_SHOWN },
      columnSizing: layout.sizing,
      columnFilters,
      grouping,
      expanded,
    },
    onColumnFiltersChange: setColumnFilters,
    onGroupingChange: setGrouping,
    onExpandedChange: setExpanded,
    onColumnVisibilityChange: (change) => {
      setLayout((now) => ({
        ...now,
        visibility: typeof change === "function" ? change(now.visibility) : change,
      }));
    },
    onColumnSizingChange: (change) => {
      setLayout((now) => ({
        ...now,
        sizing: typeof change === "function" ? change(now.sizing) : change,
      }));
    },
  });

  const rows = table.getRowModel().rows;
  // The rows scroll with the page, so the virtualizer needs where they start on it.
  const body = useRef<HTMLTableSectionElement>(null);
  const [top, setTop] = useState(0);
  useEffect(() => {
    const element = body.current;
    if (element === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      setTop(element.getBoundingClientRect().top + window.scrollY);
    });
    observer.observe(document.body);
    return () => {
      observer.disconnect();
    };
  }, []);
  const virtual = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    scrollMargin: top,
  });
  const items = virtual.getVirtualItems();
  const before = (items[0]?.start ?? top) - top;
  const after = virtual.getTotalSize() - ((items.at(-1)?.end ?? top) - top);
  // A spacer row has a cell per column, so a column the layout hides goes from it too.
  const columns = table.getVisibleLeafColumns().map((column) => column.id);
  const queue = queueOf(table);
  const playable = queue.filter((track) => track.availability === "ok");
  const unitOf = songsIn === undefined ? undefined : fileUnit;
  const playAll = (list: readonly Track[], shuffled: boolean, unit?: UnitOf) => {
    if (unit === undefined) {
      actions.onPlayAll(list, shuffled);
    } else {
      actions.onPlayAll(list, shuffled, unit);
    }
  };
  const ways = (shuffled: boolean) => {
    const verb = shuffled ? "Shuffle" : "Play";
    return [
      {
        label: `${verb} by album`,
        icon: <VinylRecordIcon />,
        onSelect: () => {
          playAll(byAlbum(playable), shuffled, albumUnit);
        },
      },
      {
        label: `${verb} by song`,
        icon: <MusicNoteSimpleIcon />,
        onSelect: () => {
          playAll(bySong(playable), shuffled);
        },
      },
    ];
  };
  const filters = filtersOf(columnFilters);
  const choices = choicesOf(table);
  const setFilter = (field: FilterField, value: Filters[FilterField]) => {
    table.getColumn(FILTER_COLUMNS[field])?.setFilterValue(value);
  };
  const by = grouping[0] ?? "";

  if (tracks.length === 0) {
    return <>{empty}</>;
  }
  return (
    <>
      <div className="table-tools">
        <div className="play-all">
          <span className={songsIn === undefined ? undefined : "split-button"}>
            <button
              type="button"
              aria-label="Play all"
              disabled={playable.length === 0}
              onClick={() => {
                playAll(playable, false, unitOf);
              }}
            >
              <PlayIcon weight="fill" aria-hidden />
              Play
            </button>
            {songsIn !== undefined && (
              <MoreWays
                label="More ways to play"
                ways={ways(false)}
                disabled={playable.length === 0}
              />
            )}
          </span>
          <span className={songsIn === undefined ? undefined : "split-button secondary"}>
            <button
              type="button"
              className="secondary"
              aria-label="Shuffle all"
              disabled={playable.length === 0}
              onClick={() => {
                playAll(playable, true, unitOf);
              }}
            >
              <ShuffleIcon weight="bold" aria-hidden />
              Shuffle
            </button>
            {songsIn !== undefined && (
              <MoreWays
                label="More ways to shuffle"
                ways={ways(true)}
                disabled={playable.length === 0}
              />
            )}
          </span>
        </div>
        <details className="dropdown columns-menu">
          <summary>
            <SlidersHorizontalIcon weight="regular" aria-hidden />
            Columns
          </summary>
          <ul>
            {table
              .getAllLeafColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <li key={column.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={column.getIsVisible()}
                      onChange={column.getToggleVisibilityHandler()}
                    />
                    {LABELS[column.id]}
                  </label>
                </li>
              ))}
          </ul>
        </details>
        <SongFilters filters={filters} choices={choices} onChange={setFilter} />
        <label className="group-by">
          Group by
          <select
            className="group-by-select"
            value={by}
            onChange={(event) => {
              setExpanded(event.target.value === "" ? folded : true);
              setGrouping(event.target.value === "" ? [] : [event.target.value]);
            }}
          >
            <option value="">None</option>
            {GROUP_BY.map((each) => (
              <option key={each.id} value={each.id}>
                {each.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <FiltersOn
        filters={filters}
        shown={table.getFilteredRowModel().rows.length}
        total={tracks.length}
        counted={songsIn === undefined ? "songs" : "songs and albums"}
        onRemove={(field) => {
          setFilter(field, undefined);
        }}
        onClear={() => {
          setColumnFilters([]);
        }}
      />
      <table className="tracks" aria-rowcount={rows.length + 1}>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} aria-rowindex={1}>
              {group.headers.map((header) => {
                const { column } = header;
                const sorted = column.getIsSorted();
                const label = LABELS[column.id] ?? "";
                return (
                  <th
                    key={header.id}
                    scope="col"
                    className={column.id}
                    style={column.id in layout.sizing ? { width: header.getSize() } : undefined}
                    aria-sort={
                      sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined
                    }
                  >
                    {column.getCanSort() ? (
                      <button
                        type="button"
                        className="sort"
                        onClick={column.getToggleSortingHandler()}
                      >
                        {HIDDEN_LABELS.has(column.id) ? (
                          <span className="visually-hidden">{label}</span>
                        ) : (
                          label
                        )}
                        {sorted === "asc" && <CaretUpIcon weight="bold" aria-hidden />}
                        {sorted === "desc" && <CaretDownIcon weight="bold" aria-hidden />}
                      </button>
                    ) : (
                      <span className="visually-hidden">{label}</span>
                    )}
                    {column.getCanResize() && (
                      <div
                        className={column.getIsResizing() ? "resizer resizing" : "resizer"}
                        // A pointer's or a finger's handle; the Columns menu is for everyone.
                        aria-hidden
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() => {
                          column.resetSize();
                        }}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody ref={body}>
          {before > 0 && (
            <tr aria-hidden className="spacer">
              {columns.map((id) => (
                <td key={id} className={id} style={{ height: before }} />
              ))}
            </tr>
          )}
          {items.map((item) => {
            const row = rows[item.index];
            if (row === undefined) {
              return null;
            }
            const track = row.original;
            if (row.getIsGrouped()) {
              return (
                <tr
                  key={row.id}
                  ref={virtual.measureElement}
                  data-index={item.index}
                  aria-rowindex={item.index + 2}
                  className="group"
                >
                  {columns.map((id) =>
                    id === "title" ? (
                      <th key={id} scope="rowgroup" className={`${id} group-cell`}>
                        <button
                          type="button"
                          className="group-toggle"
                          aria-expanded={row.getIsExpanded()}
                          onClick={row.getToggleExpandedHandler()}
                        >
                          {row.getIsExpanded() ? (
                            <CaretDownIcon weight="bold" aria-hidden />
                          ) : (
                            <CaretRightIcon weight="bold" aria-hidden />
                          )}
                          {`${groupName(by, track)} · ${songs(row.getLeafRows().length)}`}
                        </button>
                      </th>
                    ) : (
                      // A cell per column, as a spacer row has, so a column hidden by width goes too.
                      <td key={id} className={`${id} group-cell`} />
                    ),
                  )}
                </tr>
              );
            }
            return (
              <tr
                key={row.id}
                ref={virtual.measureElement}
                data-index={item.index}
                aria-rowindex={item.index + 2}
                className={
                  [row.depth > 0 ? "child" : "", track.availability === "ok" ? "" : "unplayable"]
                    .join(" ")
                    .trim() || undefined
                }
                aria-current={track.id === playingId ? "true" : undefined}
                // A click on the row plays its song, as its title does; the title stays the
                // control for the keyboard and screen readers.
                onClick={(event) => {
                  const target = event.target as Element;
                  if (
                    track.availability !== "ok" ||
                    // A menu or dialog the row opens is elsewhere on the page.
                    !event.currentTarget.contains(target) ||
                    target.closest(OWN_CONTROLS) !== null ||
                    // A click that ends selecting text is for the text.
                    (window.getSelection()?.toString() ?? "") !== ""
                  ) {
                    return;
                  }
                  playFrom(table, row);
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className={cell.column.id}>
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            );
          })}
          {after > 0 && (
            <tr aria-hidden className="spacer">
              {columns.map((id) => (
                <td key={id} className={id} style={{ height: after }} />
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

const LABELS: Record<string, string> = {
  favorite: "Favorite",
  title: "Title",
  artist: "Artist",
  album: "Album",
  album_artist: "Album artist",
  year: "Year",
  genre: "Genre",
  time: "Time",
  rating: "Rating",
  plays: "Plays",
  added: "Added",
  actions: "Actions",
};

/** Columns whose header shows an icon's worth of room, so their name is for screen readers. */
const HIDDEN_LABELS = new Set(["favorite"]);

const added = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

const meta = (table: { readonly options: { readonly meta?: Meta } }): Meta => {
  const found = table.options.meta;
  if (found === undefined) {
    throw new Error("The song table's cells need its meta.");
  }
  return found;
};

type SongRow = Row<typeof features, Track>;

interface Rows {
  readonly rows: readonly SongRow[];
}

/** What `playFrom` and `queueOf` read of the table. */
interface Played {
  readonly options: { readonly meta?: Meta };
  readonly getRowModel: () => Rows;
  readonly getPreExpandedRowModel: () => Rows;
}

/**
 * Return the Tracks the table plays, in its order. In the Library, a split file plays
 * as its songs the filters keep, in their own order, whether shown or folded away.
 */
function queueOf(table: Played): Track[] {
  const { songsIn } = meta(table);
  if (songsIn === undefined) {
    // A group's row is no song; the songs are the rows shown under the groups.
    return table
      .getRowModel()
      .rows.filter((each) => !each.getIsGrouped())
      .map((each) => each.original);
  }
  return table.getPreExpandedRowModel().rows.flatMap((row) => {
    if (!row.original.split) {
      return [row.original];
    }
    const songs = songsIn.get(row.original.id) ?? [];
    // A file the filters keep for itself, as an album, plays as all its songs.
    if (row.subRows.length === 0) {
      return songs;
    }
    const kept = new Set(row.subRows.map((song) => song.original.id));
    return songs.filter((song) => kept.has(song.id));
  });
}

/** Play `row`'s song, or a split file's first song, with the Tracks the table plays around it. */
function playFrom(table: Played, row: SongRow) {
  const { actions, songsIn } = meta(table);
  const queue = queueOf(table);
  const chosen = row.original;
  const index = chosen.split
    ? queue.findIndex((song) => song.segment_of === chosen.id)
    : queue.indexOf(chosen);
  if (songsIn === undefined) {
    actions.onPlay(queue, index);
  } else {
    actions.onPlay(queue, index, fileUnit);
  }
}

/** What on a row does its own thing when clicked, rather than playing the row's song. */
const OWN_CONTROLS = "button, a, input, select, textarea, label, summary, .stars";

const COLUMNS: Column[] = [
  {
    id: "favorite",
    accessorFn: (track) => (track.favorite ? 1 : 0),
    sortFn: byNumber,
    filterFn: isOn,
    sortDescFirst: true,
    enableResizing: false,
    cell: ({ row: { original: track }, table }) => (
      <button
        type="button"
        className={track.favorite ? "icon heart on" : "icon heart"}
        aria-label={`Favorite ${track.title}`}
        aria-pressed={track.favorite}
        title={track.favorite ? "Favorite" : "Not a favorite"}
        onClick={() => {
          meta(table).actions.onFavorite(track, !track.favorite);
        }}
      >
        <HeartIcon weight={track.favorite ? "fill" : "regular"} aria-hidden />
      </button>
    ),
  },
  {
    id: "title",
    accessorKey: "title",
    sortFn: byText,
    enableHiding: false,
    enableResizing: false,
    cell: ({ row, table }) => {
      const track = row.original;
      const playable = track.availability === "ok";
      const { actions, playingId } = meta(table);
      const nestedHere = meta(table).songsIn !== undefined;
      return (
        <div className={row.depth > 0 ? "title-cell child" : "title-cell"}>
          {nestedHere && row.depth === 0 && (
            <span className="fold-slot">
              {row.getCanExpand() && (
                <button
                  type="button"
                  className="icon fold"
                  aria-expanded={row.getIsExpanded()}
                  aria-label={`${row.getIsExpanded() ? "Hide" : "Show"} the songs of ${track.title}`}
                  title={row.getIsExpanded() ? "Hide its songs" : "Show its songs"}
                  onClick={row.getToggleExpandedHandler()}
                >
                  <CaretRightIcon className="fold-caret" weight="bold" aria-hidden />
                </button>
              )}
            </span>
          )}
          <span className="thumb-frame">
            <Cover cover={track.cover} className="thumb" />
            <CoverBadge status={actions.statusOf(track)} playing={track.id === playingId} />
          </span>
          <KindMark kind={track.kind} reason={track.kind_reason} />
          <button
            type="button"
            className="title"
            onClick={() => {
              playFrom(table, row);
            }}
            disabled={!playable}
          >
            {track.title}
          </button>
          {!playable && <span className="why">{WHY[track.availability]}</span>}
          {track.download_failed && (
            <span className="why failed">
              Download failed
              <button
                type="button"
                className="add-file-link"
                onClick={() => {
                  actions.onAddFile(track);
                }}
              >
                Add the file…
              </button>
            </span>
          )}
          <span className="subtitle" aria-hidden>
            {track.artist}
          </span>
        </div>
      );
    },
  },
  { id: "artist", accessorKey: "artist", sortFn: byText, filterFn: isText, size: 200, minSize: 80 },
  {
    id: "album",
    accessorKey: "album",
    sortFn: byText,
    filterFn: isText,
    // Two albums of one name by two artists are two groups.
    getGroupingValue: (track) => `${track.album}\u001f${albumArtistOf(track)}`,
    size: 200,
    minSize: 80,
  },
  {
    id: "album_artist",
    accessorFn: albumArtistOf,
    sortFn: byText,
    size: 200,
    minSize: 80,
  },
  {
    id: "year",
    accessorKey: "year",
    sortFn: byNumber,
    sortDescFirst: false,
    filterFn: isYear,
    enableResizing: false,
  },
  { id: "genre", accessorKey: "genre", sortFn: byText, filterFn: hasGenre, size: 160, minSize: 80 },
  {
    id: "time",
    accessorKey: "duration_ms",
    sortFn: byNumber,
    sortDescFirst: false,
    enableResizing: false,
    cell: (info) => formatTime((info.getValue<number | null>() ?? 0) / 1000),
  },
  {
    id: "rating",
    accessorKey: "rating",
    sortFn: byRating,
    filterFn: isRated,
    sortDescFirst: false,
    enableResizing: false,
    cell: ({ row: { original: track }, table }) => (
      <RatingStars track={track} onRate={meta(table).actions.onRate} />
    ),
  },
  {
    id: "plays",
    accessorKey: "play_count",
    sortFn: byNumber,
    sortDescFirst: false,
    enableResizing: false,
  },
  {
    id: "added",
    accessorFn: (track) => Date.parse(track.added_at),
    sortFn: byNumber,
    sortDescFirst: false,
    enableResizing: false,
    cell: (info) => added.format(info.getValue<number>()),
  },
  {
    id: "playable",
    accessorFn: (track) => track.availability === "ok",
    filterFn: isOn,
    enableSorting: false,
    enableHiding: false,
  },
  {
    id: "kind",
    accessorKey: "kind",
    filterFn: isText,
    enableSorting: false,
    enableHiding: false,
  },
  {
    id: "actions",
    enableSorting: false,
    enableHiding: false,
    enableResizing: false,
    cell: ({ row: { original: track }, table }) => {
      const playable = track.availability === "ok";
      const { actions } = meta(table);
      return (
        <>
          <button
            type="button"
            className="icon"
            onClick={() => {
              actions.onPlayNext(track);
            }}
            disabled={!playable}
            aria-label={`Play ${track.title} next`}
            title="Play next"
          >
            <QueueIcon weight="light" aria-hidden />
          </button>
          <button
            type="button"
            className="icon"
            onClick={() => {
              actions.onAdd(track);
            }}
            disabled={!playable}
            aria-label={`Add ${track.title} to the queue`}
            title="Add to the queue"
          >
            <ListPlusIcon weight="light" aria-hidden />
          </button>
          <TrackMenu track={track} actions={actions} queueing />
        </>
      );
    },
  },
];

/**
 * What lies over a song's cover: a lookup asked about it, or else bars while it plays,
 * so the title beside the cover never moves.
 */
function CoverBadge({
  status,
  playing,
}: {
  readonly status: CoverStatus | undefined;
  readonly playing: boolean;
}) {
  if (status !== undefined) {
    return (
      <span
        className={`cover-badge ${status.kind}`}
        role="img"
        aria-label={status.label}
        title={status.label}
      >
        {STATUS_ICONS[status.kind]}
      </span>
    );
  }
  return playing ? (
    <span className="cover-badge" role="img" aria-label="Playing" title="Playing">
      <span className="bars" aria-hidden />
    </span>
  ) : null;
}

type Table = ReturnType<typeof useTable<typeof features, Track>>;

/** Each filter's choices, from the songs the other filters keep, each with its count. */
function choicesOf(table: Table): Record<ChoiceField, Choice[]> {
  const count = (column: string, valuesOf: (track: Track) => readonly string[]) => {
    const counts = new Map<string, number>();
    for (const row of table.getColumn(column)?.getFacetedRowModel().rows ?? []) {
      for (const value of valuesOf(row.original)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    return [...counts].map(([value, n]) => ({ value, label: value, count: n }));
  };
  // The songs of a split file count too, as a filter keeps them under their file.
  const countAll = (column: string, valueOf: (track: Track) => string) => {
    const counts = new Map<string, number>();
    for (const row of table.getColumn(column)?.getFacetedRowModel().flatRows ?? []) {
      const value = valueOf(row.original);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts].map(([value, n]) => ({ value, label: value, count: n }));
  };
  const byLabel = (a: Choice, b: Choice) => collator.compare(a.label, b.label);
  return {
    kind: countAll("kind", (track) => track.kind)
      .map((choice) => ({ ...choice, label: choice.value === "album" ? "Albums" : "Songs" }))
      .sort((a, b) => Number(a.value === "album") - Number(b.value === "album")),
    artist: count("artist", (track) => (track.artist ? [track.artist] : [])).sort(byLabel),
    album: count("album", (track) => (track.album ? [track.album] : [])).sort(byLabel),
    genre: count("genre", (track) => genresOf(track.genre)).sort(byLabel),
    year: count("year", (track) => (track.year === null ? [] : [String(track.year)])).sort(
      (a, b) => Number(b.value) - Number(a.value),
    ),
  };
}

/**
 * The stars of `track`: your own rating, solid; else what listeners elsewhere rated it,
 * outlined to the nearest half. Choosing a star rates the song yourself.
 */
function RatingStars({
  track,
  onRate,
}: {
  readonly track: Track;
  readonly onRate: (track: Track, rating: number | null) => void;
}) {
  const heard = track.rating === null ? track.community : null;
  const said = heard === null ? undefined : heardFrom(heard);
  const saying = useId();
  return (
    <fieldset
      className={heard === null ? "stars" : "stars heard"}
      title={said}
      aria-describedby={said === undefined ? undefined : saying}
    >
      <legend className="visually-hidden">Rate {track.title}</legend>
      {said !== undefined && (
        <span id={saying} className="visually-hidden">
          {said}
        </span>
      )}
      {STARS.map((stars) => {
        const part = heard === null ? undefined : partOf(heard.rating, stars);
        return (
          <button
            key={stars}
            type="button"
            className="icon star"
            aria-label={stars === 1 ? "1 star" : `${String(stars)} stars`}
            aria-pressed={track.rating === stars}
            data-community={part}
            onClick={() => {
              onRate(track, track.rating === stars ? null : stars);
            }}
          >
            <span className="star-shape" aria-hidden>
              <StarIcon
                weight={
                  track.rating !== null && stars <= track.rating
                    ? "fill"
                    : part === "full"
                      ? "duotone"
                      : "light"
                }
              />
              {part === "half" && <StarIcon className="star-half" weight="duotone" />}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}
