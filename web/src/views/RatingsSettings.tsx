/**
 * @file The Your ratings section of Settings: import your Rate Your Music ratings, and export yours.
 *
 * Rate Your Music rates albums, so a song you haven't rated takes the rating you gave
 * its album. An import first says what it would change, then imports once you say so;
 * importing again merges with the earlier import unless you choose to replace it.
 */

import { DownloadSimpleIcon, TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";

import {
  ApiError,
  type ImportedAlbum,
  type ImportMode,
  RATINGS_EXPORT_URL,
  type RatingsImport,
  api,
} from "../api";
import { type Words, useFormattingLocale, useWords } from "../locale";
import { classOf, useNoteOf } from "../useNote";

type Quantity = (key: string, count: number) => string;
type ImportNotice = { readonly albums: number } | "Discarded the import." | null;
const EXPORT_REFUSALS = new Set([
  "A Rate Your Music export is UTF-8 text; this file isn't, so it may have been saved again as UTF-16 or from a spreadsheet.",
  "The file has no header; a Rate Your Music export starts with its columns.",
  "The export rates and reviews no album, so importing it would change nothing.",
]);
const HEADER_VALUE = String.raw`(?:None|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")`;
const HEADER_MISMATCH = new RegExp(
  String.raw`^The export's column (\d+) is (${HEADER_VALUE}), not (${HEADER_VALUE}); this isn't a Rate Your Music export this server can read\.$`,
  "u",
);

function importError(failure: unknown, t: Words): string {
  const detail = failure instanceof Error ? failure.message : String(failure);
  if (failure instanceof ApiError) {
    if (failure.status === 422) {
      if (EXPORT_REFUSALS.has(detail)) return t(detail);
      const [, column, actual, expected] = HEADER_MISMATCH.exec(detail) ?? [];
      if (column !== undefined && actual !== undefined && expected !== undefined) {
        return t(
          "The export's column {{column}} is {{actual}}, not {{expected}}; this isn't a Rate Your Music export this server can read.",
          { column, actual, expected },
        );
      }
    }
    if (failure.status === 413) {
      const maxSize = /^A Rate Your Music export is at most (\d+) MiB\.$/u.exec(detail)?.[1];
      if (maxSize !== undefined)
        return t("A Rate Your Music export is at most {{limit}} MiB.", { limit: maxSize });
      const maxAlbums = /^A Rate Your Music export has at most (\d+) albums\.$/u.exec(detail)?.[1];
      if (maxAlbums !== undefined)
        return t("A Rate Your Music export has at most {{limit}} albums.", { limit: maxAlbums });
    }
  }
  return t("Could not change the imported ratings: {{detail}}", { detail });
}

function useRatingsWords() {
  const t = useWords();
  const number = new Intl.NumberFormat(useFormattingLocale());
  const quantity: Quantity = (key, count) => t(key, { count, amount: number.format(count) });
  return { t, number, quantity };
}

/** The unmatched albums as a text file to save, one `artist – album` a line. */
const listOf = (albums: RatingsImport["unmatched"]) =>
  `data:text/plain;charset=utf-8,${encodeURIComponent(
    albums.map(({ artist, album }) => `${artist} – ${album}\n`).join(""),
  )}`;

/** Say what an import does with the earlier one, by the mode it was previewed in. */
function earlierOf(preview: RatingsImport, mode: ImportMode, quantity: Quantity): string[] {
  if (mode === "replace") {
    return preview.replaced_albums > 0
      ? [quantity("ratings_replaces", preview.replaced_albums)]
      : [];
  }
  if (preview.replaced_albums === 0 && preview.total_albums === preview.albums) {
    return [];
  }
  const again =
    preview.replaced_albums > 0
      ? [quantity("ratings_previously_imported", preview.replaced_albums)]
      : [];
  return [...again, quantity("ratings_total_after_import", preview.total_albums)];
}

/** Import, view, and discard your Rate Your Music ratings, and export yours; `onChanged` runs after. */
export function RatingsSettings({ onChanged }: { readonly onChanged: () => void }) {
  const { t, number, quantity } = useRatingsWords();
  const [kept, setKept] = useState<number | undefined>(undefined);
  const [keptUnread, setKeptUnread] = useState(false);
  const countFromMutation = useRef(false);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [preview, setPreview] = useState<RatingsImport | undefined>(undefined);
  const [discarding, setDiscarding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ cause: unknown }>();
  // Read again whenever the import changes, so an open list stays true.
  const [version, setVersion] = useState(0);
  const notes = useNoteOf<ImportNotice>(null);
  const previewHeading = useId();
  const modeName = useId();

  useEffect(() => {
    let current = true;
    api.ratingsImportKept().then(
      ({ albums }) => {
        if (current && !countFromMutation.current) setKept(albums);
      },
      () => {
        if (current && !countFromMutation.current) setKeptUnread(true);
      },
    );
    return () => {
      current = false;
    };
  }, []);

  const refused = (failure: unknown) => {
    setBusy(false);
    setError({ cause: failure });
  };
  const check = (chosen: File, as: ImportMode) => {
    setFile(chosen);
    setMode(as);
    setPreview(undefined);
    setError(undefined);
    notes.tell(null);
    setDiscarding(false);
    setBusy(true);
    api.previewRatingsImport(chosen, as).then((answer) => {
      setBusy(false);
      setPreview(answer);
    }, refused);
  };
  const apply = () => {
    if (file === undefined || preview === undefined || busy) {
      return;
    }
    setBusy(true);
    setError(undefined);
    api.importRatings(file, mode).then((answer) => {
      setBusy(false);
      setPreview(undefined);
      setFile(undefined);
      countFromMutation.current = true;
      setKept(answer.total_albums);
      setKeptUnread(false);
      setVersion((current) => current + 1);
      notes.confirm({ albums: answer.albums });
      onChanged();
    }, refused);
  };
  const discard = () => {
    setBusy(true);
    setError(undefined);
    api.forgetRatingsImport().then(() => {
      setBusy(false);
      setDiscarding(false);
      countFromMutation.current = true;
      setKept(0);
      setFile(undefined);
      setPreview(undefined);
      setVersion((current) => current + 1);
      notes.confirm("Discarded the import.");
      onChanged();
    }, refused);
  };
  const hasImport = kept !== undefined && kept > 0;
  const notice = notes.note.text;

  return (
    <>
      <p className="hint">
        {t(
          "Bring in the album ratings and reviews you gave on Rate Your Music: download your export from your profile there, then import it here. A song you haven't rated takes its album's rating.",
        )}
      </p>
      <div className="ratings-actions">
        <a
          href={RATINGS_EXPORT_URL}
          download
          role="button"
          className="secondary outline"
          title={t("Download a CSV file: the songs you rated, then your albums")}
        >
          <DownloadSimpleIcon aria-hidden /> {t("Export ratings")}
        </a>
        <button
          type="button"
          className="secondary outline"
          disabled={busy || !hasImport}
          title={kept === 0 ? t("You have no import to discard") : undefined}
          onClick={() => {
            setDiscarding(true);
          }}
        >
          <TrashIcon aria-hidden /> {t("Discard import")}
        </button>
        <label className={busy ? "ratings-import-button busy" : "ratings-import-button"}>
          <UploadSimpleIcon aria-hidden /> {t("Import ratings")}
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
      {keptUnread && (
        <p className="hint" role="status">
          {t("Could not read your earlier import. You can still preview a new file.")}
        </p>
      )}
      {error !== undefined && <p role="alert">{importError(error.cause, t)}</p>}
      {discarding && hasImport && (
        <p className="ratings-confirm">
          {quantity("ratings_discard", kept)}
          <button type="button" className="secondary" disabled={busy} onClick={discard}>
            {t("Discard")}
          </button>
          <button
            type="button"
            className="secondary outline"
            disabled={busy}
            onClick={() => {
              setDiscarding(false);
            }}
          >
            {t("Keep it")}
          </button>
        </p>
      )}
      {file !== undefined && (
        <section className="ratings-preview" aria-labelledby={previewHeading}>
          <h4 id={previewHeading}>{t("Before you import")}</h4>
          {hasImport && (
            <fieldset className="ratings-mode">
              <legend>{quantity("ratings_earlier_import", kept)}</legend>
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
                  {t(label)}
                </label>
              ))}
            </fieldset>
          )}
          {preview === undefined ? (
            busy && (
              <p className="hint" aria-busy="true">
                {t("Checking the import…")}
              </p>
            )
          ) : (
            <>
              <p>
                {[
                  t("ratings_preview_albums", {
                    count: preview.albums,
                    amount: number.format(preview.albums),
                    matched: number.format(preview.matched_albums),
                  }),
                  quantity("ratings_changed_songs", preview.songs),
                  ...earlierOf(preview, mode, quantity),
                ].join(t("Sentence separator", { defaultValue: " " }))}
              </p>
              {preview.playlists.length > 0 && (
                <ul aria-label={t("Your smart playlists")}>
                  {preview.playlists.map(({ id, name, joining, leaving }) => (
                    <li key={id}>
                      {t("{{name}}: {{changes}}", {
                        name,
                        changes: [
                          joining > 0 && quantity("ratings_joining", joining),
                          leaving > 0 && quantity("ratings_leaving", leaving),
                        ]
                          .filter(Boolean)
                          .join(t(", ")),
                      })}
                    </li>
                  ))}
                </ul>
              )}
              {preview.unmatched.length > 0 && (
                <details>
                  <summary>{quantity("ratings_unmatched", preview.unmatched.length)}</summary>
                  <ul className="unmatched-albums">
                    {preview.unmatched.map(({ artist, album }, index) => (
                      <li key={index}>
                        {artist} – {album}
                      </li>
                    ))}
                  </ul>
                  <a href={listOf(preview.unmatched)} download="albums-not-in-the-library.txt">
                    {t("Save the list")}
                  </a>
                </details>
              )}
            </>
          )}
          <div className="ratings-preview-actions">
            {preview === undefined && !busy && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  check(file, mode);
                }}
              >
                {t("Retry preview")}
              </button>
            )}
            <button
              type="button"
              disabled={busy || preview === undefined}
              aria-busy={busy}
              onClick={apply}
            >
              {t("Import")}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setPreview(undefined);
                setFile(undefined);
                setError(undefined);
              }}
            >
              {t("Cancel")}
            </button>
          </div>
        </section>
      )}
      <p className={classOf(notes.note)} aria-live="polite">
        {notice === null
          ? ""
          : typeof notice === "string"
            ? t(notice)
            : quantity("ratings_imported", notice.albums)}
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
  const { t, quantity } = useRatingsWords();
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<{
    readonly version: number;
    readonly albums?: readonly ImportedAlbum[];
    readonly error?: string;
  }>();
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    let current = true;
    api.importedAlbums().then(
      (found) => {
        if (current) {
          setRead({ version, albums: found });
        }
      },
      (failure: unknown) => {
        if (current) {
          setRead({ version, error: failure instanceof Error ? failure.message : String(failure) });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [open, version]);

  const result = read?.version === version ? read : undefined;
  const albums = result?.albums;
  const failed = result?.error;
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
      <summary>{quantity("ratings_imported_heading", count)}</summary>
      {failed !== undefined && (
        <p role="alert">
          {t("Could not read the imported ratings: {{detail}}", { detail: failed })}
        </p>
      )}
      {albums === undefined && failed === undefined && open && (
        <p aria-busy="true">{t("Reading imported ratings…")}</p>
      )}
      {albums !== undefined && (
        <>
          <input
            type="search"
            className="ratings-filter"
            placeholder={t("Filter by artist or album")}
            aria-label={t("Filter your imported ratings")}
            value={filter}
            onChange={(event) => {
              setFilter(event.currentTarget.value);
            }}
          />
          {shown.length === 0 ? (
            <p className="hint">
              {wanted === ""
                ? t("There are no imported albums.")
                : t("No imported album matches “{{query}}”.", { query: filter.trim() })}
            </p>
          ) : (
            <div className="ratings-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t("Album")}</th>
                    <th scope="col">{t("Artist")}</th>
                    <th scope="col">{t("Rating")}</th>
                    <th scope="col">{t("Review")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((each, index) => (
                    <tr key={index}>
                      <td>
                        {each.album}
                        {!each.in_library && (
                          <span
                            className="ratings-missing"
                            title={t("Your Library hasn't this album")}
                          >
                            {t("Not in Library")}
                          </span>
                        )}
                      </td>
                      <td>{each.artist}</td>
                      <td>
                        {each.stars === null ? (
                          <span className="hint">{t("Reviewed")}</span>
                        ) : (
                          <span
                            className="ratings-stars"
                            role="img"
                            aria-label={t("star_count", { count: each.stars })}
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
