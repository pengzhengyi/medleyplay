/**
 * @file The signed-in Account's Tracks: loaded once, asked for again when needed, and written.
 */

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  type AddedPart,
  api,
  ApiError,
  lyricsMatchInProgress,
  type Credit,
  type Detail,
  type Details,
  type Enricher,
  type EnricherMode,
  type FavoritesRead,
  type Job,
  type DownloadUnderWay,
  type JobEvent,
  type SavedVideoLookup,
  type Mode,
  type VideoChoices,
  type Playlist,
  type RemoteCommand,
  type RemoteEvent,
  type SongRowIn,
  type Track,
  type TrackDownload,
  uploadFile,
  type VideoRead,
  type VideoText,
  type WaitingDevice,
} from "../api";
import { newId } from "../ids";
import { PAGE_ID } from "../page";
import type { Speaker } from "../player/remote";
import { type Asking, askingAt } from "./asking";
import { DOWNLOAD_KIND, downloadEnded, followDownload, withDownloadEvent } from "./downloading";
import { type FavoriteGroups, NO_FAVORITES, albumKey, favoriteGroupsOf } from "./favoriteGroups";
import { afterNextPaint } from "./stages";
import { LOOKUPS } from "./lookups";
import { EMPTY, type Field, reduce, tracksOf } from "./store";

/** A lookup asked about a Track, as far as its Job has gone. */
export interface TrackLookup {
  readonly enricher: string;
  readonly state: Job["state"];
  /** Why it failed, or `""`. */
  readonly message: string;
}

