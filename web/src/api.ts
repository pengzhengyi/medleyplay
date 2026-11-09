/**
 * @file The server's API, as the client uses it: typed requests that throw on failure.
 */

/** Whether a Track can play now, best first. */
export type Availability =
  "ok" | "offline" | "waiting_online" | "unavailable" | "missing" | "cant_play";

/** A Track with the signed-in Account's own state. */
export interface Track {
  readonly id: number;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly album_artist: string;
  readonly track_number: number | null;
  readonly disc_number: number | null;
  readonly year: number | null;
  readonly genre: string;
  readonly duration_ms: number | null;
  /** When the Track was added, as an ISO 8601 date and time. */
  readonly added_at: string;
  readonly favorite: boolean;
  /** 1 to 5 stars, or `null` when unrated. */
  readonly rating: number | null;
  readonly play_count: number;
  readonly last_played_at: string | null;
  readonly availability: Availability;
  /** Whether a Source of the Track has a Download kept on the server. */
  readonly downloaded: boolean;
  /** Whether the Track has no Download, and the last Job downloading it failed. */
  readonly download_failed: boolean;
  /** The kind of site its audio is downloaded from, such as `bilibili`, if any. */
  readonly site: string | null;
  /** The album file this Track is a song of, if it is one. */
  readonly segment_of: number | null;
  /** Whether this Track's file is split into songs, which then stand for it. */
  readonly split: boolean;
  /** Whether the Track is a song or a whole album in one file. */
  readonly kind: Kind;
  /** Why it is that kind: settled, as named or split, or guessed. */
  readonly kind_reason: KindReason;
  /** The cover shown, by name, served at `coverUrl(cover)`. */
  readonly cover: string | null;
  /** What listeners elsewhere rated the song or its album, when enough did; it only shows. */
  readonly community: CommunityRating | null;
  /** Your rating of its album, from an import; it stands for `rating` when that is `null`. */
  readonly album_rating: number | null;
}

/** What listeners on another site rated a song, or the album it is on, out of 5. */
export interface CommunityRating {
  /** The enricher that found it, such as `musicbrainz`. */
  readonly source: string;
  readonly of: "song" | "album";
  readonly rating: number;
  readonly votes: number;
  /** The site's page of what was rated. */
  readonly link: string;
}

/** What a Track is: one song, or one file holding a whole album. */
export type Kind = "song" | "album";

/**
 * Why a Track is the kind it is: an origin names it, its file is split, it is a song of
 * a split file, it is guessed from its file's length, or, the household guessing none,
 * no one named it, so it is a song.
 */
export type KindReason = "named" | "split" | "segment" | "length" | "default";

/** Return whether a Track's kind is settled, rather than guessed or assumed. */
export function kindSettled(reason: KindReason): boolean {
  return reason === "named" || reason === "split" || reason === "segment";
}

/** Return where the cover named `cover` is served. */
export function coverUrl(cover: string): string {
  return `/api/covers/${cover}`;
}

/** A detail of a Track the household can edit. */
export type Detail =
  | "title"
  | "artist"
  | "album"
  | "album_artist"
  | "track_number"
  | "disc_number"
  | "year"
  | "genre"
  | "cover"
  | "kind";

/** Where a value came from, the first shown when several give one; `ai` is never shown. */
export type Origin =
  "household" | "files" | "musicbrainz" | "video" | "album_file" | "file_name" | "ai";

/** A value of a detail, and where it came from. */
export interface Found {
  readonly value: string | number;
  readonly origin: Origin;
}

/** A Track's details: what shows, what would show without the household's, and every origin's. */
export interface Details {
  readonly track_id: number;
  readonly shown: Partial<Readonly<Record<Detail, Found>>>;
  readonly found: Partial<Readonly<Record<Detail, Found>>>;
  readonly origins: Partial<
    Readonly<Record<Origin, Partial<Readonly<Record<Detail, string | number>>>>>
  >;
  /** The video's text the `video` values were read from, if any was. */
  readonly video_text: VideoText | null;
  /** Whether the Track is a song or an album, and why. */
  readonly kind: { readonly value: Kind; readonly reason: KindReason };
}

/** A video's title and description, as the site shows them. */
export interface VideoText {
  readonly title: string;
  readonly description: string;
}

/** A song of a song list: where it starts, its title, and its artist, or "". */
export interface Song {
  readonly start_ms: number;
  readonly title: string;
  readonly artist: string;
}

