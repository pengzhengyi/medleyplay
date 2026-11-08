/**
 * @file The Your ratings section of Settings: import your Rate Your Music ratings, and export yours.
 *
 * Rate Your Music rates albums, so a song you haven't rated takes the rating you gave
 * its album. An import first says what it would change, then imports once you say so;
 * importing again replaces the earlier import.
 */

import { useEffect, useId, useState } from "react";

import { RATINGS_EXPORT_URL, type RatingsImport, api } from "../api";
import { classOf, useNote } from "../useNote";

/** Write a count of things: `1 album`, `3 albums`. */
const countOf = (count: number, one: string, many = `${one}s`) =>
  `${String(count)} ${count === 1 ? one : many}`;

/** The unmatched albums as a text file to save, one `artist – album` a line. */
const listOf = (albums: RatingsImport["unmatched"]) =>
  `data:text/plain;charset=utf-8,${encodeURIComponent(
    albums.map(({ artist, album }) => `${artist} – ${album}\n`).join(""),
  )}`;

/** Import and forget your Rate Your Music ratings, and export yours; `onChanged` runs after. */
export function RatingsSettings({ onChanged }: { readonly onChanged: () => void }) {
  const [kept, setKept] = useState<number | undefined>(undefined);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [preview, setPreview] = useState<RatingsImport | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const notes = useNote();
  const previewHeading = useId();

  useEffect(() => {
    api.ratingsImportKept().then(
      ({ albums }) => {
        setKept(albums);
      },
      // Without the count, the section still imports; it just can't offer to forget.
      () => undefined,
    );
  }, []);

  const refused = (failure: unknown) => {
    setBusy(false);
    setError(failure instanceof Error ? failure.message : String(failure));
  };
  const check = (chosen: File) => {
    setFile(chosen);
    setPreview(undefined);
    setError("");
    notes.tell("");
    setBusy(true);
    api.previewRatingsImport(chosen).then((answer) => {
      setBusy(false);
      setPreview(answer);
    }, refused);
  };
  const apply = () => {
    if (file === undefined) {
      return;
    }
    setBusy(true);
    api.importRatings(file).then((answer) => {
      setBusy(false);
      setPreview(undefined);
      setFile(undefined);
      setKept(answer.albums);
      notes.confirm(`Imported ${countOf(answer.albums, "album")}.`);
      onChanged();
    }, refused);
  };
  const forget = () => {
    setBusy(true);
    api.forgetRatingsImport().then(() => {
      setBusy(false);
      setKept(0);
      notes.confirm("Forgot the import.");
      onChanged();
    }, refused);
  };

  return (
    <>
      <p className="hint">
        Bring in the album ratings and reviews you gave on Rate Your Music: download your export
        from your profile there, then choose it here. A song you haven&apos;t rated takes its
        album&apos;s rating.
      </p>
      <div className="ratings-import">
        <label className="file-picker">
          Rate Your Music export
          <input
            type="file"
            className="file-input"
            accept=".csv,text/csv"
            disabled={busy}
            aria-busy={busy}
            onChange={(event) => {
              const chosen = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (chosen !== undefined) {
                check(chosen);
              }
            }}
          />
        </label>
        {error !== "" && <p role="alert">{error}</p>}
      </div>
      {preview !== undefined && (
        <section className="ratings-preview" aria-labelledby={previewHeading}>
          <h4 id={previewHeading}>Before you import</h4>
          <p>
            {countOf(preview.albums, "album")} rated or reviewed; your Library has{" "}
            {String(preview.matched_albums)} of them. {countOf(preview.songs, "song")}{" "}
            {preview.songs === 1 ? "takes" : "take"} a new rating.
            {preview.replaced_albums > 0 &&
              ` It replaces your earlier import of ${countOf(preview.replaced_albums, "album")}.`}
          </p>
          {preview.playlists.length > 0 && (
            <ul aria-label="Your smart playlists">
              {preview.playlists.map(({ id, name, joining, leaving }) => (
                <li key={id}>
                  {name}:{" "}
                  {[
                    joining > 0 &&
                      `${countOf(joining, "song")} ${joining === 1 ? "joins" : "join"}`,
                    leaving > 0 &&
                      `${countOf(leaving, "song")} ${leaving === 1 ? "leaves" : "leave"}`,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </li>
              ))}
            </ul>
          )}
          {preview.unmatched.length > 0 && (
            <details>
              <summary>
                {countOf(preview.unmatched.length, "album")}{" "}
                {preview.unmatched.length === 1 ? "isn't" : "aren't"} in your Library
              </summary>
              <ul className="unmatched-albums">
                {preview.unmatched.map(({ artist, album }, index) => (
                  <li key={index}>
                    {artist} – {album}
                  </li>
                ))}
              </ul>
              <a href={listOf(preview.unmatched)} download="albums-not-in-the-library.txt">
                Save the list
              </a>
            </details>
          )}
          <div className="ratings-preview-actions">
            <button type="button" disabled={busy} aria-busy={busy} onClick={apply}>
              Import
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setPreview(undefined);
                setFile(undefined);
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
      {kept !== undefined && kept > 0 && (
        <p className="ratings-kept">
          Your import has {countOf(kept, "album")}.{" "}
          <button type="button" className="secondary outline" disabled={busy} onClick={forget}>
            Forget the import
          </button>
        </p>
      )}
      <p className={classOf(notes.note)} aria-live="polite">
        {notes.note.text}
      </p>
      <p>
        <a href={RATINGS_EXPORT_URL} download>
          Export your ratings
        </a>{" "}
        <span className="hint">as a CSV file: the songs you rated, then your albums.</span>
      </p>
    </>
  );
}
