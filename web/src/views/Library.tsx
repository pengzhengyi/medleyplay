/**
 * @file The signed-in page: the views, the search, the queue, and the player.
 */

import {
  CloudSlashIcon,
  DeviceMobileSpeakerIcon,
  GithubLogoIcon,
  KeyboardIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AI_ENRICHER,
  type Account,
  ApiError,
  type Kind,
  type Lyrics,
  type MissingDetailReview,
  type SavedVideoLookup,
  LYRICS_ENRICHER,
  type Track,
  api,
} from "../api";
import { preloadWhenIdle } from "../lazyPart";
import { LOOKUPS, type Lookup, coverStatusOf } from "../library/lookups";
import { playingPages } from "../library/playingPages";
import type { CoverAlbum } from "./PictureEditor";
import { afterNextPaint } from "../library/stages";
import { useLibrary } from "../library/useLibrary";
import { LyricsAvailabilityProvider } from "./LyricsAvailabilityProvider";
import { useLookAhead } from "../library/useLookAhead";
import { useLyrics } from "../library/useLyrics";
import { songTimeOf } from "../lyrics";
import { type StepCommand, albumSteps, playingOf, songPlaying, stepFor } from "../player/albumNow";
import { useStation } from "../library/useStation";
import { linksOf, withLinkedFavorites } from "../library/artistLinks";
import { playingFavorite } from "../library/favoriteGroups";
import { useArtistNames } from "../library/useArtistNames";
import { useNamesToTidy } from "../library/useNamesToTidy";
import { useArtistSplits } from "../library/useArtistSplits";
import { useCoverLookAhead } from "../library/useCoverLookAhead";
import { useMissingCovers } from "../library/useMissingCovers";
import { useMissingPhotos } from "../library/useMissingPhotos";
import { usePhotoLookAhead } from "../library/usePhotoLookAhead";
import { useSharedNames } from "../library/useSharedNames";
import { useSplitOffers } from "../library/useSplitOffers";
import { toDoOf } from "../library/cleanUp";
import {
  CoverScopeError,
  type CoverPlace,
  albumArtistOf,
  coverPlaceOf,
  sameCoverPlace,
} from "../library/views";
import { current, repeatAfter, upNext } from "../player/queue";
import { checkable, offlineBecause } from "../mode";
import { usePlayer } from "../player/usePlayer";
import { takeOf } from "../player/remote";
import { useRemotePlayer } from "../player/useRemotePlayer";
import { useSleepTimer } from "../player/useSleepTimer";
import { useSpeaker } from "../player/useSpeaker";
import { stepVolume } from "../player/volume";
import { hrefOf, navigate, useRoute } from "../routes";
import { useFormattingLocale, useWords } from "../locale";
import { learnLayout, openAccount, useBindings } from "../shortcuts";
import { AddToPlaylist } from "./AddToPlaylist";
import { AskAiAgain } from "./AskAiAgain";
import { CheckNetwork } from "./CheckNetwork";
import { AddFile } from "./AddFile";
import { AddLink } from "./AddLink";
import { VideoLookups } from "./VideoLookups";
import { DialogOpening } from "./DialogOpening";
import { EditAlbum } from "./EditAlbum";
import { EditDetails } from "./EditDetails";
import { LazyPart } from "./LazyPart";
import type { AiAsk, SilenceFinder } from "./EditSongs";
import { LibrarySkeleton } from "./LibrarySkeleton";
import { NowPlaying } from "./NowPlaying";
import { ListenOnDevice, LyricsEditor, PRELOADED, SongsEditor } from "./parts";
import { AccountMenu, Nav } from "./Nav";
import { PlayOn, type PlaysOn } from "./PlayOn";
import { PlayerBar } from "./PlayerBar";
import { QueuePanel } from "./QueuePanel";
import { SearchBox } from "./SearchBox";
import { HoldForShortcuts, ShortcutList } from "./ShortcutList";
import { type ShortcutHandlers, Shortcuts } from "./Shortcuts";
import { REPEATS, shuffleSaid } from "./playModes";
import { ThemeSwitch } from "./ThemeSwitch";
import { WaitingDevices } from "./WaitingDevices";
import type { TrackActions } from "./TrackTable";
import { CurrentView } from "./Views";
import { AiSetUpContext } from "./aiSetUp";
import { Hint } from "./Hint";
import { setRailCollapsed, setRailMinimized, useRailCollapsed, useRailMinimized } from "../rail";

/** How long a notice, such as a song added to a Playlist, stays. */
const NOTICE_MS = 4000;
/** How far a shortcut seeks back or ahead, as the arrows do on the position. */
const SEEK_SECONDS = 5;
/** Where the queue can close, as the page's styles have it; wider, it is always open. */
const NARROW = "(width <= 64rem)";
type LibraryNotice =
  | string
  | { readonly kind: "playlist"; readonly title: string; readonly playlists: readonly string[] }
  | { readonly kind: "favorite"; readonly key: string; readonly title: string }
  | { readonly kind: "playback"; readonly key: string }
  | {
      readonly kind: "message";
      readonly key: string;
      readonly values?: Readonly<Record<string, string | number>>;
    }
  | { readonly kind: "adding"; readonly count: number; readonly offline: boolean };
type LibrarySpeech =
  string | { readonly key: string; readonly title: string; readonly offline: boolean };
interface CoverCheck {
  readonly album?: CoverAlbum;
  readonly uploaded?: true;
}

/** Everything a signed-in Account sees. */

/** The gaps in a file's audio, as the server knows and finds them. */
const SILENCES: SilenceFinder = { read: api.silences, find: api.findSilences };

