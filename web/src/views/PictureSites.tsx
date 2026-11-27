/**
 * @file *Deezer*, in Settings: whether Deezer is asked for pictures of an artist, to choose
 * its photo from.
 *
 * Deezer is asked only when someone looks for a photo of an artist, or opens the page of
 * one with none, by the artist's name, through its public API. A second switch has an AI
 * model asked which picture is of the artist as soon as they are found, rather than when
 * someone asks, and a choice says which artists with no photo are looked up without anyone
 * asking, for Clean up to suggest a photo of each. Each choice saves at once.
 */

import { useState } from "react";

import type { PhotoSearch, Settings } from "../api";
import {
  CHANGED_ELSEWHERE,
  settingsFailure,
  settingsNotice,
  type SettingsNotice,
  saveChange,
} from "../library/householdSettings";
import { useWords } from "../locale";

/** Which artists with no photo are looked up without anyone asking, and what each means. */
const SEARCHES: readonly {
  readonly value: PhotoSearch;
  readonly label: string;
  readonly about: string;
}[] = [
  {
    value: "up_next",
    label: "Songs up next",
    about: "The artists of the song playing and the one after it.",
  },
  {
    value: "missing",
    label: "Every artist",
    about: "Every artist linked to MusicBrainz with no photo, a few requests at a time.",
  },
  { value: "off", label: "Only when asked", about: "Only an artist whose photo you look for." },
];

/** The switches that turn Deezer, and picking its pictures by AI, on or off, for an admin. */
export function PictureSites({
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
  const on = settings.picture_sites.includes("deezer");

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
          onChange={(event) => void save({ picture_sites: event.target.checked ? ["deezer"] : [] })}
        />
        {t("Find artist photos on Deezer")}
      </label>
      <small className="hint">
        {t(
          "Asked by the artist's name when you look for a photo of an artist, or open the page of one with none, a few requests at a time. A photo that fits is suggested there; nothing changes until you use one.",
        )}
      </small>
      <label className="lyrics-sites-switch">
        <input
          type="checkbox"
          role="switch"
          checked={settings.pick_pictures_by_ai}
          disabled={saving || !on}
          onChange={(event) => void save({ pick_pictures_by_ai: event.target.checked })}
        />
        {t("Pick by AI as soon as pictures are found")}
      </label>
      <small className="hint">
        {t(
          "Off, the AI is asked only when you press Pick by AI. On, it is asked once for each artist whose pictures are found, which your AI provider may charge for.",
        )}
      </small>
      <fieldset className="split-albums" disabled={saving || !on}>
        <legend>{t("Look up photos of artists with none")}</legend>
        {SEARCHES.map((search) => (
          <label key={search.value} className="split-albums-choice">
            <input
              type="radio"
              name="find-artist-photos"
              value={search.value}
              checked={settings.find_artist_photos === search.value}
              onChange={() => void save({ find_artist_photos: search.value })}
            />
            <span>
              <strong>{t(search.label)}</strong>
              <small>{t(search.about)}</small>
            </span>
          </label>
        ))}
        <small className="hint">
          {t("A photo found for each waits in Clean up, to use in one click.")}
        </small>
      </fieldset>
      {error !== null && <p role="alert">{settingsNotice(error, t)}</p>}
      <p className="hint saved" role="status">
        {t(note)}
      </p>
    </div>
  );
}