/** The Library as the page sees it. */
export interface Library {
  readonly tracks: ReadonlyMap<number, Track>;
  readonly playlists: readonly Playlist[];
  /** The music sites a search could look in, such as `bilibili`. */
  readonly providers: readonly string[];
  /** Whether an AI provider is set up and turned on, once the server has said. */
  readonly aiSetUp: boolean | null;
  /**
   * Ask again what the server can do now, as after an AI provider is set up; resolves
   * to whether one is, or `null` when the server didn't say.
   */
  readonly refreshFeatures: () => Promise<boolean | null>;
  /** Whether the server has listed the Tracks yet. */
  readonly loaded: boolean;
  /**
   * Counts the times the Library may have changed, as what is read beside the songs
   * sees it: each load, a moment after any Job ends, and each read of the songs after
   * a change made here; a heart or a rating leaves it alone.
   */
  readonly refreshes: number;
  readonly lyricsMatchRevision: number;
  readonly lyricsMatchEnds: ReadonlyMap<
    number,
    { readonly jobId: number; readonly saved: boolean }
  >;
  readonly lyricsStreamConnections: number;
  readonly lyricsVersion: (trackId: number | undefined) => string;
  /** Why the last request failed, or `""`. */
  readonly error: string;
  /** Whether medleyplay may contact music sites now, once the server has said. */
  readonly mode: Mode | null;
  /** Show the Mode a check of the network came to, before the stream says it. */
  readonly modeChecked: (mode: Mode) => void;
  /** The devices waiting for an admin's answer, oldest first; none for a member. */
  readonly waitingDevices: readonly WaitingDevice[];
  /** The Downloads under way, oldest first, each with how far it has got. */
  readonly downloading: readonly DownloadUnderWay[];
  /**
   * The computer playing for this Account, as it last reported, or `null` while none
   * does; `undefined` until the event stream has said.
   */
  readonly speaker: Speaker | null | undefined;
  /** Call `listener` with each command a remote sends while this page plays for the Account. */
  readonly onCommand: (listener: (command: RemoteCommand) => void) => () => void;
  /** The Tracks each enricher may be asked about now, by the enricher's name. */
  readonly findable: ReadonlyMap<string, ReadonlySet<number>>;
  /** The Tracks each enricher was asked about lately, asked again only when someone agrees. */
  readonly askedRecently: ReadonlyMap<string, ReadonlySet<number>>;
  /** Ask the enrichers again which Tracks they may be asked about, as after one is set up. */
  readonly refreshFindable: () => void;
  /** Ask for the Tracks again, as after a setting changes what they show. */
  readonly reloadTracks: () => void;
  /** When the household has each enricher asked, once the server has said. */
  readonly modes: ReadonlyMap<string, EnricherMode>;
  /**
   * Ask the enricher about the Track; its details show once the Job has run. The promise
   * rejects with why when the server refuses.
   */
  /** Ask `enricher` about the Track `id`; the AI may be asked `again`, with a hint. */
  readonly find: (enricher: string, id: number, again?: { readonly hint: string }) => Promise<void>;
  /** Stop the lookup asked about the Track while it waits or runs; nothing it found is kept. */
  readonly stopFinding: (id: number) => Promise<void>;
  /**
   * The lookup last asked about each Track, by the Track's id, while its Job runs, a
   * moment after it succeeds, and until it is asked again after it fails.
   */
  readonly lookups: ReadonlyMap<number, TrackLookup>;
  readonly setFavorite: (id: number, favorite: boolean) => void;
  /** The artists and albums the Account favorited. */
  readonly favoriteGroups: FavoriteGroups;
  /** Mark or unmark the Library's artist `artistId` as a favorite. */
  readonly setArtistFavorite: (artistId: string, favorite: boolean) => void;
  readonly setAlbumFavorite: (artist: string, name: string, favorite: boolean) => void;
  readonly setRating: (id: number, rating: number | null) => void;
  /**
   * Change the household's values for the Track, `null` dropping one; the Track then
   * shows the server's answer. The promise rejects with why when the server refuses.
   */
  readonly saveDetails: (
    id: number,
    changes: Partial<Record<Detail, string | number | null>>,
    artists?: readonly Credit[],
  ) => Promise<void>;
  /**
   * Read a video's pasted text as the Track's `video` values; the Track then shows the
   * server's answer. The promise rejects with why when the server refuses.
   */
  readonly readVideoText: (id: number, text: VideoText) => Promise<VideoRead>;
  /** Make `image` the household's cover for the Track; the Track then shows it. */
  readonly setCover: (id: number, image: Blob) => Promise<Details>;
  /** Drop the household's cover for the Track; the Track then shows the next origin's. */
  readonly removeCover: (id: number) => Promise<Details>;
  /** Make `rows` the songs of the file `id`; the Tracks then show the songs as saved. */
  readonly saveSongs: (
    id: number,
    rows: readonly SongRowIn[],
    known: readonly number[],
  ) => Promise<void>;
  /** Remove every song of the file `id`; the Tracks then show the file whole again. */
  readonly unsplit: (id: number) => Promise<void>;
  /**
   * Set the household's values on every Track of `ids`, `null` dropping one; all change
   * or none, and the Tracks then show what was saved.
   */
  readonly setDetailsOn: (
    ids: readonly number[],
    values: Partial<Record<Detail, string | number | null>>,
  ) => Promise<void>;
  /** Look up the video a link or bare code names; the promise rejects with why it can't. */
  readonly lookUpLink: (link: string) => Promise<SavedVideoLookup>;
  readonly videoLookups: readonly SavedVideoLookup[];
  readonly videoLookup: (id: number) => Promise<SavedVideoLookup>;
  readonly dismissLookup: (id: number) => Promise<void>;
  /**
   * Add the chosen parts of a link's video as Tracks, which then show downloading. The
   * promise rejects with why when the server refuses.
   */
  readonly addLink: (
    id: number,
    quality: string,
    parts: VideoChoices,
  ) => Promise<readonly AddedPart[]>;
  /** Where a site Track's Download stands. */
  readonly download: (id: number) => Promise<TrackDownload>;
  readonly dismissFailedDownloads: (ids: readonly number[]) => Promise<void>;
  /**
   * Send `file` as the Track's Download, reporting how many bytes went as they do; the
   * Tracks then show it downloaded. Aborting `signal` stops it.
   */
  readonly addFile: (
    id: number,
    file: File,
    onProgress: (sent: number, total: number) => void,
    signal: AbortSignal,
  ) => Promise<void>;
  /**
   * Add `track` to the end of the Playlists `ids`, and to a new Playlist for each
   * of `newNames`. The Playlists the server saves show at once; the promise rejects
   * with why when it refuses any.
   */
  readonly addToPlaylists: (
    track: Track,
    ids: readonly string[],
    newNames: readonly string[],
  ) => Promise<void>;
  /** Switch whether `playlist` keeps its songs downloaded; it shows as the server saved it. */
  readonly keepDownloaded: (playlist: Playlist, keep: boolean) => Promise<void>;
}

