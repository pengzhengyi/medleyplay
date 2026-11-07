/**
 * @file The signed-in Account's Tracks: loaded once, asked for again when needed, and written.
 */

import { useCallback, useEffect, useEffectEvent, useReducer, useRef, useState } from "react";

import {
  ApiError,
  type Detail,
  type Details,
  type EnricherMode,
  type FavoritesRead,
  type AddedPart,
  type Job,
  type JobEvent,
  type LinkLookup,
  type Mode,
  type PartChoice,
  type Playlist,
  type SongRowIn,
  type Track,
  type TrackDownload,
  type VideoRead,
  type VideoText,
  api,
  uploadFile,
} from "../api";
import { newId } from "../ids";
import { type FavoriteGroups, NO_FAVORITES, albumKey, favoriteGroupsOf } from "./favoriteGroups";
import { fold } from "./views";
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
  /** Whether the server has listed the Tracks yet. */
  readonly loaded: boolean;
  /** Why the last request failed, or `""`. */
  readonly error: string;
  /** Whether medleyplay may contact music sites now, once the server has said. */
  readonly mode: Mode | null;
  /** Show the Mode a check of the network came to, before the stream says it. */
  readonly modeChecked: (mode: Mode) => void;
  /** The Tracks each enricher may be asked about now, by the enricher's name. */
  readonly findable: ReadonlyMap<string, ReadonlySet<number>>;
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
  readonly find: (enricher: string, id: number) => Promise<void>;
  /**
   * The lookup last asked about each Track, by the Track's id, while its Job runs, a
   * moment after it succeeds, and until it is asked again after it fails.
   */
  readonly lookups: ReadonlyMap<number, TrackLookup>;
  readonly setFavorite: (id: number, favorite: boolean) => void;
  /** The artists and albums the Account favorited. */
  readonly favoriteGroups: FavoriteGroups;
  readonly setArtistFavorite: (name: string, favorite: boolean) => void;
  readonly setAlbumFavorite: (artist: string, name: string, favorite: boolean) => void;
  readonly setRating: (id: number, rating: number | null) => void;
  /**
   * Change the household's values for the Track, `null` dropping one; the Track then
   * shows the server's answer. The promise rejects with why when the server refuses.
   */
  readonly saveDetails: (
    id: number,
    changes: Partial<Record<Detail, string | number | null>>,
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
  /** Look up the video a link or bare code names; the promise rejects with why it can't. */
  readonly lookUpLink: (link: string) => Promise<LinkLookup>;
  /**
   * Add the chosen parts of a link's video as Tracks, which then show downloading. The
   * promise rejects with why when the server refuses.
   */
  readonly addLink: (
    link: string,
    quality: string,
    parts: readonly PartChoice[],
  ) => Promise<readonly AddedPart[]>;
  /** Where a site Track's Download stands. */
  readonly download: (id: number) => Promise<TrackDownload>;
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
}

