/**
 * @file A remote's player: what the computer plays, shown here, and what the listener
 * does here, sent to the computer as commands.
 *
 * It is a `Player`, so every view works with it unchanged. It shows the computer's
 * last report, counting the seconds on itself, and sends one command at a time, so
 * they arrive in the order they were made. Play and pause show at once, before the
 * computer's next report confirms them; a volume dragged sends at most one command
 * every 150 ms, and the last one always.
 */

import { useEffect, useRef, useState } from "react";

import { ApiError, type RemoteCommand, type Track, api } from "../api";
import { EMPTY, current } from "./queue";
import {
  NOT_RESPONDING_MS,
  type Speaker,
  handoffOf,
  queueOf,
  secondsAt,
  statusOf,
  takeOf,
} from "./remote";
import type { Player, Status, UnitOf } from "./usePlayer";
import type { SleepTimer } from "./useSleepTimer";

const TICK_MS = 500;
const VOLUME_EVERY_MS = 150;

const queuedOf = (track: Track, unitOf?: UnitOf) => ({
  track_id: track.id,
  unit: unitOf?.(track) ?? null,
});

/**
 * Play on the computer that `speaker` describes; `onSignedOut` runs when a command
 * finds the session has expired. Returns the player, and the computer's sleep timer.
 */
export function useRemotePlayer(
  speaker: Speaker | null,
  onSignedOut: () => void,
): readonly [Player, SleepTimer] {
  const [now, setNow] = useState(Date.now);
  // What a command made show at once, until a report sent after it.
  const [shown, setShown] = useState<{ readonly at: number; readonly status: Status } | undefined>(
    undefined,
  );
  const [failure, setFailure] = useState<{ readonly at: number; readonly message: string }>();
  const line = useRef<Promise<void>>(Promise.resolve());
  const volume = useRef<{
    timer?: ReturnType<typeof setTimeout> | undefined;
    next?: number | undefined;
  }>({});

  useEffect(() => {
    if (speaker === null) {
      return undefined;
    }
    const tick = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(tick);
    };
  }, [speaker]);

  const send = (command: RemoteCommand) => {
    line.current = line.current.then(
      () =>
        api.command(command).then(
          () => {
            setFailure(undefined);
          },
          (error: unknown) => {
            if (error instanceof ApiError && error.status === 401) {
              onSignedOut();
              return;
            }
            const message = error instanceof Error ? error.message : String(error);
            setFailure({ at: Date.now(), message });
          },
        ),
      () => undefined,
    );
  };

  const reportedAt = speaker?.reportedAt ?? 0;
  const state = speaker?.state;
  const queue = state === undefined ? EMPTY : queueOf(state);
  const status: Status = (() => {
    if (speaker === null || state === undefined || current(queue) === undefined) {
      return { kind: "idle" };
    }
    if (failure !== undefined && failure.at >= reportedAt) {
      return { kind: "failed", message: failure.message };
    }
    if (now - reportedAt > NOT_RESPONDING_MS) {
      return { kind: "failed", message: "The computer isn't responding." };
    }
    if (shown !== undefined && shown.at >= reportedAt) {
      return shown.status;
    }
    return statusOf(state);
  })();
  const position =
    speaker === null
      ? 0
      : status.kind === "playing" && state?.status !== "playing"
        ? (state?.seconds ?? 0)
        : status.kind === "paused" && state?.status === "playing"
          ? secondsAt(speaker, shown?.at ?? now)
          : secondsAt(speaker, now);

  const showAtOnce = (kind: "playing" | "paused") => {
    setShown({ at: Date.now(), status: { kind } });
  };

  const sendVolume = (chosen: number) => {
    const held = volume.current;
    if (held.timer !== undefined) {
      held.next = chosen;
      return;
    }
    send({ kind: "volume", volume: chosen });
    held.timer = setTimeout(() => {
      held.timer = undefined;
      const next = held.next;
      held.next = undefined;
      if (next !== undefined) {
        sendVolume(next);
      }
    }, VOLUME_EVERY_MS);
  };

  const player: Player = {
    queue,
    status,
    shuffled: state?.shuffled ?? false,
    repeat: state?.repeat ?? "off",
    position,
    duration: state?.duration ?? undefined,
    volume: state?.volume ?? 1,
    muted: state?.muted ?? false,
    playList: (tracks, start, unitOf) => {
      send({ kind: "play", entries: tracks.map((track) => queuedOf(track, unitOf)), start });
    },
    playAll: (tracks, shuffled, unitOf) => {
      send({ kind: "playAll", entries: tracks.map((track) => queuedOf(track, unitOf)), shuffled });
    },
    playNext: (track) => {
      send({ kind: "playNext", entry: queuedOf(track) });
    },
    add: (track) => {
      send({ kind: "add", entry: queuedOf(track) });
    },
    toggle: () => {
      showAtOnce(status.kind === "playing" ? "paused" : "playing");
      send({ kind: "toggle" });
    },
    pause: () => {
      if (status.kind === "playing") {
        showAtOnce("paused");
      }
      send({ kind: "pause" });
    },
    next: () => {
      send({ kind: "next" });
    },
    previous: () => {
      send({ kind: "previous" });
    },
    seek: (seconds) => {
      const key = current(queue)?.key;
      if (key !== undefined && Number.isFinite(seconds)) {
        send({ kind: "seek", key, seconds: Math.max(0, seconds) });
      }
    },
    move: (key, to) => {
      send({ kind: "move", key, to });
    },
    remove: (key) => {
      send({ kind: "remove", key });
    },
    clear: () => {
      send({ kind: "clear" });
    },
    shuffle: (on) => {
      send({ kind: "shuffle", on });
    },
    setRepeat: (repeat) => {
      send({ kind: "repeat", repeat });
    },
    setVolume: (chosen) => {
      sendVolume(Math.min(Math.max(chosen, 0), 1));
    },
    setMuted: (muted) => {
      send({ kind: "mute", muted });
    },
    handoff: () => (speaker === null ? undefined : handoffOf(speaker, Date.now())),
    take: (handoff, playing) => {
      send(takeOf(handoff, playing));
    },
  };

  const asleep = state?.sleep ?? null;
  const sleep: SleepTimer = {
    endsAt: asleep === null ? null : reportedAt + asleep.left_ms,
    setAt: asleep === null ? null : reportedAt - asleep.set_ms_ago,
    start: (minutes) => {
      send({ kind: "sleep", minutes });
    },
    stop: () => {
      send({ kind: "sleep", minutes: null });
    },
  };
  return [player, sleep];
}
