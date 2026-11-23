/**
 * @file A stand-in for the server: `fetch` answered from a table of routes.
 */

import { vi } from "vitest";

import type {
  LyricsFound,
  LyricsOption,
  Lyrics,
  CoverRelease,
  AlbumCovers,
  ArtistPictures,
  AiProvider,
  ArtistSuggestion,
  Account,
  ArtistName,
  ArtistNames,
  Details,
  DownloadUnderWay,
  Enricher,
  Features,
  HistoryLength,
  KnownArtist,
  LinkLookup,
  MeteredNetwork,
  Mode,
  ModeSettings,
  Played,
  Playlist,
  Preferences,
  PreferencesChange,
  Namesake,
  Role,
  Settings,
  Song,
  Songs,
  SpeakerState,
  Track,
  TrackArtist,
  TrackDownload,
  VideoText,
} from "../api";
import { HISTORY_LENGTHS } from "../api";
import { type Origins, type Values, shownOf } from "../library/details";
import { type FavoriteGroups, albumKey } from "../library/favoriteGroups";
import { fold } from "../library/views";
import { type SavedShortcuts, openAccount } from "../shortcuts";

/** An answer: a status and a JSON body. */
export interface Answer {
  readonly status?: number;
  readonly body?: unknown;
  /** Answer only once this settles, as a slow server would. */
  readonly after?: Promise<unknown>;
  /** The answer's ETag: a request holding it is answered 304, as the server does. */
  readonly etag?: string;
}

/** Routes keyed by method and path, such as `"GET /api/me"`. */
export type Routes = Record<string, Answer | ((body: unknown) => Answer)>;

/** Answer `fetch` from `routes`; any other request answers 404. Returns the calls made. */
export function serve(routes: Routes): { readonly calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (path: string, init?: RequestInit) => {
    const route = `${init?.method ?? "GET"} ${path}`;
    calls.push(route);
    const found = routes[route];
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const answer = typeof found === "function" ? found(body) : (found ?? { status: 404 });
    const held = new Headers(init?.headers).get("If-None-Match");
    const unchanged = answer.etag !== undefined && held === answer.etag;
    const status = unchanged ? 304 : (answer.status ?? 200);
    const headers: Record<string, string> = answer.etag === undefined ? {} : { ETag: answer.etag };
    return (answer.after ?? Promise.resolve()).then(
      () =>
        new Response(
          status === 204 || status === 304
            ? null
            : JSON.stringify(answer.body === undefined ? { detail: "Not Found" } : answer.body),
          { status, headers },
        ),
    );
  });
  return { calls };
}

/** Alice, the admin. */
export const ALICE: Account = { id: 1, username: "alice", display_name: "Alice", role: "admin" };

/** A Track that can play, with `title` and the id `id`. */
export function trackOf(id: number, title: string, change: Partial<Track> = {}): Track {
  return {
    id,
    title,
    artist: "The Band",
    album: "Blue",
    album_artist: "",
    track_number: null,
    disc_number: null,
    year: null,
    genre: "",
    duration_ms: 187_000,
    added_at: "2026-10-01T12:00:00Z",
    favorite: false,
    rating: null,
    play_count: 0,
    last_played_at: null,
    availability: "ok",
    downloaded: false,
    download_failed: false,
    site: null,
    video: null,
    segment_of: null,
    split: false,
    kind: "song",
    kind_reason:
      change.segment_of !== undefined && change.segment_of !== null
        ? "segment"
        : change.split === true
          ? "split"
          : "length",
    cover: null,
    community: null,
    album_rating: null,
    ...change,
    artists: change.artists ?? namesOf(change.artist ?? "The Band"),
    artist_ids:
      change.artist_ids ?? (change.artists ?? namesOf(change.artist ?? "The Band")).map(artistIdOf),
  };
}

/** The id of another artist called Jay than the name's first, as its own songs are bound. */
export const OTHER_JAY = "artist-jay-blue-night";

/** The name Jay naming two artists: the one it named first, and another, `OTHER_JAY`. */
export function twoJaysNames(): ArtistNames {
  return {
    names: [{ ...artistNameOf("Jay"), artist_ids: [artistIdOf("Jay"), OTHER_JAY] }],
    artists: [],
  };
}

/**
 * A song by each artist called Jay, the other's last:
 *
 * ```text
 * 1  星晴         Jay    on Jay           the name's first
 * 2  Blue Night   Jay    on Blue Night    OTHER_JAY
 * ```
 */
