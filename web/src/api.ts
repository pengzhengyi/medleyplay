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
  readonly joined?: boolean;
  /** The page of the video its audio came from, such as a Bilibili video's, if known. */
  readonly video: string | null;
  /** The album file this Track is a song of, if it is one. */
  readonly segment_of: number | null;
  /** Whether this Track's file is split into songs, which then stand for it. */
  readonly split: boolean;
  /** Whether the Track is a song or a whole album in one file. */
  readonly kind: Kind;
  /** Why it is that kind: settled, as named or split, or guessed. */
  readonly kind_reason: KindReason;
  /** The cover shown, by name, served at `coverUrl(cover, size)`. */
  readonly cover: string | null;
  /** What listeners elsewhere rated the song or its album, when enough did; it only shows. */
  readonly community: CommunityRating | null;
  /** Your rating of its album, from an import; it stands for `rating` when that is `null`. */
  readonly album_rating: number | null;
  /** The artists its artist names, as written: each one if the name was split, or the name. */
  readonly artists: readonly string[];
  /** The id of the Library's artist each of `artists` is, in the same order. */
  readonly artist_ids: readonly string[];
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

/**
 * The number of how the server makes thumbnails: their sizes, quality, and rules. A
 * thumbnail's URL carries it, so a new recipe reaches browsers that kept the old one.
 */
export const THUMBNAIL_RECIPE = 1;

/**
 * How large a cover is shown: a `small` thumbnail (128 pixels) in a song row or the
 * player bar, a `medium` one (512 pixels) in a tile, or the `original` image.
 */
export type CoverSize = "small" | "medium" | "original";

/**
 * Return where the cover named `cover` is served at `size`.
 *
 * A thumbnail not made yet is sent on to the original, so it always shows.
 */
export function coverUrl(cover: string, size: CoverSize): string {
  const original = `/api/covers/${cover}`;
  return size === "original"
    ? original
    : `${original}?size=${size}&recipe=${String(THUMBNAIL_RECIPE)}`;
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
  /** The AI model that last gave the `ai` values, as it was then; `null` if none has. */
  readonly ai_answered_by: AnsweredBy | null;
  /** The artists the Track shows, in order, each with how it credits it and who it is. */
  readonly artists: readonly TrackArtist[];
  /** Whether the household chose the Track's artists one by one. */
  readonly artists_chosen: boolean;
}

/** Where a song's lyrics came from: the first held of each shows. */
export type LyricsOrigin =
  | "household"
  | "sidecar"
  | "tag"
  | "lrclib"
  | "netease"
  /** The nearest song's, when no site has the song's: shown until saved or dismissed. */
  | "suggested";

/** A song a lyrics site found of a title and artist, what tells it apart, and its lyrics. */
export interface LyricsOption {
  readonly provider: "lrclib" | "netease";
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly duration_ms: number | null;
  /** LRC or plain text; empty for a song that is instrumental. */
  readonly text: string;
  readonly instrumental: boolean;
}

/** What was found when a song's lyrics were last looked for, and what is being asked. */
export interface LyricsFound {
  /** The title asked by; empty until asked. */
  readonly title: string;
  readonly artist: string;
  /** The songs found, the closest in length first. */
  readonly options: readonly LyricsOption[];
  readonly found_at: string | null;
  /** The song an AI model picked of those found, by its place, why, and who answered. */
  readonly pick: {
    readonly option: number;
    readonly why: string;
    readonly model: string;
    readonly host: string;
    readonly at: string;
  } | null;
  readonly finding: boolean;
  readonly choosing: boolean;
  readonly waiting: boolean;
  readonly failure: string | null;
  /** Why the last asking of an AI model failed. */
  readonly choice_failure: string | null;
  /** Whether an AI model may be asked to pick: one is set up, and none picked among these. */
  readonly may_choose: boolean;
}

/** A site the household may turn on to be asked for the lyrics LRCLIB lacks. */
export type LyricsSite = "netease";

/** A site asked for pictures of an artist, once the household turns it on. */
export type PictureSite = "deezer";

/** A word of a line of lyrics, and when it is sung, in milliseconds. */
export interface LyricWord {
  readonly at_ms: number;
  readonly text: string;
}

/** A line of lyrics, when it is sung, its translation or empty, and its words when timed. */
export interface LyricLine {
  readonly at_ms: number;
  readonly text: string;
  readonly translation: string;
  readonly words: readonly LyricWord[];
}

/** The lyrics a song shows: timed `lines`, or `plain` text; none for an instrumental. */
export interface Lyrics {
  readonly origin: LyricsOrigin;
  readonly synced: boolean;
  readonly instrumental: boolean;
  readonly lines: readonly LyricLine[];
  readonly plain: string;
  /** As their source gave them, LRC or plain, to edit. */
  readonly text: string;
  readonly found_at: string;
}

/** How a song credits an artist. */
export type Role = "main" | "featured";

/** One artist chosen for a song, as written, and how the song credits it. */
export interface Credit {
  readonly written: string;
  readonly role: Role;
}

/** The MusicBrainz artist one of the Library's artists is, once linked. */
export interface LinkedArtist {
  readonly musicbrainz_id: string;
  readonly name: string;
  readonly photo: string | null;
}

/** Another artist going by a name a Track writes: how many songs it has, and on which albums. */
export interface Namesake {
  readonly artist_id: string;
  readonly songs: number;
  /** The albums most of its songs are on, up to two. */
  readonly albums: readonly string[];
  readonly linked: LinkedArtist | null;
}

/** One artist a Track shows, and the MusicBrainz artist it is once linked. */
export interface TrackArtist extends Credit {
  readonly artist_id: string;
  readonly linked: LinkedArtist | null;
  /** The other artists going by the name, in its order; none when it names one. */
  readonly namesakes: readonly Namesake[];
}

/** The AI model that answered for a Track, the host it was asked at, and when. */
export interface AnsweredBy {
  readonly model: string;
  readonly host: string;
  readonly at: string;
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
  /** The AI model that last answered for the file, as it was then; `null` if none has. */
  readonly suggested_by: AnsweredBy | null;
}

/** A quiet stretch of a file's audio, such as the gap between two songs. */
export interface Silence {
  readonly start_ms: number;
  readonly end_ms: number;
}

/**
 * What is known of the gaps in a file's audio: found; being found; waiting for the
 * file to be copied or downloaded; not looked for, or the file changed since; or not
 * found, as ffmpeg isn't installed or couldn't read the file.
 */
export type SilenceState =
  "found" | "finding" | "preparing" | "not_found" | "no_tool" | "unreadable";

/** What is known of the gaps in a file's audio, and the gaps, in order, once found. */
export interface Silences {
  readonly state: SilenceState;
  readonly silences: readonly Silence[];
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
  /** Whether an admin has set up an AI provider that is turned on. */
  readonly ai_set_up: boolean;
}

/** How far a running Job has got: a fraction from 0 to 1 when known, and what it is doing. */
export interface JobProgress {
  readonly fraction: number | null;
  readonly message: string;
}