/** What a song list says as it is typed: the songs its lines name, and every problem. */
export interface ListCheck {
  readonly songs: readonly Song[];
  /** Why a line is no song, or with `line` `null`, why the list isn't one. */
  readonly problems: readonly { readonly line: number | null; readonly message: string }[];
}

/** A song of a split file: its id, its Track, and where it ends, if known. */
export interface SplitSong extends Song {
  readonly id: number;
  readonly track_id: number;
  readonly end_ms: number | null;
}

/** A file's songs, whether its length changed since it was split, and the lists found. */
export interface Songs {
  readonly track_id: number;
  readonly length_ms: number | null;
  readonly needs_check: boolean;
  readonly songs: readonly SplitSong[];
  readonly found: readonly (readonly Song[])[];
  /** The song list an AI model suggested for the file, or empty. */
  readonly suggested: readonly Song[];
}

/** A row of the songs editor: the song it keeps by `id`, or `null` for a new one. */
export interface SongRowIn extends Song {
  readonly id: number | null;
}

/** A Track's details once its video's text is read, and the songs that text lists. */
export interface VideoRead {
  readonly details: Details;
  readonly songs: readonly Song[];
}

/** A Playlist; a smart one's Tracks are the ones its rules match now. */
export interface Playlist {
  readonly id: string;
  readonly name: string;
  readonly track_ids: readonly number[];
  readonly rules: Record<string, unknown> | null;
  readonly keep_downloaded: boolean;
  readonly unreadable: string;
  /** Which Playlist the server keeps this is, such as `favorites`; it can't be edited. */
  readonly builtin: "favorites" | null;
  readonly updated_at: string;
}

/** A plain Playlist as it is sent: its name, its Tracks in order, and its Keep downloaded. */
export interface PlainPlaylist {
  readonly name: string;
  readonly track_ids: readonly number[];
  readonly keep_downloaded: boolean;
}

/** What this server can do now: for each extension point, the keys that answer it. */
export interface Features {
  readonly multiple_accounts: boolean;
  readonly providers: Readonly<Record<string, readonly string[]>>;
}

/** A Job as the event stream sends it, as far as the client follows one. */
export interface JobEvent {
  readonly id: number;
  readonly kind: string;
  readonly state: Job["state"];
}

/** The enricher that reads a Track's video details and cover from Bilibili. */
export const DETAILS_ENRICHER = "bilibili-details";
/** The enricher that finds a Track's release and cover on MusicBrainz. */
export const MUSICBRAINZ_ENRICHER = "musicbrainz";
/** The enricher that suggests a Track's details from its video text with an AI model. */
export const AI_ENRICHER = "ai-details";

/** An enricher: whether it can be asked, whether the site stopped it, and for which Tracks. */
/**
 * When the household has an enricher asked: only when someone chooses, for the songs
 * a page is about to play, or for every Track it may be asked about.
 */
export type EnricherMode = "manual" | "next" | "all";

export interface Enricher {
  readonly name: string;
  /** Its plugin is on. */
  readonly available: boolean;
  /** Set after the site refused a request; nothing is asked until an admin resets it. */
  readonly stopped: { readonly at: string; readonly reason: string } | null;
  /** The Tracks it may be asked about now; none while it is stopped or turned off. */
  readonly eligible: readonly number[];
  readonly mode: EnricherMode;
}

/** A site's proxy as the server shows it: its address, never its login. */
export interface ProxySetting {
  readonly scheme: "http" | "https" | "socks5h";
  readonly host: string;
  readonly port: number;
  readonly has_login: boolean;
  /** The address alone, such as `socks5h://127.0.0.1:7890`. */
  readonly display: string;
  readonly saved_at: string;
}

/** Why an AI provider last gave no answer to use. */
export type AiFailure = "unreachable" | "busy" | "refused" | "unusable" | "key_missing";

/** An AI provider as the server shows it: which it is, its address and model, never its key. */
export interface AiProvider {
  readonly id: string;
  readonly base_url: string;
  readonly model: string;
  readonly has_key: boolean;
  readonly saved_at: string;
  /** Why it last gave no answer to use, at `failed_at`, until it answers again. */
  readonly failure: AiFailure | null;
  readonly failed_at: string | null;
}

/** A provider to start from. */
export interface AiPreset {
  readonly name: string;
  readonly base_url: string;
  readonly model: string;
}

/** The providers in the order they are asked, the presets to start from, and the limits. */
export interface AiSetting {
  readonly providers: readonly AiProvider[];
  readonly presets: readonly AiPreset[];
  readonly max_providers: number;
  /** The most characters of a video's description sent to a provider. */
  readonly max_description: number;
}