export function twoJaysSongs(): Track[] {
  return [
    trackOf(1, "星晴", { artist: "Jay", album: "Jay" }),
    trackOf(2, "Blue Night", { artist: "Jay", album: "Blue Night", artist_ids: [OTHER_JAY] }),
  ];
}

/**
 * The id of the Library's artist a name names, as the server binds a name no one linked:
 * one artist for each name, compared folded.
 */
export function artistIdOf(name: string): string {
  return `artist-${fold(name.trim())}`;
}

/** The artists a Track writing `artist` lists while its name isn't split: the name, if any. */
function namesOf(artist: string): readonly string[] {
  return artist.trim() === "" ? [] : [artist.trim()];
}

/**
 * The origins of a Bilibili album file saved under its video id, with no tags:
 *
 * ```text
 * title    file_name: "BV1dm4y1s7ak"   video: "ケビョウニンゲン"
 * artist   video: "GUMI/MAYU"
 * ```
 */
export const ALBUM_FILE_ORIGINS: Origins = {
  file_name: { title: "BV1dm4y1s7ak" },
  video: { title: "ケビョウニンゲン", artist: "GUMI/MAYU" },
};

/**
 * The origins of a tagged song on a release:
 *
 * ```text
 * files    title "Melt", album "Re:Start", album_artist "MAYU", track_number 3, year 2014
 * ```
 */
export const TAGGED_ORIGINS: Origins = {
  files: { title: "Melt", album: "Re:Start", album_artist: "MAYU", track_number: 3, year: 2014 },
  file_name: { title: "03 Melt" },
};

/**
 * A Track's details from the origins `found`, the album file's by default, with the
 * household's own values `household`, which then show as the server would show them,
 * and the video's text `videoText` the `video` values were read from.
 */
export function detailsOf(
  trackId: number,
  household: Values = {},
  found: Origins = ALBUM_FILE_ORIGINS,
  videoText: VideoText | null = null,
): Details {
  const origins = Object.keys(household).length > 0 ? { household, ...found } : found;
  const shown = shownOf(origins);
  const artist = String(shown.artist?.value ?? "").trim();
  return {
    track_id: trackId,
    shown,
    found: shownOf(found),
    origins,
    video_text: videoText,
    kind: { value: "song", reason: "length" },
    ai_answered_by: null,
    artists: artist === "" ? [] : [trackArtistOf(artist)],
    artists_chosen: false,
  };
}

/**
 * One artist a Track shows as `written`, credited as `role`, linked to none unless `linked`,
 * and the one artist going by its name unless `namesakes` go by it too.
 */
export function trackArtistOf(
  written: string,
  role: Role = "main",
  linked: TrackArtist["linked"] = null,
  namesakes: readonly Namesake[] = [],
): TrackArtist {
  return { written, role, artist_id: `artist-${written}`, linked, namesakes };
}

/**
 * Another artist going by a name, `artist-<id>`, unlinked: one song on *Blue Night* unless
 * `change` says otherwise.
 */
export function namesakeOf(id: string, change: Partial<Namesake> = {}): Namesake {
  return { artist_id: `artist-${id}`, songs: 1, albums: ["Blue Night"], linked: null, ...change };
}

/**
 * The covers of an album found on MusicBrainz: one release for each of `covers`, named
 * `Release 1`, `Release 2`, …, from 2001 on, with nothing being asked.
 */
export function albumCoversOf(
  covers: readonly string[],
  change: Partial<AlbumCovers> = {},
): AlbumCovers {
  return {
    covers: covers.map((cover, index) => ({
      release: {
        release_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        title: `Release ${String(index + 1)}`,
        artist: "",
        date: String(2001 + index),
        country: "",
        format: "CD",
        tracks: null,
      },
      cover,
    })),
    found_at: "2026-11-16T00:00:00Z",
    pick: null,
    finding: false,
    choosing: false,
    waiting: false,
    failure: null,
    choice_failure: null,
    may_choose: false,
    suggested: null,
    due: false,
    may_find: true,
    ...change,
  };
}

/** The enricher `name`, on, not stopped, asked manually, about the Tracks `eligible`. */
export function enricherOf(
  name: string,
  eligible: readonly number[] = [],
  change: Partial<Enricher> = {},
): Enricher {
  return {
    name,
    available: true,
    stopped: null,
    eligible,
    waiting: {},
    asks_again: false,
    mode: "manual",
    ...change,
  };
}

