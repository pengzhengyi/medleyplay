/**
 * @file The Songs and albums section of Settings: whether a long file is guessed an album.
 *
 * A file no one names the kind of is guessed an album when it is at least so many
 * minutes long; an admin sets the length or turns the guess off, and everyone sees it.
 * Each change saves on its own: the switch at once, the length once typing pauses.
 */

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { ApiError, type Settings, api } from "../api";
import { useAutoSave } from "../useAutoSave";
import { classOf } from "../useNote";

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
  settings,
  onSettings,
  onChanged,
}: {
  readonly admin: boolean;
  /** The household's settings as last read, shared with the other sections that save them. */
  readonly settings: Settings | undefined;
  readonly onSettings: (settings: Settings) => void;
  readonly onChanged: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({ guess: true, minutes: "20" });
  const [error, setError] = useState("");
  const latest = useRef(settings);
  useEffect(() => {
    latest.current = settings;
  }, [settings]);

  const reload = (then = () => undefined) => {
    api.settings().then(
      (read) => {
        latest.current = read;
        onSettings(read);
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

  const saving = useAutoSave((albumMinutes: number | null, notes) => {
    const base = latest.current;
    if (base === undefined || albumMinutes === base.album_minutes) {
      notes.tell("");
      return Promise.resolve(false);
    }
    setError("");
    return api.saveSettings({ ...base, album_minutes: albumMinutes }).then(
      (saved) => {
        latest.current = saved;
        onSettings(saved);
        onChanged();
        return true;
      },
      (failure: unknown) => {
        if (failure instanceof ApiError && failure.status === 409) {
          reload(() => {
            notes.tell(
              "The settings changed elsewhere, so here they are now. Change them again to save.",
            );
          });
        } else {
          notes.tell("");
          setError(failure instanceof Error ? failure.message : String(failure));
        }
        return false;
      },
    );
  });

  const change = (next: Draft, typed: boolean) => {
    setDraft(next);
    const minutes = minutesOf(next);
    if (minutes === undefined || minutes === latest.current?.album_minutes) {
      saving.cancel();
    } else if (typed) {
      saving.later(minutes);
    } else {
      saving.now(minutes);
    }
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
            saving.flush();
          }}
        >
          <label className="kind-guess-check">
            <input
              type="checkbox"
              checked={draft.guess}
              onChange={(event) => {
                change({ ...draft, guess: event.target.checked }, false);
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
                change({ ...draft, minutes: event.target.value }, true);
              }}
              onBlur={saving.flush}
            />
            minutes
          </label>
          {minutesOf(draft) === undefined && (
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
      <p className={classOf(saving.note, "hint saved")} role="status">
        {saving.note.text}
      </p>
    </>
  );
}