/** The household's settings, and the revision they were read at; 0 if never saved. */
export interface Settings {
  /** The most the Downloads and cache may use, in bytes, or `null` for no limit. */
  readonly storage_limit: number | null;
  readonly removal_order: "least_favorite";
  /** A file this many minutes or longer is guessed an album; `null` guesses none. */
  readonly album_minutes: number | null;
  readonly revision: number;
}

/** An Account's own preferences, and their revision; 0 if never saved. */
export interface Preferences {
  /** The keyboard shortcuts changed from the page's defaults, or `null` for none. */
  readonly shortcuts: Readonly<Record<string, readonly string[]>> | null;
  /** How many songs History shows, or `null` for the default. */
  readonly history_length: HistoryLength | null;
  readonly revision: number;
}

/** Preferences to save at the revision read; one left out keeps what was saved. */
export type PreferencesChange = Partial<Omit<Preferences, "revision">> & {
  readonly revision: number;
};

/** How many songs History can show. */
export const HISTORY_LENGTHS = [25, 50, 100, 250, 500] as const;
export type HistoryLength = (typeof HISTORY_LENGTHS)[number];
export const DEFAULT_HISTORY_LENGTH: HistoryLength = 50;

/** A play in the Account's History: its id, its Track, and when it was played. */
export interface Played {
  readonly id: string;
  readonly track_id: number;
  readonly played_at: string;
}

/** How many days back Insights can count plays; all time comes from each Track's own count. */
export const PLAY_COUNT_PERIODS = [7, 30] as const;
export type PlayCountPeriod = (typeof PLAY_COUNT_PERIODS)[number];

/**
 * How often the Account played a Track over a period, plays cleared from History
 * too, and how long it listened: `listened_ms` adds up the `timed_plays` whose
 * time was measured.
 */
export interface PlayCount {
  readonly track_id: number;
  readonly plays: number;
  readonly listened_ms: number;
  readonly timed_plays: number;
}

/** What a plan at another storage limit would remove. */
export interface Preview {
  readonly removals: readonly {
    readonly kind: "download" | "cache";
    readonly size: number;
  }[];
}

/** The storage the download policy governs; the figures are `null` when `error` says why. */
export interface Storage {
  readonly limit: number | null;
  readonly downloads: number | null;
  readonly cache: number | null;
  readonly reserved: number | null;
  readonly free: number | null;
  readonly disk_size: number | null;
  readonly wanted: number | null;
  readonly last_evaluation: {
    readonly at: string;
    readonly removed: number;
    readonly started: number;
    readonly shortfalls: readonly unknown[];
    readonly error: string | null;
  } | null;
  readonly error: string | null;
  readonly preview: Preview | null;
}

/** What the admin chose: decide from the network, or always Online or Offline. */
/**
 * What this device is to the server: the host itself, a device the household
 * allowed, one let in without asking, one waiting for an answer, or one refused.
 */
export type Presence = "host" | "allowed" | "admitted" | "waiting" | "refused";

/** This device as the server sees it; `code` is shown while it waits. */
export interface DeviceInfo {
  readonly presence: Presence;
  readonly label: string;
  readonly code: string | null;
}

/** Return whether a device may use medleyplay now. */
export function letIn(device: DeviceInfo): boolean {
  return device.presence !== "waiting" && device.presence !== "refused";
}

/** What the household chose for new devices: ask first, allow all, or block them. */
export type Admission = "ask" | "everyone" | "known";

/** A device waiting for an admin's answer, with the code it shows. */
export interface WaitingDevice {
  readonly id: string;
  readonly label: string;
  readonly address: string;
  readonly code: string;
  readonly since: string;
}

/** A device the household allowed; `this_device` marks the one asking. */
export interface AllowedDevice {
  readonly id: string;
  /** What the household calls it, as "Mia's phone"; `null` while it has no name. */
  readonly name: string | null;
  /** What the browser says it is, as "Safari on iPhone". */
  readonly label: string;
  readonly address: string;
  readonly allowed_at: string;
  readonly last_seen_at: string;
  readonly this_device: boolean;
}

/** The choice for new devices, its revision, and the waiting and allowed devices. */
export interface Devices {
  readonly admission: Admission;
  readonly revision: number;
  readonly waiting: readonly WaitingDevice[];
  readonly allowed: readonly AllowedDevice[];
}

/** One entry of a queue as remote play sends it: its key, its Track, and its unit. */
export interface RemoteEntry {
  readonly key: string;
  readonly track_id: number;
  readonly unit: string | null;
}

