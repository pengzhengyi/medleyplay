/**
 * @file Editing what the household chooses for an artist: the name it is shown by, a
 * note about it, and its photo. The artist's songs keep their names as written.
 *
 * The name and the note are saved together; a photo is set or removed at once, as a
 * song's cover is. An empty name shows the artist as most of its songs write it, and
 * removing the household's photo shows Wikidata's again. An AI model may be asked to
 * suggest a name and a note; each suggestion shows beside its field, to use or not.
 */

import {
  CircleNotchIcon,
  PencilSimpleIcon,
  SparkleIcon,
  SpinnerGapIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { type SubmitEvent, useEffect, useId, useRef, useState } from "react";

import {
  type AnsweredBy,
  type ArtistSuggestionState,
  type KnownArtist,
  api,
  coverUrl,
} from "../api";
import { initialOf } from "../format";
import { aiNameOf, answeredOf } from "../library/aiAnswer";
import { MAX_COVER_BYTES } from "./EditDetails";
import { Modal } from "./Modal";

/** The longest name an artist may be shown by, and the longest note about it. */
const MAX_SHOWN_AS = 512;
const MAX_ABOUT = 1000;

/** How often what the AI suggests is read again while it is asked. */
const ASKING_EVERY_MS = 2000;

/** Say why a change failed, in the server's words when it gave some. */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * What an AI model last suggested for the artist `artistId`, whether it is asked now,
 * why the last asking failed, and a way to ask it; read again while it is asked.
 */
function useArtistSuggestion(artistId: string) {
  const [state, setState] = useState<ArtistSuggestionState>();
  // Counts the reads asked for, so each asks the server again.
  const [reads, setReads] = useState(0);
  const [sending, setSending] = useState(false);
  const [askError, setAskError] = useState("");
  useEffect(() => {
    let current = true;
    api.artistSuggestion(artistId).then(
      (found) => {
        if (current) {
          setState(found);
        }
      },
      () => {
        // Without it, nothing is suggested; the artist is edited all the same.
      },
    );
    return () => {
      current = false;
    };
  }, [artistId, reads]);
  useEffect(() => {
    if (state?.asking !== true) {
      return;
    }
    const timer = setTimeout(() => {
      setReads((count) => count + 1);
    }, ASKING_EVERY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);
  const ask = async () => {
    setSending(true);
    setAskError("");
    try {
      await api.suggestForArtist(artistId);
      setState((was) => ({ asking: true, suggestion: was?.suggestion ?? null, failure: null }));
    } catch (failure) {
      setAskError(messageOf(failure));
    } finally {
      setSending(false);
    }
  };
  return {
    asking: sending || state?.asking === true,
    suggestion: state?.suggestion ?? null,
    failure: askError || (state?.failure ?? ""),
    ask,
  };
}

/** What `by` suggests for `field`, unless it is what `typed` says already, with *Use*. */
function Suggested({
  field,
  value,
  typed,
  why,
  by,
  onUse,
}: {
  readonly field: string;
  readonly value: string;
  readonly typed: string;
  readonly why: string;
  readonly by: AnsweredBy;
  readonly onUse: () => void;
}) {
  if (value === "" || value === typed.trim()) {
    return null;
  }
  return (
    <div
      className="detail-suggestion"
      role="group"
      aria-label={`${aiNameOf(by, true)}'s suggestion for ${field}`}
    >
      <small
        className="detail-origin"
        title={[why, answeredOf(by)].filter((line) => line !== undefined && line !== "").join("\n")}
      >
        {aiNameOf(by, true)} suggests “{value}”
      </small>
      <button
        type="button"
        className="detail-alternative"
        aria-label={`Use “${value}”, suggested by ${aiNameOf(by)}`}
        onClick={onUse}
      >
        Use
      </button>
    </div>
  );
}

/**
 * Edit the artist `artist`, which most of its songs write as `written`; `onChanged`
 * reads the artists again after each change.
 */
export function EditArtist({
  artist,
  written,
  onChanged,
  onClose,
}: {
  readonly artist: KnownArtist;
  readonly written: string;
  readonly onChanged: () => void;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const namesId = useId();
  const [shownAs, setShownAs] = useState(artist.shown_as ?? "");
  const [about, setAbout] = useState(artist.about ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [picturing, setPicturing] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const ai = useArtistSuggestion(artist.id);
  const suggested = ai.suggestion;

  const names = [
    ...new Set([written, artist.name, ...artist.aliases.map((alias) => alias.name)]),
  ].filter((name) => name.trim() !== "");
  const changed =
    shownAs.trim() !== (artist.shown_as ?? "") || about.trim() !== (artist.about ?? "");

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.setArtistDetails(artist.id, shownAs.trim() || null, about.trim() || null);
      onChanged();
      dialog.current?.close();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setSaving(false);
    }
  };
  /** Make the photo change `change` makes at once, and read the artists again. */
  const changePhoto = async (change: () => Promise<undefined>) => {
    setPicturing(true);
    setPhotoError("");
    try {
      await change();
      onChanged();
    } catch (failure) {
      setPhotoError(messageOf(failure));
    } finally {
      setPicturing(false);
    }
  };

  const busy = saving || picturing;
  const choose = artist.photo === null ? "Add a photo" : "Replace the photo";
  return (
    <Modal
      ref={dialog}
      className="edit-artist"
      labelledBy="edit-artist-title"
      describedBy="edit-artist-name"
      locked={busy}
      onClose={onClose}
    >
      <form className="card" onSubmit={(event) => void save(event)}>
        <h2 id="edit-artist-title">Edit artist</h2>
        <p id="edit-artist-name" className="edit-details-song">
          {artist.shown_as ?? written}
        </p>
        <div className="edit-artist-body">
          <div className="edit-artist-photo">
            <span className="edit-artist-image">
              {artist.photo === null ? (
                <span className="artist-initial">{initialOf(artist.shown_as ?? written)}</span>
              ) : (
                <img
                  className="edit-artist-picture"
                  src={coverUrl(artist.photo)}
                  alt={`Photo of ${artist.shown_as ?? written}`}
                />
              )}
              {picturing && (
                <span className="cover-saving" role="status" aria-label="Saving the photo…">
                  <CircleNotchIcon weight="bold" className="spin" aria-hidden />
                </span>
              )}
            </span>
            <div className="edit-artist-photo-tools">
              <label
                className={busy ? "edit-artist-tool disabled" : "edit-artist-tool"}
                title={choose}
              >
                <UploadSimpleIcon weight="bold" aria-hidden />
                <span className="visually-hidden">{choose}</span>
                <input
                  type="file"
                  className="visually-hidden"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  onChange={(event) => {
                    const chosen = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (chosen === undefined) {
                      return;
                    }
                    if (chosen.size > MAX_COVER_BYTES) {
                      setPhotoError("A photo is at most 10 MiB.");
                    } else {
                      void changePhoto(() => api.setArtistPhoto(artist.id, chosen));
                    }
                  }}
                />
              </label>
              {artist.own_photo && (
                <button
                  type="button"
                  className="edit-artist-tool"
                  disabled={busy}
                  aria-label="Remove your photo"
                  title="Remove your photo"
                  onClick={() => void changePhoto(() => api.removeArtistPhoto(artist.id))}
                >
                  <TrashIcon weight="bold" aria-hidden />
                </button>
              )}
            </div>
            <small className={artist.own_photo ? "detail-origin yours" : "detail-origin"}>
              {artist.photo === null ? "No photo" : artist.own_photo ? "Yours" : "From Wikidata"}
            </small>
            {photoError !== "" && (
              <p className="error" role="alert">
                {photoError}
              </p>
            )}
          </div>
          <div className="edit-artist-fields">
            <div className="edit-artist-ask">
              {ai.failure !== "" && (
                <p className="error" role="alert">
                  {ai.failure}
                </p>
              )}
              <button
                type="button"
                className="secondary outline edit-artist-ask-button"
                disabled={ai.asking}
                title="Ask the AI to suggest a name and a note; nothing changes until you save"
                onClick={() => void ai.ask()}
              >
                {ai.asking ? (
                  <SpinnerGapIcon className="spin" aria-hidden />
                ) : (
                  <SparkleIcon aria-hidden />
                )}
                {ai.asking ? "Asking the AI…" : "Ask AI"}
              </button>
            </div>
            <label className="edit-album-field">
              Shown as
              <input
                className="edit-album-box"
                type="text"
                list={namesId}
                maxLength={MAX_SHOWN_AS}
                value={shownAs}
                placeholder={written}
                onChange={(event) => {
                  setShownAs(event.currentTarget.value);
                }}
              />
              <datalist id={namesId}>
                {names.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <small className="edit-artist-hint">Its songs keep their names as written.</small>
            </label>
            {suggested !== null && (
              <Suggested
                field="Shown as"
                value={suggested.shown_as ?? ""}
                typed={shownAs}
                why={suggested.why}
                by={suggested}
                onUse={() => {
                  setShownAs(suggested.shown_as ?? "");
                }}
              />
            )}
            <label className="edit-album-field">
              About
              <textarea
                className="edit-artist-about"
                rows={4}
                maxLength={MAX_ABOUT}
                value={about}
                onChange={(event) => {
                  setAbout(event.currentTarget.value);
                }}
              />
            </label>
            {suggested !== null && (
              <Suggested
                field="About"
                value={suggested.about}
                typed={about}
                why=""
                by={suggested}
                onUse={() => {
                  setAbout(suggested.about);
                }}
              />
            )}
          </div>
        </div>
        {error !== "" && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-buttons">
          <button
            type="button"
            className="secondary outline dialog-button"
            disabled={saving}
            onClick={() => dialog.current?.close()}
          >
            {changed ? "Cancel" : "Close"}
          </button>
          <button
            type="submit"
            className="dialog-button"
            disabled={!changed || busy}
            aria-busy={saving}
          >
            Save
          </button>
        </footer>
      </form>
    </Modal>
  );
}

/** *Edit details* beside an artist's name, opening its editor. */
export function EditArtistButton({
  artist,
  written,
  onChanged,
}: {
  readonly artist: KnownArtist;
  readonly written: string;
  readonly onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="secondary outline edit-heading"
        onClick={() => {
          setOpen(true);
        }}
      >
        <PencilSimpleIcon aria-hidden />
        Edit details
      </button>
      {open && (
        <EditArtist
          artist={artist}
          written={written}
          onChanged={onChanged}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
