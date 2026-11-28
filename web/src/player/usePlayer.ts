/**
 * @file The player: one `<audio>` element playing the queue, with the lock screen's controls.
 *
 * A song inside a longer file plays its stretch of that file: the player shows, seeks,
 * and saves its position from the song's own start, and moves on at its end, playing
 * on without reloading the file when the next song starts there.
 */

import {
  type RefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
} from "react";

import { ApiError, type PlaybackAnswer, type Track, api, coverUrl } from "../api";
import { newId } from "../ids";
import {
  segmentStretch,
  splitChanged,
  updatePlayingAlbum,
  updateUpcomingAlbums,
  withoutDeletedSongs,
} from "./albumSync";
import { PlayTime, reportOf } from "./playCount";
import { recordPlay, sendPlays, updatePlay } from "./plays";
import {
  EMPTY,
  type Entry,
  type Queue,
  RESTART_AFTER,
  type Repeat,
  current,
  following,
  reduce,
  withoutTracks,
} from "./queue";
import { type Play, type Saved, loadQueue, saveQueue } from "./storage";
import {
  type Stretch,
  WHOLE,
  fileTimeOf,
  lengthOf,
  positionIn,
  remainingIn,
  stretchOf,
} from "./stretch";
import { loadVolume, saveVolume } from "./volume";

