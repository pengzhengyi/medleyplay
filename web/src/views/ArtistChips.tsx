/**
 * @file A song's artists as chips: each with its photo or initial, *feat.* to credit it as
 * featured, and a way to remove it.
 *
 * ```text
 * (photo) スズム  + feat.  ×    (G) GUMI  [feat.]  ×
 * ```
 *
 * Removing a chip moves focus to the next chip's remove button, or else to `onFocusAdd`'s
 * box.
 */

import { XIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import { type Credit, type TrackArtist, coverUrl } from "../api";

/** Fold a name as the server does, to find the artist a chip names among those it showed. */
function keyOf(written: string): string {
  return written.normalize("NFKC").trim().toLowerCase();
}

export function ArtistChips({
  credits,
  shown,
  disabled,
  onToggle,
  onRemove,
  onFocusAdd,
}: {
  readonly credits: readonly Credit[];
  /** The artists the song showed when read, each with the MusicBrainz artist it is. */
  readonly shown: readonly TrackArtist[];
  readonly disabled: boolean;
  readonly onToggle: (index: number) => void;
  readonly onRemove: (index: number) => void;
  /** Focus the box an artist is added in. */
  readonly onFocusAdd: () => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  // The chip whose remove button takes focus once the chip before it has gone.
  const focusAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    const at = focusAt.current;
    if (at === undefined) {
      return;
    }
    focusAt.current = undefined;
    const next = list.current?.querySelectorAll<HTMLButtonElement>(".artist-chip-remove")[at];
    if (next === undefined) {
      onFocusAdd();
    } else {
      next.focus();
    }
  });

  return (
    <ul ref={list} className="artist-chips" aria-label="Artists">
      {credits.map((credit, index) => {
        const linked = shown.find((each) => keyOf(each.written) === keyOf(credit.written))?.linked;
        const featured = credit.role === "featured";
        return (
          <li key={keyOf(credit.written)} className={`artist-chip ${credit.role}`}>
            <span className="artist-chip-face" aria-hidden title={linked?.name}>
              {linked?.photo ? (
                <img src={coverUrl(linked.photo)} alt="" />
              ) : (
                credit.written.charAt(0).toUpperCase()
              )}
            </span>
            <span className="artist-chip-name">{credit.written}</span>
            <span className="visually-hidden">
              {linked === null || linked === undefined
                ? ", not linked to an artist yet"
                : `, linked to ${linked.name}`}
            </span>
            <button
              type="button"
              className="artist-chip-role"
              aria-pressed={featured}
              aria-label={`${credit.written}, featured`}
              title={featured ? "Credit as a main artist" : "Credit as featured"}
              disabled={disabled}
              onClick={() => {
                onToggle(index);
              }}
            >
              {featured ? "feat." : "+ feat."}
            </button>
            <button
              type="button"
              className="artist-chip-remove"
              aria-label={`Remove ${credit.written}`}
              title="Remove"
              disabled={disabled}
              onClick={() => {
                focusAt.current = index;
                onRemove(index);
              }}
            >
              <XIcon weight="bold" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
