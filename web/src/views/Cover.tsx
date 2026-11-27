/** @file A song's or an album's cover, with a stand-in where there is none to show. */

import { MusicNotesIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";

import { type CoverSize, coverUrl } from "../api";
import { LyricsBadge } from "./LyricsBadge";
import { type LyricsSubject, useLyricsLabel } from "./lyricsAvailability";

/**
 * The image `cover` names at `size`, or `children` (a note by default) when it names
 * none or the image can't be loaded. The image is decorative unless `alt` names it;
 * its optional lyrics state is announced separately.
 */
export function Cover({
  cover,
  size,
  className,
  children,
  lyrics,
  alt = "",
}: {
  readonly cover: string | null;
  /** A `small` thumbnail for a row, a `medium` one for a tile, or the `original`. */
  readonly size: CoverSize;
  readonly className?: string;
  readonly children?: ReactNode;
  readonly lyrics?: LyricsSubject | undefined;
  readonly alt?: string;
}) {
  const label = useLyricsLabel(lyrics);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const [named, setNamed] = useState(cover);
  if (named !== cover) {
    // Another cover: a failure of the one before, even of this one earlier, is forgotten.
    setNamed(cover);
    setFailed(undefined);
  }
  const shown = cover !== null && cover !== "" && cover !== failed ? cover : undefined;
  return (
    <span
      className={`${className === undefined ? "cover" : `cover ${className}`}${label === undefined ? "" : ` has-lyrics lyrics-${size}`}`}
      aria-hidden={label === undefined && alt === "" ? true : undefined}
      title={label}
    >
      {shown === undefined ? (
        (children ?? <MusicNotesIcon weight="duotone" aria-hidden />)
      ) : (
        <img
          src={coverUrl(shown, size)}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => {
            setFailed(shown);
          }}
        />
      )}
      <LyricsBadge label={label} />
    </span>
  );
}