/** A server with no plugins answering any extension point, no AI provider, and one Account. */
export const NO_FEATURES: Features = { multiple_accounts: false, providers: {}, ai_set_up: false };

/** A Playlist named `name` holding the Tracks `trackIds`, in that order. */
export function playlistOf(id: string, name: string, trackIds: readonly number[]): Playlist {
  return {
    id,
    name,
    track_ids: trackIds,
    rules: null,
    keep_downloaded: false,
    unreadable: "",
    builtin: null,
    updated_at: "2026-10-01T12:00:00Z",
  };
}

/**
 * The Favorites the server keeps for every Account: the smart playlist of its
 * favorite Tracks, here holding `trackIds`.
 */
export function favoritesPlaylistOf(trackIds: readonly number[] = []): Playlist {
  return {
    ...playlistOf("f0000000-0000-4000-8000-000000000001", "Favorites", trackIds),
    rules: { version: 1, match: "all", conditions: [{ field: "favorite", op: "is", value: true }] },
    builtin: "favorites",
  };
}

/** The routes of a signed-in server holding `tracks` and `playlists`, Favorites by default. */
export function signedIn(
  tracks: readonly Track[],
  playlists: readonly Playlist[] = [favoritesPlaylistOf()],
  features: Features = NO_FEATURES,
): Routes {
  return {
    "GET /api/device": { body: { presence: "host", label: "Safari on Mac", code: null } },
    "GET /api/me": { body: ALICE },
    "GET /api/tracks": { body: tracks },
    "GET /api/playlists": { body: playlists },
    "GET /api/favorites": { body: { artists: [], albums: [] } },
    "GET /api/features": { body: features },
    "GET /api/mode": { body: modeOf() },
    "GET /api/downloads": { body: [] },
    "GET /api/links/lookups": { body: [] },
    ...preferencesOf(),
  };
}

/**
 * DeepSeek's `deepseek-flash` with a key, saved at noon, turned on, that has not failed,
 * unless `change` says otherwise.
 */
export function aiProviderOf(change: Partial<AiProvider> = {}): AiProvider {
  return {
    id: "d1",
    base_url: "https://api.deepseek.com",
    model: "deepseek-flash",
    has_key: true,
    saved_at: "2026-11-06T12:00:00Z",
    failure: null,
    failed_at: null,
    failure_reason: null,
    failure_status: null,
    enabled: true,
    ...change,
  };
}

/** The Mode: Online on the home Wi-Fi, set to Auto, unless `change` says otherwise. */
export function modeOf(change: Partial<Mode> = {}): Mode {
  return {
    setting: "auto",
    online: true,
    reason: "online",
    network: { kind: "wifi", metered_as: null, hotspot_like: false },
    since: "2026-10-27T12:00:00Z",
    checked_at: "2026-10-27T12:00:00Z",
    online_at: null,
    held_jobs: 0,
    ...change,
  };
}

/**
 * The computer playing the first of two songs, 12.5 s in, unless `change` says otherwise:
 *
 * ```json
 * {"entries": [{"key": "a", "track_id": 1}, {"key": "b", "track_id": 2}],
 *  "position": 0, "status": "playing", "seconds": 12.5, "duration": 200}
 * ```
 */
export function speakerStateOf(change: Partial<SpeakerState> = {}): SpeakerState {
  return {
    entries: [
      { key: "a", track_id: 1, unit: null },
      { key: "b", track_id: 2, unit: null },
    ],
    offset: 0,
    total: 2,
    position: 0,
    status: "playing",
    message: null,
    shuffled: false,
    repeat: "off",
    seconds: 12.5,
    duration: 200,
    volume: 0.8,
    muted: false,
    counted: false,
    play: null,
    sleep: null,
    ...change,
  };
}

/**
 * The routes of a server whose Mode is `mode`, keeping the Mode's settings as the
 * page changes them; a network marked is the one the server is on, named as sent.
 */
