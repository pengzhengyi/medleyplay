/**
 * @file *Split albums*, in Songs and albums: what becomes of a long file a song list was found for.
 *
 * An admin chooses, and the choice saves at once; everyone else reads it.
 */

import { useState } from "react";

import type { Settings, SplitAlbums } from "../api";
import {
  CHANGED_ELSEWHERE,
  type SettingsNotice,
  saveChange,
  settingsNotice,
  settingsFailure,
} from "../library/householdSettings";
import { useWords } from "../locale";

/** Each choice, its name, and what it does. */
const CHOICES: readonly {
  readonly value: SplitAlbums;
  readonly label: string;
  readonly about: string;
}[] = [
  {
    value: "off",
    label: "Off",
    about: "Long files stay as they are, and nothing is offered.",
  },
  {
    value: "approval",
    label: "Ask first",
    about: "A song list found for a long file waits in Clean up, to split or keep as one file.",
  },
  {
    value: "auto",
    label: "Auto",
    about:
      "A long file is split when its list can be trusted: the video's and the AI's agree, or one raises no doubt, even an AI's, whose starts are its estimates. The rest wait in Clean up, and the AI is asked in the background about files with no list.",
  },
];

/** The setting *Split albums*, changed by an admin. */
export function SplitSettings({
  admin,
  settings,
  onSettings,
}: {
  readonly admin: boolean;
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
  const chosen = CHOICES.find((choice) => choice.value === settings.split_albums) ?? CHOICES[1];

  const choose = async (value: SplitAlbums) => {
    setSaving(true);
    setNote("");
    setError(null);
    try {
      const { outcome, settings: now } = await saveChange(settings, { split_albums: value });
      onSettings(now);
      setNote(outcome === "conflict" ? CHANGED_ELSEWHERE : "Saved.");
    } catch (failure) {
      setError(settingsFailure(failure));
    } finally {
      setSaving(false);
    }
  };

  if (!admin) {
    return (
      <p>
        {t("Split albums: {{mode}}. {{help}}", {
          mode: t(chosen?.label ?? ""),
          help: t(chosen?.about ?? ""),
        })}{" "}
        {t("An admin changes this.")}
      </p>
    );
  }
  return (
    <fieldset className="split-albums" aria-busy={saving}>
      <legend>{t("Split albums")}</legend>
      {CHOICES.map((choice) => (
        <label key={choice.value} className="split-albums-choice">
          <input
            type="radio"
            name="split-albums"
            value={choice.value}
            checked={settings.split_albums === choice.value}
            disabled={saving}
            onChange={() => void choose(choice.value)}
          />
          <span>
            <strong>{t(choice.label)}</strong>
            <small>{t(choice.about)}</small>
          </span>
        </label>
      ))}
      {error !== null && <p role="alert">{settingsNotice(error, t)}</p>}
      <p className="hint saved" role="status">
        {t(note)}
      </p>
    </fieldset>
  );
}
