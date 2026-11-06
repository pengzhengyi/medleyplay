/**
 * @file Where a detail's value came from, as a small tag: a mark and a word or two,
 * with the full words in its tooltip and for screen readers.
 */

import type { Origin } from "../api";
import { ORIGIN_TAGS } from "./originTags";

/** The tag of `origin`, saying `full` in full, such as `From the video`. */
export function OriginTag({
  id,
  origin,
  full,
}: {
  readonly id?: string | undefined;
  readonly origin: Origin;
  readonly full: string;
}) {
  const { short, icon: Mark } = ORIGIN_TAGS[origin];
  return (
    <small id={id} className={`origin-tag ${origin}`} title={full}>
      <Mark weight="bold" aria-hidden />
      {short === full ? (
        short
      ) : (
        <>
          <span aria-hidden>{short}</span>
          <span className="visually-hidden">{full}</span>
        </>
      )}
    </small>
  );
}
