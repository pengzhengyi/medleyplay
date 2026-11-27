/**
 * @file Where a detail's value came from, as a small tag: a mark and a word or two,
 * with the full words in its tooltip and for screen readers.
 */

import type { Origin } from "../api";
import { useWords } from "../locale";
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
  const t = useWords();
  const { short: key, icon: Mark } = ORIGIN_TAGS[origin];
  const short = t(key);
  const description = t(full);
  return (
    <small id={id} className={`origin-tag ${origin}`} title={description}>
      <Mark weight="bold" aria-hidden />
      {short === description ? (
        short
      ) : (
        <>
          <span aria-hidden>{short}</span>
          <span className="visually-hidden">{description}</span>
        </>
      )}
    </small>
  );
}
