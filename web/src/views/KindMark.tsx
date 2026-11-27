/**
 * @file A Track's mark as a song or an album, named for screen readers and pointers alike.
 *
 * A settled kind, as named or split, has a solid mark; a guessed one an outline.
 */

import { MusicNoteSimpleIcon, VinylRecordIcon } from "@phosphor-icons/react";

import { type Kind, type KindReason, kindSettled } from "../api";
import { LyricsBadge } from "./LyricsBadge";
import { type LyricsSubject, useLyricsLabel } from "./lyricsAvailability";

const UNSETTLED: Readonly<Partial<Record<KindReason, string>>> = {
  length: "guessed from its length",
  default: "as no one named it",
};

/** A note for a song, a record for an album in one file; solid once settled. */
export function KindMark({
  kind,
  reason,
  lyrics,
}: {
  readonly kind: Kind;
  readonly reason: KindReason;
  readonly lyrics?: LyricsSubject | undefined;
}) {
  const lyricsLabel = useLyricsLabel(lyrics);
  const album = kind === "album";
  const settled = kindSettled(reason);
  const named = album ? "Album" : "Song";
  const kindLabel = settled ? named : `${named}, ${UNSETTLED[reason] ?? ""}`;
  const label = lyricsLabel === undefined ? kindLabel : `${kindLabel}, ${lyricsLabel}`;
  const weight = settled ? "fill" : "regular";
  return (
    <span
      className={`kind-mark kind-${kind}${settled ? "" : " guessed"}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {album ? (
        <VinylRecordIcon weight={weight} aria-hidden />
      ) : (
        <MusicNoteSimpleIcon weight={weight} aria-hidden />
      )}
      <LyricsBadge label={lyricsLabel} />
    </span>
  );
}
