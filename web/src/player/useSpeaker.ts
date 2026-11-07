/**
 * @file The computer's side of remote play: a page on the host reports what its
 * player plays, and carries out what remotes ask.
 *
 * It reports whenever what it would show changes, when its position drifts from
 * what its last report foretold, as after a seek, and every 20 s while it plays for
 * the Account, so remotes know it still answers. The server makes the page that
 * plays the Account's speaker; a page with nothing queued never reports.
 */

import { useEffect, useEffectEvent, useRef } from "react";

import { type RemoteCommand, type SpeakerState, type Track, api } from "../api";
import { PAGE_ID } from "../page";
import { DRIFT_SECONDS, HEARTBEAT_MS, type Speaker, apply, stateOf } from "./remote";
import type { Player } from "./usePlayer";
import type { SleepTimer } from "./useSleepTimer";

/**
 * Play for the Account while `onHost`: report `player` and `sleep`, and carry out each
 * command `onCommand` hears, looking Tracks up in `tracks`. `speaker` is the Account's
 * speaker as the event stream last said.
 */
export function useSpeaker(
  onHost: boolean,
  player: Player,
  sleep: SleepTimer,
  tracks: ReadonlyMap<number, Track>,
  speaker: Speaker | null,
  onCommand: (listener: (command: RemoteCommand) => void) => () => void,
): void {
  const isSpeaker = speaker?.page === PAGE_ID;
  const last = useRef<{ readonly state: SpeakerState; readonly at: number } | undefined>(undefined);
  const sending = useRef(false);
  const waiting = useRef<{ readonly state: SpeakerState; readonly at: number } | undefined>(
    undefined,
  );

  /** Send `state`, made `at`, one report at a time; one made meanwhile waits, the latest kept. */
  const send = (state: SpeakerState, at: number) => {
    last.current = { state, at };
    if (sending.current) {
      waiting.current = { state, at };
      return;
    }
    sending.current = true;
    api
      .report(PAGE_ID, state)
      .catch(() => {
        // A report that doesn't arrive is replaced by the next; remotes count on meanwhile.
      })
      .finally(() => {
        sending.current = false;
        const next = waiting.current;
        waiting.current = undefined;
        if (next !== undefined) {
          send(next.state, next.at);
        }
      });
  };
  const report = useEffectEvent(() => {
    if (onHost && (isSpeaker || player.queue.entries.length > 0)) {
      const now = Date.now();
      send(stateOf(player, sleep, now), now);
    }
  });

  // A change of what a remote would show is reported, and so is the speaker coming or
  // going, as when the server restarts; the time going by isn't.
  const { queue, status, repeat, duration, volume, muted } = player;
  const message = status.kind === "failed" || status.kind === "blocked" ? status.message : null;
  const speakerPage = speaker?.page ?? null;
  useEffect(() => {
    report();
  }, [queue, status.kind, message, repeat, duration, volume, muted, sleep.endsAt, speakerPage]);

  // A position its last report didn't foretell, as after a seek, is reported.
  const { position } = player;
  const playing = player.status.kind === "playing";
  useEffect(() => {
    const sent = last.current;
    if (sent === undefined) {
      return;
    }
    const foretold = playing
      ? sent.state.seconds + (Date.now() - sent.at) / 1000
      : sent.state.seconds;
    if (Math.abs(position - foretold) > DRIFT_SECONDS) {
      report();
    }
  }, [position, playing]);

  useEffect(() => {
    if (!isSpeaker) {
      return undefined;
    }
    const beat = setInterval(() => {
      report();
    }, HEARTBEAT_MS);
    return () => {
      clearInterval(beat);
    };
  }, [isSpeaker]);

  const carryOut = useEffectEvent((command: RemoteCommand) => {
    apply(command, player, tracks, sleep);
  });
  useEffect(() => {
    if (!onHost) {
      return undefined;
    }
    return onCommand((command) => {
      carryOut(command);
    });
  }, [onHost, onCommand]);
}