/** A Track to queue on the computer, and the unit it is part of. */
export interface Queued {
  readonly track_id: number;
  readonly unit: string | null;
}

/**
 * What the computer plays: a window of its queue in the order it plays, and how.
 *
 * `entries` starts at place `offset` of the `total`; `position` is the place of the
 * entry playing, `total` when the queue has finished.
 */
export interface SpeakerState {
  readonly entries: readonly RemoteEntry[];
  readonly offset: number;
  readonly total: number;
  readonly position: number;
  readonly status: "idle" | "loading" | "preparing" | "playing" | "paused" | "blocked" | "failed";
  readonly message: string | null;
  readonly shuffled: boolean;
  readonly repeat: "off" | "all" | "one";
  readonly seconds: number;
  readonly duration: number | null;
  readonly volume: number;
  readonly muted: boolean;
  /** Whether the play of the entry playing has been counted. */
  readonly counted: boolean;
  readonly sleep: { readonly left_ms: number; readonly set_ms_ago: number } | null;
}

/** The account's speaker as the event stream sends it: its page, its report, and its age. */
export interface RemoteEvent {
  readonly page: string | null;
  readonly state: SpeakerState | null;
  readonly age_ms: number | null;
}

/** One thing a remote asks the computer to do. */
export type RemoteCommand =
  | { readonly kind: "play"; readonly entries: readonly Queued[]; readonly start: number }
  | { readonly kind: "playAll"; readonly entries: readonly Queued[]; readonly shuffled: boolean }
  | { readonly kind: "playNow" | "playNext" | "add"; readonly entry: Queued }
  | { readonly kind: "toggle" | "pause" | "next" | "previous" | "clear" }
  | { readonly kind: "seek"; readonly key: string; readonly seconds: number }
  | { readonly kind: "move"; readonly key: string; readonly to: number }
  | { readonly kind: "remove"; readonly key: string }
  | { readonly kind: "shuffle"; readonly on: boolean }
  | { readonly kind: "repeat"; readonly repeat: "off" | "all" | "one" }
  | { readonly kind: "volume"; readonly volume: number }
  | { readonly kind: "mute"; readonly muted: boolean }
  | { readonly kind: "sleep"; readonly minutes: number | null }
  | {
      readonly kind: "take";
      readonly entries: readonly RemoteEntry[];
      readonly order: readonly string[] | null;
      readonly position: number;
      readonly repeat: "off" | "all" | "one";
      readonly shuffled: boolean;
      readonly seconds: number;
      readonly playing: boolean;
      readonly counted: boolean;
    };

export type ModeSetting = "auto" | "online" | "offline";

/** Why the Mode is what it is. */
export type ModeReason =
  | "set_online"
  | "set_offline"
  | "online"
  | "no_network"
  | "metered"
  | "unknown_network"
  | "unreachable"
  | "settling";

/** Whether medleyplay may contact music sites now, and why. */
export interface Mode {
  readonly setting: ModeSetting;
  readonly online: boolean;
  readonly reason: ModeReason;
  /** The network the server is on, or `null` when there is none or it can't be read. */
  readonly network: {
    readonly kind: "wifi" | "wired" | "unknown";
    readonly metered_as: string | null;
    readonly hotspot_like: boolean;
  } | null;
  readonly since: string;
  readonly checked_at: string | null;
  /** While settling, when the Mode goes Online if nothing changes. */
  readonly online_at: string | null;
  /** How many Jobs wait for Online. */
  readonly held_jobs: number;
}

/** A network an admin marked metered. */
export interface MeteredNetwork {
  readonly id: number;
  readonly name: string;
  readonly subnet: string;
  readonly hotspot_like: boolean;
}

/** The Mode's setting and the metered networks, at their revision; 0 if never saved. */
export interface ModeSettings {
  readonly setting: ModeSetting;
  readonly metered: readonly MeteredNetwork[];
  readonly revision: number;
}

/** The signed-in Account. */
export interface Account {
  readonly id: number;
  readonly username: string;
  readonly display_name: string;
  readonly role: "admin" | "member";
}

/** How a Track can play: from a URL now, once a Job prepares it, or not at all. */
export type PlaybackAnswer =
  | {
      readonly state: "ready";
      readonly source_id: number;
      readonly audio_url: string;
      readonly media_type: string;
      /** Where a song inside a longer file starts in it; `null` for a whole file. */
      readonly start_ms: number | null;
      /** Where it ends; `null` when the file's end is its end. */
      readonly end_ms: number | null;
    }
  | { readonly state: "preparing"; readonly source_id: number; readonly job_id: number }
  | { readonly state: "unplayable"; readonly availability: Availability };