/** A Job as the event stream sends it, as far as the client follows one. */
export interface JobEvent {
  readonly id: number;
  readonly kind: string;
  readonly state: Job["state"];
  /** What it works on, such as `source:12` for a Source's Download. */
  readonly target?: string;
  /** How far it has got, while it runs. */
  readonly progress?: JobProgress | null;
  /** Whether it needs the network, and waits while the Mode is Offline. */
  readonly waits_for_online?: boolean;
}

/** A saved song's outcome from Auto-Match, or why no Job was started. */
export interface LyricsMatch {
  readonly track_id: number;
  readonly job_id: number | null;
  readonly previous_job_id?: number | null;
  readonly state: "searching" | "choosing" | "waiting" | "saved" | "skipped" | "failed";
  readonly note: string;
}

/** A Track whose Download a Job is getting, and that Job, with how far it has got. */
export interface DownloadUnderWay {
  readonly track_id: number;
  readonly job: {
    readonly id: number;
    readonly state: Job["state"];
    readonly progress: JobProgress | null;
    readonly waits_for_online: boolean;
  };
}

/** The enricher that reads a Track's video details and cover from Bilibili. */
/** Another name an artist goes by, and the language it is written for, if one. */
export interface ArtistAlias {
  readonly name: string;
  readonly locale: string | null;
  readonly primary: boolean;
}

/** An artist MusicBrainz knows, with every name it goes by. */
export interface KnownArtist {
  readonly id: string;
  readonly name: string;
  readonly sort_name: string;
  /** What tells it apart from others of its name, such as *Liverpool rock band*. */
  readonly disambiguation: string;
  readonly country: string;
  readonly aliases: readonly ArtistAlias[];
  /** Its page on Wikidata, once Wikidata has answered for it. */
  readonly page: string | null;
  /** The cover holding its photo, from Wikidata, if it has one. */
  readonly photo: string | null;
  /** Where Wikidata's photo comes from: who made it, and its license; none for the household's. */
  readonly photo_page: string | null;
  /** The name the household shows it by, if it chose one. */
  readonly shown_as: string | null;
  /** The household's note about it, if any. */
  readonly about: string | null;
  /** Whether the photo is the household's own, in place of Wikidata's. */
  readonly own_photo: boolean;
}

/** A name Tracks show as an artist or album artist, and what is known of it. */
export interface ArtistName {
  readonly name: string;
  readonly key: string;
  readonly tracks: number;
  /** Whether it may be looked up, never (it names no one artist), or once tidied. */
  readonly look_up: "yes" | "never" | "tidy_first";
  /** Whether the household chose an artist, or none, for it. */
  readonly linked: boolean;
  /** The artist chosen; `null` when none was, or none is linked. */
  readonly artist_id: string | null;
  readonly looked_at: string | null;
  /** What MusicBrainz knows by the name, best first. */
  readonly candidates: readonly { readonly artist_id: string; readonly score: number }[];
  /** The artist going by the name exactly, if one. */
  readonly suggested: string | null;
  /** Whether MusicBrainz is being asked about it now. */
  readonly finding: boolean;
  /** What an AI model last recommended linking it to, while it isn't linked. */
  readonly recommendation?: ArtistRecommendation | null;
  /** The Library's artists the name names, its first first; several when artists share it. */
  readonly artist_ids?: readonly string[];
}

/** Every artist name the Library shows, most Tracks first, and the artists they name. */
export interface ArtistNames {
  readonly names: readonly ArtistName[];
  readonly artists: readonly KnownArtist[];
  /** Whether an AI model is being asked which artists the names name. */
  readonly recommending?: boolean;
}

/** The artist an AI model recommends linking a name to, `null` for none offered, and why. */
export interface ArtistRecommendation extends AnsweredBy {
  readonly artist_id: string | null;
  readonly why: string;
}

/** What an AI model suggests for an artist: a name to show it by, and a note about it. */
export interface ArtistSuggestion extends AnsweredBy {
  /** One of the names the artist goes by; `null` for none. */
  readonly shown_as: string | null;
  /** Why that name; empty with none. */
  readonly why: string;
  /** A note about who it is; empty for none. */
  readonly about: string;
}

/** Whether an AI model is asked about an artist now, what it last suggested, and why not. */
export interface ArtistSuggestionState {
  readonly asking: boolean;
  /** Whether the asking waits for medleyplay to be Online. */
  readonly waiting: boolean;
  readonly suggestion: ArtistSuggestion | null;
  /** Why the last asking failed; only to the Account that asked, and to admins. */
  readonly failure: string | null;
}

/** A release of an album, and what tells it apart from the others. */
export interface CoverRelease {
  readonly release_id: string;
  readonly title: string;
  readonly artist: string;
  /** When it came out, as `1997`, `1997-05`, or `1997-05-21`; empty when unknown. */
  readonly date: string;
  readonly country: string;
  /** Its media, such as `CD`, or `CD + DVD`. */
  readonly format: string;
  readonly tracks: number | null;
}

/** What is known of an album's covers on MusicBrainz, an AI model's pick, and what is asked. */
export interface AlbumCovers {
  /** The covers last found, best first, each with its release. */
  readonly covers: readonly { readonly release: CoverRelease; readonly cover: string }[];
  readonly found_at: string | null;
  /** The release an AI model picked of those found, why, and who answered. */
  readonly pick: {
    readonly release_id: string;
    readonly why: string;
    readonly model: string;
    readonly host: string;
    readonly at: string;
  } | null;
  readonly finding: boolean;
  readonly choosing: boolean;
  /** Whether the asking waits for medleyplay to be Online. */
  readonly waiting: boolean;
  /** Why the last finding failed; only to the Account that asked, and to admins. */
  readonly failure: string | null;
  readonly choice_failure: string | null;
  /** Whether an AI model may be asked to pick: one is set up, and none picked among these. */
  readonly may_choose: boolean;
  /**
   * The cover suggested as the album's: the AI's pick, else the best-ranked release whose
   * title and artist are the album's; never one dismissed, and none when none match.
   */
  readonly suggested: string | null;
  /** Whether the album may be searched on its own: never searched, or in vain long ago. */
  readonly due: boolean;
  /** Whether the MusicBrainz plugin is on to be asked. */
  readonly may_find: boolean;
}

/** What is known of the pictures Deezer has of an artist, and what is asked. */
export interface ArtistPictures {
  /** The pictures last found, the most followed artist first. */
  readonly pictures: readonly {
    /** The name Deezer knows the artist by. */
    readonly name: string;
    /** How many follow the artist on Deezer, if known. */
    readonly fans: number | null;
    readonly cover: string;
  }[];
  readonly found_at: string | null;
  readonly finding: boolean;
  /** Whether the asking waits for medleyplay to be Online. */
  readonly waiting: boolean;
  /** Why the last finding failed; only to the Account that asked, and to admins. */
  readonly failure: string | null;
  /** Whether the household turned Deezer on in Settings. */
  readonly may_find: boolean;
  /** The picture an AI model picked among those found, if one was asked. */
  readonly pick: PicturePick | null;
  readonly choosing: boolean;
  /** Why the last asking failed; only to the Account that asked, and to admins. */
  readonly choice_failure: string | null;
  /** Whether an AI model may be asked which picture is of the artist. */
  readonly may_choose: boolean;
  /** The cover suggested as the artist's photo: the AI's pick, else the likeliest by name. */
  readonly suggested: string | null;
  /** Whether the household has an AI model asked as soon as pictures are found. */
  readonly auto_pick: boolean;
}

