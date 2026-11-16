/**
 * @file *Split albums*, in Songs and albums: what becomes of a long file a song list was found for.
 *
 * An admin chooses, and the choice saves at once; everyone else reads it.
 */

import { useState } from "react";

import type { Settings, SplitAlbums } from "../api";
import { CHANGED_ELSEWHERE, notSaved, saveChange } from "../library/householdSettings";

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
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  if (settings === undefined) {
    return null;
  }
  const chosen = CHOICES.find((choice) => choice.value === settings.split_albums) ?? CHOICES[1];

  const choose = async (value: SplitAlbums) => {
    setSaving(true);
    setNote("");
    setError("");
    try {
      const { outcome, settings: now } = await saveChange(settings, { split_albums: value });
      onSettings(now);
      setNote(outcome === "conflict" ? CHANGED_ELSEWHERE : "Saved.");
    } catch (failure) {
      setError(notSaved(failure));
    } finally {
      setSaving(false);
    }
  };

  if (!admin) {
    return (
      <p>{`Split albums: ${chosen?.label ?? ""}. ${chosen?.about ?? ""}`} An admin changes this.</p>
    );
  }
  return (
    <fieldset className="split-albums" aria-busy={saving}>
      <legend>Split albums</legend>
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
            <strong>{choice.label}</strong>
            <small>{choice.about}</small>
          </span>
        </label>
      ))}
      {error !== "" && <p role="alert">{error}</p>}
      <p className="hint saved" role="status">
        {note}
      </p>
    </fieldset>
  );
}