/** The artists and albums an Account favorited, by the names it favorited them under. */
export interface FavoritesRead {
  readonly artists: readonly { readonly name: string }[];
  readonly albums: readonly { readonly artist: string; readonly name: string }[];
}

/** A Job, as far as the player follows one. */
export interface Job {
  readonly id: number;
  readonly state: "waiting" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
  readonly failure_message: string;
}

/** One part of a video a link names, and its Track when it is already in the catalog. */
export interface LinkPart {
  readonly part: number;
  readonly title: string;
  readonly duration_ms: number | null;
  readonly track_id: number | null;
}

/** An audio quality a video can be added at. */
export interface Quality {
  readonly id: string;
  readonly label: string;
  readonly kbps: number | null;
}

/** Why a video couldn't be read. */
export type UnreadableReason = "gone" | "needs_login" | "network" | "refused" | "fault";

/**
 * The video a link names. One that couldn't be read has `readable` false, a `reason` and
 * a `message`, no title, uploader, or qualities, and one part: the one the link names.
 */
export interface LinkLookup {
  readonly kind: string;
  readonly video: string;
  readonly title: string;
  readonly uploader: string;
  readonly parts: readonly LinkPart[];
  readonly qualities: readonly Quality[];
  readonly readable: boolean;
  readonly reason: UnreadableReason | null;
  readonly message: string;
}

/** A part to add, under the title and artist the household chose. */
export interface PartChoice {
  readonly part: number;
  readonly title: string;
  readonly artist: string;
}

/** A part that was added: its Track and Source, and the Job downloading it, if one is needed. */
export interface AddedPart {
  readonly part: number;
  readonly track_id: number;
  readonly source_id: number;
  readonly job: Job | null;
}

/** Where a site Track's Download stands. */
export type DownloadStatus = "downloaded" | "downloading" | "failed" | "unavailable" | "none";

/** A Track's site Source, its link, and where its Download stands. */
export interface TrackDownload {
  readonly track_id: number;
  readonly source_id: number;
  readonly kind: string;
  /** The link to the part, such as `https://www.bilibili.com/video/BV1Xx41117Tz?p=2`. */
  readonly link: string;
  readonly status: DownloadStatus;
  /** Why a Download failed or is unavailable, or `""`. */
  readonly message: string;
  /** What made a Download that exists; `manual` for a file the household added. */
  readonly backend: string | null;
}

/** A request the server refused; `status` is its HTTP status, and `code` names why, if it says. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The codes of a request refused because this device isn't let in. */
const DEVICE_REFUSALS: ReadonlySet<string> = new Set(["device_waiting", "device_refused"]);
const deviceListeners = new Set<() => void>();

/**
 * Call `listener` whenever the server refuses a request because this device
 * isn't let in, as when an admin removes it; return what stops listening.
 */
export function onDeviceRefused(listener: () => void): () => void {
  deviceListeners.add(listener);
  return () => {
    deviceListeners.delete(listener);
  };
}

/** Return the error a refused response stands for, telling who listens if it is the device. */
async function refusalOf(response: Response): Promise<ApiError> {
  const { detail, code } = await reasonOf(response);
  if (code !== null && DEVICE_REFUSALS.has(code)) {
    for (const listener of deviceListeners) {
      listener();
    }
  }
  return new ApiError(response.status, detail, code);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (!response.ok) {
    throw await refusalOf(response);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** Send `file` as the request's body, as it is. */
async function send<T>(method: string, path: string, file: Blob): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin", body: file });
  if (!response.ok) {
    throw await refusalOf(response);
  }
  return (await response.json()) as T;
}

/** Say why the server refused: its own words, each check a request failed, or its status. */
async function reasonOf(
  response: Response,
): Promise<{ readonly detail: string; readonly code: string | null }> {
  const status = response.statusText || `The server refused this (${String(response.status)}).`;
  try {
    const body = (await response.json()) as { detail?: unknown; code?: unknown };
    const code = typeof body.code === "string" ? body.code : null;
    if (typeof body.detail === "string") {
      return { detail: body.detail, code };
    }
    if (Array.isArray(body.detail)) {
      const checks = body.detail.flatMap((check: unknown) =>
        typeof check === "object" &&
        check !== null &&
        "msg" in check &&
        typeof check.msg === "string"
          ? [check.msg]
          : [],
      );
      return { detail: checks.length > 0 ? checks.join("; ") : status, code };
    }
    return { detail: status, code };
  } catch {
    return { detail: status, code: null };
  }
}

/**
 * Send `file` as the body of a PUT to the Track's download, reporting how many bytes
 * were sent as they go. Aborting `signal` stops it, rejecting with an `AbortError`.
 * `fetch` can't report an upload's progress, so this is a request of its own.
 */
export function uploadFile(
  trackId: number,
  file: File,
  onProgress: (sent: number, total: number) => void,
  signal?: AbortSignal,
): Promise<TrackDownload> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(
      "PUT",
      `/api/tracks/${String(trackId)}/download?name=${encodeURIComponent(file.name)}`,
    );
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded, event.total);
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(JSON.parse(request.responseText) as TrackDownload);
      } else {
        const answer = new Response(request.responseText, { status: request.status });
        void refusalOf(answer).then(reject);
      }
    };
    request.onerror = () => {
      reject(new ApiError(0, "The file didn't reach the server."));
    };
    request.onabort = () => {
      reject(new DOMException("The upload was stopped.", "AbortError"));
    };
    signal?.addEventListener("abort", () => {
      request.abort();
    });
    request.send(file);
  });
}