/** The Jobs whose end can change the Tracks. */
const CHANGES_TRACKS = new Set(["scan_library", "download_source", "enrich_track"]);
/** The Jobs whose end changes nothing the Library reads: thumbnails are found by URL. */
const CHANGES_NOTHING = new Set(["make_thumbnails", "lookup_video"]);
const FINISHED = new Set<JobEvent["state"]>(["succeeded", "failed", "cancelled"]);
/** How long after the last Job to end the Library is refreshed, so a busy scan does it once. */
const SETTLE_MS = 1000;
/** How long a lookup that succeeded still says so. */
const DONE_MS = 4000;

/** Compare names as people read them, as the Playlists view lists them. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Load the Tracks and Playlists, and ask for them again whenever something may
 * have changed them: the page is shown after being hidden, the event stream
 * (re)connects, or a scan or a Download finishes.
 *
 * `onSignedOut` runs when a request finds the session has expired.
 */
export function useLibrary(onSignedOut: () => void): Library {
  const [store, dispatch] = useReducer(reduce, EMPTY);
  const [refreshes, setRefreshes] = useState(0);
  const [lyricsMatchRevision, setLyricsMatchRevision] = useState(0);
  const [lyricsReconnects, setLyricsReconnects] = useState(0);
  const [lyricsStreamConnections, setLyricsStreamConnections] = useState(0);
  const [lyricsMatchEnds, setLyricsMatchEnds] = useState<Library["lyricsMatchEnds"]>(new Map());
  const [lyricSaves, setLyricSaves] = useState<ReadonlyMap<number, number>>(new Map());
  const refresh = useCallback(() => {
    setRefreshes((count) => count + 1);
  }, []);
  const [playlists, setPlaylists] = useState<readonly Playlist[]>([]);
  const [providers, setProviders] = useState<readonly string[]>([]);
  const [aiSetUp, setAiSetUp] = useState<boolean | null>(null);
  // Counts the reads of the features, so an answer to an older one is dropped.
  const featureReads = useRef(0);
  const loadFeatures = useCallback(() => {
    const read = ++featureReads.current;
    return api.features().then(
      (features) => {
        if (read === featureReads.current) {
          setProviders(features.providers.source_resolver ?? []);
          setAiSetUp(features.ai_set_up);
        }
        return features.ai_set_up;
      },
      () => {
        // Without the features, a search looks only in the Library, and no AI hint shows.
        return null;
      },
    );
  }, []);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode | null>(null);
  const [waitingDevices, setWaitingDevices] = useState<readonly WaitingDevice[]>([]);
  const [downloading, setDownloading] = useState<readonly DownloadUnderWay[]>([]);
  const [videoLookups, setVideoLookups] = useState<readonly SavedVideoLookup[]>([]);
  const videoReads = useRef(0);
  const loadVideoLookups = useCallback(() => {
    const read = ++videoReads.current;
    api.videoLookups().then(
      (saved) => {
        if (videoReads.current === read) setVideoLookups(saved);
      },
      () => undefined,
    );
  }, []);
  const forgetVideo = (id: number) => {
    videoReads.current++;
    setVideoLookups((saved) => saved.filter((row) => row.id !== id));
    loadVideoLookups();
  };
  const [speaker, setSpeaker] = useState<Speaker | null | undefined>(undefined);
  const commandListeners = useRef(new Set<(command: RemoteCommand) => void>());
  const onCommand = useCallback((listener: (command: RemoteCommand) => void) => {
    commandListeners.current.add(listener);
    return () => {
      commandListeners.current.delete(listener);
    };
  }, []);
  // Each enricher as the server last said, the Tracks asked about from this page since,
  // and the time its waits are applied at: when an answer came or the next wait passed.
  const [enrichers, setEnrichers] = useState<ReadonlyMap<string, Enricher>>(new Map());
  const [askedHere, setAskedHere] = useState<ReadonlyMap<string, ReadonlySet<number>>>(new Map());
  const [waitsAppliedAt, setWaitsAppliedAt] = useState(() => Date.now());
  const askings = useMemo(
    () => new Map([...enrichers].map(([name, read]) => [name, askingAt(read, waitsAppliedAt)])),
    [enrichers, waitsAppliedAt],
  );
  const findable = useMemo(
    () => withoutAskedHere(askings, askedHere, (asking) => asking.findable),
    [askings, askedHere],
  );
  const askedRecently = useMemo(
    () => withoutAskedHere(askings, askedHere, (asking) => asking.askedRecently),
    [askings, askedHere],
  );
  useEffect(() => {
    const next = Math.min(...[...askings.values()].map((each) => each.changesAt ?? Infinity));
    if (next === Infinity) {
      return undefined;
    }
    const timer = setTimeout(
      () => {
        setWaitsAppliedAt(Date.now());
      },
      Math.min(Math.max(0, next - Date.now()), MAX_TIMEOUT_MS),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [askings]);
  const [modes, setModes] = useState<ReadonlyMap<string, EnricherMode>>(new Map());
  const [lookups, setLookups] = useState<ReadonlyMap<number, TrackLookup>>(new Map());
  const [favoriteGroups, setFavoriteGroups] = useState<FavoriteGroups>(NO_FAVORITES);
  // The latest favorite written, so an older answer can't land after it, and how many
  // are unanswered, so a reload can't undo one the server hasn't answered yet.
  const favoriteWrites = useRef(0);
  const favoritesUnanswered = useRef(0);
  // Each lookup's Job, and each Track's latest, so an older Job's end can't land after it.
  const trackOfJob = useRef(new Map<number, number>());
  const jobOfTrack = useRef(new Map<number, number>());
  // The Tracks whose lookup is being asked for, and those of them stopped before it was.
  const asking = useRef(new Set<number>());
  const stoppedEarly = useRef(new Set<number>());
  const writes = useRef(0);
  // The latest change of each Track's details, so an older read-back can't land after it.
  const latestSave = useRef(new Map<number, number>());

  const failed = (failure: unknown) => {
    if (failure instanceof ApiError && failure.status === 401) {
      onSignedOut();
      return;
    }
    setError(failure instanceof Error ? failure.message : String(failure));
  };
  const onFailure = useEffectEvent(failed);

  const setLookup = (id: number, lookup: TrackLookup | undefined) => {
    setLookups((now) => {
      const next = new Map(now);
      if (lookup === undefined) {
        next.delete(id);
      } else {
        next.set(id, lookup);
      }
      return next;
    });
  };
  // Keep the newest event per Job while a list read is pending, so the older list
  // cannot undo its progress.
  const underWay = useRef<readonly DownloadUnderWay[]>([]);
  const endedJobs = useRef(new Set<number>());
  const askedJobs = useRef(new Set<number>());
  const downloadRead = useRef<Map<number, JobEvent> | null>(null);
  const showDownloading = (next: readonly DownloadUnderWay[]) => {
    underWay.current = next;
    setDownloading(next);
  };
  const loadDownloading = useCallback(() => {
    const events = new Map<number, JobEvent>();
    downloadRead.current = events;
    api.downloads().then(
      (listed) => {
        if (downloadRead.current === events) {
          downloadRead.current = null;
          const active = listed.filter(({ job }) => !endedJobs.current.has(job.id));
          showDownloading(
            active.map((download) => {
              const event = events.get(download.job.id);
              return event === undefined ? download : withDownloadEvent(download, event);
            }),
          );
        }
      },
      () => {
        if (downloadRead.current === events) downloadRead.current = null;
      },
    );
  }, []);
  /** Follow a Download's or a lookup's Job as the event stream tells of it. */
  const onJob = useEffectEvent((job: JobEvent) => {
    if (job.kind === "lookup_video") loadVideoLookups();
    if (job.kind === "auto_match_find" || job.kind === "auto_match_choose") {
      setLyricsMatchRevision((count) => count + 1);
      if (
        FINISHED.has(job.state) &&
        !(job.kind === "auto_match_find" && job.state === "succeeded")
      ) {
        const trackId = Number(job.target?.split(":")[1]);
        if (Number.isSafeInteger(trackId) && trackId > 0) {
          const saved = job.state === "succeeded";
          setLyricsMatchEnds((prior) =>
            (prior.get(trackId)?.jobId ?? 0) >= job.id
              ? prior
              : new Map(prior).set(trackId, { jobId: job.id, saved }),
          );
          if (saved) {
            setLyricSaves((prior) =>
              (prior.get(trackId) ?? 0) >= job.id ? prior : new Map(prior).set(trackId, job.id),
            );
          }
        }
      }
    }
    if (downloadEnded(job)) {
      endedJobs.current.add(job.id);
    }
    const { next, reread } = followDownload(underWay.current, job);
    if (next !== underWay.current) {
      showDownloading(next);
    }
    if (reread && !askedJobs.current.has(job.id)) {
      askedJobs.current.add(job.id);
      loadDownloading();
    }
    if (job.kind === DOWNLOAD_KIND) downloadRead.current?.set(job.id, job);
    const id = trackOfJob.current.get(job.id);
    const lookup = id === undefined ? undefined : lookups.get(id);
    if (id === undefined || lookup === undefined || jobOfTrack.current.get(id) !== job.id) {
      return;
    }
    if (job.state === "cancelled") {
      setLookup(id, undefined);
    } else if (job.state === "failed") {
      setLookup(id, { ...lookup, state: "failed" });
      api.job(job.id).then(
        (read) => {
          if (jobOfTrack.current.get(id) === job.id) {
            setLookup(id, { ...lookup, state: "failed", message: read.failure_message });
          }
        },
        () => {
          // Without the Job, the lookup says it failed but not why.
        },
      );
    } else {
      setLookup(id, { ...lookup, state: job.state });
      if (job.state === "succeeded") {
        setTimeout(() => {
          if (jobOfTrack.current.get(id) === job.id) {
            jobOfTrack.current.delete(id);
            setLookup(id, undefined);
          }
        }, DONE_MS);
      }
    }
  });

  /** Ask each enricher which Tracks it may be asked about. */
  const loadFindable = useCallback(() => {
    for (const { enricher } of LOOKUPS) {
      api.enricher(enricher).then(
        (read) => {
          // A 304 gives back the very answer held, which changes nothing.
          setEnrichers((now) =>
            now.get(enricher) === read ? now : new Map(now).set(enricher, read),
          );
          setAskedHere((now) => {
            if (!now.has(enricher)) {
              return now;
            }
            const left = new Map(now);
            left.delete(enricher);
            return left;
          });
          setWaitsAppliedAt(Date.now());
          setModes((now) =>
            now.get(enricher) === read.mode ? now : new Map(now).set(enricher, read.mode),
          );
        },
        () => {
          // Without the enricher, no Track offers its lookup.
        },
      );
    }
  }, []);

  useEffect(() => {
    // The songs are read first and alone, as the server answers one read faster than many;
    // the rest once they are drawn. Each loads on its own, so Playlists that fail to load
    // don't hide the songs.
    let cancelRest: (() => void) | undefined;
    const load = () => {
      cancelRest?.();
      let drawn = false;
      const readRest = () => {
        if (!drawn) {
          drawn = true;
          cancelRest = afterNextPaint(loadRest);
        }
      };
      api.tracks().then(
        (tracks) => {
          dispatch({ type: "loaded", tracks });
          refresh();
          readRest();
        },
        (failure: unknown) => {
          onFailure(failure);
          refresh();
          readRest();
        },
      );
      api.favorites().then(
        (read) => {
          if (favoritesUnanswered.current === 0) {
            setFavoriteGroups(favoriteGroupsOf(read));
          }
        },
        () => {
          // Without them, no artist or album shows a heart until one is given.
        },
      );
    };
    const loadRest = () => {
      api.playlists().then(setPlaylists, (failure: unknown) => {
        onFailure(failure);
      });
      api.mode().then(setMode, () => {
        // Without the Mode, the page shows nothing about it until the stream says.
      });
      loadFindable();
      loadDownloading();
      void loadFeatures();
      loadVideoLookups();
    };
    const onShown = () => {
      if (document.visibilityState === "visible") {
        readLyricsAgain();
        load();
      }
    };
    const readLyricsAgain = () => {
      setLyricsReconnects((count) => count + 1);
      setLyricsMatchRevision((count) => count + 1);
    };
    load();
    document.addEventListener("visibilitychange", onShown);
    const stopListening = listen(
      {
        load,
        refresh,
        firstReady: loadVideoLookups,
        onReady: () => {
          readLyricsAgain();
          setLyricsStreamConnections((count) => count + 1);
        },
      },
      setMode,
      onJob,
      setWaitingDevices,
      setSpeaker,
      (command) => {
        for (const listener of commandListeners.current) {
          listener(command);
        }
      },
    );
    return () => {
      cancelRest?.();
      document.removeEventListener("visibilitychange", onShown);
      stopListening();
    };
  }, [loadFindable, loadFeatures, loadDownloading, loadVideoLookups, refresh]);

  /** Ask for the Tracks again; one that can't be read now shows on the next load. */
  const reloadTracks = () => {
    api.tracks().then(
      (tracks) => {
        dispatch({ type: "loaded", tracks });
        refresh();
      },
      () => undefined,
    );
  };

  // A Download can be for a song added since the Tracks were read, as one just added is.
  const askedFor = useRef(new Set<number>());
  const readAddedTracks = useEffectEvent(() => {
    reloadTracks();
  });
  useEffect(() => {
    const unread = downloading
      .map(({ track_id }) => track_id)
      .filter((id) => !store.confirmed.has(id) && !askedFor.current.has(id));
    if (store.loaded && unread.length > 0) {
      for (const id of unread) {
        askedFor.current.add(id);
      }
      readAddedTracks();
    }
  }, [downloading, store]);

  /** Send `request`, signing out on a 401; then show the Track as the server now has it. */
  const changeDetails = async <T>(id: number, request: Promise<T>): Promise<T> => {
    let answer: T;
    try {
      answer = await request;
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        onSignedOut();
      }
      throw failure;
    }
    // A split file's album values are its songs' too, so all the Tracks are read again.
    if (store.confirmed.get(id)?.split === true) {
      reloadTracks();
      return answer;
    }
    // Changed; a Track that can't be read back now shows its new details on the next load.
    const seq = ++writes.current;
    latestSave.current.set(id, seq);
    api.track(id).then(
      (track) => {
        if (latestSave.current.get(id) === seq) {
          dispatch({ type: "details", track });
          refresh();
        }
      },
      () => undefined,
    );
    return answer;
  };

  /** Send `request`, signing out on a 401; then ask for the Tracks again, which it changed. */
  const changeTracks = async (request: Promise<unknown>): Promise<void> => {
    try {
      await request;
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        onSignedOut();
      }
      throw failure;
    }
    reloadTracks();
  };

  /** Send `request`, signing out on a 401. */
  const signedOutOn401 = async <T>(request: Promise<T>): Promise<T> => {
    try {
      return await request;
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        onSignedOut();
      }
      throw failure;
    }
  };

  const write = <F extends Field>(id: number, field: F, value: Track[F], send: Promise<Track>) => {
    const seq = ++writes.current;
    dispatch({ type: "write", id, field, value, seq });
    send.then(
      (track) => {
        dispatch({ type: "answered", id, field, value: track[field], seq });
      },
      (failure: unknown) => {
        dispatch({ type: "refused", id, field, seq });
        failed(failure);
      },
    );
  };

  /** Show `key` favorited or not at once, then as the server answers, or as it was if refused. */
  const writeFavorite = (
    group: "artistIds" | "artists" | "albums",
    key: string,
    favorite: boolean,
    send: Promise<FavoritesRead>,
  ) => {
    const seq = ++favoriteWrites.current;
    const toggle = (on: boolean) => {
      setFavoriteGroups((now) => {
        const keys = new Set(now[group]);
        if (on) {
          keys.add(key);
        } else {
          keys.delete(key);
        }
        return { ...now, [group]: keys };
      });
    };
    setError("");
    toggle(favorite);
    favoritesUnanswered.current += 1;
    send
      .finally(() => {
        favoritesUnanswered.current -= 1;
      })
      .then(
        (read) => {
          if (favoriteWrites.current === seq) {
            setFavoriteGroups(favoriteGroupsOf(read));
          }
        },
        (failure: unknown) => {
          toggle(!favorite);
          failed(failure);
        },
      );
  };

  return {
    tracks: tracksOf(store),
    playlists,
    providers,
    aiSetUp,
    refreshFeatures: loadFeatures,
    loaded: store.loaded,
    refreshes,
    lyricsMatchRevision,
    lyricsMatchEnds,
    lyricsStreamConnections,
    lyricsVersion: (trackId) =>
      `${String(lyricsReconnects)}:${String(trackId === undefined ? 0 : (lyricSaves.get(trackId) ?? 0))}`,
    error,
    mode,
    modeChecked: setMode,
    waitingDevices,
    downloading,
    speaker,
    onCommand,
    findable,
    askedRecently,
    refreshFindable: loadFindable,
    reloadTracks,
    modes,
    lookups,
    find: async (enricher, id, again) => {
      jobOfTrack.current.delete(id);
      setLookup(id, { enricher, state: "queued", message: "" });
      let job: Job;
      asking.current.add(id);
      try {
        job = await api.findDetails(enricher, id, again);
      } catch (failure) {
        asking.current.delete(id);
        stoppedEarly.current.delete(id);
        if (failure instanceof ApiError && failure.status === 401) {
          onSignedOut();
        }
        if (lyricsMatchInProgress(failure)) {
          setLookup(id, undefined);
        } else {
          const message = failure instanceof Error ? failure.message : String(failure);
          setLookup(id, { enricher, state: "failed", message });
        }
        throw failure;
      }
      asking.current.delete(id);
      if (stoppedEarly.current.delete(id)) {
        // Stopped while it was being asked for: the Job it became is cancelled at once.
        setLookup(id, undefined);
        await api.cancelJob(job.id).catch(() => undefined);
        loadFindable();
        return;
      }
      trackOfJob.current.set(job.id, id);
      jobOfTrack.current.set(id, job.id);
      setLookup(id, { enricher, state: job.state, message: job.failure_message });
      // Asked: the Job is queued, so the Track no longer offers it until the Job is done.
      setAskedHere((now) =>
        new Map(now).set(enricher, new Set([...(now.get(enricher) ?? []), id])),
      );
    },
    stopFinding: async (id) => {
      const job = jobOfTrack.current.get(id);
      if (job === undefined) {
        if (asking.current.has(id)) {
          stoppedEarly.current.add(id);
        }
        return;
      }
      jobOfTrack.current.delete(id);
      setLookup(id, undefined);
      await api.cancelJob(job);
      // Stopped, the Track offers the lookup again.
      loadFindable();
    },
    setFavorite: (id, favorite) => {
      setError("");
      write(id, "favorite", favorite, api.setFavorite(id, favorite));
    },
    favoriteGroups,
    setArtistFavorite: (artistId, favorite) => {
      writeFavorite("artistIds", artistId, favorite, api.setArtistFavorite(artistId, favorite));
    },
    setAlbumFavorite: (artist, name, favorite) => {
      writeFavorite(
        "albums",
        albumKey(artist, name),
        favorite,
        api.setAlbumFavorite(artist, name, favorite),
      );
    },
    setRating: (id, rating) => {
      setError("");
      write(id, "rating", rating, api.setRating(id, rating));
    },
    saveDetails: async (id, changes, artists) => {
      await changeDetails(id, api.setDetails([id], changes, artists));
    },
    readVideoText: (id, text) => changeDetails(id, api.readVideoText(id, text)),
    setCover: (id, image) => changeDetails(id, api.setCover(id, image)),
    removeCover: (id) => changeDetails(id, api.removeCover(id)),
    saveSongs: async (id, rows, known) => {
      await changeTracks(api.saveSongs(id, rows, known));
    },
    unsplit: async (id) => {
      await changeTracks(api.unsplit(id));
    },
    setDetailsOn: async (ids, values) => {
      await changeTracks(api.setDetails(ids, values));
    },
    videoLookups,
    videoLookup: (id) => signedOutOn401(api.videoLookup(id)),
    lookUpLink: async (link) => {
      const saved = await signedOutOn401(api.lookUpLink(link));
      loadVideoLookups();
      return saved;
    },
    dismissLookup: async (id) => {
      await signedOutOn401(api.dismissLookup(id));
      forgetVideo(id);
    },
    addLink: async (id, quality, parts) => {
      const added = await signedOutOn401(api.addLink(id, quality, parts));
      forgetVideo(id);
      reloadTracks();
      loadDownloading();
      return added;
    },
    download: (id) => signedOutOn401(api.download(id)),
    dismissFailedDownloads: (ids) => changeTracks(api.dismissFailedDownloads(ids)),
    addFile: async (id, file, onProgress, signal) => {
      await signedOutOn401(uploadFile(id, file, onProgress, signal));
      reloadTracks();
    },
    addToPlaylists: async (track, ids, newNames) => {
      const puts = [
        ...playlists
          .filter((playlist) => ids.includes(playlist.id))
          .map((playlist) =>
            api.putPlaylist(playlist.id, {
              name: playlist.name,
              track_ids: [...playlist.track_ids, track.id],
              keep_downloaded: playlist.keep_downloaded,
            }),
          ),
        ...newNames.map((name) =>
          api.putPlaylist(newId(), { name, track_ids: [track.id], keep_downloaded: false }),
        ),
      ];
      const results = await Promise.allSettled(puts);
      const saved = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      setPlaylists((now) =>
        listed([...now.filter((each) => !saved.some((s) => s.id === each.id)), ...saved]),
      );
      const refused = results.find((result) => result.status === "rejected");
      if (refused !== undefined) {
        if (refused.reason instanceof ApiError && refused.reason.status === 401) {
          onSignedOut();
        }
        throw refused.reason;
      }
    },
    keepDownloaded: async (playlist, keep) => {
      const saved = await signedOutOn401(api.setKeepDownloaded(playlist.id, keep));
      setPlaylists((now) => now.map((each) => (each.id === saved.id ? saved : each)));
    },
  };
}