export function Library({
  account,
  onHost,
  onSignedOut,
}: {
  readonly account: Account;
  /** Whether this page is on the computer medleyplay runs on, and so plays for the Account. */
  readonly onHost: boolean;
  readonly onSignedOut: () => void;
}) {
  const route = useRoute();
  const t = useWords();
  const locale = useFormattingLocale();
  const listFormat = useMemo(() => new Intl.ListFormat(locale, { type: "conjunction" }), [locale]);
  const library = useLibrary(onSignedOut);
  const catalog = library.tracks;
  const byId = useMemo(
    () => new Map([...catalog].filter(([, track]) => track.download_dismissed !== true)),
    [catalog],
  );
  const tracks = useMemo(() => [...byId.values()], [byId]);
  const admin = account.role === "admin";
  const { refreshFeatures } = library;
  const aiSetUp = useMemo(
    () => ({
      missing: library.aiSetUp === false,
      admin,
      recheck: () => refreshFeatures().then((setUp) => setUp === true),
    }),
    [library.aiSetUp, admin, refreshFeatures],
  );
  // The artists a typed song list offers, each once.
  const artists = useMemo(
    () => [...new Set(tracks.map((track) => track.artist.trim()).filter((name) => name !== ""))],
    [tracks],
  );
  const [local, audio] = usePlayer(catalog, onSignedOut);
  const localSleep = useSleepTimer(local.pause);
  useSpeaker(onHost, local, localSleep, byId, library.speaker, library.onCommand);
  // Where a page that isn't on the computer plays; with the computer gone, it plays here.
  const [playsOn, setPlaysOn] = useState<PlaysOn>("here");
  const [playOnFailed, setPlayOnFailed] = useState("");
  const speaker = library.speaker ?? null;
  const canPlayOnComputer = !onHost && speaker !== null;
  if (playsOn === "computer" && !canPlayOnComputer) {
    setPlaysOn("here");
  }
  const onComputer = playsOn === "computer" && canPlayOnComputer;
  const [remote, remoteSleep, command] = useRemotePlayer(speaker, onComputer, onSignedOut);
  const player = onComputer ? remote : local;
  const sleep = onComputer ? remoteSleep : localSleep;
  const playOnFailedFor = (failure: unknown) => {
    setPlayOnFailed(failure instanceof Error ? failure.message : String(failure));
  };
  /**
   * Play on `where`, moving what plays there, as Spotify Connect does. The device the
   * music leaves stops only once the computer has the command, so a refusal leaves
   * the music where it was.
   */
  const playOn = (where: PlaysOn) => {
    setPlayOnFailed("");
    if (where === playsOn) {
      return;
    }
    if (where === "here") {
      const handoff = remote.status.kind === "playing" ? remote.handoff() : undefined;
      if (handoff === undefined) {
        setPlaysOn("here");
        return;
      }
      command({ kind: "pause" }).then(() => {
        local.take(handoff, true);
        setPlaysOn("here");
      }, playOnFailedFor);
      return;
    }
    const handoff = local.status.kind === "playing" ? local.handoff() : undefined;
    if (handoff === undefined) {
      setPlaysOn("computer");
      return;
    }
    command(takeOf(handoff, true)).then(() => {
      local.pause();
      setPlaysOn("computer");
    }, playOnFailedFor);
  };
  // What is read beside the songs is read once they are in, and again whenever the
  // Library may have changed; never for a heart or a rating.
  const refreshes = library.loaded ? library.refreshes : undefined;
  const artistNames = useArtistNames(refreshes);
  const namesToTidy = useNamesToTidy(refreshes);
  const splitOffers = useSplitOffers(refreshes);
  const artistSplits = useArtistSplits(refreshes);
  const sharedNames = useSharedNames(refreshes);
  const missingPhotos = useMissingPhotos(refreshes);
  const missingCovers = useMissingCovers(refreshes);
  const toDo = toDoOf(
    namesToTidy.names,
    artistNames.names,
    splitOffers.offers,
    artistSplits.splits,
    sharedNames.names,
    missingPhotos.artists,
    missingCovers.albums,
  );
  const links = useMemo(() => linksOf(artistNames.names, tracks), [artistNames.names, tracks]);
  // A favorite artist makes each of its names, and every name linked with one, a favorite.
  const favorites = useMemo(
    () => withLinkedFavorites(library.favoriteGroups, links),
    [library.favoriteGroups, links],
  );
  // A heart names the artist as written, and the artist it is bound to where the song says;
  // the server keeps the Library's artist.
  const favoriteArtist = (name: string, favorite: boolean, bound?: string) => {
    const id = bound ?? links.idOf(name);
    if (id !== undefined) {
      library.setArtistFavorite(id, favorite);
    }
  };
  const station = useStation(player, tracks, account.id, favorites);
  // On a narrow screen the queue opens over the page, from the player.
  const [queueOpen, setQueueOpen] = useState(false);
  // When the Mode a check left Offline began, so the header says it is still Offline.
  const [stillSince, setStillSince] = useState<string | null>(null);
  // The view Now Playing was opened over, while it is open; going to another view closes it.
  const here = hrefOf(route);
  const [nowPlayingOver, setNowPlayingOver] = useState<string | undefined>(undefined);
  if (nowPlayingOver !== undefined && nowPlayingOver !== here) {
    setNowPlayingOver(undefined);
  }
  const [nowPlayingQueue, setNowPlayingQueue] = useState(false);
  const playingId = current(player.queue)?.trackId;
  const playing = playingId === undefined ? undefined : byId.get(playingId);
  // The song playing, a song of a file playing whole too, whose lyrics show.
  const songTime =
    playing === undefined
      ? undefined
      : songTimeOf(playing, playingOf(player.queue, byId, player.position), player.position);
  const song = songTime?.song;
  const lyricsLookup = song === undefined ? undefined : library.lookups.get(song.id);
  // Counts the household's lyrics saved or removed here, so the song playing reads its again.
  const [lyricsEdits, setLyricsEdits] = useState(0);
  const {
    lyrics,
    failed: lyricsFailed,
    confirm: confirmLyrics,
  } = useLyrics(
    song?.id,
    `${lyricsLookup?.enricher === LYRICS_ENRICHER ? lyricsLookup.state : ""}:${String(lyricsEdits)}:${library.lyricsVersion(song?.id)}`,
  );
  const lyricsChanged = (trackId: number, answer: Lyrics | null) => {
    confirmLyrics(trackId, answer);
    setLyricsEdits((count) => count + 1);
    return answer;
  };
  /** The editor of `track`'s lyrics, syncing them to it as the player plays it. */
  const lyricsOf = (track: Track) => {
    if (track.kind === "album") {
      return undefined;
    }
    const current = song?.id === track.id;
    return {
      label: "Lyrics",
      editor: (
        <LazyPart doing="Opening the lyrics…">
          <LyricsEditor.Component
            key={track.id}
            load={() => api.lyrics(track.id)}
            refreshVersion={library.lyricsVersion(track.id)}
            save={(text, instrumental) =>
              api
                .setLyrics(track.id, text, instrumental)
                .then((answer) => lyricsChanged(track.id, answer))
            }
            forget={() =>
              api.forgetLyrics(track.id).then((answer) => lyricsChanged(track.id, answer))
            }
            song={track}
            player={{
              current,
              playing: current && player.status.kind === "playing",
              seconds: current ? (songTime?.seconds ?? 0) : 0,
              start: () => {
                player.playNow(track);
              },
              toggle: player.toggle,
              seek: (seconds) => {
                player.seek((songTime?.from ?? 0) + seconds);
              },
            }}
          />
        </LazyPart>
      ),
    };
  };
  // An enricher set to the next to play is asked about the song playing and the one after.
  useLookAhead([playingId, upNext(player.queue)[0]?.trackId], byId, library);
  usePhotoLookAhead([playingId, upNext(player.queue)[0]?.trackId]);
  // Their albums with no cover are searched as the household chose, those coming up first.
  useCoverLookAhead([playingId, ...upNext(player.queue).map((entry) => entry.trackId)]);
  // With nothing left playing, Now Playing closes, and the next song doesn't reopen it.
  if (nowPlayingOver !== undefined && playing === undefined && library.loaded) {
    setNowPlayingOver(undefined);
  }
  const nowPlaying = nowPlayingOver !== undefined && playing !== undefined;
  // The song being added to Playlists, while its dialog is open, and what was last done.
  const [adding, setAdding] = useState<Track | undefined>(undefined);
  // The song whose details are being edited, while its dialog is open.
  // The Track whose details are edited, and whether the dialog opens on its file's songs.
  const [editing, setEditing] = useState<
    | { readonly track: Track; readonly songs: boolean; readonly review?: MissingDetailReview }
    | undefined
  >(undefined);
  // The songs of their own whose album is being edited, while its dialog is open.
  const [editingAlbum, setEditingAlbum] = useState<readonly Track[] | undefined>(undefined);
  // The link or code being added from Bilibili, and the Track whose file is being added by hand.
  const [linking, setLinking] = useState<{ page: string; opening: Promise<SavedVideoLookup> }>();
  if (linking && linking.page !== here) setLinking(undefined);
  const openVideo = (opening: Promise<SavedVideoLookup>) => {
    setLinking({ page: here, opening });
  };
  const [filing, setFiling] = useState<Track | undefined>(undefined);
  // The Track whose lookup waits for someone to agree to ask the AI about it again.
  const [askingAgain, setAskingAgain] = useState<
    { readonly lookup: Lookup; readonly track: Track } | undefined
  >(undefined);
  const [notice, setNotice] = useFading<LibraryNotice>("");
  // Said to screen readers only: what the page shows where it happens, such as a lookup.
  const [said, setSaid] = useFading<LibrarySpeech>("");
  const [listingShortcuts, setListingShortcuts] = useState(false);
  // Whether the guide to listening on another device is open.
  const [listening, setListening] = useState(false);
  // The header stays at the top, so what else stays there sits under it, however tall it is.
  const top = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = top.current;
    if (header === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const measured = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        "--top-height",
        `${String(header.offsetHeight)}px`,
      );
    });
    measured.observe(header);
    return () => {
      measured.disconnect();
    };
  }, []);
  const keys = useBindings();
  // The Account's shortcuts, read again when the page is shown, as they may have
  // changed on another device.
  useEffect(() => {
    learnLayout();
    const load = () => {
      openAccount(account.id).catch(() => {
        // This browser's copy, or the defaults, serve until the server answers.
      });
    };
    const onShown = () => {
      if (document.visibilityState === "visible") {
        load();
      }
    };
    load();
    document.addEventListener("visibilitychange", onShown);
    return () => {
      document.removeEventListener("visibilitychange", onShown);
    };
  }, [account.id]);

  /** Ask `lookup` about `track`, `again` once someone agreed, and say how it went. */
  const find = (lookup: Lookup, track: Track, again = false) => {
    library.find(lookup.enricher, track.id, again ? { hint: "" } : undefined).then(
      () => {
        setSaid({
          key: lookup.notice,
          title: track.title,
          offline: library.mode?.online === false,
        });
      },
      (failure: unknown) => {
        if (failure instanceof ApiError && failure.code === "asked_recently") {
          setAskingAgain({ lookup, track });
          return;
        }
        setSaid(failure instanceof Error ? failure.message : String(failure));
      },
    );
  };
  /** Use `cover` on every song of `songs`. */
  const setAlbumCover = async (songs: readonly Track[], cover: string, album?: CoverAlbum) => {
    const [first] = songs;
    if (first === undefined) throw new CoverScopeError("This track is no longer in the Library.");
    await coverAlbumOf(first, { kind: "songs", ids: songs.map(({ id }) => id) }, cover, {
      album: album ?? { album: first.album, artist: albumArtistOf(first) },
    });
    noteAlbumCover(songs.length);
  };
  const noteAlbumCover = (count: number) => {
    setNotice({
      kind: "message",
      key: "Used the cover on {{count}} songs.",
      values: { count },
    });
  };
  // The image becomes the first song's cover, then every song's.
  const uploadAlbumCover = async (songs: readonly Track[], image: File, subject?: CoverAlbum) => {
    const [first] = songs;
    if (first === undefined) throw new CoverScopeError("This track is no longer in the Library.");
    const place: CoverPlace = { kind: "songs", ids: songs.map(({ id }) => id) };
    const album = subject ?? { album: first.album, artist: albumArtistOf(first) };
    await checkCoverTarget(first, place, { album });
    const cover = (await library.setCover(first.id, image)).origins.household?.cover;
    if (typeof cover !== "string") {
      throw new Error("The cover could not be kept.");
    }
    await coverAlbumOf(first, place, cover, { album, uploaded: true });
    noteAlbumCover(songs.length);
    return cover;
  };
  /**
   * Make `cover` the cover of `track`'s album, or drop the album's with `null`: on its split
   * file, dropping the song's own so it shows the file's, or on every song of its album.
   */
  async function coverAlbumOf(
    track: Track,
    place: CoverPlace,
    cover: string | null,
    check: CoverCheck = {},
  ) {
    await checkCoverTarget(track, place, check);
    const { id } = track;
    if (place.kind === "songs") {
      await library.setDetailsOn(place.ids, { cover });
      return;
    }
    await library.setDetailsOn(cover === null ? [place.id, id] : [place.id], { cover });
    if (cover !== null) {
      await library.setDetailsOn([id], { cover: null });
    }
  }
  function trackForCover(id: number) {
    const shown = byId.get(id);
    if (shown === undefined) throw new CoverScopeError("This track is no longer in the Library.");
    return { shown, place: coverPlaceOf(shown, tracks) };
  }
  async function checkCoverTarget(
    shown: Track,
    expected: CoverPlace,
    { album, uploaded }: CoverCheck = {},
  ) {
    const partial =
      "The image was uploaded to one track, but it was not applied to the rest of the album. Review the updated scope before trying again.";
    const latest = await api.tracks().catch((failure: unknown) => {
      if (uploaded) throw new CoverScopeError(partial);
      throw failure;
    });
    const current = latest.find((track) => track.id === shown.id);
    if (current === undefined) {
      library.reloadTracks();
      throw new CoverScopeError(uploaded ? partial : "This track is no longer in the Library.");
    }
    const page =
      album !== undefined
        ? playingPages(latest, undefined).album(album.artist, album.album)
        : undefined;
    const target: CoverPlace =
      page === undefined
        ? coverPlaceOf(current, latest)
        : {
            kind: "songs",
            ids: page.file === undefined ? page.songs.map(({ id }) => id) : [page.file.id],
          };
    if (
      (album === undefined &&
        (current.album !== shown.album ||
          albumArtistOf(current) !== albumArtistOf(shown) ||
          current.segment_of !== shown.segment_of ||
          current.split !== shown.split)) ||
      !sameCoverPlace(expected, target)
    ) {
      library.reloadTracks();
      throw new CoverScopeError(
        uploaded ? partial : "The cover target changed. Review the updated scope and try again.",
      );
    }
  }
  const coverHelpOf = (id: number) => {
    const track = byId.get(id);
    if (track === undefined) return t("This track is no longer in the Library.");
    const place = coverPlaceOf(track, tracks);
    if (place.kind === "file") {
      return t(
        "Cover changes apply immediately to the parent album file. Removing the cover also clears this song's override.",
      );
    }
    if (track.split) {
      return t(
        "Cover changes apply immediately to this album file and songs that inherit its cover.",
      );
    }
    if (place.ids.length > 1) {
      return t("Cover changes apply immediately to the {{count}} songs of “{{album}}”.", {
        count: place.ids.length,
        album: track.album,
      });
    }
    return t("Cover changes apply to this track immediately, without pressing Save.");
  };
  // Once the Library has drawn, the parts that load apart load while the browser is idle.
  useEffect(() => {
    if (!library.loaded) {
      return undefined;
    }
    const stop = new AbortController();
    const cancel = afterNextPaint(() => {
      preloadWhenIdle(PRELOADED, stop.signal);
    });
    return () => {
      cancel();
      stop.abort();
    };
  }, [library.loaded]);
  // A song's Download under way shows on its row, from the moment it is added.
  const downloadsByTrack = useMemo(
    () => new Map(library.downloading.map((download) => [download.track_id, download])),
    [library.downloading],
  );
  const actions: TrackActions = {
    onPlay: player.playList,
    onPlayAll: player.playAll,
    onPlayNext: player.playNext,
    onAdd: player.add,
    onFavorite: (track, favorite) => {
      library.setFavorite(track.id, favorite);
    },
    onRate: (track, rating) => {
      library.setRating(track.id, rating);
    },
    onAddToPlaylist: setAdding,
    onEditDetails: (track, review) => {
      setEditing({ track, songs: false, ...(review === undefined ? {} : { review }) });
    },
    onEditAlbum: setEditingAlbum,
    onUseAlbumCover: setAlbumCover,
    onUploadAlbumCover: uploadAlbumCover,
    onKeepDownloaded: library.keepDownloaded,
    // The AI asked about a Track lately is offered too, asked again once someone agrees.
    canFind: (lookup: Lookup, track: Track) =>
      (library.findable.get(lookup.enricher)?.has(track.id) ?? false) ||
      (library.askedRecently.get(lookup.enricher)?.has(track.id) ?? false),
    // The song's cover shows the lookup as it goes; screen readers hear it asked.
    statusOf: (track: Track) =>
      coverStatusOf(library.lookups.get(track.id), library.mode?.online !== false, t),
    downloadOf: (track: Track) => downloadsByTrack.get(track.id),
    onFind: (lookup: Lookup, track: Track) => {
      if (library.askedRecently.get(lookup.enricher)?.has(track.id) ?? false) {
        setAskingAgain({ lookup, track });
      } else {
        find(lookup, track);
      }
    },
    onAddFile: setFiling,
    // The row's mark shows the new Kind, and the notice says so, as a filter may hide the row.
    onSetKind: (track: Track, kind: Kind) => {
      library.saveDetails(track.id, { kind }).then(
        () => {
          setNotice({
            kind: "message",
            key: kind === "album" ? "“{{title}}” is now an album." : "“{{title}}” is now a song.",
            values: { title: track.title },
          });
        },
        (failure: unknown) => {
          setNotice(failure instanceof Error ? failure.message : String(failure));
        },
      );
    },
    // The songs of a song's file open over that song's own details, the way back from them.
    onEditSongs: (track: Track) => {
      const file = track.segment_of === null ? track : byId.get(track.segment_of);
      if (file !== undefined) {
        setEditing({ track, songs: true });
      }
    },
  };
  /** The way to the songs of `track`'s file from its details, and the editor to show. */
  const songsOf = (track: Track) => {
    // Read from the Library, so a file split while its details are open says so.
    const file =
      byId.get(track.segment_of ?? track.id) ?? (track.segment_of === null ? track : undefined);
    if (file === undefined) {
      return undefined;
    }
    const count = tracks.filter((each) => each.segment_of === file.id).length;
    const ai = LOOKUPS.find((lookup) => lookup.enricher === AI_ENRICHER);
    const asked = library.lookups.get(file.id);
    const askAi: AiAsk = {
      can: ai !== undefined && actions.canFind(ai, file),
      state: asked?.enricher === AI_ENRICHER ? asked.state : undefined,
      message: asked?.message ?? "",
      ask: () => {
        if (ai !== undefined) {
          actions.onFind(ai, file);
        }
      },
      askAgain: (hint) => {
        library.find(AI_ENRICHER, file.id, { hint }).catch(() => {
          // The lookup's state says why, beside the AI button.
        });
      },
      stop: () => {
        library.stopFinding(file.id).catch(() => {
          // A Job that can't be cancelled has ended; its answer lands as any does.
        });
      },
    };
    return {
      label: file.split && count > 0 ? t("song_count", { count }) : t("Split into songs"),
      editor: (
        <LazyPart doing="Opening the songs…">
          <SongsEditor.Component
            album={file}
            matchOnline={library.mode?.online === true}
            matchRevision={library.lyricsMatchRevision}
            lyricsOf={(id) => {
              const child = byId.get(id);
              return child?.segment_of === file.id ? lyricsOf(child)?.editor : undefined;
            }}
            load={api.songs}
            check={api.checkSongList}
            artists={artists}
            ai={askAi}
            loadAudio={api.playback}
            silences={SILENCES}
            onListen={player.pause}
            onSave={async (rows, known, lyricPicks) => {
              await library.saveSongs(file.id, rows, known, lyricPicks);
              if (lyricPicks?.length) setLyricsEdits((count) => count + 1);
              setNotice({
                kind: "message",
                key: "Saved the songs of “{{title}}”.",
                values: { title: file.title },
              });
            }}
            onUnsplit={async (known) => {
              await library.unsplit(file.id, known);
              setNotice({
                kind: "message",
                key: "“{{title}}” plays whole again.",
                values: { title: file.title },
              });
            }}
          />
        </LazyPart>
      ),
    };
  };
  const addTo = async (track: Track, ids: readonly string[], newNames: readonly string[]) => {
    const playlists = await library.addToPlaylists(track, ids, newNames);
    if (playlists.length > 0) setNotice({ kind: "playlist", title: track.title, playlists });
  };

  /**
   * Step as `command` says: within and past the album playing, or along the queue while a
   * song of its own plays, where Previous and Next album step as Previous and Next do.
   */
  const step = (command: StepCommand) => {
    if (playing === undefined) {
      return;
    }
    const { position, queue } = player;
    const steps = albumSteps(queue, byId, playingOf(queue, byId, position), position);
    if (steps === undefined) {
      if (command === "previous" || command === "previousAlbum") {
        player.previous();
      } else {
        player.next();
      }
      return;
    }
    const to = stepFor(steps, command);
    if (to !== undefined) {
      player.playAt(to.key, to.seconds);
    }
  };
  // A shortcut changes what isn't in view, or isn't focused, so what it did is said.
  const shortcuts: ShortcutHandlers = {
    toggle: player.toggle,
    back: () => {
      player.seek(Math.max(0, player.position - SEEK_SECONDS));
    },
    forward: () => {
      player.seek(Math.min(player.duration ?? Infinity, player.position + SEEK_SECONDS));
    },
    previous: () => {
      step("previous");
    },
    next: () => {
      step("next");
    },
    previousAlbum: () => {
      step("previousAlbum");
    },
    nextAlbum: () => {
      step("nextAlbum");
    },
    volumeDown: () => {
      player.setVolume(stepVolume(player.volume, -1));
    },
    volumeUp: () => {
      player.setVolume(stepVolume(player.volume, 1));
    },
    mute: () => {
      player.setMuted(!player.muted);
      setNotice({ kind: "playback", key: player.muted ? "Sound on." : "Muted." });
    },
    shuffle: () => {
      player.shuffle(!player.shuffled);
      setNotice({ kind: "playback", key: shuffleSaid(!player.shuffled) });
    },
    repeat: () => {
      const then = repeatAfter(player.repeat);
      player.setRepeat(then);
      setNotice({ kind: "playback", key: REPEATS[then].said });
    },
    favorite: () => {
      if (playing !== undefined) {
        const target = playingFavorite(
          playing,
          songPlaying(playing, playingOf(player.queue, byId, player.position)),
          favorites,
        );
        if (target.kind === "track") {
          actions.onFavorite(target.track, !target.track.favorite);
          setNotice({
            kind: "favorite",
            title: target.track.title,
            key: target.track.favorite
              ? "Removed “{{title}}” from Favorites."
              : "Added “{{title}}” to Favorites.",
          });
        } else {
          library.setAlbumFavorite(target.artist, target.name, !target.favorite);
          setNotice({
            kind: "favorite",
            title: target.name,
            key: target.favorite
              ? "Unfavorited the album “{{title}}”."
              : "Favorited the album “{{title}}”.",
          });
        }
      }
    },
    search: () => {
      document.getElementById("search")?.focus();
    },
    queue: () => {
      if (nowPlaying) {
        setNowPlayingQueue((open) => !open);
      } else if (window.matchMedia(NARROW).matches) {
        setQueueOpen((open) => !open);
      } else {
        document
          .querySelector<HTMLButtonElement>('#queue [role="tab"][aria-selected="true"]')
          ?.focus();
      }
    },
    nowPlaying: () => {
      setNowPlayingOver((over) => (over === undefined && playing !== undefined ? here : undefined));
    },
    help: () => {
      setListingShortcuts(true);
    },
  };

  const railCollapsed = useRailCollapsed();
  const railMinimized = useRailMinimized();
  const signOut = () => {
    void api.signOut().then(onSignedOut, (failure: unknown) => {
      if (!(failure instanceof ApiError && failure.deviceRefusal)) onSignedOut();
    });
  };

  const page = (
    <div
      className={[
        "library",
        queueOpen && "queue-open",
        railCollapsed && "rail-collapsed",
        railMinimized && "rail-minimized",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <header ref={top} className="top">
        <h1>
          <a className="wordmark" href={hrefOf({ view: "library" })} aria-label="medleyplay">
            <WaveformIcon weight="bold" aria-hidden />
            <span className="wordmark-name">medleyplay</span>
          </a>
        </h1>
        <SearchBox
          route={route}
          admin={admin}
          providers={library.providers}
          onLookUp={(link) => {
            openVideo(library.lookUpLink(link));
          }}
          tracks={tracks}
          links={links}
        />
        <div className="header-notices">
          {library.mode !== null && !library.mode.online && (
            <span className="mode-note">
              <a
                className="mode-note-link"
                href={hrefOf({ view: "settings" })}
                title={t("See the network in Settings")}
              >
                <CloudSlashIcon weight="bold" aria-hidden />
                <span>
                  {t(stillSince === library.mode.since ? "Still offline" : "Offline")}
                  <span className="why">
                    {t(": {{reason}}", { reason: t(offlineBecause(library.mode) ?? "") })}
                  </span>
                </span>
              </a>
              {checkable(library.mode) && (
                <CheckNetwork
                  onChecked={(mode) => {
                    library.modeChecked(mode);
                    setStillSince(mode.online ? null : mode.since);
                  }}
                />
              )}
            </span>
          )}
          {account.role === "admin" && <WaitingDevices waiting={library.waitingDevices} />}
        </div>
        <ThemeSwitch />
        <button
          type="button"
          className="icon listen-button"
          aria-label={t("Listen on your device")}
          title={t("Listen on your device")}
          onClick={() => {
            setListening(true);
          }}
        >
          <DeviceMobileSpeakerIcon weight="regular" aria-hidden />
        </button>
        <Hint name={t("Keyboard shortcuts")} keys={keys.help}>
          <button
            type="button"
            className="icon keys-button"
            aria-label={t("Keyboard shortcuts")}
            onClick={() => {
              setListingShortcuts(true);
            }}
          >
            <KeyboardIcon weight="regular" aria-hidden />
          </button>
        </Hint>
        <span className="header-account">
          <AccountMenu account={{ name: account.display_name, onSignOut: signOut }} />
        </span>
        <a
          className="icon"
          href="https://github.com/pengzhengyi/medleyplay"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("View medleyplay on GitHub (opens in a new tab)")}
          title={t("View medleyplay on GitHub (opens in a new tab)")}
        >
          <GithubLogoIcon aria-hidden />
        </a>
      </header>
      <Nav
        route={route}
        toDo={toDo}
        downloading={library.downloading.length}
        collapsed={railCollapsed}
        minimized={railMinimized}
        onToggle={() => {
          setRailCollapsed(!railCollapsed);
        }}
        onMinimize={() => {
          setRailMinimized(!railMinimized);
        }}
        account={{ name: account.display_name, onSignOut: signOut }}
      />
      <main>
        {library.error !== "" && <p role="alert">{library.error}</p>}
        {library.loaded ? (
          <CurrentView
            route={route}
            tracks={tracks}
            playlists={library.playlists}
            playingId={playingId}
            nextId={upNext(player.queue)[0]?.trackId}
            actions={actions}
            admin={account.role === "admin"}
            mode={library.mode}
            onModeChecked={library.modeChecked}
            onEnrichersChanged={() => {
              library.refreshFindable();
              void library.refreshFeatures();
            }}
            onKindsChanged={library.reloadTracks}
            onRatingsChanged={library.reloadTracks}
            waitingDevices={library.waitingDevices}
            downloading={library.downloading}
            cancelDownload={library.cancelDownload}
            dismissFailedDownloads={library.dismissFailedDownloads}
            videoLookups={
              <VideoLookups
                rows={library.videoLookups}
                offline={library.mode?.online === false}
                choose={(id) => {
                  openVideo(library.videoLookup(id));
                }}
                dismiss={library.dismissLookup}
              />
            }
            station={station}
            accountId={account.id}
            favorites={favorites}
            onFavoriteArtist={favoriteArtist}
            onFavoriteAlbum={library.setAlbumFavorite}
            links={links}
            artistNames={artistNames}
            namesToTidy={namesToTidy}
            splitOffers={{ names: splitOffers.offers, reload: splitOffers.reload }}
            artistSplits={{ names: artistSplits.splits, reload: artistSplits.reload }}
            sharedNames={sharedNames}
            missingPhotos={missingPhotos}
            missingCovers={{ ...missingCovers, onUsed: library.reloadTracks }}
            missingDetailsRevision={String(library.refreshes)}
            toDo={toDo}
          />
        ) : (
          <LibrarySkeleton />
        )}
      </main>
      <QueuePanel player={player} sleep={sleep} tracks={byId} showFoldAll />
      <PlayerBar
        player={player}
        track={playing}
        tracks={byId}
        onFavorite={actions.onFavorite}
        favorites={favorites}
        onFavoriteAlbum={library.setAlbumFavorite}
        menuActions={actions}
        lyrics={lyrics}
        queueOpen={queueOpen}
        onToggleQueue={() => {
          setQueueOpen((open) => !open);
        }}
        onOpenNowPlaying={() => {
          setNowPlayingOver(here);
        }}
        playOn={
          onHost ? undefined : (
            <PlayOn
              on={onComputer ? "computer" : "here"}
              available={canPlayOnComputer}
              failed={playOnFailed}
              onChoose={playOn}
            />
          )
        }
      />
      {linking !== undefined && (
        <AddLink
          opening={linking.opening}
          listed={library.videoLookups}
          load={library.videoLookup}
          add={library.addLink}
          onAdded={(count, destination) => {
            if (destination !== undefined) {
              setNotice({
                kind: "message",
                key: "The album is in the Library. Check Downloaded for its status.",
              });
              navigate(destination);
              return;
            }
            setNotice({ kind: "adding", count, offline: library.mode?.online === false });
          }}
          onClose={() => {
            setLinking(undefined);
          }}
        />
      )}
      {filing !== undefined && (
        <AddFile
          track={filing}
          load={library.download}
          upload={library.addFile}
          onAdded={() => {
            setNotice({
              kind: "message",
              key: "Added the file for “{{title}}”.",
              values: { title: filing.title },
            });
          }}
          onClose={() => {
            setFiling(undefined);
          }}
        />
      )}
      {nowPlaying && (
        <NowPlaying
          player={player}
          sleep={sleep}
          track={playing}
          tracks={byId}
          onFavorite={actions.onFavorite}
          favorites={favorites}
          onFavoriteArtist={favoriteArtist}
          onFavoriteAlbum={library.setAlbumFavorite}
          menuActions={actions}
          lyrics={lyrics}
          lyricsFailed={lyricsFailed}
          {...(song === undefined || !lyrics
            ? {}
            : {
                onSaveLyrics: async () => {
                  lyricsChanged(song.id, await api.setLyrics(song.id, lyrics.text));
                },
                onDismissLyrics: async () => {
                  lyricsChanged(song.id, await api.dismissLyricsSuggestion(song.id));
                },
              })}
          queueOpen={nowPlayingQueue}
          onToggleQueue={() => {
            setNowPlayingQueue((open) => !open);
          }}
          onClose={() => {
            setNowPlayingOver(undefined);
          }}
        />
      )}
      {askingAgain !== undefined && (
        <AskAiAgain
          title={askingAgain.track.title}
          onAsk={() => {
            find(askingAgain.lookup, askingAgain.track, true);
          }}
          onClose={() => {
            setAskingAgain(undefined);
          }}
        />
      )}
      {adding !== undefined && (
        <AddToPlaylist
          track={adding}
          playlists={library.playlists}
          onSave={(ids, newNames) => addTo(adding, ids, newNames)}
          onClose={() => {
            setAdding(undefined);
          }}
        />
      )}
      {editingAlbum !== undefined && (
        <EditAlbum
          songs={editingAlbum}
          onUseCover={(cover) => setAlbumCover(editingAlbum, cover)}
          onUploadCover={(image) => uploadAlbumCover(editingAlbum, image)}
          onSave={async (changes) => {
            const [first] = editingAlbum;
            await library.setDetailsOn(
              editingAlbum.map(({ id }) => id),
              changes,
            );
            setNotice({
              kind: "message",
              key: "Saved the album of {{count}} songs.",
              values: { count: editingAlbum.length },
            });
            // A renamed album is found under its new name; one whose name was emptied, in Albums.
            if (first !== undefined && ("album" in changes || "album_artist" in changes)) {
              const name = changes.album === undefined ? first.album : changes.album;
              const artist =
                changes.album_artist === undefined ? albumArtistOf(first) : changes.album_artist;
              navigate(
                typeof name === "string" && typeof artist === "string"
                  ? { view: "album", artist, name }
                  : { view: "albums" },
              );
            }
          }}
          onClose={() => {
            setEditingAlbum(undefined);
          }}
        />
      )}
      {editing !== undefined && (
        <EditDetails
          key={editing.track.id}
          track={byId.get(editing.track.id) ?? editing.track}
          review={editing.review}
          load={api.details}
          onSave={async (values, artists) => {
            await library.saveDetails(editing.track.id, values, artists);
            setNotice({
              kind: "message",
              key: "Saved the details of “{{title}}”.",
              values: { title: editing.track.title },
            });
          }}
          onReadVideo={(text) => library.readVideoText(editing.track.id, text)}
          coverHelp={coverHelpOf(editing.track.id)}
          onSetCover={async (image) => {
            const { shown, place } = trackForCover(editing.track.id);
            await checkCoverTarget(shown, place);
            const kept = (await library.setCover(editing.track.id, image)).origins.household?.cover;
            if (typeof kept !== "string") {
              throw new Error("The cover could not be kept.");
            }
            await coverAlbumOf(shown, place, kept, { uploaded: true });
            return api.details(editing.track.id);
          }}
          onRemoveCover={async () => {
            const { shown, place } = trackForCover(editing.track.id);
            await coverAlbumOf(shown, place, null);
            return api.details(editing.track.id);
          }}
          onUseCover={async (cover) => {
            const { shown, place } = trackForCover(editing.track.id);
            await coverAlbumOf(shown, place, cover);
            return api.details(editing.track.id);
          }}
          onChooseArtist={async (written, id) => {
            const fresh = await api.chooseNamesake(editing.track.id, written, id);
            library.reloadTracks();
            artistNames.reload();
            return fresh;
          }}
          findable={LOOKUPS.filter((lookup) => actions.canFind(lookup, editing.track))}
          lookup={library.lookups.get(editing.track.id)}
          online={library.mode?.online !== false}
          onFind={(lookup) => {
            actions.onFind(lookup, editing.track);
          }}
          onAskAi={(note) => {
            library.find(AI_ENRICHER, editing.track.id, { hint: note }).catch(() => {
              // The lookup's state says why, beside the AI button.
            });
          }}
          songs={songsOf(editing.track)}
          lyrics={lyricsOf(editing.track)}
          startOnSongs={editing.songs}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
      {listening && (
        <LazyPart
          doing="Finding this computer's addresses…"
          frame={(shown) => (
            <DialogOpening
              className="listen"
              title={t("Listen on your device")}
              onClose={() => {
                setListening(false);
              }}
            >
              {shown}
            </DialogOpening>
          )}
        >
          <ListenOnDevice.Component
            username={account.username}
            load={api.addresses}
            waitingCount={admin ? library.waitingDevices.length : undefined}
            onClose={() => {
              setListening(false);
            }}
          />
        </LazyPart>
      )}
      {listingShortcuts && (
        <ShortcutList
          onClose={() => {
            setListingShortcuts(false);
          }}
        />
      )}
      <HoldForShortcuts blocked={listingShortcuts} />
      <Shortcuts on={shortcuts} />
      <p className="notice" role="status">
        {typeof notice === "string"
          ? notice
          : notice.kind === "playlist"
            ? t("Added “{{title}}” to {{playlists}}.", {
                title: notice.title,
                playlists: listFormat.format(notice.playlists),
              })
            : notice.kind === "favorite"
              ? t(notice.key, { title: notice.title })
              : notice.kind === "message"
                ? t(notice.key, notice.values ?? {})
                : notice.kind === "adding"
                  ? t(
                      notice.offline
                        ? "Added {{songs}}. They are downloading. They wait until medleyplay is Online."
                        : "Added {{songs}}. They are downloading.",
                      { songs: t("song_count", { count: notice.count }) },
                    )
                  : t(notice.key)}
      </p>
      <p className="visually-hidden" role="status">
        {typeof said === "string"
          ? said
          : [
              t(said.key, { title: said.title }),
              ...(said.offline ? [t("It waits until medleyplay is Online.")] : []),
            ].join(t("Sentence separator", { defaultValue: " " }))}
      </p>
      <audio ref={audio} preload="auto" />
    </div>
  );
  return (
    <AiSetUpContext value={aiSetUp}>
      <LyricsAvailabilityProvider tracks={tracks}>{page}</LyricsAvailabilityProvider>
    </AiSetUpContext>
  );
}

/** A value that goes back to `cleared` a few seconds after it is set, as a notice fades. */
function useFading<Value>(cleared: Value) {
  const [value, setValue] = useState(cleared);
  useEffect(() => {
    if (value === cleared) {
      return;
    }
    const fade = setTimeout(() => {
      setValue(cleared);
    }, NOTICE_MS);
    return () => {
      clearTimeout(fade);
    };
  }, [value, cleared]);
  return [value, setValue] as const;
}
