/**
 * @file A photo suggested for an artist that has none, from the pictures Deezer has of it.
 *
 * It stands where the photo would, ringed and tagged as a suggestion, and is its own
 * controls: use it in one click, dismiss it, or choose another in the photo editor. The
 * suggestion is the one an AI model picked, else the most followed whose artist goes by
 * one of the artist's names; one dismissed is never suggested again. Deezer is looked
 * to as the photo editor does. With none, `fallback` shows in its place.
 */

import { type ReactNode, useState } from "react";

import { api } from "../api";
import { formatFans } from "../format";
import { useFormattingLocale, useWords } from "../locale";
import { ArtistPhotoEditor } from "./ArtistPhotoEditor";
import { Cover } from "./Cover";
import { SuggestedFrame } from "./SuggestedFrame";
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
  /** Called once a photo is used, so the artist is read again. */
  readonly onUsed: () => void;
}) {
  const t = useWords();
  const locale = useFormattingLocale();
  const {
    state,
    error: requestError,
    choiceError,
    readError,
    retryRead,
    dismiss,
  } = useArtistPictures(artistId);
  const [using, setUsing] = useState(false);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  const suggested = state?.suggested ?? null;
  const picture = state?.pictures.find((each) => each.cover === suggested);
  const editor = changing && (
    <ArtistPhotoEditor
      artistId={artistId}
      name={name}
      shown={null}
      onChanged={onUsed}
      onClose={() => {
        setChanging(false);
      }}
    />
  );
  const failure = error || requestError || readError || choiceError;
  const problem = failure !== "" && (
    <>
      <p className="error" role="alert">
        {t("Could not update the photo suggestions: {{detail}}", { detail: failure })}
      </p>
      {readError !== "" && (
        <button type="button" className="link-button" onClick={retryRead}>
          {t("Retry reading results")}
        </button>
      )}
    </>
  );
  if (state === undefined || suggested === null || picture === undefined) {
    return (
      <>
        {fallback}
        {problem}
        {editor}
      </>
    );
  }
  const pick = state.pick?.cover === suggested ? state.pick : null;
  const fans = formatFans(picture.fans, t, locale);
  const why =
    pick === null
      ? t("Deezer's {{artist}}, going by this artist's name", {
          artist: [picture.name, fans].filter(Boolean).join(t(", ")),
        })
      : t("{{model}} picked this: {{reason}}", { model: pick.model, reason: pick.why });
  const use = async () => {
    setUsing(true);
    setError("");
    try {
      await api.useArtistPhotoCover(artistId, suggested);
      onUsed();
    } catch (failed) {
      setError(failed instanceof Error ? failed.message : String(failed));
    } finally {
      setUsing(false);
    }
  };
  return (
    <div className="photo-suggestion">
      <SuggestedFrame
        of={name}
        why={why}
        picked={pick !== null}
        className="artist-art tiles-1"
        busy={using}
        onUse={() => void use()}
        onDismiss={() => {
          dismiss(suggested);
        }}
        onChange={() => {
          setChanging(true);
        }}
      >
        <Cover size="medium" cover={suggested} className="artist-tile" />
      </SuggestedFrame>
      {problem}
      {editor}
    </div>
  );
}
