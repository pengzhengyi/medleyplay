/**
 * @file A Track's mark as a song or an album, named for screen readers and pointers alike.
 *
 * A settled kind, as named or split, has a solid mark; a guessed one an outline.
 */

import { MusicNoteSimpleIcon, VinylRecordIcon } from "@phosphor-icons/react";

import { type Kind, type KindReason, kindSettled } from "../api";
import { useWords } from "../locale";
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
  besideTitle = false,
}: {
  readonly kind: Kind;
  readonly reason: KindReason;
  readonly lyrics?: LyricsSubject | undefined;
  readonly besideTitle?: boolean;
}) {
  const t = useWords();
  const lyricsLabel = useLyricsLabel(lyrics, t);
  const album = kind === "album";
  const settled = kindSettled(reason);
  const named = t(album ? "Album" : "Song");
  const kindLabel = settled
    ? named
    : t("{{kind}}, {{reason}}", { kind: named, reason: t(UNSETTLED[reason] ?? "") });
  const label = lyricsLabel === undefined ? kindLabel : [kindLabel, lyricsLabel].join(t(", "));
  const weight = settled ? "fill" : "regular";
  return (
    <span
      className={`kind-mark kind-${kind}${settled ? "" : " guessed"}${besideTitle ? " title-kind" : ""}`}
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
