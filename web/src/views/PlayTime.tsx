/**
 * @file A running time beside the length it runs to, such as `3:57 / 4:24`.
 */

import { formatTime } from "../format";

/**
 * Show `at` seconds of `length`, the time that moves set apart from the length, which
 * doesn't. `joiner` reads between them: a slash, hidden from screen readers, or a word.
 */
export function PlayTime({
  at,
  length,
  joiner = "/",
}: {
  readonly at: number | undefined;
  readonly length: number | undefined;
  readonly joiner?: "/" | "of";
}) {
  return (
    <>
      <span className="time-at">{formatTime(at)}</span>{" "}
      <span className="time-length">
        {joiner === "/" ? <span aria-hidden>/</span> : joiner} {formatTime(length)}
      </span>
    </>
  );
}