/** The Jobs whose end can change the Tracks. */
const CHANGES_TRACKS = new Set(["scan_library", "download_source", "enrich_track"]);
const FINISHED = new Set<JobEvent["state"]>(["succeeded", "failed", "cancelled"]);
/** How long after the last such Job the Tracks are asked for, so a busy scan asks once. */
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
  const [playlists, setPlaylists] = useState<readonly Playlist[]>([]);
  const [providers, setProviders] = useState<readonly string[]>([]);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode | null>(null);
  const [findable, setFindable] = useState<ReadonlyMap<string, ReadonlySet<number>>>(new Map());
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
  /** Follow a lookup's Job as the event stream tells of it. */
  const onJob = useEffectEvent((job: JobEvent) => {
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
          setFindable((now) => new Map(now).set(enricher, new Set(read.eligible)));
          setModes((now) => new Map(now).set(enricher, read.mode));
        },
        () => {
          // Without the enricher, no Track offers its lookup.
        },
      );
    }
  }, []);

  useEffect(() => {
    // Each loads on its own, so Playlists that fail to load don't hide the songs.
    const load = () => {
      api.tracks().then(
        (tracks) => {
          dispatch({ type: "loaded", tracks });
        },
        (failure: unknown) => {
          onFailure(failure);
        },
      );
      api.playlists().then(setPlaylists, (failure: unknown) => {
        onFailure(failure);
      });
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
      api.mode().then(setMode, () => {
        // Without the Mode, the page shows nothing about it until the stream says.
      });
      loadFindable();
    };
    const onShown = () => {
      if (document.visibilityState === "visible") {
        load();
      }
    };
    load();
    api.features().then(
      (features) => {
        setProviders(features.providers.source_resolver ?? []);
      },
      () => {
        // Without the features, a search looks only in the Library.
      },
    );
    document.addEventListener("visibilitychange", onShown);
    const stopListening = listen(load, setMode, onJob);
    return () => {
      document.removeEventListener("visibilitychange", onShown);
      stopListening();
    };
  }, [loadFindable]);

  /** Ask for the Tracks again; one that can't be read now shows on the next load. */
  const reloadTracks = () => {
    api.tracks().then(
      (tracks) => {
        dispatch({ type: "loaded", tracks });
      },
      () => undefined,
    );
  };

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
    group: keyof FavoriteGroups,
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
    loaded: store.loaded,
    error,
    mode,
    modeChecked: setMode,
    findable,
    refreshFindable: loadFindable,
    reloadTracks,
    modes,
    lookups,
    find: async (enricher, id) => {
      jobOfTrack.current.delete(id);
      setLookup(id, { enricher, state: "queued", message: "" });
      let job: Job;
      try {
        job = await api.findDetails(enricher, id);
      } catch (failure) {
        if (failure instanceof ApiError && failure.status === 401) {
          onSignedOut();
        }
        const message = failure instanceof Error ? failure.message : String(failure);
        setLookup(id, { enricher, state: "failed", message });
        throw failure;
      }
      trackOfJob.current.set(job.id, id);
      jobOfTrack.current.set(id, job.id);
      setLookup(id, { enricher, state: job.state, message: job.failure_message });
      // Asked: the Job is queued, so the Track no longer offers it until the Job is done.
      setFindable((now) => {
        const left = [...(now.get(enricher) ?? [])].filter((each) => each !== id);
        return new Map(now).set(enricher, new Set(left));
      });
    },
    setFavorite: (id, favorite) => {
      setError("");
      write(id, "favorite", favorite, api.setFavorite(id, favorite));
    },
    favoriteGroups,
    setArtistFavorite: (name, favorite) => {
      writeFavorite("artists", fold(name.trim()), favorite, api.setArtistFavorite(name, favorite));
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
    saveDetails: async (id, changes) => {
      await changeDetails(id, api.setDetails([id], changes));
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
    lookUpLink: (link) => signedOutOn401(api.lookUpLink(link)),
    addLink: async (link, quality, parts) => {
      const added = await signedOutOn401(api.addLink(link, quality, parts));
      reloadTracks();
      return added;
    },
    download: (id) => signedOutOn401(api.download(id)),
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
 * Offline, which changes what can play; tell `onMode` each Mode the stream sends,
 * and `onJob` each Job. Return what stops listening.
 */
function listen(
  load: () => void,
  onMode: (mode: Mode) => void,
  onJob: (job: JobEvent) => void,
): () => void {
  if (typeof EventSource === "undefined") {
    return () => undefined;
  }
  const events = new EventSource("/api/events");
  let settling: ReturnType<typeof setTimeout> | undefined;
  let connected = false;
  let online: boolean | undefined;
  events.addEventListener("ready", () => {
    // The page loaded on opening; only a reconnect may have missed something.
    if (connected) {
      load();
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
  events.addEventListener("job", (event: MessageEvent<string>) => {
    const job = JSON.parse(event.data) as JobEvent;
    onJob(job);
    if (CHANGES_TRACKS.has(job.kind) && FINISHED.has(job.state)) {
      clearTimeout(settling);
      settling = setTimeout(load, SETTLE_MS);
    }
  });
  return () => {
    clearTimeout(settling);
    events.close();
  };
}
