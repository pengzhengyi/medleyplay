/**
 * @file Sending plays and how long they were listened to, through the outbox.
 *
 * A play is kept until the server accepts it, then its later times are kept and
 * sent the same way. Sends run one at a time, so an older answer can't settle a
 * newer time; a play is forgotten only once the time the server has is the time
 * kept. Without IndexedDB, a play is sent only while the page is open.
 */

import { ApiError, api } from "../api";
import { type Play, forgetPlay, keepPlay, keepPlayTime, keptPlays, settlePlay } from "./storage";

/** The plays the server will never accept, so retrying them is pointless. */
const REFUSED_PLAY = new Set([404, 409, 422]);

const recordedListeners = new Set<() => void>();

/** Call `listener` whenever the server records a play this page sent; return how to stop. */
export function onPlaysRecorded(listener: () => void): () => void {
  recordedListeners.add(listener);
  return () => {
    recordedListeners.delete(listener);
  };
}

/** Keep and send a play that has just counted, with how long it has been listened to. */
export async function recordPlay(play: Play): Promise<void> {
  await keepPlay(play);
  await sendPlays(play);
}

/** Keep and send a longer time for `play`, recorded or still waiting to be. */
export async function updatePlay(play: Play, listenedMs: number): Promise<void> {
  const kept = await keepPlayTime(play.id, listenedMs);
  // A play no longer kept was accepted, so only its time is left to send.
  const latest = kept ?? { ...play, listenedMs, recorded: true };
  if (kept === undefined) {
    await keepPlay(latest);
  }
  await sendPlays(latest);
}

let sending: Promise<void> = Promise.resolve();

/** Send every kept play, and `given` too when the browser keeps none; one send at a time. */
export function sendPlays(given?: Play): Promise<void> {
  sending = sending.then(() => sendKept(given));
  return sending;
}

async function sendKept(given: Play | undefined): Promise<void> {
  const kept = await keptPlays();
  const plays =
    given === undefined || kept.some((play) => play.id === given.id) ? kept : [...kept, given];
  for (const play of plays) {
    try {
      await send(play);
      await settlePlay(play);
    } catch (error) {
      if (error instanceof ApiError && REFUSED_PLAY.has(error.status)) {
        await forgetPlay(play.id);
      }
    }
  }
}

async function send(play: Play): Promise<void> {
  if (!play.recorded) {
    await api.recordPlay(play.id, play.trackId, play.playedAt, play.listenedMs);
    for (const listener of recordedListeners) {
      listener();
    }
  } else if (play.listenedMs !== undefined) {
    await api.noteListened(play.id, play.listenedMs);
  }
}
