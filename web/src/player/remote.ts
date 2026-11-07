/**
 * @file Remote play's rules: what the computer reports of its player, what a remote
 * shows from that report, and how the computer carries out a remote's command.
 *
 * The computer, the speaker, plays through its own player and reports a window of
 * its queue, in the order it plays. A remote shows that window as its queue and
 * counts the seconds on itself from when the report was sent.
 */

import type { RemoteCommand, RemoteEntry, SpeakerState, Track } from "../api";
import type { Entry, Queue } from "./queue";
import { current } from "./queue";
import type { Handoff, Player, Status } from "./usePlayer";
import type { SleepTimer } from "./useSleepTimer";

/** How many entries before the one playing a report carries. */
export const REPORT_BEFORE = 50;
/** The most entries a report carries. */
export const REPORT_ENTRIES = 500;
/** How often the speaker reports though nothing changed, so a remote knows it still answers. */
export const HEARTBEAT_MS = 20_000;
/** How long a remote waits for a report before it says the computer isn't responding. */
export const NOT_RESPONDING_MS = 60_000;
/** How long a remote shows a play or pause at once, while no report has followed it. */
export const SHOWN_AT_ONCE_MS = 3000;
/** The least time between two reports, so a volume dragged on the computer doesn't flood remotes. */
export const REPORT_EVERY_MS = 150;
/** How far the speaker's position may drift from what its last report foretold before it reports. */
export const DRIFT_SECONDS = 2;

export const BLOCKED_ON_THE_COMPUTER = "Click once on the computer to let it play.";

/** The computer as a remote last heard it: its state, and when it reported by this page's clock. */
export interface Speaker {
  readonly page: string;
  readonly state: SpeakerState;
  /** When the report was sent, in milliseconds since the epoch on this page's clock. */
  readonly reportedAt: number;
}

/** Return what the speaker reports of `player` and `sleep` at `now`, in ms since the epoch. */
export function stateOf(player: Player, sleep: SleepTimer, now: number): SpeakerState {
  const { queue, status } = player;
  const offset = Math.max(0, queue.position - REPORT_BEFORE);
  const entries = queue.entries.slice(offset, offset + REPORT_ENTRIES).map(remoteEntryOf);
  return {
    entries,
    offset,
    total: queue.entries.length,
    position: queue.position,
    status: status.kind,
    message: status.kind === "failed" || status.kind === "blocked" ? status.message : null,
    shuffled: player.shuffled,
    repeat: player.repeat,
    seconds: player.position,
    duration: player.duration ?? null,
    volume: player.volume,
    muted: player.muted,
    counted: player.handoff()?.counted ?? false,
    sleep:
      sleep.endsAt === null || sleep.setAt === null
        ? null
        : { left_ms: Math.max(0, sleep.endsAt - now), set_ms_ago: Math.max(0, now - sleep.setAt) },
  };
}

/** Return the queue a remote shows from the speaker's report: its window, in the order it plays. */
export function queueOf(state: SpeakerState): Queue {
  return {
    entries: state.entries.map(entryOf),
    position: Math.max(0, state.position - state.offset),
    repeat: state.repeat,
    order: undefined,
  };
}

/** Return what a remote shows the speaker doing. */
export function statusOf(state: SpeakerState): Status {
  switch (state.status) {
    case "blocked":
      return { kind: "blocked", message: BLOCKED_ON_THE_COMPUTER };
    case "failed":
      return { kind: "failed", message: state.message ?? "The computer couldn't play this Track." };
    default:
      return { kind: state.status };
  }
}

/** Return how many seconds into its Track the speaker is at `now`, counted on from its report. */
export function secondsAt(speaker: Speaker, now: number): number {
  const { state } = speaker;
  if (state.status !== "playing") {
    return state.seconds;
  }
  const seconds = state.seconds + Math.max(0, now - speaker.reportedAt) / 1000;
  return state.duration === null ? seconds : Math.min(seconds, state.duration);
}

/** Return the command that plays `handoff` on the computer, playing or paused. */
export function takeOf(handoff: Handoff, playing: boolean): RemoteCommand {
  const { queue } = handoff;
  return {
    kind: "take",
    entries: queue.entries.map(remoteEntryOf),
    order: queue.order ?? null,
    position: Math.min(queue.position, Math.max(queue.entries.length - 1, 0)),
    repeat: queue.repeat,
    shuffled: queue.order !== undefined,
    seconds: handoff.seconds,
    playing,
    counted: handoff.counted,
  };
}

/** Return the speaker's report as a queue to take onto this page, from its second at `now`. */
export function handoffOf(speaker: Speaker, now: number): Handoff | undefined {
  const queue = queueOf(speaker.state);
  return current(queue) === undefined
    ? undefined
    : { queue, seconds: secondsAt(speaker, now), counted: speaker.state.counted };
}

/**
 * Carry out a remote's `command` on the speaker's `player`, looking each Track up in
 * `tracks`; a Track this page doesn't know is left out.
 */
export function apply(
  command: RemoteCommand,
  player: Player,
  tracks: ReadonlyMap<number, Track>,
  sleep: SleepTimer,
): void {
  switch (command.kind) {
    case "play":
    case "playAll": {
      const known = command.entries.flatMap((queued, place) => {
        const track = tracks.get(queued.track_id);
        return track === undefined ? [] : [{ track, unit: queued.unit, place }];
      });
      if (known.length === 0) {
        return;
      }
      const units = new Map(known.map(({ track, unit }) => [track.id, unit ?? undefined]));
      const list = known.map(({ track }) => track);
      const unitOf = (track: Track) => units.get(track.id);
      if (command.kind === "play") {
        const start = Math.max(
          0,
          known.findIndex(({ place }) => place >= command.start),
        );
        player.playList(list, start, unitOf);
      } else {
        player.playAll(list, command.shuffled, unitOf);
      }
      return;
    }
    case "playNext":
    case "add": {
      const track = tracks.get(command.entry.track_id);
      if (track !== undefined) {
        (command.kind === "playNext" ? player.playNext : player.add)(track);
      }
      return;
    }
    case "toggle":
      player.toggle();
      return;
    case "pause":
      player.pause();
      return;
    case "next":
      player.next();
      return;
    case "previous":
      player.previous();
      return;
    case "clear":
      player.clear();
      return;
    case "seek":
      // A seek meant for an entry no longer playing means nothing now.
      if (current(player.queue)?.key === command.key) {
        player.seek(command.seconds);
      }
      return;
    case "move":
      player.move(command.key, command.to);
      return;
    case "remove":
      player.remove(command.key);
      return;
    case "shuffle":
      player.shuffle(command.on);
      return;
    case "repeat":
      player.setRepeat(command.repeat);
      return;
    case "volume":
      player.setVolume(command.volume);
      return;
    case "mute":
      player.setMuted(command.muted);
      return;
    case "sleep":
      if (command.minutes === null) {
        sleep.stop();
      } else {
        sleep.start(command.minutes);
      }
      return;
    case "take": {
      const entries = command.entries.map(entryOf);
      player.take(
        {
          queue: {
            entries,
            position: command.position,
            repeat: command.repeat,
            order: command.shuffled ? (command.order ?? entries.map((e) => e.key)) : undefined,
          },
          seconds: command.seconds,
          counted: command.counted,
        },
        command.playing,
      );
      return;
    }
  }
}

function remoteEntryOf(entry: Entry): RemoteEntry {
  return { key: entry.key, track_id: entry.trackId, unit: entry.unit ?? null };
}

function entryOf(entry: RemoteEntry): Entry {
  return { key: entry.key, trackId: entry.track_id, unit: entry.unit ?? undefined };
}
