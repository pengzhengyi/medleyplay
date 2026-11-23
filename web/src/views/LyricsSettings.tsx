/**
 * @file The Lyrics section of Settings, for an admin: when a song's lyrics are looked up on
 * LRCLIB, and a reset after LRCLIB refused a request.
 *
 * Lyrics are looked up as songs come up by default, so the song playing has them; every
 * song at once is not offered, as that would ask a free service about the whole Library.
 */

import { useEffect, useId, useState } from "react";

import {
  api,
  ApiError,
  LYRICS_ENRICHER,
  type LyricsMatchConfirmation,
  type Preferences,
} from "../api";
import { useWords } from "../locale";
import { classOf, useNote } from "../useNote";
import { EnricherSettings, type EnricherWords } from "./EnricherSettings";

const WORDS: EnricherWords = {
  enricher: LYRICS_ENRICHER,
  site: "LRCLIB",
  heading: "Song lyrics",
  description: (
    <>
      Looks up a song&apos;s lyrics on LRCLIB (lrclib.net), an open lyrics database, sending its
      title, artist, album, and length, at most once a second. A song whose lyrics you entered, or
      whose files hold them, is never looked up; one LRCLIB does not know is asked again a month
      later.
    </>
  ),
  count: (tracks) =>
    tracks === 1
      ? "1 song's lyrics can be looked up."
      : `${String(tracks)} songs' lyrics can be looked up.`,
  off: "Looking up lyrics is turned off.",
  modes: ["next", "manual"],
};

/** When lyrics are looked up, how many songs can be, and a reset once stopped. */
export function LyricsSettings({ onChanged }: { readonly onChanged?: (() => void) | undefined }) {
  return <EnricherSettings words={WORDS} onChanged={onChanged} />;
}

/** Whether this Account is asked before Auto-Match searches saved album songs. */
export function LyricsMatchSettings() {
  const t = useWords();
  const hint = useId();
  const notes = useNote();
  const [preferences, setPreferences] = useState<Preferences>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let open = true;
    api.preferences().then(
      (read) => {
        if (open) setPreferences(read);
      },
      () => {
        if (open) setLoadFailed(true);
      },
    );
    return () => {
      open = false;
    };
  }, []);

  const save = async (choice: LyricsMatchConfirmation) => {
    if (preferences === undefined || saving) return;
    setSaving(true);
    notes.tell(t("Saving…"));
    try {
      const saved = await api.savePreferences({
        lyrics_match_confirmation: choice,
        revision: preferences.revision,
      });
      setPreferences(saved);
      notes.confirm(t("Saved."));
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) {
        const latest = await api.preferences().catch(() => undefined);
        setPreferences(latest);
        setLoadFailed(latest === undefined);
        notes.refuse(t("Your preferences changed before this was saved. Choose again."));
      } else {
        const reason = failure instanceof Error ? failure.message : String(failure);
        notes.refuse(t("Not saved: {{reason}}", { reason }));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <label>
        {t("Auto-Match lyrics")}
        <select
          value={preferences?.lyrics_match_confirmation ?? "ask"}
          aria-describedby={hint}
          disabled={preferences === undefined || saving}
          onChange={(event) => void save(event.currentTarget.value === "direct" ? "direct" : "ask")}
        >
          <option value="ask">{t("Ask before searching")}</option>
          <option value="direct">{t("Search directly")}</option>
        </select>
      </label>
      <p className="hint" id={hint}>
        {t("This choice is kept with your account. Searching from Songs may make paid AI calls.")}
      </p>
      <p className={classOf(notes.note, "hint saved")} role="status">
        {loadFailed
          ? t("Could not load your preference. Reopen Settings to try again.")
          : notes.note.text}
      </p>
    </div>
  );
}
