/**
 * @file A photo suggested for an artist that has none, from the pictures Deezer has of it.
 *
 * It stands where the photo would, ringed and tagged as a suggestion, with *Use photo*
 * under it, which makes it the artist's photo in one click. The suggestion is the one an
 * AI model picked, else the most followed whose artist goes by one of the artist's names;
 * Deezer is looked to as the photo editor does. With none, `fallback` shows in its place.
 */

import { CircleNotchIcon, SparkleIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";

import { api } from "../api";
import { formatFans } from "../format";
import { Cover } from "./Cover";
import { useArtistPictures } from "./useArtistPictures";

/** The photo suggested for the artist `artistId`, called `name`, or `fallback` while none is. */
export function SuggestedPhoto({
  artistId,
  name,
  fallback,
  onUsed,
}: {
  readonly artistId: string;
  readonly name: string;
  readonly fallback: ReactNode;
  /** Called once the photo is used, so the artist is read again. */
  readonly onUsed: () => void;
}) {
  const { state } = useArtistPictures(artistId);
  const [using, setUsing] = useState(false);
  const [error, setError] = useState("");
  const suggested = state?.suggested ?? null;
  const picture = state?.pictures.find((each) => each.cover === suggested);
  if (state === undefined || suggested === null || picture === undefined) {
    return fallback;
  }
  const pick = state.pick;
  const fans = formatFans(picture.fans);
  const why =
    pick === null
      ? `Deezer's ${[picture.name, fans].filter(Boolean).join(", ")}, going by this artist's name`
      : `${pick.model} picked this: ${pick.why}`;
  const use = async () => {
    setUsing(true);
    setError("");
    try {
      await api.useArtistPhotoCover(artistId, suggested);
      onUsed();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setUsing(false);
    }
  };
  return (
    <div className="photo-suggestion">
      <div className="photo-suggestion-frame">
        <div
          className="artist-art tiles-1 photo-suggestion-art"
          role="img"
          aria-label={`Suggested photo of ${name}: ${why}`}
          title={why}
        >
          <Cover cover={suggested} className="artist-tile" />
        </div>
        <span className="photo-suggestion-tag" aria-hidden>
          {pick === null ? (
            "Suggested"
          ) : (
            <>
              <SparkleIcon weight="fill" /> AI pick
            </>
          )}
        </span>
      </div>
      <button
        type="button"
        className="dialog-button photo-suggestion-use"
        aria-label={`Use the suggested photo of ${name}`}
        disabled={using}
        aria-busy={using}
        onClick={() => void use()}
      >
        {using && <CircleNotchIcon weight="bold" className="spin" aria-hidden />}
        Use photo
      </button>
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
