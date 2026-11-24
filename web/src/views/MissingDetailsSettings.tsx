/** @file The household's opt-in for AI suggestions in Clean up. */

import { useState } from "react";

import type { Settings } from "../api";
import { CHANGED_ELSEWHERE, notSaved, saveChange } from "../library/householdSettings";
import { useWords } from "../locale";

export function MissingDetailsSettings({
  settings,
  onSettings,
}: {
  readonly settings: Settings;
  readonly onSettings: (settings: Settings) => void;
}) {
  const t = useWords();
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const save = async (enabled: boolean) => {
    setSaving(true);
    setNote("");
    setError("");
    try {
      const saved = await saveChange(settings, { suggest_missing_details_by_ai: enabled });
      onSettings(saved.settings);
      setNote(saved.outcome === "conflict" ? CHANGED_ELSEWHERE : t("Saved."));
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
          aria-describedby="missing-details-ai-help"
          checked={settings.suggest_missing_details_by_ai}
          disabled={saving}
          onChange={(event) => void save(event.currentTarget.checked)}
        />
        {t("Suggest missing details with AI")}
      </label>
      <small id="missing-details-ai-help" className="hint">
        {t(
          "Lets listeners ask AI about one track at a time in Clean up. Nothing is sent until someone asks.",
        )}
      </small>
      {error !== "" && <p role="alert">{error}</p>}
      {note !== "" && (
        <p className="hint saved" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
