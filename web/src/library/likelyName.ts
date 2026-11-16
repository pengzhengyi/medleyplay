/**
 * @file The artist a name with more written after it likely is: *告五人2019超强音质的*
 * starts with *告五人*, a name the Library already has, so it is likely that.
 */

import { fold } from "./views";

/** A name shorter than this is too short to read others by. */
const SHORTEST = 2;

/** What may follow a name in a longer one: a digit, a space, or a mark, not more letters. */
const BREAK = /^[\p{N}\p{P}\p{S}\s]/u;

/** What joins one artist to another, so a name followed by it names both: *A & B*, *A feat. B*. */
const JOINER = /^\s*(?:[&/,+×、，＆和与]|(?:x|feat\.?|ft\.?|with|and|vs\.?)\s)/iu;

/** A script written without spaces, where a name may run straight on into more words. */
const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;

/**
 * Return the name among `others` that `name` likely is: the longest that `name` starts
 * with, compared folded, where what follows is a digit, space, or mark, or the name is
 * in a script written without spaces, but not another artist joined on, as *& B*;
 * `undefined` when none is.
 */
export function likelyNameOf(name: string, others: readonly string[]): string | undefined {
  const whole = fold(name.trim());
  let best: string | undefined;
  for (const other of others) {
    const start = fold(other.trim());
    if (
      start.length >= SHORTEST &&
      start.length < whole.length &&
      whole.startsWith(start) &&
      (BREAK.test(whole.slice(start.length)) || NO_SPACES.test(start)) &&
      !JOINER.test(whole.slice(start.length)) &&
      (best === undefined || start.length > fold(best.trim()).length)
    ) {
      best = other.trim();
    }
  }
  return best;
}