/** Return `playlists` as the server lists them: the built-in ones first, then by name. */
function listed(playlists: readonly Playlist[]): Playlist[] {
  return [...playlists].sort(
    (a, b) =>
      Number(a.builtin === null) - Number(b.builtin === null) || collator.compare(a.name, b.name),
  );
}

/**
 * Call `load` when the event stream (re)connects, which may have missed changes,
 * a moment after a scan or a Download finishes, and when the Mode goes Online or
 * Offline, which changes what can play; a moment after any other Job ends, call
 * `refresh`, as it may change what is read beside the songs. Tell `onMode` each
 * Mode the stream sends, `onJob` each Job, `onWaitingDevices` the devices waiting
 * for an answer, which only an admin's stream sends, `onSpeaker` the computer
 * playing for the Account, and `onCommand` each command for this page while it is
 * that computer. Return what stops listening.
 */
function listen(
  {
    load,
    refresh,
    firstReady,
    onReady,
  }: {
    readonly load: () => void;
    readonly refresh: () => void;
    readonly firstReady: () => void;
    readonly onReady: () => void;
  },
  onMode: (mode: Mode) => void,
  onJob: (job: JobEvent) => void,
  onWaitingDevices: (waiting: readonly WaitingDevice[]) => void,
  onSpeaker: (speaker: Speaker | null) => void,
  onCommand: (command: RemoteCommand) => void,
): () => void {
  if (typeof EventSource === "undefined") {
    return () => undefined;
  }
  const events = new EventSource(`/api/events?page=${PAGE_ID}`);
  let settling: ReturnType<typeof setTimeout> | undefined;
  // Whether a Job that ended while settling may have changed the Tracks.
  let tracksChanged = false;
  let connected = false;
  let online: boolean | undefined;
  events.addEventListener("ready", () => {
    onReady();
    if (connected) {
      load();
    } else {
      firstReady();
    }
    connected = true;
  });
  events.addEventListener("mode", (event: MessageEvent<string>) => {
    const mode = JSON.parse(event.data) as Mode;
    if (online !== undefined && online !== mode.online) {
      load();
    }
    online = mode.online;
    onMode(mode);
  });
  events.addEventListener("tracks", () => {
    // A setting changed how Tracks show, such as which are albums.
    load();
  });
  events.addEventListener("devices", (event: MessageEvent<string>) => {
    const { waiting } = JSON.parse(event.data) as { waiting: readonly WaitingDevice[] };
    onWaitingDevices(waiting);
  });
  events.addEventListener("remote", (event: MessageEvent<string>) => {
    const { page, state, age_ms } = JSON.parse(event.data) as RemoteEvent;
    onSpeaker(
      page === null || state === null
        ? null
        : { page, state, reportedAt: Date.now() - (age_ms ?? 0) },
    );
  });
  events.addEventListener("command", (event: MessageEvent<string>) => {
    onCommand(JSON.parse(event.data) as RemoteCommand);
  });
  events.addEventListener("job", (event: MessageEvent<string>) => {
    const job = JSON.parse(event.data) as JobEvent;
    onJob(job);
    if (FINISHED.has(job.state) && !CHANGES_NOTHING.has(job.kind)) {
      tracksChanged ||= CHANGES_TRACKS.has(job.kind);
      clearTimeout(settling);
      settling = setTimeout(() => {
        const reload = tracksChanged;
        tracksChanged = false;
        if (reload) {
          load();
        } else {
          refresh();
        }
      }, SETTLE_MS);
    }
  });
  return () => {
    clearTimeout(settling);
    events.close();
  };
}

/** The longest a timer may wait: a longer one fires at once. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** Each enricher's Tracks from `pick`, less those asked about from this page since its answer. */
function withoutAskedHere(
  askings: ReadonlyMap<string, Asking>,
  askedHere: ReadonlyMap<string, ReadonlySet<number>>,
  pick: (asking: Asking) => ReadonlySet<number>,
): ReadonlyMap<string, ReadonlySet<number>> {
  return new Map(
    [...askings].map(([name, asking]) => {
      const asked = askedHere.get(name);
      const tracks = pick(asking);
      return [
        name,
        asked === undefined ? tracks : new Set([...tracks].filter((id) => !asked.has(id))),
      ];
    }),
  );
}
