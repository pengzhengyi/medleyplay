/**
 * @file The Songs and albums section of Settings: whether a long file is guessed an album.
 *
 * A file no one names the kind of is guessed an album when it is at least so many
 * minutes long; an admin sets the length or turns the guess off, and everyone sees it.
 */

import { useEffect, useEffectEvent, useState } from "react";

import { ApiError, type Settings, api } from "../api";
import { classOf, useNote } from "../useNote";

const MAX_MINUTES = 600;

/** The form as typed: whether to guess, and the length as written. */
interface Draft {
  readonly guess: boolean;
  readonly minutes: string;
}

const draftOf = (settings: Settings): Draft => ({
  guess: settings.album_minutes !== null,
  minutes: String(settings.album_minutes ?? 20),
});

/** Return the length the draft asks for, `null` for no guess, or `undefined` if it isn't one. */
function minutesOf(draft: Draft): number | null | undefined {
  if (!draft.guess) {
    return null;
  }
  const minutes = Number(draft.minutes);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_MINUTES ? minutes : undefined;
}

/** Whether a long file is guessed an album, changed by an admin; `onChanged` runs once saved. */
export function KindSettings({
  admin,
  onChanged,
}: {
  readonly admin: boolean;
  readonly onChanged: () => void;
}) {
  const [settings, setSettings] = useState<Settings | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>({ guess: true, minutes: "20" });
  const [error, setError] = useState("");
  const notes = useNote();

  const reload = (
    then = () => {
      notes.tell("");
    },
  ) => {
    api.settings().then(
      (read) => {
        setSettings(read);
        setDraft(draftOf(read));
        then();
      },
      (failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure));
      },
    );
  };
  const loadOnOpen = useEffectEvent(() => {
    reload();
  });
  useEffect(() => {
    loadOnOpen();
  }, []);

  const minutes = minutesOf(draft);
  const changed =
    settings !== undefined && minutes !== undefined && minutes !== settings.album_minutes;

  const change = (next: Draft) => {
    setDraft(next);
    notes.tell("");
  };
  const save = () => {
    if (settings === undefined || minutes === undefined) {
      return;
    }
    setError("");
    api.saveSettings({ ...settings, album_minutes: minutes }).then(
      () => {
        reload(() => {
          notes.confirm("Saved.");
        });
        onChanged();
      },
      (failure: unknown) => {
        if (failure instanceof ApiError && failure.status === 409) {
          reload(() => {
            notes.tell(
              "The settings changed elsewhere, so here they are now. Change them again to save.",
            );
          });
          return;
        }
        setError(failure instanceof Error ? failure.message : String(failure));
      },
    );
  };

  if (settings === undefined) {
    return error === "" ? (
      <p className="hint" aria-busy="true">
        Reading the settings…
      </p>
    ) : (
      <p role="alert">{error}</p>
    );
  }
  return (
    <>
      {error !== "" && <p role="alert">{error}</p>}
      {admin ? (
        <form
          className="kind-guess"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label className="kind-guess-check">
            <input
              type="checkbox"
              checked={draft.guess}
              onChange={(event) => {
                change({ ...draft, guess: event.target.checked });
              }}
            />
            Guess that a long file is an album
          </label>
          <label className="kind-guess-minutes">
            At least
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_MINUTES}
              step={1}
              value={draft.minutes}
              disabled={!draft.guess}
              aria-label="Shortest album, in minutes"
              onChange={(event) => {
                change({ ...draft, minutes: event.target.value });
              }}
            />
            minutes
          </label>
          <button type="submit" disabled={!changed}>
            Save
          </button>
          {minutes === undefined && (
            <p className="hint">Type whole minutes from 1 to {MAX_MINUTES}.</p>
          )}
        </form>
      ) : (
        <p>
          {settings.album_minutes === null
            ? "A file no one names the kind of is a song."
            : `A file ${String(settings.album_minutes)} minutes or longer is guessed an album.`}{" "}
          An admin changes this.
        </p>
      )}
      <p className="hint">
        A guess shows as an outlined mark; choosing Song or Album in Edit details settles it.
      </p>
      <p className={classOf(notes.note, "hint saved")} role="status">
        {notes.note.text}
      </p>
    </>
  );
}
