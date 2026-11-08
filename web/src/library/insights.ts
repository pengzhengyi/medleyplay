/**
 * @file Insights: what the Account listened to most, worked out from its plays.
 *
 * Listening time is an estimate: each play counts the song's whole length, since
 * a play is recorded once half the song, or four minutes, has played. A whole
 * album in one file counts its plays but not its length, which would overstate
 * the time many times over. Artists and albums group as the Library's views do.
 */

import type { Track } from "../api";
import { albumArtistOf, fold } from "./views";

/** How often each Track was played over a period, by its id. */
export type PlayCounts = ReadonlyMap<number, number>;

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
  /** The plays with no time counted: of whole albums, or of songs of unknown length. */
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

/** Return each played Track's own count of plays, which covers all time. */
export function allTimePlays(tracks: readonly Track[]): PlayCounts {
  return new Map(
    tracks.filter((track) => track.play_count > 0).map((track) => [track.id, track.play_count]),
  );
}

/** Return what `counts` say the Account listened to among `tracks`. */
export function insightsOf(tracks: readonly Track[], counts: PlayCounts): Insights {
  const artists = new Map<string, Listened>();
  const albums = new Map<string, Listened>();
  const topSongs: SongPlays[] = [];
  let plays = 0;
  let listenedMs = 0;
  let playsNotTimed = 0;
  for (const track of tracks) {
    const played = counts.get(track.id) ?? 0;
    if (played === 0) {
      continue;
    }
    const timed = track.kind === "song" && track.duration_ms !== null;
    const listened = timed ? played * track.duration_ms : 0;
    plays += played;
    listenedMs += listened;
    playsNotTimed += timed ? 0 : played;
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
