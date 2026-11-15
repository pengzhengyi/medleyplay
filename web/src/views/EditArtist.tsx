/**
 * @file Editing what the household chooses for an artist: the name it is shown by, a
 * note about it, and its photo. The artist's songs keep their names as written.
 *
 * The name and the note are saved together; a photo is set or removed at once, as a
 * song's cover is. An empty name shows the artist as most of its songs write it, and
 * removing the household's photo shows Wikidata's again.
 */

import {
  CircleNotchIcon,
  PencilSimpleIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { type SubmitEvent, useId, useRef, useState } from "react";

import { type KnownArtist, api, coverUrl } from "../api";
import { initialOf } from "../format";
import { MAX_COVER_BYTES } from "./EditDetails";
import { Modal } from "./Modal";

/** The longest name an artist may be shown by, and the longest note about it. */
const MAX_SHOWN_AS = 512;
const MAX_ABOUT = 1000;

/** Say why a change failed, in the server's words when it gave some. */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
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
