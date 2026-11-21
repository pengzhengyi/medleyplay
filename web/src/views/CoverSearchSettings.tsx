/**
 * @file Album covers, in Settings → MusicBrainz: which albums with no cover MusicBrainz is
 * searched for without anyone asking, and whether an AI model picks among the covers found.
 *
 * An album's page searches it when opened whatever is chosen here; the choice says which
 * others are searched, for Clean up to suggest a cover of each. Each choice saves at once.
 */

import { useState } from "react";

import type { CoverSearch, Settings } from "../api";
import { CHANGED_ELSEWHERE, notSaved, saveChange } from "../library/householdSettings";

/** Which albums with no cover are searched without anyone asking, and what each means. */
const SEARCHES: readonly {
  readonly value: CoverSearch;
  readonly label: string;
  readonly about: string;
}[] = [
  {
    value: "up_next",
    label: "Songs up next",
    about: "The albums of the song playing and the one after it.",
  },
  {
    value: "missing",
    label: "Every album",
    about: "Every album with no cover, one at a time while MusicBrainz is otherwise idle.",
  },
  { value: "off", label: "Only when asked", about: "Only an album whose page you open." },
];

/** The choice of albums searched for covers, and the switch for the AI's pick, for an admin. */
export function CoverSearchSettings({
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
      <fieldset className="split-albums" disabled={saving}>
        <legend>Find covers of albums with none</legend>
        {SEARCHES.map((search) => (
          <label key={search.value} className="split-albums-choice">
            <input
              type="radio"
              name="find-album-covers"
              value={search.value}
              checked={settings.find_album_covers === search.value}
              onChange={() => void save({ find_album_covers: search.value })}
            />
            <span>
              <strong>{search.label}</strong>
              <small>{search.about}</small>
            </span>
          </label>
        ))}
        <small className="hint">
          A cover that fits waits on the album's page and in Clean up, to use in one click.
        </small>
      </fieldset>
      <label className="lyrics-sites-switch">
        <input
          type="checkbox"
          role="switch"
          checked={settings.pick_album_covers_by_ai}
          disabled={saving}
          onChange={(event) => void save({ pick_album_covers_by_ai: event.target.checked })}
        />
        Pick covers by AI when none plainly fits
      </label>
      <small className="hint">
        Off, the AI is asked only in the cover editor. On, it is asked once for each album whose
        covers were found but none has its title and artist, which your AI provider may charge for.
      </small>
      {error !== "" && <p role="alert">{error}</p>}
      <p className="hint saved" role="status">
        {note}
      </p>
    </div>
  );
}