/** What the player is doing. */
export type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "preparing" }
  | { readonly kind: "playing" }
  | { readonly kind: "paused" }
  /** The browser refused to start playing until someone presses play. */
  | { readonly kind: "blocked"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

/** What plays, to play on elsewhere: the queue, how far into its entry, and whether it counted. */
export interface Handoff {
  readonly queue: Queue;
  readonly seconds: number;
  /** Whether the play of the current entry has already been counted. */
  readonly counted: boolean;
  /** That play, with how long it has been listened to, for the page taking it on to go on with. */
  readonly play?: Play | undefined;
}

/** The player as the page sees it. */
export interface Player {
  readonly queue: Queue;
  readonly status: Status;
  readonly shuffled: boolean;
  readonly repeat: Repeat;
  /** Seconds into the current Track. */
  readonly position: number;
  /** The current Track's length in seconds, once known. */
  readonly duration: number | undefined;
  /** How loud it plays, from 0 to 1. */
  readonly volume: number;
  /** Whether it is silent for now; the volume comes back as it was. */
  readonly muted: boolean;
  /** Play `tracks` from its entry `start`, each in the unit `unitOf` gives it, if any. */
  readonly playList: (tracks: readonly Track[], start: number, unitOf?: UnitOf) => void;
  /** Play every Track of `tracks` from the first, in their order or shuffled by unit. */
  readonly playAll: (tracks: readonly Track[], shuffled: boolean, unitOf?: UnitOf) => void;
  /** Play `track` now, leaving what plays next as it was. */
  readonly playNow: (track: Track) => void;
  readonly playNext: (track: Track) => void;
  readonly add: (track: Track) => void;
  readonly toggle: () => void;
  /** Pause what plays, if anything does; unlike `toggle`, it never starts playing. */
  readonly pause: () => void;
  readonly next: () => void;
  readonly previous: () => void;
  readonly seek: (seconds: number) => void;
  /** Play the entry `key` from `seconds` into it, playing on, wherever it is in the queue. */
  readonly playAt: (key: string, seconds: number) => void;
  /** Move an upcoming entry to place `to` among what plays next, 0 being next. */
  readonly move: (key: string, to: number) => void;
  readonly remove: (key: string) => void;
  readonly clear: () => void;
  readonly shuffle: (on: boolean) => void;
  readonly setRepeat: (repeat: Repeat) => void;
  /** Change the volume, and turn the sound back on. */
  readonly setVolume: (volume: number) => void;
  readonly setMuted: (muted: boolean) => void;
  /** What plays now, to play on elsewhere; nothing while nothing is queued. */
  readonly handoff: () => Handoff | undefined;
  /** Play `handoff`'s queue from its second, playing or paused. */
  readonly take: (handoff: Handoff, playing: boolean) => void;
}

/** What the page shows about one entry of the queue. */
interface View {
  readonly key: string | undefined;
  readonly status: Status;
  readonly position: number;
  readonly duration: number | undefined;
}

const MAX_PREPARE_ATTEMPTS = 3;
const SAVE_EVERY = 5;
const FINISHED_JOB = new Set(["succeeded", "failed", "cancelled"]);
const PAUSING_ERRORS = new Set(["AbortError"]);
/** How near a song's start the file may already be for it to play on without a seek, in seconds. */
const IN_PLACE = 0.25;

const UNPLAYABLE: Record<string, string> = {
  offline: "This Track's Library is offline.",
  waiting_online: "This Track can play once medleyplay is Online.",
  unavailable: "This Track is unavailable.",
  missing: "This Track's file is missing.",
  cant_play: "This Track can't be played.",
};

/** The unit a Track is queued as part of, if any; a shuffle keeps a unit together. */
export type UnitOf = (track: Track) => string | undefined;

const entryOf = (track: Track, unitOf?: UnitOf): Entry => ({
  key: newId(),
  trackId: track.id,
  unit: unitOf?.(track),
});
const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Play the queue through one `<audio>` element, which the page renders once with the
 * returned ref: `<audio ref={audio} />`.
 *
 * `tracks` names each Track for the lock screen; `onSignedOut` runs when a request
 * finds the session has expired. Saved album entries stay until `catalogLoaded`.
 * The third result enables or suspends this device's audio.
 */
export function usePlayer(
  tracks: ReadonlyMap<number, Track>,
  onSignedOut: () => void,
  catalogLoaded = true,
): readonly [Player, RefObject<HTMLAudioElement | null>, (enabled: boolean) => void] {
  const audio = useRef<HTMLAudioElement>(null);
  const [audioEnabled, showAudioEnabled] = useState(true);
  const audioEnabledNow = useRef(true);
  const audioStarts = useRef(0);
  const [queue, dispatch] = useReducer(reduce, EMPTY);
  const [albumRevision, setAlbumRevision] = useState(0);
  const previousTracks = useRef(tracks);
  const catalogWasLoaded = useRef(catalogLoaded);
  const updatedPosition = useRef<{ queue: Queue; seconds: number } | undefined>(undefined);
  const [view, setView] = useState<View>({
    key: undefined,
    status: { kind: "idle" },
    position: 0,
    duration: undefined,
  });
  const ahead = useRef(new Map<number, Prefetched>());
  const loads = useRef(0);
  const playingKey = useRef<string | undefined>(undefined);
  const loadedKey = useRef<string | undefined>(undefined);
  const waitingMetadata = useRef(false);
  // A restored queue starts paused at its saved position, once its Track's metadata loads.
  const restore = useRef<number | undefined>(undefined);
  const resumeAt = useRef<number | undefined>(undefined);
  // A queue taken from elsewhere plays on, or pauses, from its second; its play may have counted.
  const takenPlaying = useRef(false);
  const takenCounted = useRef(false);
  const takenPlay = useRef<Play | undefined>(undefined);
  // The current listen: its play, how long it has played here and before it was handed
  // on to this page, whether it counts, and the time sent.
  const listening = useRef<
    { play: Play; time: PlayTime; fromMs: number; counted: boolean; sentMs: number } | undefined
  >(undefined);
  const lastSaved = useRef(0);
  // The current song's stretch of its file, the timer that ends it, and the entry last ended.
  const stretch = useRef<Stretch>(WHOLE);
  const ending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ended = useRef<string | undefined>(undefined);
  const followingBoundary = useRef<{ key: string; end: number } | undefined>(undefined);
  const [volume, setVolume] = useState(loadVolume);
  const [muted, setMuted] = useState(false);

  const setAudioEnabled = (enabled: boolean) => {
    if (audioEnabledNow.current === enabled) return;
    audioEnabledNow.current = enabled;
    showAudioEnabled(enabled);
    if (!enabled) {
      ++audioStarts.current;
      clearTimeout(ending.current);
      audio.current?.pause();
    }
  };

  const playing = current(queue);
  const key = playing?.key;
  const trackId = playing?.trackId;
  const trackFor = useEffectEvent((id: number) => tracks.get(id));

  /** Change what the page shows about the entry `forKey`, ignoring an entry since replaced. */
  const show = (forKey: string | undefined, change: Partial<View>) => {
    setView((now) =>
      now.key === forKey
        ? { ...now, ...change }
        : { key: forKey, status: { kind: "loading" }, position: 0, duration: undefined, ...change },
    );
  };

  const failed = (forKey: string | undefined, error: unknown) => {
    const status = failureOf(error);
    if (status === undefined) {
      onSignedOut();
    } else {
      show(forKey, { status });
    }
  };
  const fail = useEffectEvent(failed);

  /**
   * Send what is due of the current listen: the play once it counts, then its time
   * each further minute; once `over`, any time not yet sent.
   */
  const report = (over = false) => {
    const heard = listening.current;
    if (heard === undefined) {
      return;
    }
    const element = audio.current;
    const playedMs = heard.fromMs + Math.round(heard.time.playedMs);
    const trackMs =
      tracks.get(heard.play.trackId)?.duration_ms ?? (element?.duration ?? Number.NaN) * 1000;
    switch (reportOf(heard, playedMs, trackMs, over)) {
      case "record":
        heard.counted = true;
        heard.sentMs = playedMs;
        void recordPlay({ ...heard.play, listenedMs: playedMs });
        break;
      case "update":
        heard.sentMs = playedMs;
        void updatePlay(heard.play, playedMs);
        break;
      default:
    }
  };
  const reportNow = useEffectEvent(report);

  /** Start counting a new play of `forTrack`, the Track now starting from its beginning. */
  const startListening = (forTrack: number) => {
    report(true);
    listening.current = {
      play: { id: newId(), trackId: forTrack, playedAt: new Date().toISOString() },
      time: new PlayTime(),
      fromMs: 0,
      counted: false,
      sentMs: 0,
    };
  };
  const listen = useEffectEvent(startListening);

  const restoreSaved = useEffectEvent((saved: Saved | undefined) => {
    if (saved === undefined || saved.queue.entries.length === 0) return;
    const restored = catalogLoaded ? withoutMissingAlbumSongs(saved.queue, tracks) : saved.queue;
    const entry = current(restored);
    const seconds = entry !== undefined && entry === current(saved.queue) ? saved.seconds : 0;
    restore.current = entry === undefined ? undefined : seconds;
    updatedPosition.current = { queue: restored, seconds };
    dispatch({ type: "restore", queue: restored });
  });

  // Restore the saved queue paused, and send any plays a closed page left behind.
  useEffect(() => {
    void loadQueue().then((saved) => {
      restoreSaved(saved);
    });
    void sendPlays();
  }, []);

  // A page put away may be closed without warning, so the time listened so far goes now.
  useEffect(() => {
    const whenHidden = () => {
      if (document.visibilityState === "hidden") {
        reportNow(true);
      }
    };
    document.addEventListener("visibilitychange", whenHidden);
    return () => {
      document.removeEventListener("visibilitychange", whenHidden);
    };
  }, []);

  // Load the current entry whenever it changes; a later load supersedes an earlier one.
  useEffect(() => {
    const element = audio.current;
    if (key !== undefined && playingKey.current === key && loadedKey.current === key) return;
    const boundary = followingBoundary.current;
    followingBoundary.current = undefined;
    playingKey.current = key;
    loadedKey.current = undefined;
    waitingMetadata.current = false;
    if (element === null) {
      return;
    }
    const load = ++loads.current;
    const stale = () => load !== loads.current;
    clearTimeout(ending.current);
    ended.current = undefined;
    if (trackId === undefined) {
      element.pause();
      element.removeAttribute("src");
      element.load();
      return;
    }
    const restoring = restore.current;
    restore.current = undefined;
    resumeAt.current = restoring;
    const playOn = audioEnabledNow.current && (restoring === undefined || takenPlaying.current);
    const start = audioStarts.current;
    const canStart = () => playOn && start === audioStarts.current && audioEnabledNow.current;
    const counted = takenCounted.current;
    const carried = takenPlay.current;
    takenPlaying.current = false;
    takenCounted.current = false;
    takenPlay.current = undefined;
    const requestedTrack = trackFor(trackId);
    void (async () => {
      try {
        const answer = await answerFor(trackId, requestedTrack, ahead.current, () => {
          if (!stale()) {
            show(key, { status: { kind: "preparing" } });
          }
        });
        if (stale()) {
          return;
        }
        if (answer.state !== "ready") {
          const message =
            answer.state === "unplayable"
              ? (UNPLAYABLE[answer.availability] ?? "This Track can't be played.")
              : "This Track couldn't be prepared.";
          show(key, { status: { kind: "failed", message } });
          return;
        }
        if (element.canPlayType(answer.media_type) === "") {
          show(key, { status: { kind: "failed", message: "This browser can't play this file." } });
          return;
        }
        listen(trackId);
        if (counted && listening.current !== undefined) {
          listening.current.counted = true;
          // The play goes on here, unless a stale report handed on another Track's.
          if (carried?.trackId === trackId) {
            const fromMs = carried.listenedMs ?? 0;
            listening.current = { ...listening.current, play: carried, fromMs, sentMs: fromMs };
          }
        }
        const latestTrack = trackFor(trackId);
        const song =
          (splitChanged(requestedTrack, latestTrack) ? segmentStretch(latestTrack) : undefined) ??
          stretchOf(answer);
        stretch.current = song;
        loadedKey.current = key;
        if (playsFrom(element, answer.audio_url)) {
          // A song of the file already loaded: play on, from its start or the second taken.
          const from =
            restoring === undefined ? song.start : fileTimeOf(song, restoring, element.duration);
          const at = element.currentTime;
          const alreadyInNext =
            boundary !== undefined &&
            boundary.key === key &&
            Math.abs(song.start - boundary.end) <= IN_PLACE &&
            restoring === undefined &&
            at >= song.start &&
            (song.end === undefined || at < song.end);
          resumeAt.current = undefined;
          if (!alreadyInNext && Math.abs(at - from) > IN_PLACE) {
            element.currentTime = from;
          }
          // Playing on fires no `play` event, so the new entry says it is playing itself.
          const shouldStart = canStart();
          show(key, {
            duration: lengthOf(song, element.duration),
            ...(alreadyInNext ? { position: positionIn(song, at) } : {}),
            ...(!element.paused
              ? { status: { kind: "playing" } }
              : shouldStart
                ? {}
                : { status: { kind: "paused" } }),
          });
          if (element.paused && shouldStart) {
            await element.play();
          }
          return;
        }
        waitingMetadata.current = true;
        element.src = answer.audio_url;
        if (canStart()) {
          await element.play();
        } else {
          show(key, { status: { kind: "paused" } });
        }
      } catch (error) {
        if (!stale() && start === audioStarts.current) {
          fail(key, error);
        }
      }
    })();
    // A new entry for the same Track is a new play, so its key decides.
  }, [key, trackId]);

  /** Play the current Track on from where it is, if it is loaded and paused. */
  const resume = () => {
    const element = audio.current;
    if (!audioEnabledNow.current || element?.getAttribute("src") == null || !element.paused) {
      return;
    }
    const forKey = playingKey.current;
    const start = audioStarts.current;
    element.play().catch((error: unknown) => {
      if (start === audioStarts.current) failed(forKey, error);
    });
  };
  const toggle = () => {
    if (audio.current?.paused === false) {
      audio.current.pause();
    } else {
      resume();
    }
  };
  /** Start the current Track over, as a new play, and play it if `play`. */
  const restart = (play: boolean) => {
    const element = audio.current;
    if (element === null || trackId === undefined) {
      return;
    }
    element.currentTime = stretch.current.start;
    ended.current = undefined;
    startListening(trackId);
    if (play && audioEnabledNow.current) {
      const forKey = playingKey.current;
      const start = audioStarts.current;
      element.play().catch((error: unknown) => {
        if (start === audioStarts.current) failed(forKey, error);
      });
    }
  };
  const previous = () => {
    const element = audio.current;
    if (
      element !== null &&
      (positionIn(stretch.current, element.currentTime) > RESTART_AFTER || queue.position === 0)
    ) {
      restart(false);
      return;
    }
    dispatch({ type: "previous" });
  };
  const next = () => {
    // A queue that starts over on the same entry keeps its key, so it plays again in place.
    if (key !== undefined && following(queue)?.key === key) {
      restart(true);
      return;
    }
    dispatch({ type: "next" });
  };
  const seek = useCallback((seconds: number) => {
    const element = audio.current;
    if (element !== null && Number.isFinite(seconds)) {
      element.currentTime = fileTimeOf(stretch.current, seconds, element.duration);
    }
  }, []);
  const playAt = useCallback(
    (target: string, seconds: number) => {
      if (target === key) {
        seek(seconds);
        return;
      }
      restore.current = Math.max(0, seconds);
      takenPlaying.current = true;
      dispatch({ type: "jump", key: target });
    },
    [key, seek],
  );
  const move = useCallback((moving: string, to: number) => {
    dispatch({ type: "move", key: moving, to });
  }, []);
  const remove = useCallback((removing: string) => {
    dispatch({ type: "remove", key: removing });
  }, []);

  /** End the current entry once: start it over, or move on, playing on into the next song of the file. */
  const finish = useEffectEvent(() => {
    const element = audio.current;
    if (!audioEnabledNow.current || element === null || ended.current === playingKey.current) {
      return;
    }
    ended.current = playingKey.current;
    clearTimeout(ending.current);
    if (queue.repeat === "one") {
      restart(true);
      return;
    }
    const coming = following(queue);
    const early =
      coming === undefined
        ? undefined
        : prefetchedAnswer(ahead.current.get(coming.trackId), trackFor(coming.trackId));
    const end = stretch.current.end;
    const flowsOn =
      early?.state === "ready" &&
      playsFrom(element, early.audio_url) &&
      end !== undefined &&
      Math.abs(stretchOf(early).start - end) <= IN_PLACE;
    followingBoundary.current =
      coming === undefined || end === undefined ? undefined : { key: coming.key, end };
    if (end !== undefined && !flowsOn) {
      element.pause();
    }
    next();
  });

  const refreshQueue = useEffectEvent(() => {
    const before = previousTracks.current;
    const alreadyLoaded = catalogWasLoaded.current;
    previousTracks.current = tracks;
    catalogWasLoaded.current = catalogLoaded;
    if (!catalogLoaded || (before === tracks && alreadyLoaded)) return;
    const element = audio.current;
    const loaded =
      element !== null &&
      key !== undefined &&
      loadedKey.current === key &&
      view.key === key &&
      (view.status.kind === "playing" ||
        view.status.kind === "paused" ||
        view.status.kind === "blocked");
    const revised = updatePlayingAlbum(
      queue,
      before,
      tracks,
      loaded && !waitingMetadata.current ? element.currentTime : undefined,
      newId,
    );
    const wasActive = trackId === undefined ? undefined : before.get(trackId);
    const isActive = trackId === undefined ? undefined : tracks.get(trackId);
    const activeChanged = splitChanged(wasActive, isActive);
    const coming = following(queue)?.trackId;
    const refreshed = updateUpcomingAlbums(revised ?? queue, before, tracks, newId);
    const nextQueue = withoutDismissed(withoutDeletedSongs(refreshed, before, tracks), tracks);
    if (
      revised !== undefined ||
      activeChanged ||
      coming !== following(nextQueue)?.trackId ||
      (coming !== undefined && splitChanged(before.get(coming), tracks.get(coming)))
    ) {
      ahead.current = new Map();
      setAlbumRevision((revision) => revision + 1);
    }

    const entry = current(nextQueue);
    const track = entry === undefined ? undefined : tracks.get(entry.trackId);
    const file = wasActive?.segment_of;
    const sameFile = file != null && (track?.segment_of === file || track?.id === file);
    const song = !sameFile ? undefined : track.id === file ? WHOLE : segmentStretch(track);
    if (isActive?.download_dismissed === true && entry?.key !== key) {
      ++loads.current;
      clearTimeout(ending.current);
      if (entry !== undefined) {
        const playing = loaded ? !element.paused : resumeAt.current === undefined;
        restore.current = 0;
        takenPlaying.current = playing;
      }
      if (element?.paused === false) element.pause();
    } else if (loaded && entry?.key === key && waitingMetadata.current && song !== undefined) {
      if (activeChanged) stretch.current = song;
    } else if (
      loaded &&
      !waitingMetadata.current &&
      entry !== undefined &&
      song !== undefined &&
      (revised !== undefined || activeChanged)
    ) {
      if (entry.key !== key) {
        ++loads.current;
        listening.current?.time.update(element.currentTime);
        listen(entry.trackId);
      }
      playingKey.current = loadedKey.current = entry.key;
      stretch.current = song;
      ended.current = undefined;
      const start = Math.max(element.currentTime, song.start);
      if (start !== element.currentTime) element.currentTime = start;
      const left = remainingIn(song, start);
      clearTimeout(ending.current);
      if (left !== undefined && !element.paused) {
        ending.current = setTimeout(finish, (Math.max(left, 0) * 1000) / element.playbackRate);
      }
      const seconds = positionIn(song, Math.min(start, song.end ?? start));
      updatePositionState(element, song);
      show(entry.key, {
        duration: lengthOf(song, element.duration),
        position: seconds,
        status:
          view.status.kind === "blocked"
            ? view.status
            : { kind: element.paused ? "paused" : "playing" },
      });
      if (nextQueue === queue) {
        lastSaved.current = seconds;
        void saveQueue({ queue, seconds });
      } else {
        updatedPosition.current = { queue: nextQueue, seconds };
      }
    } else if (
      entry !== undefined &&
      entry.key !== key &&
      (loaded ? element.paused : resumeAt.current !== undefined)
    ) {
      restore.current = 0;
      takenPlaying.current = false;
    }
    if (nextQueue !== queue) {
      if (
        entry !== undefined &&
        entry.key === key &&
        updatedPosition.current?.queue !== nextQueue
      ) {
        const seconds =
          loaded && !waitingMetadata.current
            ? positionIn(stretch.current, element.currentTime)
            : (resumeAt.current ?? 0);
        updatedPosition.current = { queue: nextQueue, seconds };
      }
      dispatch({ type: "restore", queue: nextQueue });
    }
  });
  useEffect(() => {
    refreshQueue();
  }, [catalogLoaded, tracks]);

  const onTime = useEffectEvent((element: HTMLAudioElement) => {
    const position = positionIn(stretch.current, element.currentTime);
    show(playingKey.current, { position });
    const left = remainingIn(stretch.current, element.currentTime);
    if (left !== undefined && !element.paused) {
      // `timeupdate` comes a few times a second; the timer ends the song on time between.
      clearTimeout(ending.current);
      if (left <= 0) {
        finish();
      } else {
        ending.current = setTimeout(finish, (left * 1000) / element.playbackRate);
      }
    }
    if (listening.current !== undefined && !element.paused) {
      listening.current.time.update(element.currentTime);
      report();
    }
    if (Math.abs(position - lastSaved.current) >= SAVE_EVERY) {
      lastSaved.current = position;
      void saveQueue({ queue, seconds: position });
    }
  });

  const onLoaded = useEffectEvent((element: HTMLAudioElement) => {
    const song = stretch.current;
    if (resumeAt.current !== undefined || song.start > 0) {
      element.currentTime = fileTimeOf(song, resumeAt.current ?? 0, element.duration);
      resumeAt.current = undefined;
    }
    waitingMetadata.current = false;
    show(playingKey.current, { duration: lengthOf(song, element.duration) });
    updatePositionState(element, song);
  });

  // Follow the audio element.
  useEffect(() => {
    const element = audio.current;
    if (element === null) {
      return;
    }
    const handlers: [string, () => void][] = [
      [
        "play",
        () => {
          if (!audioEnabledNow.current) {
            element.pause();
            return;
          }
          show(playingKey.current, { status: { kind: "playing" } });
        },
      ],
      [
        "pause",
        () => {
          clearTimeout(ending.current);
          listening.current?.time.pause();
          reportNow(true);
          if (!element.ended) {
            show(playingKey.current, { status: { kind: "paused" } });
          }
        },
      ],
      [
        "ended",
        () => {
          finish();
        },
      ],
      [
        "loadedmetadata",
        () => {
          onLoaded(element);
        },
      ],
      [
        "timeupdate",
        () => {
          onTime(element);
        },
      ],
      [
        "seeked",
        () => {
          listening.current?.time.pause();
          updatePositionState(element, stretch.current);
        },
      ],
      [
        "error",
        () => {
          if (element.getAttribute("src") === null) {
            return;
          }
          // An expired session answers the audio request 401, which the element can't show.
          const forKey = playingKey.current;
          api.me().then(
            () => {
              show(forKey, { status: { kind: "failed", message: "This Track couldn't play." } });
            },
            (error: unknown) => {
              fail(forKey, error);
            },
          );
        },
      ],
    ];
    for (const [name, handler] of handlers) {
      element.addEventListener(name, handler);
    }
    return () => {
      for (const [name, handler] of handlers) {
        element.removeEventListener(name, handler);
      }
    };
  }, []);

  useEffect(() => {
    if (audio.current !== null) {
      audio.current.volume = volume;
    }
  }, [volume]);
  useEffect(() => {
    if (audio.current !== null) {
      audio.current.muted = muted;
    }
  }, [muted]);

  // Save the queue whenever it changes.
  useEffect(() => {
    const updated = updatedPosition.current;
    const seconds = updated?.queue === queue ? updated.seconds : 0;
    updatedPosition.current = undefined;
    lastSaved.current = seconds;
    void saveQueue({ queue, seconds });
  }, [queue]);

  // The lock screen: the Track's details, and only the controls iOS shows as buttons.
  const track = trackId === undefined ? undefined : tracks.get(trackId);
  const status: Status =
    key === undefined ? { kind: "idle" } : view.key === key ? view.status : { kind: "loading" };

  // Once the current Track is ready, ask how the next plays, again whenever the next changes.
  const loaded = status.kind === "playing" || status.kind === "paused";
  const coming = following(queue);
  const comingKey = coming?.key;
  const comingTrack = coming?.trackId;
  useEffect(() => {
    if (loaded && comingTrack !== undefined && comingKey !== key) {
      void lookAhead(comingTrack, trackFor(comingTrack), ahead.current);
    }
  }, [albumRevision, loaded, key, comingKey, comingTrack]);
  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata =
        !audioEnabled || track === undefined
          ? null
          : new MediaMetadata({
              title: track.title,
              artist: track.artist,
              album: track.album,
              artwork: track.cover ? [{ src: coverUrl(track.cover, "original") }] : [],
            });
    }
  }, [audioEnabled, track]);
  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = !audioEnabled
        ? "none"
        : status.kind === "playing" || status.kind === "paused"
          ? status.kind
          : "none";
    }
  }, [audioEnabled, status.kind]);
  const onAction = useEffectEvent((details: MediaSessionActionDetails) => {
    if (!audioEnabledNow.current) return;
    switch (details.action) {
      // The system may ask twice, once per earbud taken out, so each asks for a state, not a change.
      case "play":
        resume();
        break;
      case "pause":
        audio.current?.pause();
        break;
      case "previoustrack":
        previous();
        break;
      case "nexttrack":
        next();
        break;
      default:
        if (details.seekTime !== undefined) {
          seek(details.seekTime);
        }
    }
  });
  useEffect(() => {
    if (!audioEnabled || !("mediaSession" in navigator)) {
      return;
    }
    const actions: MediaSessionAction[] = ["play", "pause", "previoustrack", "nexttrack", "seekto"];
    for (const action of actions) {
      navigator.mediaSession.setActionHandler(action, onAction);
    }
    return () => {
      for (const action of actions) {
        navigator.mediaSession.setActionHandler(action, null);
      }
    };
  }, [audioEnabled]);

  // Earbuds taken out or headphones unplugged leave the sound to the next device, often
  // the speakers, so a change of devices pauses. A page over plain HTTP has no devices.
  useEffect(() => {
    const devices = navigator.mediaDevices as MediaDevices | undefined;
    if (devices === undefined) {
      return;
    }
    const whenChanged = () => {
      audio.current?.pause();
    };
    devices.addEventListener("devicechange", whenChanged);
    return () => {
      devices.removeEventListener("devicechange", whenChanged);
    };
  }, []);

  const shown = view.key === key ? view : undefined;
  const player: Player = {
    queue,
    status,
    shuffled: queue.order !== undefined,
    repeat: queue.repeat,
    position: shown?.position ?? 0,
    duration: shown?.duration,
    volume,
    muted,
    playList: (list, start, unitOf) => {
      const entries = list.map((track) => entryOf(track, unitOf));
      dispatch({ type: "play", entries, start, random: Math.random });
    },
    playAll: (list, shuffled, unitOf) => {
      const entries = list.map((track) => entryOf(track, unitOf));
      dispatch({ type: "playAll", entries, shuffled, random: Math.random });
    },
    playNow: (chosen) => {
      dispatch({ type: "playNow", entry: entryOf(chosen) });
    },
    playNext: (chosen) => {
      dispatch({ type: "playNext", entry: entryOf(chosen) });
    },
    add: (chosen) => {
      dispatch({ type: "add", entry: entryOf(chosen) });
    },
    toggle,
    pause: () => {
      audio.current?.pause();
    },
    next,
    previous,
    seek,
    playAt,
    move,
    remove,
    clear: () => {
      dispatch({ type: "clear" });
    },
    shuffle: (on) => {
      dispatch(on ? { type: "shuffle", random: Math.random } : { type: "unshuffle" });
    },
    setRepeat: (repeat) => {
      dispatch({ type: "repeat", repeat });
    },
    setVolume: (chosen) => {
      const within = Math.min(Math.max(chosen, 0), 1);
      setVolume(within);
      setMuted(false);
      saveVolume(within);
    },
    setMuted,
    handoff: () =>
      key === undefined
        ? undefined
        : {
            queue,
            seconds: shown?.position ?? 0,
            counted: listening.current?.counted ?? false,
            play: handedPlay(listening.current),
          },
    take: (handoff, playing) => {
      const restored = catalogLoaded
        ? withoutMissingAlbumSongs(handoff.queue, tracks)
        : handoff.queue;
      const taking = current(restored);
      const sameEntry = taking !== undefined && taking === current(handoff.queue);
      const seconds = sameEntry ? handoff.seconds : 0;
      dispatch({ type: "restore", queue: restored });
      if (taking !== undefined && taking.key === key) {
        // The entry already playing here: only its second and whether it plays change.
        seek(seconds);
        if (playing === audio.current?.paused) {
          toggle();
        }
        return;
      }
      restore.current = taking === undefined ? undefined : seconds;
      takenPlaying.current = playing;
      takenCounted.current = sameEntry && handoff.counted;
      takenPlay.current = sameEntry ? handoff.play : undefined;
    },
  };
  return [player, audio, setAudioEnabled];
}