/** The routes the client calls. */
export const api = {
  setupStatus: () => call<{ set_up: boolean }>("GET", "/api/setup"),
  setUp: (username: string, displayName: string, password: string) =>
    call<Account>("POST", "/api/setup", { username, display_name: displayName, password }),
  signIn: (username: string, password: string) =>
    call<Account>("POST", "/api/session", { username, password }),
  signOut: () => call<undefined>("DELETE", "/api/session"),
  me: () => call<Account>("GET", "/api/me"),
  device: () => call<DeviceInfo>("GET", "/api/device"),
  devices: () => call<Devices>("GET", "/api/devices"),
  saveAdmission: (admission: Admission, revision: number) =>
    call<Devices>("PUT", "/api/devices/setting", { admission, revision }),
  allowDevice: (id: string) => call<AllowedDevice>("POST", `/api/devices/${id}/allow`),
  renameDevice: (id: string, name: string | null) =>
    call<AllowedDevice>("PUT", `/api/devices/${id}/name`, { name }),
  turnAwayDevice: (id: string) => call<undefined>("POST", `/api/devices/${id}/turn-away`),
  removeDevice: (id: string) => call<undefined>("DELETE", `/api/devices/${id}`),
  removeOtherDevices: () => call<undefined>("DELETE", "/api/devices"),
  report: (page: string, state: SpeakerState) =>
    call<{ speaker: boolean }>("PUT", "/api/remote/report", { page, ...state }),
  command: (command: RemoteCommand) => call<undefined>("POST", "/api/remote/commands", { command }),
  tracks: () => call<Track[]>("GET", "/api/tracks"),
  track: (trackId: number) => call<Track>("GET", `/api/tracks/${String(trackId)}`),
  details: (trackId: number) => call<Details>("GET", `/api/tracks/${String(trackId)}/details`),
  /** Set the household's values on the Tracks; `null` drops one. All change, or none. */
  setDetails: (
    trackIds: readonly number[],
    values: Partial<Record<Detail, string | number | null>>,
  ) => call<{ changed: number }>("POST", "/api/tracks/details", { track_ids: trackIds, values }),
  /** Read a video's pasted title and description as the Track's `video` values. */
  readVideoText: (trackId: number, text: VideoText) =>
    call<VideoRead>("POST", `/api/tracks/${String(trackId)}/video-text`, text),
  /** Make `image` the household's cover for the Track. */
  setCover: (trackId: number, image: Blob) =>
    send<Details>("PUT", `/api/tracks/${String(trackId)}/cover`, image),
  /** Drop the household's cover for the Track, so the next origin's shows. */
  removeCover: (trackId: number) => call<Details>("DELETE", `/api/tracks/${String(trackId)}/cover`),
  /** The songs a Track's file is split into, and the lists found for it. */
  songs: (trackId: number) => call<Songs>("GET", `/api/tracks/${String(trackId)}/songs`),
  /** Make `rows` the file's songs: each kept by its id, the others new, the rest removed. */
  saveSongs: (trackId: number, rows: readonly SongRowIn[], known: readonly number[]) =>
    call<Songs>("PUT", `/api/tracks/${String(trackId)}/songs`, { rows, known }),
  /** Check a song list as it is typed, each problem on its line. */
  checkSongList: (trackId: number, text: string) =>
    call<ListCheck>("POST", `/api/tracks/${String(trackId)}/songs/check`, { text }),
  /** Remove every song of the file, with its Track. */
  unsplit: (trackId: number) =>
    call<{ removed: number }>("DELETE", `/api/tracks/${String(trackId)}/songs`),
  playlists: () => call<Playlist[]>("GET", "/api/playlists"),
  /** Create or replace a plain Playlist under an id the client chose. */
  putPlaylist: (id: string, playlist: PlainPlaylist) =>
    call<Playlist>("PUT", `/api/playlists/${id}`, playlist),
  features: () => call<Features>("GET", "/api/features"),
  preferences: () => call<Preferences>("GET", "/api/me/preferences"),
  savePreferences: (change: PreferencesChange) =>
    call<Preferences>("PUT", "/api/me/preferences", change),
  settings: () => call<Settings>("GET", "/api/settings"),
  saveSettings: (settings: Settings) => call<Settings>("PUT", "/api/settings", settings),
  storage: (previewLimit?: number) =>
    call<Storage>(
      "GET",
      previewLimit === undefined ? "/api/storage" : `/api/storage?limit=${String(previewLimit)}`,
    ),
  /** The household's proxy for a site, or `null` when none is set; admins only. */
  proxy: (site: string) => call<ProxySetting | null>("GET", `/api/proxies/${site}`),
  /** Set a site's proxy from its URL, which the server keeps in the Keychain. */
  saveProxy: (site: string, url: string) =>
    call<ProxySetting>("PUT", `/api/proxies/${site}`, { url }),
  removeProxy: (site: string) => call<undefined>("DELETE", `/api/proxies/${site}`),
  /** The AI providers in the order they are asked; admins only. */
  ai: () => call<AiSetting>("GET", "/api/ai"),
  /** Add a provider after the others, with its key when it needs one; admins only. */
  addAiProvider: (baseUrl: string, model: string, key?: string) =>
    call<AiProvider>("POST", "/api/ai/providers", {
      base_url: baseUrl,
      model,
      ...(key === undefined ? {} : { key }),
    }),
  /** Replace a provider's key, keeping its place; admins only. */
  replaceAiKey: (id: string, key: string) =>
    call<AiProvider>("PUT", `/api/ai/providers/${id}/key`, { key }),
  /** Ask another model of a provider, keeping its place and key; admins only. */
  changeAiModel: (id: string, model: string) =>
    call<AiProvider>("PUT", `/api/ai/providers/${id}/model`, { model }),
  /** Ask the providers in the order of `ids`, which names each once; admins only. */
  reorderAi: (ids: readonly string[]) => call<AiProvider[]>("PUT", "/api/ai/order", { ids }),
  /** Forget a provider and delete its key; admins only. */
  removeAiProvider: (id: string) => call<undefined>("DELETE", `/api/ai/providers/${id}`),
  /** Where another device on the network can reach the server: addresses, then names. */
  addresses: () => call<{ addresses: string[] }>("GET", "/api/addresses"),
  /** The enricher's state, and the Tracks it may be asked about. */
  enricher: (name: string) => call<Enricher>("GET", `/api/enrichers/${name}`),
  /** Ask the enricher about one Track: a Job that runs once the Mode is Online. */
  findDetails: (name: string, trackId: number) =>
    call<Job>("POST", `/api/enrichers/${name}/tracks/${String(trackId)}`),
  /** Let a stopped enricher be asked again; admins only. */
  resetEnricher: (name: string) => call<undefined>("POST", `/api/enrichers/${name}/reset`),
  /** Choose when the enricher is asked; admins only. Finding all queues every Track at once. */
  setEnricherMode: (name: string, mode: EnricherMode) =>
    call<Enricher>("PUT", `/api/enrichers/${name}/mode`, { mode }),
  /** Look up the video a link or a bare `BV` or `av` code names. */
  lookUpLink: (link: string) => call<LinkLookup>("POST", "/api/links/lookup", { link }),
  /** Add the chosen parts of a link's video as Tracks, and start downloading them. */
  addLink: (link: string, quality: string, parts: readonly PartChoice[]) =>
    call<AddedPart[]>("POST", "/api/links", { link, quality, parts }),
  /** Where a site Track's Download stands. */
  download: (trackId: number) =>
    call<TrackDownload>("GET", `/api/tracks/${String(trackId)}/download`),
  mode: () => call<Mode>("GET", "/api/mode"),
  /** Read the network and check the internet now; one reached is Online at once. */
  checkMode: () => call<Mode>("POST", "/api/mode/check"),
  modeSettings: () => call<ModeSettings>("GET", "/api/mode/settings"),
  saveModeSetting: (setting: ModeSetting, revision: number) =>
    call<ModeSettings>("PUT", "/api/mode/settings", { setting, revision }),
  /** Mark the network the server is on now metered, as `name`. */
  markMetered: (name: string) => call<MeteredNetwork>("POST", "/api/mode/metered", { name }),
  unmarkMetered: (id: number) => call<undefined>("DELETE", `/api/mode/metered/${String(id)}`),
  setFavorite: (trackId: number, favorite: boolean) =>
    call<Track>("PUT", `/api/tracks/${String(trackId)}/favorite`, { favorite }),
  /** The artists and albums you favorited. */
  favorites: () => call<FavoritesRead>("GET", "/api/favorites"),
  /** Mark or unmark an artist as your favorite; answers with your favorites. */
  setArtistFavorite: (name: string, favorite: boolean) =>
    call<FavoritesRead>("PUT", "/api/artists/favorite", { name, favorite }),
  /** Mark or unmark an album as your favorite, under its album artist; answers likewise. */
  setAlbumFavorite: (artist: string, name: string, favorite: boolean) =>
    call<FavoritesRead>("PUT", "/api/albums/favorite", { artist, name, favorite }),
  setRating: (trackId: number, rating: number | null) =>
    call<Track>("PUT", `/api/tracks/${String(trackId)}/rating`, { rating }),
  playback: (trackId: number) =>
    call<PlaybackAnswer>("POST", `/api/tracks/${String(trackId)}/playback`),
  job: (jobId: number) => call<Job>("GET", `/api/jobs/${String(jobId)}`),
  recordPlay: (playId: string, trackId: number, playedAt: string, listenedMs?: number) =>
    call<Track>("PUT", `/api/plays/${playId}`, {
      track_id: trackId,
      played_at: playedAt,
      listened_ms: listenedMs ?? null,
    }),
  /** Note how long a recorded play has been listened to; the longest time sent stays. */
  noteListened: (playId: string, listenedMs: number) =>
    call<undefined>("PUT", `/api/plays/${playId}/listened`, { listened_ms: listenedMs }),
  history: (limit: number) => call<Played[]>("GET", `/api/plays?limit=${String(limit)}`),
  clearHistory: () => call<undefined>("DELETE", "/api/plays"),
  /** How often and how long you played each Track over the last `days`, or all time. */
  playCounts: (days?: PlayCountPeriod) =>
    call<PlayCount[]>(
      "GET",
      days === undefined ? "/api/plays/counts" : `/api/plays/counts?days=${String(days)}`,
    ),
  /** What importing a Rate Your Music export would change, changing nothing. */
  previewRatingsImport: (file: Blob) =>
    send<RatingsImport>("POST", "/api/ratings/import/preview", file),
  /** Replace your imported album ratings with a Rate Your Music export's. */
  importRatings: (file: Blob) => send<RatingsImport>("POST", "/api/ratings/import", file),
  /** How many albums your last import rated or reviewed, 0 for none. */
  ratingsImportKept: () => call<{ readonly albums: number }>("GET", "/api/ratings/import"),
  /** Forget the album ratings you imported; the ratings you gave songs stay. */
  forgetRatingsImport: () => call<undefined>("DELETE", "/api/ratings/import"),
  /** Your imported rating and review of the album `album` by `artist`, or `null`. */
  albumRating: (artist: string, album: string) =>
    call<AlbumRating | null>(
      "GET",
      `/api/album-rating?${new URLSearchParams({ artist, album }).toString()}`,
    ),
};

/** Where your ratings download as a CSV file: the songs you rated, then your albums. */
export const RATINGS_EXPORT_URL = "/api/ratings/export";

/** What importing a Rate Your Music export changes, or changed, for you. */
export interface RatingsImport {
  /** The albums the export rates or reviews. */
  readonly albums: number;
  /** Of those, the albums the Library has. */
  readonly matched_albums: number;
  /** The songs whose rating changes. */
  readonly songs: number;
  /** The albums the Library hasn't, in the export's order. */
  readonly unmatched: readonly { readonly artist: string; readonly album: string }[];
  /** Your smart playlists songs join or leave. */
  readonly playlists: readonly {
    readonly id: string;
    readonly name: string;
    readonly joining: number;
    readonly leaving: number;
  }[];
  /** The albums of your earlier import this replaces. */
  readonly replaced_albums: number;
}

/** Your imported rating of an album, if you rated it, and your review. */
export interface AlbumRating {
  readonly stars: number | null;
  readonly note: string;
}