export function modeSettingsOf(mode: Mode, metered: readonly MeteredNetwork[] = []): Routes {
  let kept: ModeSettings = { setting: mode.setting, metered, revision: metered.length };
  const subnet = mode.network?.hotspot_like === true ? "172.20.10.0/28" : "192.168.31.0/24";
  return {
    "GET /api/mode": { body: mode },
    "GET /api/mode/settings": () => ({ body: kept }),
    "PUT /api/mode/settings": (body) => {
      const sent = body as { setting: Mode["setting"]; revision: number };
      if (sent.revision !== kept.revision) {
        return { status: 409, body: { detail: "The Mode's settings were saved since." } };
      }
      kept = { ...kept, setting: sent.setting, revision: kept.revision + 1 };
      return { body: kept };
    },
    "POST /api/mode/metered": (body) => {
      const { name } = body as { name: string };
      const id = kept.metered.length + 1;
      const network = { id, name, subnet, hotspot_like: mode.network?.hotspot_like ?? false };
      kept = { ...kept, metered: [...kept.metered, network], revision: kept.revision + 1 };
      return { body: network };
    },
    ...Object.fromEntries(
      [1, 2, 3].map((id) => [
        `DELETE /api/mode/metered/${String(id)}`,
        () => {
          kept = { ...kept, metered: kept.metered.filter((each) => each.id !== id) };
          return { status: 204 };
        },
      ]),
    ),
  };
}

/**
 * The routes of a server keeping `shortcuts` and `historyLength` for the signed-in
 * Account, which keeps what the page saves, and what it leaves out, at the next revision.
 */
export function preferencesOf(
  shortcuts: SavedShortcuts = null,
  historyLength: HistoryLength | null = null,
): Routes {
  let kept: Preferences = {
    shortcuts,
    history_length: historyLength,
    revision: shortcuts === null && historyLength === null ? 0 : 1,
  };
  return {
    "GET /api/me/preferences": () => ({ body: kept }),
    "PUT /api/me/preferences": (body) => {
      const sent = body as PreferencesChange;
      if (sent.revision !== kept.revision) {
        return { status: 409, body: { detail: "The preferences were saved since." } };
      }
      kept = {
        shortcuts: sent.shortcuts === undefined ? kept.shortcuts : sent.shortcuts,
        history_length:
          sent.history_length === undefined ? kept.history_length : sent.history_length,
        revision: sent.revision + 1,
      };
      return { body: kept };
    },
  };
}

/**
 * The routes of a server whose History for the signed-in Account holds `plays`, newest
 * first; it answers up to the length asked for, and clearing empties it.
 */
export function historyOf(plays: readonly Played[]): Routes {
  let kept = plays;
  return {
    ...Object.fromEntries(
      HISTORY_LENGTHS.map((length) => [
        `GET /api/plays?limit=${String(length)}`,
        () => ({ body: kept.slice(0, length) }),
      ]),
    ),
    "DELETE /api/plays": () => {
      kept = [];
      return { status: 204 };
    },
  };
}

/** Sign Alice's page in with `shortcuts` saved, as the Library does. */
export async function openWithShortcuts(shortcuts: SavedShortcuts): Promise<void> {
  serve(preferencesOf(shortcuts));
  await openAccount(ALICE.id);
}

/**
 * The songs of the album file `trackId`, an hour long, split into `songs` (each
 * `[id, start_ms, title]`, its Track `100 + id`), with the lists `found` for it and the
 * list an AI model `suggested`.
 */
export function splitSongsOf(
  trackId: number,
  songs: readonly (readonly [number, number, string])[],
  found: readonly (readonly Song[])[] = [],
  suggested: readonly Song[] = [],
): Songs {
  return {
    track_id: trackId,
    length_ms: 3_600_000,
    needs_check: false,
    songs: songs.map(([id, start, title], index) => ({
      id,
      track_id: 100 + id,
      start_ms: start,
      end_ms: songs[index + 1]?.[1] ?? 3_600_000,
      title,
      artist: "",
    })),
    found,
    suggested,
    suggested_by: null,
  };
}

/**
 * A video a link names that was read: *Night Drive* by Blue Room with one part, or
 * *Mixtape* with three when `parts` is 3, both addable at 192 and 64 kbps.
 */
export function lookupOf(parts = 1, change: Partial<LinkLookup> = {}): LinkLookup {
  const title = parts === 1 ? "【MV】Night Drive" : "Mixtape";
  return {
    kind: "bilibili",
    video: "BV1Xx41117Tz",
    title,
    uploader: "Blue Room",
    parts: Array.from({ length: parts }, (_, index) => ({
      part: index + 1,
      title: parts === 1 ? "Night Drive" : `Mixtape ${String(index + 1)}`,
      duration_ms: 187_000,
      track_id: null,
    })),
    qualities: [
      { id: "30280", label: "192 kbps", kbps: 192 },
      { id: "30216", label: "64 kbps", kbps: 64 },
    ],
    readable: true,
    reason: null,
    message: "",
    ...change,
  };
}