function withoutDismissed(queue: Queue, tracks: ReadonlyMap<number, Track>): Queue {
  return withoutTracks(queue, (id) => tracks.get(id)?.download_dismissed === true);
}

function withoutMissingAlbumSongs(queue: Queue, tracks: ReadonlyMap<number, Track>): Queue {
  return withoutDismissed(withoutDeletedSongs(queue, tracks, tracks), tracks);
}

/** Return the status to show for `error`, or `undefined` when the session has expired. */
function failureOf(error: unknown): Status | undefined {
  if (error instanceof ApiError && error.status === 401) {
    return undefined;
  }
  // `play()` refused before anyone pressed play waits for a press; interrupted, it pauses.
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return { kind: "blocked", message: "Press play to start." };
  }
  if (error instanceof DOMException && PAUSING_ERRORS.has(error.name)) {
    return { kind: "paused" };
  }
  return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
}

/**
 * Return how `trackId` plays, using an answer asked for ahead of time when there is one.
 *
 * A Track that must be prepared waits for its Job, then asks again, a few times at most.
 */
async function answerFor(
  trackId: number,
  track: Track | undefined,
  ahead: Map<number, Prefetched>,
  onPreparing: () => void,
): Promise<PlaybackAnswer> {
  const early = prefetchedAnswer(ahead.get(trackId), track);
  ahead.delete(trackId);
  let answer = early?.state === "ready" ? early : await api.playback(trackId);
  for (
    let attempt = 1;
    answer.state === "preparing" && attempt <= MAX_PREPARE_ATTEMPTS;
    attempt++
  ) {
    onPreparing();
    const job = await finishedJob(answer.job_id);
    if (job.state !== "succeeded") {
      throw new Error(job.failure_message || `Preparing this Track was ${job.state}.`);
    }
    answer = await api.playback(trackId);
  }
  return answer;
}

