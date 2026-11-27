/** @file Why a Track can't play now, as a Track list and History say it. */

import type { Words } from "../locale";
import { downloadFailureOf } from "../library/downloading";

/** Why a Track can't play now, in a word or two, by its availability. */
export const WHY: Record<string, string> = {
  offline: "Drive unplugged",
  waiting_online: "When online",
  unavailable: "Unavailable",
  missing: "Missing",
  cant_play: "Can't play",
};

const PLAYBACK_MESSAGES: ReadonlySet<string> = new Set([
  "This Track's Library is offline.",
  "This Track can play once medleyplay is Online.",
  "This Track is unavailable.",
  "This Track's file is missing.",
  "This Track can't be played.",
  "This Track couldn't be prepared.",
  "This browser can't play this file.",
  "This Track couldn't play.",
  "Press play to start.",
  "Click once on the computer to let it play.",
  "The computer couldn't play this Track.",
  "The computer isn't responding.",
  "Preparing this Track was failed.",
  "Preparing this Track was cancelled.",
]);

export function playbackMessage(message: string, t: Words): string {
  return PLAYBACK_MESSAGES.has(message) ? t(message) : downloadFailureOf(message, t);
}