/**
 * A video that couldn't be read, for the reason `reason` and `message`: its one part is
 * the one the link named.
 */
export function unreadableLookupOf(
  message: string,
  reason: LinkLookup["reason"] = "network",
  part = 1,
): LinkLookup {
  return {
    kind: "bilibili",
    video: "BV1Xx41117Tz",
    title: "",
    uploader: "",
    parts: [{ part, title: "", duration_ms: null, track_id: null }],
    qualities: [],
    readable: false,
    reason,
    message,
  };
}

/**
 * Where a site Track's Download stands: `status`, with `message` when it has one; one
 * failed or downloading names its Job, numbered `trackId + 500`.
 */
export function downloadOf(
  trackId: number,
  status: TrackDownload["status"],
  message = "",
  link = "https://www.bilibili.com/video/BV1Xx41117Tz?p=1",
): TrackDownload {
  return {
    track_id: trackId,
    source_id: trackId + 100,
    kind: "bilibili",
    link,
    status,
    message,
    backend: status === "downloaded" ? "manual" : null,
    job_id: status === "failed" || status === "downloading" ? trackId + 500 : null,
  };
}

/**
 * Track `trackId`'s Download under way: its Job, numbered `trackId + 500`, queued and
 * waiting for nothing, unless `job` says otherwise.
 */
export function downloadUnderWayOf(
  trackId: number,
  job: Partial<DownloadUnderWay["job"]> = {},
): DownloadUnderWay {
  return {
    track_id: trackId,
    job: { id: trackId + 500, state: "queued", progress: null, waits_for_online: false, ...job },
  };
}

/** The artist MusicBrainz knows as `name` by the id `id`, before Wikidata has answered for it. */
export function knownArtistOf(
  id: string,
  name: string,
  change: Partial<KnownArtist> = {},
): KnownArtist {
  return {
    id,
    name,
    sort_name: "",
    disambiguation: "",
    country: "",
    aliases: [],
    page: null,
    photo: null,
    photo_page: null,
    shown_as: null,
    about: null,
    own_photo: false,
    ...change,
  };
}

/** What deepseek-flash suggests for The Beatles: to show them as *甲壳虫乐队*, with a note. */
export function artistSuggestionOf(change: Partial<ArtistSuggestion> = {}): ArtistSuggestion {
  return {
    shown_as: "甲壳虫乐队",
    why: "The songs are Chinese",
    about: "An English rock band from Liverpool.",
    model: "deepseek-flash",
    host: "api.deepseek.com",
    at: "2026-11-02T00:00:00Z",
    ...change,
  };
}

/** A name the Library shows by one Track, linked to `artistId` when one is given, `null` for none. */
export function artistNameOf(name: string, artistId?: string | null): ArtistName {
  return {
    name,
    key: name.toLowerCase(),
    tracks: 1,
    look_up: "yes",
    linked: artistId !== undefined,
    artist_id: artistId ?? null,
    looked_at: null,
    candidates: [],
    suggested: null,
    finding: false,
  };
}

export const VINYL: CoverRelease = {
  release_id: "0a1b2c3d-0000-4000-8000-000000001965",
  title: "Help!",
  artist: "The Beatles",
  date: "1965-08-06",
  country: "GB",
  format: '12" Vinyl',
  tracks: 14,
};
export const CD: CoverRelease = {
  ...VINYL,
  release_id: "0a1b2c3d-0000-4000-8000-000000001987",
  date: "1987-04-30",
  format: "CD",
};

/** Nothing known of an album's covers: never looked up, so due a search, MusicBrainz on. */
export const UNKNOWN_COVERS: AlbumCovers = {
  covers: [],
  found_at: null,
  pick: null,
  finding: false,
  choosing: false,
  waiting: false,
  failure: null,
  choice_failure: null,
  may_choose: false,
  suggested: null,
  due: true,
  may_find: true,
};

