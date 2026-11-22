/**
 * @file The Lyrics section's switches: whether NetEase is asked for the lyrics LRCLIB lacks,
 * and whether a song no site has lyrics for shows the nearest song's, suggested.
 *
 * NetEase offers no public API, so medleyplay asks only its plain endpoints, as itself; a
 * refusal stops looking lyrics up until an admin resets it. The choice saves at once.
 */

import { useState } from "react";

import type { LyricsSite, Settings } from "../api";
import { CHANGED_ELSEWHERE, notSaved, saveChange } from "../library/householdSettings";

/** The switches that turn NetEase and suggestions on or off, for an admin. */
export function LyricsSites({
  settings,
  onSettings,
}: {
  /** The household's settings as last read, shared with the other sections that save them. */
  readonly settings: Settings | undefined;
  readonly onSettings: (settings: Settings) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  if (settings === undefined) {
    return null;
  }
  const on = settings.lyrics_sites.includes("netease");

  const save = async (change: Partial<Settings>) => {
    setSaving(true);
    setNote("");
    setError("");
    try {
      const { outcome, settings: now } = await saveChange(settings, change);
      onSettings(now);
      setNote(outcome === "conflict" ? CHANGED_ELSEWHERE : "Saved.");
    } catch (failure) {
      setError(notSaved(failure));
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
        Also look on NetEase Cloud Music
      </label>
      <small className="hint">
        Asked for a song LRCLIB has no lyrics for, by its title and artist, once a second at most;
        turning it on looks those songs up again. NetEase has no public API, so it may stop
        answering.
      </small>
      <label className="lyrics-sites-switch">
        <input
          type="checkbox"
          role="switch"
          checked={settings.suggest_lyrics}
          disabled={saving}
          onChange={(event) => void save({ suggest_lyrics: event.target.checked })}
        />
        Suggest lyrics that nearly match
      </label>
      <small className="hint">
        A song no site has lyrics for shows those of the nearest song LRCLIB has, of the same title
        and nearly as long, tagged Found on the web, to save or dismiss.
      </small>
      {error !== "" && <p role="alert">{error}</p>}
      <p className="hint saved" role="status">
        {note}
      </p>
    </div>
  );
}