/** The picture an AI model picked, why, which model answered, and the note it was asked with. */
export interface PicturePick extends AnsweredBy {
  readonly cover: string;
  readonly why: string;
  readonly hint: string;
}

/** A link to a picture an AI model suggested, and what fetching it gave. */
export interface SuggestedLink {
  readonly url: string;
  /** The page that shows the picture, if the model named one. */
  readonly page: string | null;
  readonly why: string;
  /** The cover holding the picture, once fetched. */
  readonly cover: string | null;
  /** Why there is no picture at the link, once asked. */
  readonly unavailable: string;
  readonly fetching: boolean;
  /** Why the last fetching failed; only to the Account that asked, and to admins. */
  readonly failure: string | null;
}

export interface ImageSearchResults {
  readonly images: readonly {
    readonly url: string;
    readonly page: string;
    readonly title: string;
  }[];
  readonly searching: boolean;
  readonly waiting: boolean;
  readonly failure: string | null;
}

/** The links an AI model last suggested for a picture, and what is asked. */
export interface PictureLinks {
  /** Best first. */
  readonly links: readonly SuggestedLink[];
  readonly model: string;
  readonly host: string;
  readonly asked_at: string | null;
  readonly asking: boolean;
  /** Whether the asking waits for medleyplay to be Online. */
  readonly waiting: boolean;
  readonly failure: string | null;
  /** Whether an AI model may be asked: one is set up. */
  readonly may_suggest: boolean;
}

/** What a picture is of: an album's cover, by its name and artist, or an artist's photo. */
export type Pictured =
  | { readonly kind: "album"; readonly album: string; readonly artist: string }
  | { readonly kind: "artist"; readonly artistId: string };

/** Where the links for a picture live in the API. */
function picturePath(pictured: Pictured): string {
  return pictured.kind === "album"
    ? "/api/image-links/album"
    : `/api/image-links/artist/${encodeURIComponent(pictured.artistId)}`;
}

/** What names an album in a request body; nothing for an artist, named in the path. */
function pictureBody(pictured: Pictured): Record<string, string> {
  return pictured.kind === "album" ? { album: pictured.album, artist: pictured.artist } : {};
}

function artistImageSearchPath(artistId: string): string {
  return `/api/image-search/artist/${encodeURIComponent(artistId)}`;
}

function imageSearchResultsPath(pictured: Pictured): string {
  return pictured.kind === "album"
    ? "/api/image-search/results"
    : `${artistImageSearchPath(pictured.artistId)}/results`;
}

/** An artist's or album's name shown on Tracks with more than the name in it, tidied. */
export interface NameToTidy {
  /** What the name names: an artist or album artist, or an album. */
  readonly kind: "artist" | "album";
  /** The name exactly as the Tracks show it. */
  readonly written: string;
  /** The name with the rest taken off. */
  readonly name: string;
  /** The release year the written name gave, if any. */
  readonly year: number | null;
  /** Where the Tracks show it: as the artist, the album artist, or the album. */
  readonly fields: readonly ("artist" | "album_artist" | "album")[];
  /** The Tracks showing it, oldest first. */
  readonly track_ids: readonly number[];
  /** How many of them show another year, which tidying keeps. */
  readonly years_differ: number;
}

export const DETAILS_ENRICHER = "bilibili-details";
/** The enricher that finds a Track's release and cover on MusicBrainz. */
export const MUSICBRAINZ_ENRICHER = "musicbrainz";
/** The enricher that suggests a Track's details from its video text with an AI model. */
export const AI_ENRICHER = "ai-details";
/** The enricher that looks a song's lyrics up, on LRCLIB. */
export const LYRICS_ENRICHER = "lyrics";

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
  /**
   * The Tracks it may be asked about; none while it is stopped or turned off. A Track in
   * `waiting` may be asked about once its time has come.
   */
  readonly eligible: readonly number[];
  /** The Tracks asked about before, and when each may be asked again. */
  readonly waiting: Readonly<Record<string, string>>;
  /** Someone may choose to ask again before the time comes: the AI only. */
  readonly asks_again: boolean;
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
  /** What was wrong with its answer, when it was unusable. */
  readonly failure_reason: UnusableReason | null;
  /** The status it refused the request with, when it refused one. */
  readonly failure_status: number | null;
  /** Whether it is asked; one turned off keeps its place and key. */
  readonly enabled: boolean;
}

/** What was wrong with an AI provider's unusable answer. */
export type UnusableReason = "rejected" | "redirected" | "cut_off" | "empty" | "not_json";

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

export type StorageFolderScope = "downloads" | "server";

/** Where the selected folder is, from `~` when in the home folder, and if Finder may show it. */
export interface StorageFolder {
  readonly path: string;
  readonly can_show: boolean;
}

/** Measured file lengths and selected startup settings, visible only to an admin. */
export interface StorageInspection {
  readonly downloads: number;
  readonly cache: number;
  readonly covers: number;
  readonly thumbnails: number;
  readonly database: number;
  readonly database_companions: number;
  readonly configuration: number;
  readonly multiple_accounts: boolean;
  readonly safe_mode: boolean;
  readonly wal_enabled: boolean;
}

/** The household's settings, and the revision they were read at; 0 if never saved. */
/** What someone asks the AI from: a Track's details, or the songs of its file. */
export type AiAsk = "details" | "songs";

/** A note offered beside the AI's button for `ask`, to send with the question. */
export interface AiNote {
  readonly ask: AiAsk;
  readonly text: string;
}

/** The most characters one note offered to the AI may have. */
export const MAX_AI_NOTE = 200;

/** The most characters a note sent with a question to the AI may have, all told. */
export const MAX_HINT = 500;

export interface Settings {
  /** The most the Downloads and cache may use, in bytes, or `null` for no limit. */
  readonly storage_limit: number | null;
  readonly removal_order: "least_favorite";
  /** A file this many minutes or longer is guessed an album; `null` guesses none. */
  readonly album_minutes: number | null;
  /** What becomes of a long file a song list was found for. */
  readonly split_albums: SplitAlbums;
  /** The sites asked for a song's lyrics, in turn, when LRCLIB has none. */
  readonly lyrics_sites: readonly LyricsSite[];
  /** Whether a song no site has lyrics for shows the nearest song's, suggested. */
  readonly suggest_lyrics: boolean;
  /** The sites asked for pictures of an artist, to choose its photo from. */
  readonly picture_sites: readonly PictureSite[];
  /** Whether an AI model is asked which picture is of an artist as soon as they are found. */
  readonly pick_pictures_by_ai: boolean;
  /** Which artists with no photo the picture sites are asked about without anyone asking. */
  readonly find_artist_photos: PhotoSearch;
  /** Which albums with no cover MusicBrainz is searched for without anyone asking. */
  readonly find_album_covers: CoverSearch;
  /** Whether an AI model is asked, in the background, which cover fits an album none plainly fits. */
  readonly pick_album_covers_by_ai: boolean;
  readonly suggest_missing_details_by_ai: boolean;
  /** The notes offered to whoever asks the AI, beside the button for each ask. */
  readonly ai_notes: readonly AiNote[];
  readonly revision: number;
}

