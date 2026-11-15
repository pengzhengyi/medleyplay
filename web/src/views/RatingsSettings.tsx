/**
 * @file The Your ratings section of Settings: import your Rate Your Music ratings, and export yours.
 *
 * Rate Your Music rates albums, so a song you haven't rated takes the rating you gave
 * its album. An import first says what it would change, then imports once you say so;
 * importing again merges with the earlier import unless you choose to replace it.
 */

import { DownloadSimpleIcon, TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useId, useState } from "react";

import {
  type ImportedAlbum,
  type ImportMode,
  RATINGS_EXPORT_URL,
  type RatingsImport,
  api,
} from "../api";
import { classOf, useNote } from "../useNote";

/** Write a count of things: `1 album`, `3 albums`. */
const countOf = (count: number, one: string, many = `${one}s`) =>
  `${String(count)} ${count === 1 ? one : many}`;

/** The unmatched albums as a text file to save, one `artist – album` a line. */
const listOf = (albums: RatingsImport["unmatched"]) =>
  `data:text/plain;charset=utf-8,${encodeURIComponent(
    albums.map(({ artist, album }) => `${artist} – ${album}\n`).join(""),
  )}`;

/** Say what an import does with the earlier one, by the mode it was previewed in. */
function earlierOf(preview: RatingsImport, mode: ImportMode, kept: number): string {
  if (mode === "replace") {
    return preview.replaced_albums > 0
      ? ` It replaces your earlier import of ${countOf(preview.replaced_albums, "album")}.`
      : "";
  }
  if (kept === 0) {
    return "";
  }
  const again =
    preview.replaced_albums > 0
      ? ` ${countOf(preview.replaced_albums, "album")} you imported before ${preview.replaced_albums === 1 ? "takes its" : "take their"} new rating.`
      : "";
  return `${again} Your import will have ${countOf(preview.total_albums, "album")}.`;
}

