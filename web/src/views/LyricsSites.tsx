/**
 * @file *NetEase Cloud Music*, in the Lyrics section: whether NetEase is asked for the lyrics
 * LRCLIB lacks.
 *
 * NetEase offers no public API, so medleyplay asks only its plain endpoints, as itself; a
 * refusal stops looking lyrics up until an admin resets it. The choice saves at once.
 */

import { useState } from "react";

import type { LyricsSite, Settings } from "../api";
import { CHANGED_ELSEWHERE, notSaved, saveChange } from "../library/householdSettings";

/** The switch that turns NetEase on or off, for an admin. */
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

  const turn = async (netease: boolean) => {
    setSaving(true);
    setNote("");
    setError("");
    const sites: readonly LyricsSite[] = netease ? ["netease"] : [];
    try {
      const { outcome, settings: now } = await saveChange(settings, { lyrics_sites: sites });
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
          onChange={(event) => void turn(event.target.checked)}
        />
        Also look on NetEase Cloud Music
      </label>
      <small className="hint">
        Asked for a song LRCLIB has no lyrics for, by its title and artist, once a second at most;
        turning it on looks those songs up again. NetEase has no public API, so it may stop
        answering.
      </small>
      {error !== "" && <p role="alert">{error}</p>}
      <p className="hint saved" role="status">
        {note}
      </p>
    </div>
  );
}