/** The albums with no cover searched on their own: of the songs up next, every one, or none. */
export type CoverSearch = "off" | "up_next" | "missing";

export type MissingField = "artist" | "album" | "album_artist";

export interface CreditCandidate {
  readonly value: string;
  readonly origin: "library" | "ai";
}

export interface DetailImpact {
  readonly details: readonly {
    readonly field: Detail;
    readonly before: string | number;
    readonly after: string | number;
  }[];
  readonly split_songs: number;
  readonly affected_songs: number;
  readonly song_fields: readonly Detail[];
}

export interface MissingDetailReview {
  readonly field: MissingField;
  readonly value: string;
  readonly impact: DetailImpact;
}

export interface MissingDetailsItem {
  readonly track_id: number;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly kind: Kind;
  readonly key: string;
  readonly fields: readonly {
    readonly field: MissingField;
    readonly candidates: readonly CreditCandidate[];
  }[];
  readonly ai: "off" | "unavailable" | "no_metadata" | "ready" | "working" | "failed" | "answered";
}

export interface MissingDetailsPage {
  readonly tracks: readonly MissingDetailsItem[];
  readonly next_after: number | null;
}

/** An album with no cover, as written, and the cover suggested for it. */
export interface MissingCover {
  readonly album: string;
  /** Its album artist, else its artist. */
  readonly artist: string;
  readonly songs: number;
  /** The cover suggested, if any. */
  readonly suggested: string | null;
  /** Whether an AI model picked the one suggested. */
  readonly picked: boolean;
  /** Whether MusicBrainz was searched for it. */
  readonly found: boolean;
  readonly finding: boolean;
}

/** A cover found for an album, to make the album's cover. */
export interface ChosenAlbumCover {
  readonly album: string;
  readonly artist: string;
  readonly cover: string;
}

/** The artists with no photo looked up on their own: of the songs up next, every one, or none. */
export type PhotoSearch = "off" | "up_next" | "missing";

/** An artist linked to MusicBrainz with no photo, and the photo suggested for it. */
export interface MissingPhoto {
  readonly artist_id: string;
  readonly name: string;
  readonly songs: number;
  /** The cover suggested as its photo, if any. */
  readonly suggested: string | null;
  /** Whether an AI model picked the one suggested. */
  readonly picked: boolean;
  /** Whether Deezer was asked about it. */
  readonly found: boolean;
  readonly finding: boolean;
}

/** What becomes of a long file a song list was found for: nothing, offered, or split when trusted. */
export type SplitAlbums = "off" | "approval" | "auto";

/** Why a list offered for a long file is doubtful. */
export type SplitDoubt = "lists_differ" | "long_song" | "few_songs" | "unknown_length" | "invalid";

/** A long file shown as an album, not split yet, and the song list offered for it, if any. */
export interface OfferedFile {
  readonly track_id: number;
  readonly title: string;
  readonly artist: string;
  readonly length_ms: number | null;
  readonly offer: {
    readonly source: "both" | "video" | "ai";
    readonly songs: readonly {
      readonly start_ms: number;
      readonly title: string;
      readonly artist: string;
    }[];
    readonly doubts: readonly SplitDoubt[];
    /** Whether Auto splits the file by it. */
    readonly trusted: boolean;
    /** The offer as shown; named to split by it. */
    readonly signature: string;
  } | null;
  /** Whether its video's text was read, so the AI may be asked for a list. */
  readonly has_text: boolean;
}

/** An artist a name lists, as written, and how songs credit it. */
export interface ArtistCredit {
  readonly written: string;
  readonly role: "main" | "featured";
}

/** A name written as several artists, the artists it lists, and how many songs show it. */
export interface ArtistSplitOffer {
  readonly written: string;
  readonly artists: readonly ArtistCredit[];
  readonly songs: number;
  /** Whether it is linked to one MusicBrainz artist, so may name one artist. */
  readonly linked: boolean;
}

/** The names offered to split into their artists, and those split or kept as written. */
export interface ArtistSplits {
  readonly offers: readonly ArtistSplitOffer[];
  readonly decided: readonly { readonly written: string; readonly split: boolean }[];
}

/** One of the Library's artists a name names, the MusicBrainz artist it is, and its songs of the name. */
export interface ArtistOfName {
  readonly artist_id: string;
  readonly musicbrainz_id: string | null;
  readonly songs: number;
}

/** The songs of one album writing a name that are by one artist. */
export interface AlbumSongs {
  /** As most of its songs write it; empty for songs on none. */
  readonly album: string;
  readonly track_ids: readonly number[];
  readonly artist_id: string;
  /** Whether the household chose the artist of every one of them. */
  readonly confirmed: boolean;
}

/** A name that may name several artists, the artists it names, and its songs by album. */
export interface SharedName {
  readonly name: string;
  /** The Library's artists the name names, its first first. */
  readonly artists: readonly ArtistOfName[];
  /** The MusicBrainz artists going by the name exactly, scored high, best first. */
  readonly known: readonly string[];
  /** Whether the household keeps the name as naming one artist. */
  readonly kept: boolean;
  /** Whether songs of it wait to be confirmed, or it waits to be told apart. */
  readonly waiting: boolean;
  /** The name's songs by album and artist, most songs first. */
  readonly albums: readonly AlbumSongs[];
}

/** Songs of a name, and the artist they are by: one of the Library's, or one MusicBrainz knows. */
export type SongsBy =
  | { readonly track_ids: readonly number[]; readonly artist_id: string }
  | { readonly track_ids: readonly number[]; readonly musicbrainz_id: string };

/** The setting *Split albums*, and the long files offered under it. */
export interface SplitOffers {
  readonly setting: SplitAlbums;
  readonly files: readonly OfferedFile[];
}

/** Return the newer of the settings held and a read of them, so a late answer undoes no save. */
export function newestOf(held: Settings | undefined, read: Settings): Settings {
  return held !== undefined && held.revision > read.revision ? held : read;
}

/** An Account's own preferences, and their revision; 0 if never saved. */
export interface Preferences {
  /** The keyboard shortcuts changed from the page's defaults, or `null` for none. */
  readonly shortcuts: Readonly<Record<string, readonly string[]>> | null;
  /** How many songs History shows, or `null` for the default. */
  readonly history_length: HistoryLength | null;
  readonly lyrics_match_confirmation: LyricsMatchConfirmation | null;
  readonly revision: number;
}

export type LyricsMatchConfirmation = "ask" | "direct";

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

export interface FirstReads {
  readonly device: Promise<Response>;
  readonly account?: Promise<Response | undefined>;
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
  /** That play, once counted, for the page that takes it on to go on with. */
  readonly play?: HandedPlay | null;
  readonly sleep: { readonly left_ms: number; readonly set_ms_ago: number } | null;
}

