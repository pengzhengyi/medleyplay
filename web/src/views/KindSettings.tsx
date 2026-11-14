/**
 * @file The Songs and albums section of Settings: whether a long file is guessed an album.
 *
 * A file no one names the kind of is guessed an album when it is at least so many
 * minutes long; an admin sets the length or turns the guess off, and everyone sees it.
 * Each change saves on its own: the switch at once, the length once typing pauses.
 */

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { type Settings, api, newestOf } from "../api";
import { CHANGED_ELSEWHERE, notSaved, saveChange } from "../library/householdSettings";
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
    if (settings !== undefined) {
      latest.current = newestOf(latest.current, settings);
    }
  }, [settings]);

  const reload = (then = () => undefined) => {
    api.settings().then(
      (read) => {
        const newest = newestOf(latest.current, read);
        latest.current = newest;
        onSettings(newest);
        setDraft(draftOf(newest));
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

  const saving = useAutoSave(async (albumMinutes: number | null, notes) => {
    const base = latest.current;
    if (base === undefined || albumMinutes === base.album_minutes) {
      notes.tell("");
      return "unchanged";
    }
    try {
      const { outcome, settings: now } = await saveChange(base, { album_minutes: albumMinutes });
      latest.current = now;
      onSettings(now);
      if (outcome === "conflict") {
        setDraft(draftOf(now));
        notes.tell(CHANGED_ELSEWHERE);
        return "conflict";
      }
      onChanged();
      return "saved";
    } catch (failure) {
      notes.refuse(notSaved(failure));
      return "failed";
    }
  });

  const change = (next: Draft, typed: boolean) => {
    setDraft(next);
    const minutes = minutesOf(next);
    if (minutes === undefined) {
      saving.cancel();
    } else if (!saving.busy() && minutes === latest.current?.album_minutes) {
      saving.tell("");
    } else if (typed) {
      saving.later(minutes);
    } else {
      saving.now(minutes);
    }
  };
  /** Save what the field holds as it is left, or put back what is saved if it isn't a length. */
  const leave = () => {
    const minutes = minutesOf(draft);
    const saved = latest.current;
    if (minutes === undefined) {
      saving.cancel();
      if (saved !== undefined) {
        setDraft(draftOf(saved));
      }
      saving.refuse(`Not saved: type whole minutes from 1 to ${String(MAX_MINUTES)}.`);
    } else if (saving.busy() || minutes !== saved?.album_minutes) {
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
            leave();
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
              onBlur={leave}
            />
            minutes
          </label>
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
