/**
 * @file Insights: what the Account listened to most, worked out from its plays.
 *
 * Listening time is what the page measured of each play. A play recorded before
 * pages measured counts its song's whole length; a whole album in one file, or a
 * song of unknown length, then counts its play but no time, since its length
 * would overstate the time many times over. Artists and albums group as the
 * Library's views do.
 */

import type { Track } from "../api";
import { albumArtistOf, fold } from "./views";

/** How often and how long a Track was played over a period. */
export interface Played {
  readonly plays: number;
  /** The measured time of `timedPlays` of the plays. */
  readonly listenedMs: number;
  readonly timedPlays: number;
}

/** How often and how long each Track was played over a period, by its id. */
export type PlayCounts = ReadonlyMap<number, Played>;

/** An artist or an album, with how often and about how long it was listened to. */
export interface Listened {
  /** The name as the first of its Tracks writes it. */
  readonly name: string;
  /** For an album, its album artist, or its artist when that is blank; `""` for an artist. */
  readonly artist: string;
  /** The first cover among its Tracks. */
  readonly cover: string | null;
  readonly plays: number;
  readonly listenedMs: number;
}

/** A song, with how often and about how long it was listened to. */
export interface SongPlays {
  readonly track: Track;
  readonly plays: number;
  readonly listenedMs: number;
}

/** What the Account listened to over a period, the most listened first. */
export interface Insights {
  readonly plays: number;
  readonly listenedMs: number;
  /** The plays from before pages measured counted at their song's whole length. */
  readonly playsEstimated: number;
  /** The plays from before pages measured with no time: of whole albums, or of unknown length. */
  readonly playsNotTimed: number;
  /** How many songs were played. */
  readonly songs: number;
  /** Every named artist played, the most listened first. */
  readonly artists: readonly Listened[];
  /** Every named album played, the most listened first. */
  readonly albums: readonly Listened[];
  /** Every song played, the most played first. */
  readonly topSongs: readonly SongPlays[];
}

/** Return what `counts` say the Account listened to among `tracks`. */
export function insightsOf(tracks: readonly Track[], counts: PlayCounts): Insights {
  const artists = new Map<string, Listened>();
  const albums = new Map<string, Listened>();
  const topSongs: SongPlays[] = [];
  let plays = 0;
  let listenedMs = 0;
  let playsEstimated = 0;
  let playsNotTimed = 0;
  for (const track of tracks) {
    const count = counts.get(track.id);
    const played = count?.plays ?? 0;
    if (count === undefined || played === 0) {
      continue;
    }
    const unmeasured = played - count.timedPlays;
    const estimable = track.kind === "song" && track.duration_ms !== null;
    const listened = count.listenedMs + (estimable ? unmeasured * track.duration_ms : 0);
    plays += played;
    listenedMs += listened;
    playsEstimated += estimable ? unmeasured : 0;
    playsNotTimed += estimable ? 0 : unmeasured;
    if (track.kind === "song") {
      topSongs.push({ track, plays: played, listenedMs: listened });
    }
    if (track.artist !== "") {
      add(artists, fold(track.artist), { name: track.artist, artist: "" }, track, played, listened);
    }
    if (track.album !== "") {
      const artist = albumArtistOf(track);
      const key = `${fold(artist)}\n${fold(track.album)}`;
      add(albums, key, { name: track.album, artist }, track, played, listened);
    }
  }
  return {
    plays,
    listenedMs,
    playsEstimated,
    playsNotTimed,
    songs: topSongs.length,
    artists: [...artists.values()].sort(byListened),
    albums: [...albums.values()].sort(byListened),
    topSongs: topSongs.sort((a, b) => b.plays - a.plays || b.listenedMs - a.listenedMs),
  };
}

/** Add a Track's plays to its group under `key`, starting the group with `names` if new. */
function add(
  groups: Map<string, Listened>,
  key: string,
  names: Pick<Listened, "name" | "artist">,
  track: Track,
  plays: number,
  listenedMs: number,
): void {
  const cover = track.cover === "" ? null : track.cover;
  const group = groups.get(key);
  groups.set(
    key,
    group === undefined
      ? { ...names, cover, plays, listenedMs }
      : {
          ...group,
          cover: group.cover ?? cover,
          plays: group.plays + plays,
          listenedMs: group.listenedMs + listenedMs,
        },
  );
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function byListened(a: Listened, b: Listened): number {
  return b.listenedMs - a.listenedMs || b.plays - a.plays || collator.compare(a.name, b.name);
}
