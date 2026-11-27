/**
 * @file The Lyrics section's switches: whether NetEase is asked for the lyrics LRCLIB lacks,
 * and whether a song no site has lyrics for shows the nearest song's, suggested.
 *
 * NetEase offers no public API, so medleyplay asks only its plain endpoints, as itself; a
 * refusal stops looking lyrics up until an admin resets it. The choice saves at once.
 */

import { useState } from "react";

import type { LyricsSite, Settings } from "../api";
import {
  CHANGED_ELSEWHERE,
  type SettingsNotice,
  saveChange,
  settingsNotice,
  settingsFailure,
} from "../library/householdSettings";
import { useWords } from "../locale";

/** The switches that turn NetEase and suggestions on or off, for an admin. */
export function LyricsSites({
  settings,
  onSettings,
}: {
  /** The household's settings as last read, shared with the other sections that save them. */
  readonly settings: Settings | undefined;
  readonly onSettings: (settings: Settings) => void;
}) {
  const t = useWords();
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<SettingsNotice>(null);
  if (settings === undefined) {
    return null;
  }
  const on = settings.lyrics_sites.includes("netease");

  const save = async (change: Partial<Settings>) => {
    setSaving(true);
    setNote("");
    setError(null);
    try {
      const { outcome, settings: now } = await saveChange(settings, change);
      onSettings(now);
      setNote(outcome === "conflict" ? CHANGED_ELSEWHERE : "Saved.");
    } catch (failure) {
      setError(settingsFailure(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lyrics-sites" aria-busy={saving}>
      <label className="lyrics-sites-switch">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          disabled={saving}
          onChange={(event) => {
            const sites: readonly LyricsSite[] = event.target.checked ? ["netease"] : [];
            void save({ lyrics_sites: sites });
          }}
        />
        {t("Also look on NetEase Cloud Music")}
      </label>
      <small className="hint">
        {t(
          "Asked for a song LRCLIB has no lyrics for, by its title and artist, once a second at most; turning it on looks those songs up again. NetEase has no public API, so it may stop answering.",
        )}
      </small>
      <label className="lyrics-sites-switch">
        <input
          type="checkbox"
          role="switch"
          checked={settings.suggest_lyrics}
          disabled={saving}
          onChange={(event) => void save({ suggest_lyrics: event.target.checked })}
        />
        {t("Suggest lyrics that nearly match")}
      </label>
      <small className="hint">
        {t(
          "If no site has a song's lyrics, suggest a close match from LRCLIB based on the title, artist, and duration when known. You can save or dismiss lyrics tagged Found on the web.",
        )}
      </small>
      {error !== null && <p role="alert">{settingsNotice(error, t)}</p>}
      <p className="hint saved" role="status">
        {t(note)}
      </p>
    </div>
  );
}
