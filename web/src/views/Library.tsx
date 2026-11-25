/**
 * @file The signed-in page: the views, the search, the queue, and the player.
 */

import {
  CloudSlashIcon,
  DeviceMobileSpeakerIcon,
  KeyboardIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AI_ENRICHER,
  type Account,
  ApiError,
  type Kind,
  type MissingDetailReview,
  type SavedVideoLookup,
  LYRICS_ENRICHER,
  type Track,
  api,
} from "../api";
import { preloadWhenIdle } from "../lazyPart";
import { LOOKUPS, type Lookup, coverStatusOf } from "../library/lookups";
import { afterNextPaint } from "../library/stages";
import { useLibrary } from "../library/useLibrary";
import { useLookAhead } from "../library/useLookAhead";
import { useLyrics } from "../library/useLyrics";
import { songTimeOf } from "../lyrics";
import { type StepCommand, albumSteps, playingOf, stepFor } from "../player/albumNow";
import { useStation } from "../library/useStation";
import { linksOf, withLinkedFavorites } from "../library/artistLinks";
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
import { albumArtistOf, coverPlaceOf } from "../library/views";
import { current, repeatAfter, upNext } from "../player/queue";
import { checkable, offlineBecause } from "../mode";
import { usePlayer } from "../player/usePlayer";
import { takeOf } from "../player/remote";
import { useRemotePlayer } from "../player/useRemotePlayer";
import { useSleepTimer } from "../player/useSleepTimer";
import { useSpeaker } from "../player/useSpeaker";
import { stepVolume } from "../player/volume";
import { hrefOf, navigate, useRoute } from "../routes";
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
const listFormat = new Intl.ListFormat(undefined, { type: "conjunction" });

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
  const library = useLibrary(onSignedOut);
  const byId = library.tracks;
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
  const [local, audio] = usePlayer(byId, onSignedOut);
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
  const lyrics = useLyrics(
    song?.id,
    `${lyricsLookup?.enricher === LYRICS_ENRICHER ? lyricsLookup.state : ""}:${String(lyricsEdits)}:${library.lyricsVersion(song?.id)}`,
  );
  /** The editor of `track`'s lyrics, syncing them to it as the player plays it. */
  const lyricsOf = (track: Track) => {
    if (track.kind === "album") {
      return undefined;
    }
    const current = song?.id === track.id;
    const edited = <T,>(change: Promise<T>) =>
      change.then((answer) => {
        setLyricsEdits((count) => count + 1);
        return answer;
      });
    return {
      label: "Lyrics",
      editor: (
        <LazyPart doing="Opening the lyrics…">
          <LyricsEditor.Component
            key={track.id}
            load={() => api.lyrics(track.id)}
            refreshVersion={library.lyricsVersion(track.id)}
            save={(text, instrumental) => edited(api.setLyrics(track.id, text, instrumental))}
            forget={() => edited(api.forgetLyrics(track.id))}
            song={{ id: track.id, title: track.title, artist: track.artist }}
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
  const [notice, setNotice] = useFading("");
  // Said to screen readers only: what the page shows where it happens, such as a lookup.
  const [said, setSaid] = useFading("");
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
        const wait = library.mode?.online === false ? " It waits until medleyplay is Online." : "";
        setSaid(`${lookup.notice(track.title)}${wait}`);
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
  const setAlbumCover = async (songs: readonly Track[], cover: string) => {
    await library.setDetailsOn(
      songs.map(({ id }) => id),
      { cover },
    );
    setNotice(`Used the cover on ${String(songs.length)} songs.`);
  };
  // The image becomes the first song's cover, then every song's.
  const uploadAlbumCover = async (songs: readonly Track[], image: File) => {
    const [first] = songs;
    const cover =
      first === undefined
        ? undefined
        : (await library.setCover(first.id, image)).origins.household?.cover;
    if (typeof cover !== "string") {
      throw new Error("The cover could not be kept.");
    }
    await setAlbumCover(songs, cover);
    return cover;
  };
  /**
   * Make `cover` the cover of `track`'s album, or drop the album's with `null`: on its split
   * file, dropping the song's own so it shows the file's, or on every song of its album.
   */
  const coverAlbumOf = async (track: Track, cover: string | null) => {
    const place = coverPlaceOf(track, tracks);
    if (place.kind === "songs") {
      await library.setDetailsOn(place.ids, { cover });
      return;
    }
    await library.setDetailsOn(cover === null ? [place.id, track.id] : [place.id], { cover });
    if (cover !== null) {
      await library.setDetailsOn([track.id], { cover: null });
    }
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
      coverStatusOf(library.lookups.get(track.id), library.mode?.online !== false),
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
          setNotice(`“${track.title}” is now ${kind === "album" ? "an album" : "a song"}.`);
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
      label: file.split && count > 0 ? `${String(count)} songs` : "Split into songs",
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
            onSave={async (rows, known) => {
              await library.saveSongs(file.id, rows, known);
              setNotice(`Saved the songs of “${file.title}”.`);
            }}
            onUnsplit={async () => {
              await library.unsplit(file.id);
              setNotice(`“${file.title}” plays whole again.`);
            }}
          />
        </LazyPart>
      ),
    };
  };
  const addTo = async (track: Track, ids: readonly string[], newNames: readonly string[]) => {
    await library.addToPlaylists(track, ids, newNames);
    const names = [
      ...library.playlists.filter((playlist) => ids.includes(playlist.id)).map((p) => p.name),
      ...newNames,
    ];
    setNotice(`Added “${track.title}” to ${listFormat.format(names)}.`);
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
      setNotice(player.muted ? "Sound on." : "Muted.");
    },
    shuffle: () => {
      player.shuffle(!player.shuffled);
      setNotice(shuffleSaid(!player.shuffled));
    },
    repeat: () => {
      const then = repeatAfter(player.repeat);
      player.setRepeat(then);
      setNotice(REPEATS[then].said);
    },
    favorite: () => {
      if (playing !== undefined) {
        actions.onFavorite(playing, !playing.favorite);
        setNotice(
          playing.favorite
            ? `Removed “${playing.title}” from Favorites.`
            : `Added “${playing.title}” to Favorites.`,
        );
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
        document.getElementById("queue")?.focus();
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
          <a className="wordmark" href={hrefOf({ view: "library" })}>
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
        {library.mode !== null && !library.mode.online && (
          <span className="mode-note">
            <a
              className="mode-note-link"
              href={hrefOf({ view: "settings" })}
              title="See the network in Settings"
            >
              <CloudSlashIcon weight="bold" aria-hidden />
              <span>
                {stillSince === library.mode.since ? "Still offline" : "Offline"}
                <span className="why">: {offlineBecause(library.mode)}</span>
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
        <ThemeSwitch />
        <button
          type="button"
          className="icon listen-button"
          aria-label="Listen on your device"
          title="Listen on your device"
          onClick={() => {
            setListening(true);
          }}
        >
          <DeviceMobileSpeakerIcon weight="regular" aria-hidden />
        </button>
        <Hint name={"Keyboard shortcuts"} keys={keys.help}>
          <button
            type="button"
            className="icon keys-button"
            aria-label="Keyboard shortcuts"
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
      <QueuePanel player={player} sleep={sleep} tracks={byId} />
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
          onAdded={(count, notice) => {
            if (notice !== undefined) {
              setNotice(notice);
              return;
            }
            const songs = count === 1 ? "1 song" : `${String(count)} songs`;
            const wait =
              library.mode?.online === false ? " They wait until medleyplay is Online." : "";
            setNotice(`Added ${songs}. They are downloading.${wait}`);
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
            setNotice(`Added the file for “${filing.title}”.`);
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
          {...(song === undefined || !lyrics
            ? {}
            : {
                onSaveLyrics: async () => {
                  await api.setLyrics(song.id, lyrics.text);
                  setLyricsEdits((count) => count + 1);
                },
                onDismissLyrics: async () => {
                  await api.dismissLyricsSuggestion(song.id);
                  setLyricsEdits((count) => count + 1);
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
            setNotice(`Saved the album of ${String(editingAlbum.length)} songs.`);
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
          track={editing.track}
          review={editing.review}
          load={api.details}
          onSave={async (values, artists) => {
            await library.saveDetails(editing.track.id, values, artists);
            setNotice(`Saved the details of “${editing.track.title}”.`);
          }}
          onReadVideo={(text) => library.readVideoText(editing.track.id, text)}
          onSetCover={async (image) => {
            const kept = (await library.setCover(editing.track.id, image)).origins.household?.cover;
            if (typeof kept !== "string") {
              throw new Error("The cover could not be kept.");
            }
            await coverAlbumOf(editing.track, kept);
            return api.details(editing.track.id);
          }}
          onRemoveCover={async () => {
            await coverAlbumOf(editing.track, null);
            return api.details(editing.track.id);
          }}
          onUseCover={async (cover) => {
            await coverAlbumOf(editing.track, cover);
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
              title="Listen on your device"
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
        {notice}
      </p>
      <p className="visually-hidden" role="status">
        {said}
      </p>
      <audio ref={audio} preload="auto" />
    </div>
  );
  return <AiSetUpContext value={aiSetUp}>{page}</AiSetUpContext>;
}

/** A value that goes back to `cleared` a few seconds after it is set, as a notice fades. */
function useFading(cleared: string) {
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