/** A counted play handed on from one page to another, with how long it has been listened to. */
export interface HandedPlay {
  readonly id: string;
  readonly track_id: number;
  readonly played_at: string;
  readonly listened_ms: number;
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
  | { readonly kind: "playAt"; readonly key: string; readonly seconds: number }
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
      readonly play?: HandedPlay | null;
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
  /** Each favorite artist by the id of the Library's artist, as a Track's `artist_ids` names it. */
  readonly artists: readonly { readonly id: string }[];
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

/** The current Account's open choice in Downloads; parts are loaded on selection. */
export interface SavedVideoLookup {
  readonly id: number;
  readonly label: string;
  readonly state: Job["state"];
  readonly message: string;
  readonly result: LinkLookup | null;
}

/** Never send share parameters or credentials from the clipboard, even to the local server. */
function publicVideoInput(text: string): string {
  const input = text.trim();
  if (/^(?:BV[a-z0-9]{10}|av[0-9]{1,19})$/iu.test(input)) return input;
  const url = URL.canParse(input) ? new URL(input) : null;
  const host = url?.host.toLowerCase().replace(/\.$/u, "");
  const video =
    host === "b23.tv"
      ? /^\/[\w-]{1,64}\/?$/u
      : /^\/video\/(?:BV[a-z0-9]{1,62}|av[0-9]{1,19})\/?$/iu;
  if (
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !["bilibili.com", "www.bilibili.com", "m.bilibili.com", "b23.tv"].includes(host ?? "") ||
    !video.test(url.pathname)
  ) {
    throw new Error("Enter a Bilibili video link, short link, or video code.");
  }
  const part = url.searchParams.get("p");
  if (part && !/^[0-9]{1,4}$/u.test(part)) throw new Error("A part number is 1 to 9999.");
  url.hash = "";
  url.search = part ? `?p=${part}` : "";
  return url.href;
}

/** A part to add, under the title and artist the household chose. */
export interface PartChoice {
  readonly part: number;
  readonly title: string;
  readonly artist: string;
}

export type VideoChoices =
  | readonly PartChoice[]
  | { readonly mode: "download"; readonly parts: readonly number[] }
  | {
      readonly mode: "album" | "joined";
      readonly parts: readonly number[];
      readonly album: string;
      readonly artist: string;
    };

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
  /** The link to the standalone part or the joined album's whole video. */
  readonly link: string;
  readonly status: DownloadStatus;
  /** Why a Download failed or is unavailable, or `""`. */
  readonly message: string;
  /** What made a Download that exists; `manual` for a file the household added. */
  readonly backend: string | null;
  /** The Job downloading it, or the one that failed, to retry; `null` for none. */
  readonly job_id: number | null;
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

  get deviceRefusal(): boolean {
    return this.code !== null && DEVICE_REFUSALS.has(this.code);
  }
}

/** A Cleanup save that needs the listener to review its side effects. */
export class MissingDetailReviewError extends ApiError {
  constructor(
    message: string,
    readonly impact: DetailImpact,
  ) {
    super(409, message, "missing_detail_review_required");
  }
}

/** Whether the lyrics lookup was deferred because Auto-Match is working on this song. */
export function lyricsMatchInProgress(failure: unknown): boolean {
  return failure instanceof ApiError && failure.code === "lyrics_match_in_progress";
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
  const { detail, code, impact } = await reasonOf(response);
  if (
    response.status === 409 &&
    code === "missing_detail_review_required" &&
    impact !== undefined
  ) {
    return new MissingDetailReviewError(detail, impact);
  }
  const refusal = new ApiError(response.status, detail, code);
  if (refusal.deviceRefusal) {
    for (const listener of deviceListeners) {
      listener();
    }
  }
  return refusal;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return readResponse<T>(await fetch(path, init));
}

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw await refusalOf(response);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

function get<T>(path: string, first?: Promise<Response | undefined>): Promise<T> {
  const load = () => call<T>("GET", path);
  return first === undefined
    ? load()
    : first.then((response) =>
        response === undefined ? load() : readResponse<T>(response.clone()),
      );
}

/** The last answer read from a path, and the ETag it came with. */
interface Held {
  readonly etag: string;
  readonly value: unknown;
}

/** The read under way for a path, and the one asked for after it, if any. */
interface Flying {
  readonly answer: Promise<unknown>;
  next: Promise<unknown> | null;
}

/**
 * Reads of answers the server caches, each asked with the ETag of the last answer
 * held. A 304 gives back the very object held, so a caller sees that nothing changed
 * by its identity alone.
 *
 * A request carrying `If-None-Match` skips the browser's cache, so the 304 reaches
 * the page; the first read of a path, with nothing held, goes through that cache.
 * One read per path runs at a time: one asked for meanwhile waits for a single read
 * after it, shared by every caller who asked, so an older answer never lands after
 * a newer one.
 */
export class HeldReads {
  private readonly held = new Map<string, Held>();
  private readonly flying = new Map<string, Flying>();
  /** Moves on each `forget`, so an answer asked for before it isn't held after. */
  private era = 0;

  /** Read `path`, or wait for the read after the one under way. */
  read<T>(path: string): Promise<T> {
    const flying = this.flying.get(path);
    if (flying === undefined) {
      return this.start(path) as Promise<T>;
    }
    flying.next ??= flying.answer.then(ignore, ignore).then(() => this.start(path));
    return flying.next as Promise<T>;
  }

  /** Forget every answer held, as when the Account signs out. */
  forget(): void {
    this.held.clear();
    this.era += 1;
  }

  private start(path: string): Promise<unknown> {
    const answer = this.ask(path).finally(() => {
      const flying = this.flying.get(path);
      // A read asked for meanwhile takes this one's place as it starts.
      if (flying?.answer === answer && flying.next === null) {
        this.flying.delete(path);
      }
    });
    this.flying.set(path, { answer, next: null });
    return answer;
  }

  private async ask(path: string): Promise<unknown> {
    const era = this.era;
    const kept = this.held.get(path);
    const init: RequestInit = { credentials: "same-origin" };
    if (kept !== undefined) {
      init.headers = { "If-None-Match": kept.etag };
    }
    const response = await fetch(path, init);
    if (response.status === 304) {
      if (kept === undefined) {
        throw new ApiError(304, "The server said nothing changed, but nothing was held.");
      }
      return kept.value;
    }
    if (!response.ok) {
      throw await refusalOf(response);
    }
    const value: unknown = await response.json();
    if (import.meta.env.DEV) {
      freezeDeeply(value);
    }
    const etag = response.headers.get("ETag");
    if (etag !== null && era === this.era) {
      this.held.set(path, { etag, value });
    }
    return value;
  }
}

function ignore(): void {
  // A failed read still lets the one after it start.
}

/** Freeze `value` and everything in it, so code that changes an answer fails at once. */
function freezeDeeply(value: unknown): void {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const each of Object.values(value)) {
      freezeDeeply(each);
    }
  }
}

/** The held reads of this page; forgotten whenever the Account signed in changes. */
const heldReads = new HeldReads();