/** Import, view, and discard your Rate Your Music ratings, and export yours; `onChanged` runs after. */
export function RatingsSettings({ onChanged }: { readonly onChanged: () => void }) {
  const [kept, setKept] = useState<number | undefined>(undefined);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [preview, setPreview] = useState<RatingsImport | undefined>(undefined);
  const [discarding, setDiscarding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Read again whenever the import changes, so an open list stays true.
  const [version, setVersion] = useState(0);
  const notes = useNote();
  const previewHeading = useId();
  const modeName = useId();

  useEffect(() => {
    api.ratingsImportKept().then(
      ({ albums }) => {
        setKept(albums);
      },
      // Without the count, the section still imports; it just can't offer to discard.
      () => undefined,
    );
  }, []);

  const refused = (failure: unknown) => {
    setBusy(false);
    setError(failure instanceof Error ? failure.message : String(failure));
  };
  const check = (chosen: File, as: ImportMode) => {
    setFile(chosen);
    setMode(as);
    setError("");
    notes.tell("");
    setDiscarding(false);
    setBusy(true);
    api.previewRatingsImport(chosen, as).then((answer) => {
      setBusy(false);
      setPreview(answer);
    }, refused);
  };
  const apply = () => {
    if (file === undefined) {
      return;
    }
    setBusy(true);
    api.importRatings(file, mode).then((answer) => {
      setBusy(false);
      setPreview(undefined);
      setFile(undefined);
      setKept(answer.total_albums);
      setVersion((current) => current + 1);
      notes.confirm(`Imported ${countOf(answer.albums, "album")}.`);
      onChanged();
    }, refused);
  };
  const discard = () => {
    setBusy(true);
    api.forgetRatingsImport().then(() => {
      setBusy(false);
      setDiscarding(false);
      setKept(0);
      setVersion((current) => current + 1);
      notes.confirm("Discarded the import.");
      onChanged();
    }, refused);
  };
  const hasImport = kept !== undefined && kept > 0;

  return (
    <>
      <p className="hint">
        Bring in the album ratings and reviews you gave on Rate Your Music: download your export
        from your profile there, then import it here. A song you haven&apos;t rated takes its
        album&apos;s rating.
      </p>
      <div className="ratings-actions">
        <a
          href={RATINGS_EXPORT_URL}
          download
          role="button"
          className="secondary outline"
          title="Download a CSV file: the songs you rated, then your albums"
        >
          <DownloadSimpleIcon aria-hidden /> Export ratings
        </a>
        <button
          type="button"
          className="secondary outline"
          disabled={busy || !hasImport}
          title={hasImport ? undefined : "You have no import to discard"}
          onClick={() => {
            setDiscarding(true);
          }}
        >
          <TrashIcon aria-hidden /> Discard import
        </button>
        <label className={busy ? "ratings-import-button busy" : "ratings-import-button"}>
          <UploadSimpleIcon aria-hidden /> Import ratings
          <input
            type="file"
            className="visually-hidden"
            accept=".csv,text/csv"
            disabled={busy}
            aria-busy={busy}
            onChange={(event) => {
              const chosen = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (chosen !== undefined) {
                check(chosen, "merge");
              }
            }}
          />
        </label>
      </div>
      {error !== "" && <p role="alert">{error}</p>}
      {discarding && hasImport && (
        <p className="ratings-confirm">
          Discard the {countOf(kept, "album")} you imported? Songs you rated yourself keep their
          ratings.
          <button type="button" className="secondary" disabled={busy} onClick={discard}>
            Discard
          </button>
          <button
            type="button"
            className="secondary outline"
            onClick={() => {
              setDiscarding(false);
            }}
          >
            Keep it
          </button>
        </p>
      )}
      {preview !== undefined && file !== undefined && (
        <section className="ratings-preview" aria-labelledby={previewHeading}>
          <h4 id={previewHeading}>Before you import</h4>
          {hasImport && (
            <fieldset className="ratings-mode">
              <legend>Your earlier import of {countOf(kept, "album")}</legend>
              {(
                [
                  ["merge", "Merge with it"],
                  ["replace", "Replace it"],
                ] as const
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={modeName}
                    value={value}
                    checked={mode === value}
                    disabled={busy}
                    onChange={() => {
                      check(file, value);
                    }}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
          <p>
            {countOf(preview.albums, "album")} rated or reviewed; your Library has{" "}
            {String(preview.matched_albums)} of them. {countOf(preview.songs, "song")}{" "}
            {preview.songs === 1 ? "takes" : "take"} a new rating.
            {earlierOf(preview, mode, kept ?? 0)}
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
      <p className={classOf(notes.note)} aria-live="polite">
        {notes.note.text}
      </p>
      {hasImport && <ImportedRatings count={kept} version={version} />}
    </>
  );
}

/** Say a rating in stars, filled then empty: `★★★★☆`. */
const starsOf = (stars: number) => "★".repeat(stars) + "☆".repeat(5 - stars);

/**
 * The albums you imported, read only, read once opened: each with your rating and
 * review, and whether your Library has it, narrowed by what you type.
 */
function ImportedRatings({ count, version }: { readonly count: number; readonly version: number }) {
  const [open, setOpen] = useState(false);
  const [albums, setAlbums] = useState<readonly ImportedAlbum[] | undefined>(undefined);
  const [failed, setFailed] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    let current = true;
    api.importedAlbums().then(
      (found) => {
        if (current) {
          setAlbums(found);
          setFailed("");
        }
      },
      (failure: unknown) => {
        if (current) {
          setFailed(failure instanceof Error ? failure.message : String(failure));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [open, version]);

  const wanted = filter.trim().toLocaleLowerCase();
  const shown =
    albums?.filter(
      ({ artist, album }) =>
        wanted === "" ||
        artist.toLocaleLowerCase().includes(wanted) ||
        album.toLocaleLowerCase().includes(wanted),
    ) ?? [];

  return (
    <details
      className="ratings-imported"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>Your imported ratings ({countOf(count, "album")})</summary>
      {failed !== "" && <p role="alert">{failed}</p>}
      {albums === undefined && failed === "" && open && <p aria-busy="true">Reading them…</p>}
      {albums !== undefined && (
        <>
          <input
            type="search"
            className="ratings-filter"
            placeholder="Filter by artist or album"
            aria-label="Filter your imported ratings"
            value={filter}
            onChange={(event) => {
              setFilter(event.currentTarget.value);
            }}
          />
          {shown.length === 0 ? (
            <p className="hint">No imported album matches “{filter.trim()}”.</p>
          ) : (
            <div className="ratings-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Album</th>
                    <th scope="col">Artist</th>
                    <th scope="col">Rating</th>
                    <th scope="col">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((each, index) => (
                    <tr key={index}>
                      <td>
                        {each.album}
                        {!each.in_library && (
                          <span className="ratings-missing" title="Your Library hasn't this album">
                            Not in Library
                          </span>
                        )}
                      </td>
                      <td>{each.artist}</td>
                      <td>
                        {each.stars === null ? (
                          <span className="hint">Reviewed</span>
                        ) : (
                          <span
                            className="ratings-stars"
                            role="img"
                            aria-label={countOf(each.stars, "star")}
                          >
                            {starsOf(each.stars)}
                          </span>
                        )}
                      </td>
                      <td className="ratings-review">{each.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </details>
  );
}
