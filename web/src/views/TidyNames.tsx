/**
 * @file Tidying artist and album names written with more than the name in them.
 *
 * A capsule says how many names could be tidied, and only shows while some can. It
 * opens the list: each name as written, its tidy form and the year it gave, and how
 * many songs show it. *Tidy* sets the tidy form on those songs, and the year where
 * a song shows none; *Keep* keeps the name as written, so it isn't offered again.
 * Either can be undone in a song's details.
 */

import { ArrowElbowDownRightIcon, BroomIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { api, type NameToTidy } from "../api";
import { Modal } from "./Modal";

/** The capsule that opens the names to tidy; `version` changes when the Library does. */
export function TidyNames({ version }: { readonly version?: unknown }) {
  const [names, setNames] = useState<readonly NameToTidy[]>([]);
  const [open, setOpen] = useState(false);
  // Counts the changes made here, so the names are asked for again after each.
  const [changes, setChanges] = useState(0);
  useEffect(() => {
    let current = true;
    api.namesToTidy().then(
      (answer) => {
        if (current) {
          setNames(answer.names);
        }
      },
      () => {
        // Without the list there is nothing to offer; the Library works on.
        if (current) {
          setNames([]);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [version, changes]);

  if (names.length === 0 && !open) {
    return null;
  }
  const count = names.length;
  return (
    <>
      {count > 0 && (
        <button
          type="button"
          className="tidy-capsule"
          title="Some artist or album names have more than the name in them"
          onClick={() => {
            setOpen(true);
          }}
        >
          <BroomIcon weight="bold" aria-hidden />
          {`Tidy ${String(count)} ${count === 1 ? "name" : "names"}`}
        </button>
      )}
      {open && (
        <TidyList
          names={names}
          onChanged={() => {
            setChanges((count) => count + 1);
          }}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function TidyList({
  names,
  onChanged,
  onClose,
}: {
  readonly names: readonly NameToTidy[];
  readonly onChanged: () => void;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  // Why a name couldn't be tidied or kept, by the name as written.
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());

  const act = async (name: NameToTidy, action: "tidy" | "keep") => {
    try {
      await (action === "tidy"
        ? api.tidyName(name.kind, name.written)
        : api.keepName(name.kind, name.written));
      setErrors((now) => without(now, keyOf(name)));
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setErrors((now) => new Map(now).set(keyOf(name), message));
    }
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal ref={dialog} className="tidy-names" labelledBy="tidy-names-title" onClose={onClose}>
      <div className="card">
        <h2 id="tidy-names-title">Tidy names</h2>
        <p className="tidy-lead">
          These artist and album names have more than the name in them. Tidying sets the name on
          their songs, and the year where a song has none.
        </p>
        {names.length === 0 ? (
          <p className="empty">Every artist name is tidy.</p>
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
                      onClick={() => void run(() => act(name, "keep"))}
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      className="dialog-button"
                      aria-label={`Tidy ${name.written} to ${name.name}`}
                      disabled={busy}
                      onClick={() => void run(() => act(name, "tidy"))}
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
        <footer className="dialog-buttons">
          <button
            type="button"
            className="secondary outline dialog-button"
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
          {names.length > 1 && (
            <button
              type="button"
              className="dialog-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  for (const name of names) {
                    await act(name, "tidy");
                  }
                })
              }
            >
              Tidy all
            </button>
          )}
        </footer>
      </div>
    </Modal>
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