/** Forget every answer held, so the next Account starts with nothing. */
export function forgetHeldReads(): void {
  heldReads.forget();
}

/** Send `file` as the request's body, as it is. */
async function send<T>(method: string, path: string, file: Blob): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin", body: file });
  if (!response.ok) {
    throw await refusalOf(response);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** Say why the server refused: its own words, each check a request failed, or its status. */
async function reasonOf(response: Response): Promise<{
  readonly detail: string;
  readonly code: string | null;
  readonly impact?: DetailImpact;
}> {
  const status = response.statusText || `The server refused this (${String(response.status)}).`;
  try {
    const body = (await response.json()) as {
      detail?: unknown;
      code?: unknown;
      impact?: DetailImpact;
    };
    const code = typeof body.code === "string" ? body.code : null;
    if (typeof body.detail === "string") {
      return { detail: body.detail, code, ...(body.impact && { impact: body.impact }) };
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
  me: (first?: FirstReads["account"]) => get<Account>("/api/me", first),
  device: (first?: FirstReads["device"]) => get<DeviceInfo>("/api/device", first),
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
  tracks: () => heldReads.read<Track[]>("/api/tracks"),
  track: (trackId: number) => call<Track>("GET", `/api/tracks/${String(trackId)}`),
  details: (trackId: number) => call<Details>("GET", `/api/tracks/${String(trackId)}/details`),
  /** Bind the song's artist `name` to one of the artists going by it, or `null` for another. */
  chooseNamesake: (trackId: number, name: string, artistId: string | null) =>
    call<Details>("PUT", `/api/tracks/${String(trackId)}/namesake`, {
      name,
      artist_id: artistId,
    }),
  /** Set the household's values on the Tracks; `null` drops one. All change, or none. */
  /** Set `values` on every Track; `artists` chooses one song's artists one by one instead. */
  setDetails: (
    trackIds: readonly number[],
    values: Partial<Record<Detail, string | number | null>>,
    artists?: readonly Credit[],
  ) =>
    call<{ changed: number }>("POST", "/api/tracks/details", {
      track_ids: trackIds,
      values,
      ...(artists === undefined ? {} : { artists }),
    }),
  /** The lyrics the song shows, or `null` when no source has any. */
  lyrics: (trackId: number) => call<Lyrics | null>("GET", `/api/tracks/${String(trackId)}/lyrics`),
  /** Make `text` the household's lyrics for the song, or say it is instrumental. */
  setLyrics: (trackId: number, text: string, instrumental = false) =>
    call<Lyrics | null>("PUT", `/api/tracks/${String(trackId)}/lyrics`, { text, instrumental }),
  /** Drop the household's lyrics for the song; answers what it shows now. */
  forgetLyrics: (trackId: number) =>
    call<Lyrics | null>("DELETE", `/api/tracks/${String(trackId)}/lyrics`),
  /** Stop showing the lyrics suggested for the song; answers what it shows now. */
  dismissLyricsSuggestion: (trackId: number) =>
    call<Lyrics | null>("DELETE", `/api/tracks/${String(trackId)}/lyrics/suggestion`),
  /** What was found when the song's lyrics were last looked for by hand. */
  lyricsFound: (trackId: number) =>
    call<LyricsFound>("GET", `/api/tracks/${String(trackId)}/lyrics/found`),
  /** Look for the songs titled `title` by `artist` on the lyrics sites, for the song. */
  findLyrics: (trackId: number, title: string, artist: string) =>
    call<null>("POST", `/api/tracks/${String(trackId)}/lyrics/find`, { title, artist }),
  /** Ask an AI model which of the songs found is the song. */
  chooseLyrics: (trackId: number) =>
    call<null>("POST", `/api/tracks/${String(trackId)}/lyrics/choose`),
  lyricsMatches: (album: number) =>
    call<readonly LyricsMatch[]>("GET", `/api/tracks/${String(album)}/songs/lyrics-match`),
  startLyricsMatch: (album: number, songs: readonly SplitSong[]) =>
    call<readonly LyricsMatch[]>(
      "POST",
      `/api/tracks/${String(album)}/songs/lyrics-match`,
      songs.map(({ id, track_id, start_ms, title, artist }) => ({
        segment_id: id,
        track_id,
        start_ms,
        title,
        artist,
      })),
    ),
  /** Every artist name the Library shows, and the artists MusicBrainz knows them by. */
  artistNames: () => heldReads.read<ArtistNames>("/api/artist-names"),
  /** Ask MusicBrainz about each name not linked yet; answers how many are being asked. */
  lookUpArtists: (names: readonly string[]) =>
    call<{ asked: number }>("POST", "/api/artist-names/look-up", { names }),
  /** Ask an AI model which artist each name looked up and not linked names; links nothing. */
  recommendArtists: () => call<{ asked: number }>("POST", "/api/artist-names/recommend"),
  /** Link a name to an artist MusicBrainz named for it, or to none. */
  linkArtist: (name: string, artistId: string | null) =>
    call<undefined>("PUT", "/api/artist-names/link", { name, artist_id: artistId }),
  /** Forget a name's link, so it is offered again. */
  unlinkArtist: (name: string) => call<undefined>("POST", "/api/artist-names/unlink", { name }),
  /** Keep the name an artist is shown by and a note about it; `null` or empty forgets one. */
  setArtistDetails: (artistId: string, shownAs: string | null, about: string | null) =>
    call<undefined>("PUT", `/api/artists/${encodeURIComponent(artistId)}/details`, {
      shown_as: shownAs,
      about,
    }),
  /** Make `image` the household's photo of an artist, in place of Wikidata's. */
  setArtistPhoto: (artistId: string, image: Blob) =>
    send<undefined>("PUT", `/api/artists/${encodeURIComponent(artistId)}/photo`, image),
  /** Drop the household's photo of an artist, so Wikidata's shows again. */
  removeArtistPhoto: (artistId: string) =>
    call<undefined>("DELETE", `/api/artists/${encodeURIComponent(artistId)}/photo`),
  /** Whether an AI model is asked about an artist, and what it last suggested. */
  artistSuggestion: (artistId: string) =>
    call<ArtistSuggestionState>("GET", `/api/artists/${encodeURIComponent(artistId)}/suggestion`),
  /** Ask an AI model which name to show an artist by, and who it is; nothing changes. */
  suggestForArtist: (artistId: string) =>
    call<null>("POST", `/api/artists/${encodeURIComponent(artistId)}/suggestion`),
  /** What is known of the pictures Deezer has of an artist, and what is asked. */
  artistPictures: (artistId: string) =>
    call<ArtistPictures>("GET", `/api/artists/${encodeURIComponent(artistId)}/pictures`),
  /** Ask Deezer for pictures of the artists going by an artist's name; nothing changes. */
  findArtistPictures: (artistId: string) =>
    call<null>("POST", `/api/artists/${encodeURIComponent(artistId)}/pictures/find`),
  /** Every artist linked to MusicBrainz with no photo, those with a photo suggested first. */
  missingPhotos: () => heldReads.read<{ artists: MissingPhoto[] }>("/api/artist-photos/missing"),
  /** Ask Deezer about the artists with no photo of `trackIds`, or every one for `null`. */
  findPhotos: (trackIds: readonly number[] | null) =>
    call<{ asked: number }>("POST", "/api/artist-photos/find", { track_ids: trackIds }),
  /** Ask an AI model which picture found is of an artist, with what the listener says. */
  chooseArtistPicture: (artistId: string, hint: string) =>
    call<null>("POST", `/api/artists/${encodeURIComponent(artistId)}/pictures/choose`, { hint }),
  /** Suggest the picture `cover` no more as the artist's photo; nothing else changes. */
  dismissArtistPicture: (artistId: string, cover: string) =>
    call<undefined>("POST", `/api/artists/${encodeURIComponent(artistId)}/pictures/dismiss`, {
      cover,
    }),
  /** What is known of the covers of the album `album` by `artist`, its album artist or artist. */
  albumCovers: (album: string, artist: string) =>
    call<AlbumCovers>(
      "GET",
      `/api/album-covers?${new URLSearchParams({ album, artist }).toString()}`,
    ),
  /** Ask MusicBrainz for the covers of an album's releases; nothing changes. */
  findAlbumCovers: (album: string, artist: string) =>
    call<null>("POST", "/api/album-covers/find", { album, artist }),
  /** Ask an AI model which of an album's releases found is the album; nothing changes. */
  chooseAlbumCover: (album: string, artist: string) =>
    call<null>("POST", "/api/album-covers/choose", { album, artist }),
  /** Suggest a cover found for an album no more, even once found again. */
  dismissAlbumCover: (album: string, artist: string, cover: string) =>
    call<undefined>("POST", "/api/album-covers/dismiss", { album, artist, cover }),
  /** Every album with no cover, those with a cover suggested first, then most songs. */
  missingCovers: () => heldReads.read<{ albums: MissingCover[] }>("/api/album-covers/missing"),
  missingDetails: (after: number) =>
    call<MissingDetailsPage>("GET", `/api/missing-details?after=${String(after)}`),
  askMissingDetails: (track: number, key: string) =>
    call<Job>("POST", `/api/missing-details/${String(track)}/ask`, { key }),
  decideMissingDetail: (
    track: number,
    key: string,
    field: MissingField,
    candidate?: CreditCandidate,
  ) =>
    call<undefined>("POST", `/api/missing-details/${String(track)}/decision`, {
      key,
      field,
      ...candidate,
    }),
  /** Send the songs coming up, the one playing first; their albums with no cover are searched. */
  findMissingCovers: (trackIds: readonly number[]) =>
    call<{ asked: number }>("POST", "/api/album-covers/missing/find", { track_ids: trackIds }),
  /** Make each cover found its album's, on songs with none; say how many albums now show it. */
  useAlbumCovers: (albums: readonly ChosenAlbumCover[]) =>
    call<{ used: number }>("POST", "/api/album-covers/use", { albums }),
  imageSearch: () => call<{ configured: boolean }>("GET", "/api/image-search"),
  artistImageSearch: (artistId: string) =>
    call<{ configured: boolean; name: string }>("GET", artistImageSearchPath(artistId)),
  saveImageSearchKey: (key: string) => call<unknown>("PUT", "/api/image-search/key", { key }),
  removeImageSearchKey: () => call<unknown>("DELETE", "/api/image-search/key"),
  searchImages: (pictured: Pictured) =>
    call<unknown>(
      "POST",
      imageSearchResultsPath(pictured),
      pictured.kind === "album" ? pictureBody(pictured) : undefined,
    ),
  imageSearchResults: (pictured: Pictured) =>
    call<ImageSearchResults>(
      "GET",
      pictured.kind === "album"
        ? `${imageSearchResultsPath(pictured)}?${new URLSearchParams(pictureBody(pictured)).toString()}`
        : imageSearchResultsPath(pictured),
    ),
  /** The links an AI model last suggested for a picture, and what is asked. */
  imageLinks: (pictured: Pictured) =>
    call<PictureLinks>(
      "GET",
      pictured.kind === "album"
        ? `${picturePath(pictured)}?${new URLSearchParams(pictureBody(pictured)).toString()}`
        : picturePath(pictured),
    ),
  /** Ask an AI model for links to a picture; nothing is fetched. */
  suggestImageLinks: (pictured: Pictured, hint = "") =>
    call<null>("POST", `${picturePath(pictured)}/suggest`, { ...pictureBody(pictured), hint }),
  /** Fetch the picture at a link suggested; answers its cover when it was fetched before. */
  approveImageLink: (pictured: Pictured, url: string) =>
    call<{ readonly cover: string | null }>("POST", `${picturePath(pictured)}/approve`, {
      ...pictureBody(pictured),
      url,
    }),
  /** Make a cover already kept, such as a picture fetched, the household's photo of an artist. */
  useArtistPhotoCover: (artistId: string, cover: string) =>
    call<undefined>("POST", `/api/artists/${encodeURIComponent(artistId)}/photo/cover`, { cover }),
  /** The long files a song list was found for, to split or keep as one file. */
  splitOffers: () => heldReads.read<SplitOffers>("/api/split-offers"),
  /** Split each file by the offer seen for it; one whose offer changed is left as it is. */
  splitFiles: (files: readonly { readonly track_id: number; readonly signature: string }[]) =>
    call<{ split: number; left: number }>("POST", "/api/split-offers/split", { files }),
  /** Keep each file as one, so no song list is offered for it again. */
  keepFiles: (trackIds: readonly number[]) =>
    call<{ kept: number }>("POST", "/api/split-offers/keep", { track_ids: trackIds }),
  /** The artist names written as several artists, to split, and those decided. */
  artistSplits: () => heldReads.read<ArtistSplits>("/api/artist-splits"),
  /** Split each name into the artists it lists. */
  splitArtistNames: (names: readonly string[]) =>
    call<null>("POST", "/api/artist-splits/split", { names }),
  /** Keep each name as written, as one artist. */
  keepArtistNames: (names: readonly string[]) =>
    call<null>("POST", "/api/artist-splits/keep", { names }),
  /** Forget what was decided for each name, so it is offered again. */
  forgetArtistNames: (names: readonly string[]) =>
    call<null>("POST", "/api/artist-splits/forget", { names }),
  /** The names that may name several artists, most songs first. */
  sharedNames: () => heldReads.read<{ names: SharedName[] }>("/api/shared-names"),
  /** Bind each album's songs of a name to the artist chosen for them, confirming them. */
  tellApart: (name: string, albums: readonly SongsBy[]) =>
    call<null>("PUT", "/api/shared-names/albums", { name, albums }),
  /** Keep each name as naming one artist. */
  keepSharedNames: (names: readonly string[]) =>
    call<null>("POST", "/api/shared-names/keep", { names }),
  /** Forget that each name is kept as one, so it waits to be told apart again. */
  forgetSharedNames: (names: readonly string[]) =>
    call<null>("POST", "/api/shared-names/forget", { names }),
  /** The artist and album names written with more than the name in them, tidied. */
  namesToTidy: () => heldReads.read<{ names: NameToTidy[] }>("/api/names-to-tidy"),
  /** Show a name's tidy form on every Track showing it, and its year where none shows. */
  tidyName: (kind: NameToTidy["kind"], written: string) =>
    call<{ changed: number }>("POST", "/api/names-to-tidy/tidy", { kind, written }),
  /** Tidy each of `names` at once, passing over any with nothing left to tidy. */
  tidyNames: (names: readonly Pick<NameToTidy, "kind" | "written">[]) =>
    call<{ changed: number }>("POST", "/api/names-to-tidy/tidy-all", {
      names: names.map(({ kind, written }) => ({ kind, written })),
    }),
  /** Keep a name as written, so it is no longer offered for tidying. */
  keepName: (kind: NameToTidy["kind"], written: string) =>
    call<undefined>("POST", "/api/names-to-tidy/keep", { kind, written }),
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
  /** Say what is known of the gaps in a file's audio. */
  silences: (trackId: number) => call<Silences>("GET", `/api/tracks/${String(trackId)}/silences`),
  /** Find the gaps in a file's audio, unless they are known or being found. */
  findSilences: (trackId: number) =>
    call<Silences>("POST", `/api/tracks/${String(trackId)}/silences/find`),
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
  /** Switch whether a Playlist, Favorites too, keeps its songs downloaded. */
  setKeepDownloaded: (id: string, keep: boolean) =>
    call<Playlist>("PUT", `/api/playlists/${id}/keep_downloaded`, { keep_downloaded: keep }),
  features: () => call<Features>("GET", "/api/features"),
  preferences: () => call<Preferences>("GET", "/api/me/preferences"),
  savePreferences: (change: PreferencesChange) =>
    call<Preferences>("PUT", "/api/me/preferences", change),
  settings: () => call<Settings>("GET", "/api/settings"),
  saveSettings: (settings: Settings) => call<Settings>("PUT", "/api/settings", settings),
  /** Where the Downloads folder is, and whether this request may have Finder show it. */
  storageFolder: (scope?: StorageFolderScope) =>
    call<StorageFolder>("GET", `/api/storage/folder${scope === "server" ? "?scope=server" : ""}`),
  inspectStorage: () => call<StorageInspection>("GET", "/api/storage/inspection"),
  /** Have Finder show the Downloads folder: an admin's, on the Mac the server runs on. */
  showStorageFolder: (scope?: StorageFolderScope) =>
    call<undefined>("POST", `/api/storage/folder/show${scope === "server" ? "?scope=server" : ""}`),
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
  /** Turn a provider on or off, keeping its place and key; admins only. */
  setAiEnabled: (id: string, enabled: boolean) =>
    call<AiProvider>("PUT", `/api/ai/providers/${id}/enabled`, { enabled }),
  /** Ask the providers in the order of `ids`, which names each once; admins only. */
  reorderAi: (ids: readonly string[]) => call<AiProvider[]>("PUT", "/api/ai/order", { ids }),
  /** Forget a provider and delete its key; admins only. */
  removeAiProvider: (id: string) => call<undefined>("DELETE", `/api/ai/providers/${id}`),
  /** Where another device on the network can reach the server: addresses, then names. */
  addresses: () => call<{ addresses: string[] }>("GET", "/api/addresses"),
  /** The enricher's state, and the Tracks it may be asked about. */
  enricher: (name: string) => heldReads.read<Enricher>(`/api/enrichers/${name}`),
  /** Ask the enricher about one Track: a Job that runs once the Mode is Online. */
  /** Ask the enricher about a Track; the AI may be asked `again`, with a `hint` of yours. */
  findDetails: (name: string, trackId: number, again?: { readonly hint: string }) =>
    call<Job>(
      "POST",
      `/api/enrichers/${name}/tracks/${String(trackId)}`,
      again === undefined ? undefined : { again: true, hint: again.hint },
    ),
  /** Let a stopped enricher be asked again; admins only. */
  resetEnricher: (name: string) => call<undefined>("POST", `/api/enrichers/${name}/reset`),
  /** Choose when the enricher is asked; admins only. Finding all queues every Track at once. */
  setEnricherMode: (name: string, mode: EnricherMode) =>
    call<Enricher>("PUT", `/api/enrichers/${name}/mode`, { mode }),
  lookUpLink: async (link: string) =>
    call<SavedVideoLookup>("POST", "/api/links/lookups", { link: publicVideoInput(link) }),
  videoLookups: () => call<SavedVideoLookup[]>("GET", "/api/links/lookups"),
  videoLookup: (id: number) => call<SavedVideoLookup>("GET", `/api/links/lookups/${String(id)}`),
  dismissLookup: (id: number) => call<undefined>("DELETE", `/api/links/lookups/${String(id)}`),
  addLink: (id: number, quality: string, choices: VideoChoices) =>
    call<AddedPart[]>("POST", `/api/links/lookups/${String(id)}`, {
      quality,
      ...("mode" in choices ? choices : { parts: choices }),
    }),
  /** Where a site Track's Download stands. */
  download: (trackId: number) =>
    call<TrackDownload>("GET", `/api/tracks/${String(trackId)}/download`),
  /** Each Download a Job is getting, the first asked for first, with its Track. */
  downloads: () => call<DownloadUnderWay[]>("GET", "/api/downloads"),
  /** Run a failed or cancelled Job again, as a new Job. */
  retryJob: (jobId: number) => call<Job>("POST", `/api/jobs/${String(jobId)}/retry`),
  /** Cancel a Job the Account asked for; cancelling one that ended changes nothing. */
  cancelJob: (jobId: number) => call<Job>("POST", `/api/jobs/${String(jobId)}/cancel`),
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
  /** Mark or unmark one of the Library's artists as your favorite; answers with your favorites. */
  setArtistFavorite: (artistId: string, favorite: boolean) =>
    call<FavoritesRead>("PUT", `/api/favorites/artists/${artistId}`, { favorite }),
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
  previewRatingsImport: (file: Blob, mode: ImportMode) =>
    send<RatingsImport>("POST", `/api/ratings/import/preview?mode=${mode}`, file),
  /** Merge a Rate Your Music export's album ratings into yours, or replace yours with them. */
  importRatings: (file: Blob, mode: ImportMode) =>
    send<RatingsImport>("POST", `/api/ratings/import?mode=${mode}`, file),
  /** The albums you imported, in the order you imported them. */
  importedAlbums: () => call<ImportedAlbum[]>("GET", "/api/ratings/imported"),
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

/** What importing does with the albums you imported before: keep them, or drop them. */
export type ImportMode = "merge" | "replace";

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
  /** The albums of your earlier import this replaces: all when replacing, those rated again when merging. */
  readonly replaced_albums: number;
  /** The albums your import holds after. */
  readonly total_albums: number;
}

/** An album you imported, your rating of it if you rated it, and your review. */
export interface ImportedAlbum {
  readonly artist: string;
  readonly album: string;
  readonly stars: number | null;
  readonly note: string;
  /** Whether the Library has the album. */
  readonly in_library: boolean;
}

/** Your imported rating of an album, if you rated it, and your review. */
export interface AlbumRating {
  readonly stars: number | null;
  readonly note: string;
}