async function finishedJob(jobId: number) {
  for (let polls = 0; ; polls++) {
    await wait(polls < 5 ? 1000 : 3000);
    const job = await api.job(jobId);
    if (FINISHED_JOB.has(job.state)) {
      return job;
    }
  }
}

/** Ask now how `trackId` plays, so `ended` only swaps the source; it starts preparing too. */
async function lookAhead(
  trackId: number,
  track: Track | undefined,
  ahead: Map<number, Prefetched>,
): Promise<void> {
  if (prefetchedAnswer(ahead.get(trackId), track) !== undefined) {
    return;
  }
  try {
    ahead.set(trackId, { answer: await api.playback(trackId), track });
  } catch {
    // The next Track asks again when its turn comes.
  }
}

interface Prefetched {
  readonly answer: PlaybackAnswer;
  readonly track: Track | undefined;
}

function prefetchedAnswer(
  early: Prefetched | undefined,
  track: Track | undefined,
): PlaybackAnswer | undefined {
  return early !== undefined && !splitChanged(early.track, track) ? early.answer : undefined;
}

/** Return the play of a counted `listen`, with how long it has been listened to, to hand on. */
function handedPlay(
  listen: { play: Play; time: PlayTime; fromMs: number; counted: boolean } | undefined,
): Play | undefined {
  return listen?.counted === true
    ? { ...listen.play, listenedMs: listen.fromMs + Math.round(listen.time.playedMs) }
    : undefined;
}

/** Return whether `element` already has the file at `audioUrl` loaded. */
function playsFrom(element: HTMLAudioElement, audioUrl: string): boolean {
  return (
    element.getAttribute("src") !== null && element.src === new URL(audioUrl, document.baseURI).href
  );
}

function updatePositionState(element: HTMLAudioElement, song: Stretch): void {
  const duration = lengthOf(song, element.duration);
  // `setPositionState` throws on an unknown length, which a live stream has.
  if (!("mediaSession" in navigator) || duration === undefined) {
    return;
  }
  navigator.mediaSession.setPositionState({
    duration,
    playbackRate: element.playbackRate,
    position: Math.min(positionIn(song, element.currentTime), duration),
  });
}