/** *Help!*'s 1965 vinyl and 1987 CD found, `cover-1965` and `cover-1987`, with `known` on top. */
export function helpFound(known: Partial<AlbumCovers> = {}): AlbumCovers {
  return {
    ...UNKNOWN_COVERS,
    covers: [
      { release: VINYL, cover: "cover-1965" },
      { release: CD, cover: "cover-1987" },
    ],
    found_at: "2026-11-16T00:00:00Z",
    due: false,
    ...known,
  };
}

/** Nothing known of the pictures Deezer has of an artist: never looked up, Deezer on. */
export const UNKNOWN_PICTURES: ArtistPictures = {
  pictures: [],
  found_at: null,
  finding: false,
  waiting: false,
  failure: null,
  may_find: true,
  pick: null,
  choosing: false,
  choice_failure: null,
  may_choose: false,
  suggested: null,
  auto_pick: false,
};

/**
 * The Beatles' pictures on Deezer, `picture-beatles` of the band, 4.1M fans, and
 * `picture-tribute` of a tribute band no count is known of, with `known` on top.
 */
export function beatlesPictures(known: Partial<ArtistPictures> = {}): ArtistPictures {
  return {
    ...UNKNOWN_PICTURES,
    pictures: [
      { name: "The Beatles", fans: 4_100_000, cover: "picture-beatles" },
      { name: "The Beatles Revival", fans: null, cover: "picture-tribute" },
    ],
    found_at: "2026-11-18T00:00:00Z",
    ...known,
  };
}

/** The household's settings never saved: every default, the built-in notes for the AI. */
export function settingsOf(change: Partial<Settings> = {}): Settings {
  return {
    storage_limit: null,
    removal_order: "least_favorite",
    album_minutes: 20,
    split_albums: "approval",
    lyrics_sites: [],
    suggest_lyrics: true,
    picture_sites: [],
    pick_pictures_by_ai: false,
    find_artist_photos: "up_next",
    find_album_covers: "up_next",
    pick_album_covers_by_ai: false,
    ai_notes: [
      { ask: "details", text: "Name the album the song first came out on." },
      { ask: "songs", text: "One song per track of the album's standard edition." },
      { ask: "songs", text: "A live album: leave out the talking between songs." },
    ],
    revision: 0,
    ...change,
  };
}

/**
 * *Melt*'s lyrics, found on LRCLIB, with `change` on top:
 *
 * ```text
 * [00:12.34]朝目が覚めて
 * ```
 */
export function lyricsOf(change: Partial<Lyrics> = {}): Lyrics {
  return {
    origin: "lrclib",
    synced: true,
    instrumental: false,
    lines: [{ at_ms: 12_340, text: "朝目が覚めて", translation: "", words: [] }],
    plain: "",
    text: "[00:12.34]朝目が覚めて\n",
    found_at: "2026-11-17T12:00:00Z",
    ...change,
  };
}

/** *Melt* by ryo as LRCLIB has it, 4:20 long, timed, with `change` on top. */
export function lyricsOptionOf(change: Partial<LyricsOption> = {}): LyricsOption {
  return {
    provider: "lrclib",
    title: "Melt",
    artist: "ryo",
    album: "Re:Start",
    duration_ms: 260_000,
    text: "[ar:ryo]\n[00:12.34]朝目が覚めて\n[00:15.50]真っ先に思い浮かぶ\n[00:18.00]君の顔\n",
    instrumental: false,
    ...change,
  };
}

/** What was found looking for *Melt* by ryo: `options`, with `change` on top. */
export function lyricsFoundOf(
  options: readonly LyricsOption[] = [lyricsOptionOf()],
  change: Partial<LyricsFound> = {},
): LyricsFound {
  return {
    title: "Melt",
    artist: "ryo",
    options,
    found_at: "2026-11-19T12:00:00Z",
    pick: null,
    finding: false,
    choosing: false,
    waiting: false,
    failure: null,
    choice_failure: null,
    may_choose: false,
    ...change,
  };
}

/**
 * The favorites of an Account that hearted the artists `artists` and the albums `albums`,
 * as the Library sees them once it knows each artist's songs: by the id of the Library's
 * artist each name names, and by the name.
 */
export function favoriteGroupsNaming(
  artists: readonly string[],
  albums: readonly { readonly artist: string; readonly name: string }[] = [],
): FavoriteGroups {
  return {
    artistIds: new Set(artists.map(artistIdOf)),
    artists: new Set(artists.map((name) => fold(name.trim()))),
    albums: new Set(albums.map(({ artist, name }) => albumKey(artist, name))),
    isNamesake: () => false,
  };
}
