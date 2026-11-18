/**
 * @file *Deezer*, in Settings: whether Deezer is asked for pictures of an artist, to choose
 * its photo from.
 *
 * Deezer is asked only when someone looks for a photo of an artist, by the artist's name,
 * through its public API. The choice saves at once.
 */

import { useState } from "react";

import type { PictureSite, Settings } from "../api";
import { CHANGED_ELSEWHERE, notSaved, saveChange } from "../library/householdSettings";

/** The switch that turns Deezer on or off, for an admin. */
export function PictureSites({
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
  const on = settings.picture_sites.includes("deezer");

  const turn = async (deezer: boolean) => {
    setSaving(true);
    setNote("");
    setError("");
    const sites: readonly PictureSite[] = deezer ? ["deezer"] : [];
    try {
      const { outcome, settings: now } = await saveChange(settings, { picture_sites: sites });
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
        Find artist photos on Deezer
      </label>
      <small className="hint">
        Asked by the artist's name when you look for a photo of an artist, a few requests at a time.
        What Deezer has shows beside the other ways to add a photo; nothing changes until you use
        one.
      </small>
      {error !== "" && <p role="alert">{error}</p>}
      <p className="hint saved" role="status">
        {note}
      </p>
    </div>
  );
}
