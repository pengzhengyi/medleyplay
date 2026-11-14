/**
 * @file Editing an album of songs of their own: its name, artist, year, and genre, on every song.
 *
 * A detail the songs agree on starts filled; one they don't starts blank, and is left
 * as each song has it unless typed. Saving sends only what changed, to every song at
 * once, as the household's own value; emptying a detail drops the household's value,
 * so what the files say shows again. An album that is one file is edited as that file,
 * in Edit details, instead.
 */

import { type SubmitEvent, useRef, useState } from "react";

import type { Detail, Track } from "../api";
import { albumArtistOf } from "../library/views";
import { Modal } from "./Modal";

/** The album details edited here, each with its label and how its songs show it. */
const FIELDS = [
  { detail: "album", label: "Album", read: (track: Track) => track.album },
  { detail: "album_artist", label: "Album artist", read: albumArtistOf },
  {
    detail: "year",
    label: "Year",
    read: (track: Track) => (track.year === null ? "" : String(track.year)),
  },
  { detail: "genre", label: "Genre", read: (track: Track) => track.genre },
] as const satisfies readonly {
  readonly detail: Detail;
  readonly label: string;
  readonly read: (track: Track) => string;
}[];

type AlbumDetail = (typeof FIELDS)[number]["detail"];

/** The changes to save: a value for each detail typed, `null` for one emptied. */
export type AlbumChanges = Partial<Record<AlbumDetail, string | number | null>>;

/** What the songs agree on for each detail, or `undefined` where they differ. */
function sharedOf(songs: readonly Track[]): Record<AlbumDetail, string | undefined> {
  const shared = (read: (track: Track) => string) => {
    const values = new Set(songs.map(read));
    return values.size === 1 ? [...values][0] : undefined;
  };
  return Object.fromEntries(FIELDS.map(({ detail, read }) => [detail, shared(read)])) as Record<
    AlbumDetail,
    string | undefined
  >;
}

/** Edit the album `songs` make up; `onSave` sets the changes on every one of them. */
export function EditAlbum({
  songs,
  onSave,
  onClose,
}: {
  readonly songs: readonly Track[];
  readonly onSave: (changes: AlbumChanges) => Promise<void>;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [shared] = useState(() => sharedOf(songs));
  const [draft, setDraft] = useState<Record<AlbumDetail, string>>(() => ({
    album: shared.album ?? "",
    album_artist: shared.album_artist ?? "",
    year: shared.year ?? "",
    genre: shared.genre ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const changes: AlbumChanges = {};
  for (const { detail } of FIELDS) {
    const typed = draft[detail].trim();
    if (typed === (shared[detail] ?? "")) {
      continue;
    }
    changes[detail] = typed === "" ? null : detail === "year" ? Number(typed) : typed;
  }
  const changed = Object.keys(changes).length > 0;

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(changes);
      dialog.current?.close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      ref={dialog}
      className="edit-album"
      labelledBy="edit-album-title"
      locked={saving}
      onClose={onClose}
    >
      <form className="card" onSubmit={(event) => void save(event)}>
        <h2 id="edit-album-title">Edit album</h2>
        <p className="hint">
          {`${String(songs.length)} songs of their own. What you type here is set on each of them.`}
        </p>
        <div className="edit-album-fields">
          {FIELDS.map(({ detail, label }) => (
            <label key={detail} className="edit-album-field">
              {label}
              <input
                className="edit-album-box"
                type={detail === "year" ? "number" : "text"}
                inputMode={detail === "year" ? "numeric" : undefined}
                min={detail === "year" ? 1 : undefined}
                max={detail === "year" ? 9999 : undefined}
                maxLength={detail === "year" ? undefined : 512}
                value={draft[detail]}
                placeholder={
                  shared[detail] === undefined ? "Varies; each keeps its own" : undefined
                }
                onChange={(event) => {
                  const { value } = event.currentTarget;
                  setDraft((now) => ({ ...now, [detail]: value }));
                }}
              />
            </label>
          ))}
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
            Cancel
          </button>
          <button
            type="submit"
            className="dialog-button"
            disabled={!changed || saving}
            aria-busy={saving}
          >
            {`Save to ${String(songs.length)} songs`}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
