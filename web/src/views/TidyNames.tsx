/**
 * @file Tidying artist and album names written with more than the name in them.
 *
 * A section of Clean up: each name as written, its tidy form and the year it gave, and
 * how many songs show it. *Tidy* sets the tidy form on those songs, and the year where
 * a song shows none; *Keep* keeps the name as written, so it isn't offered again;
 * *Tidy all* tidies every name listed at once. Each can be undone in a song's details.
 */

import { ArrowElbowDownRightIcon, BroomIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { api, type NameToTidy } from "../api";

/** The names to tidy, each to tidy or keep, and all to tidy at once. */
export function TidyNames({
  names,
  onChanged,
}: {
  readonly names: readonly NameToTidy[];
  /** Called after a change, so the names are read again. */
  readonly onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // Why a name couldn't be tidied or kept, by the name as written; "" for all of them.
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());

  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      setErrors((now) => without(now, key));
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setErrors((now) => new Map(now).set(key, message));
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  const allError = errors.get("");

  return (
    <section className="clean-up-section" aria-labelledby="tidy-names-title">
      <header className="clean-up-head">
        <h3 id="tidy-names-title">
          <BroomIcon className="clean-up-icon" weight="bold" aria-hidden />
          Tidy names
          <span className="clean-up-count">{names.length}</span>
        </h3>
        {names.length > 1 && (
          <button
            type="button"
            className="dialog-button"
            disabled={busy}
            onClick={() => void run("", () => api.tidyNames(names))}
          >
            Tidy all
          </button>
        )}
      </header>
      <p className="tidy-lead">
        These artist and album names have more than the name in them. Tidying sets the name on their
        songs, and the year where a song has none.
      </p>
      {allError !== undefined && (
        <p className="error" role="alert">
          {allError}
        </p>
      )}
      {names.length === 0 ? (
        <p className="empty">Every artist and album name is tidy.</p>
      ) : (
        <ul className="tidy-list" aria-label="Names to tidy">
          {names.map((name) => {
            const error = errors.get(keyOf(name));
            return (
              <li key={keyOf(name)} className="tidy-row">
                <div className="tidy-names-pair">
                  <s className="tidy-written">{name.written}</s>
                  <span className="tidy-result">
                    <ArrowElbowDownRightIcon className="tidy-arrow" weight="bold" aria-hidden />
                    <strong className="tidy-name">{name.name}</strong>
                    {name.year !== null && <span className="tidy-year">{name.year}</span>}
                  </span>
                </div>
                <p className="tidy-meta">
                  {fieldOf(name) !== undefined && (
                    <span className="tidy-field">{fieldOf(name)}</span>
                  )}
                  {metaOf(name)}
                </p>
                <div className="tidy-actions">
                  <button
                    type="button"
                    className="secondary outline dialog-button"
                    aria-label={`Keep ${name.written} as written`}
                    disabled={busy}
                    onClick={() =>
                      void run(keyOf(name), () => api.keepName(name.kind, name.written))
                    }
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    className="dialog-button"
                    aria-label={`Tidy ${name.written} to ${name.name}`}
                    disabled={busy}
                    onClick={() =>
                      void run(keyOf(name), () => api.tidyName(name.kind, name.written))
                    }
                  >
                    Tidy
                  </button>
                </div>
                {error !== undefined && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Say how many songs show the name, and how many keep a year of their own. */
function metaOf(name: NameToTidy): string {
  const songs = `${String(name.track_ids.length)} ${name.track_ids.length === 1 ? "song" : "songs"}`;
  if (name.years_differ === 0) {
    return songs;
  }
  const keeps = name.years_differ === 1 ? "keeps its" : "keep their";
  return `${songs}, ${String(name.years_differ)} ${keeps} own year`;
}

/** Say what a name is when it isn't an artist's: an album, or only an album artist. */
function fieldOf(name: NameToTidy): string | undefined {
  if (name.kind === "album") {
    return "Album";
  }
  return name.fields.includes("artist") ? undefined : "Album artist";
}

function keyOf(name: NameToTidy): string {
  return `${name.kind}:${name.written}`;
}

function without(map: ReadonlyMap<string, string>, key: string): ReadonlyMap<string, string> {
  const left = new Map(map);
  left.delete(key);
  return left;
}
