/** @file A song's or an album's cover, with a stand-in where there is none to show. */

import { MusicNotesIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";

import { coverUrl } from "../api";

/**
 * The image `cover` names, or `children` (a note by default) when it names none or
 * the image can't be loaded. It is decoration: the title beside it says what it is.
 */
export function Cover({
  cover,
  className,
  children,
}: {
  readonly cover: string | null;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const [named, setNamed] = useState(cover);
  if (named !== cover) {
    // Another cover: a failure of the one before, even of this one earlier, is forgotten.
    setNamed(cover);
    setFailed(undefined);
  }
  const shown = cover !== null && cover !== "" && cover !== failed ? cover : undefined;
  return (
    <span className={className === undefined ? "cover" : `cover ${className}`} aria-hidden>
      {shown === undefined ? (
        (children ?? <MusicNotesIcon weight="duotone" />)
      ) : (
        <img
          src={coverUrl(shown)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => {
            setFailed(shown);
          }}
        />
      )}
    </span>
  );
}
