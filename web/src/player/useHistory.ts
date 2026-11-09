/**
 * @file The Account's History: the songs it played, newest first, as many as it chose to see.
 *
 * It loads while shown: when shown, when the page is shown again, and after the
 * server accepts a play this page sent. Plays made on other devices show on the next
 * of these. How many songs it shows is one of the Account's preferences.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, DEFAULT_HISTORY_LENGTH, type HistoryLength, type Played, api } from "../api";
import { onPlaysRecorded } from "./plays";

export interface History {
  /** The plays, newest first; `undefined` until they load. */
  readonly plays: readonly Played[] | undefined;
  /** Why the plays couldn't load or be cleared, or `""`. */
  readonly failure: string;
  readonly length: HistoryLength;
  /** Why the length couldn't be saved, or `""`; the length is then as it was. */
  readonly lengthFailure: string;
  readonly setLength: (length: HistoryLength) => void;
  /** Clear History on every device; play counts stay. */
  readonly clear: () => Promise<void>;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The Account's History, loaded while `shown`. */
export function useHistory(shown: boolean): History {
  const [plays, setPlays] = useState<readonly Played[] | undefined>(undefined);
  const [failure, setFailure] = useState("");
  const [length, setShownLength] = useState<HistoryLength | undefined>(undefined);
  const [lengthFailure, setLengthFailure] = useState("");
  // The revision the preferences were last read at, to save the length at.
  const revision = useRef(0);
  // The latest load asked, so an older answer can't land after it.
  const asked = useRef(0);

  useEffect(() => {
    if (!shown || length !== undefined) {
      return undefined;
    }
    let live = true;
    api.preferences().then(
      (preferences) => {
        if (live) {
          revision.current = preferences.revision;
          setShownLength(preferences.history_length ?? DEFAULT_HISTORY_LENGTH);
        }
      },
      () => {
        if (live) {
          setShownLength(DEFAULT_HISTORY_LENGTH);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [shown, length]);

  const load = useCallback((limit: HistoryLength) => {
    const ask = ++asked.current;
    api.history(limit).then(
      (answer) => {
        if (ask === asked.current) {
          setFailure("");
          setPlays(answer);
        }
      },
      (error: unknown) => {
        if (ask === asked.current) {
          setFailure(messageOf(error));
        }
      },
    );
  }, []);

  useEffect(() => {
    if (!shown || length === undefined) {
      return undefined;
    }
    load(length);
    const again = () => {
      load(length);
    };
    const whenVisible = () => {
      if (document.visibilityState === "visible") {
        again();
      }
    };
    const stop = onPlaysRecorded(again);
    document.addEventListener("visibilitychange", whenVisible);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", whenVisible);
    };
  }, [shown, length, load]);

  const setLength = (chosen: HistoryLength) => {
    const was = length;
    setShownLength(chosen);
    setLengthFailure("");
    const save = async () => {
      try {
        return await api.savePreferences({ history_length: chosen, revision: revision.current });
      } catch (error) {
        // Saved since, perhaps from another device: save the length at the revision now.
        if (!(error instanceof ApiError && error.status === 409)) {
          throw error;
        }
        const { revision: now } = await api.preferences();
        return await api.savePreferences({ history_length: chosen, revision: now });
      }
    };
    save().then(
      (saved) => {
        revision.current = saved.revision;
      },
      (error: unknown) => {
        setShownLength(was);
        setLengthFailure(`The length wasn't saved: ${messageOf(error)}`);
      },
    );
  };

  const clear = async () => {
    try {
      await api.clearHistory();
      asked.current += 1;
      setFailure("");
      setPlays([]);
    } catch (error) {
      setFailure(messageOf(error));
    }
  };

  return {
    plays,
    failure,
    length: length ?? DEFAULT_HISTORY_LENGTH,
    lengthFailure,
    setLength,
    clear,
  };
}
