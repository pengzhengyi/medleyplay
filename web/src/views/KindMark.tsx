/**
 * @file A Track's mark as a song or an album, named for screen readers and pointers alike.
 */

import { MusicNoteSimpleIcon, VinylRecordIcon } from "@phosphor-icons/react";

import type { Kind } from "../api";

/** A note for a song, a record for an album in one file. */
export function KindMark({ kind }: { readonly kind: Kind }) {
  const album = kind === "album";
  const label = album ? "Album" : "Song";
  return (
    <span className={`kind-mark kind-${kind}`} role="img" aria-label={label} title={label}>
      {album ? (
        <VinylRecordIcon weight="fill" aria-hidden />
      ) : (
        <MusicNoteSimpleIcon weight="regular" aria-hidden />
      )}
    </span>
  );
}
