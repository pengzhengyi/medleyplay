/** @file The household's optional Tavily key for image searches. Only an admin changes it. */

import { useEffect, useState } from "react";

import { api } from "../api";
import { classOf, useNote } from "../useNote";

export function ImageSearchSettings() {
  const [configured, setConfigured] = useState<boolean>();
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState<"save" | "remove">();
  const [error, setError] = useState("");
  const notes = useNote();
  useEffect(() => {
    let active = true;
    api.imageSearch().then(
      (answer) => {
        if (active) setConfigured(answer.configured);
      },
      () => {
        if (active) setError("Could not read the image search setting.");
      },
    );
    return () => {
      active = false;
    };
  }, []);
  const change = async (action: "save" | "remove") => {
    setSaving(action);
    setError("");
    try {
      if (action === "remove") await api.removeImageSearchKey();
      else await api.saveImageSearchKey(key.trim());
      setConfigured(action === "save");
      setKey("");
      notes.confirm(action === "save" ? "Saved." : "Key removed.");
    } catch {
      setError("Could not change the key. Try again.");
    } finally {
      setSaving(undefined);
    }
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void change("save");
      }}
    >
      <p className="hint">
        Search for album covers inside the editor with a household key. Searching Google Images
        needs no key.
      </p>
      <label>
        Tavily API key
        <input
          type="password"
          autoComplete="off"
          value={key}
          disabled={saving !== undefined}
          placeholder={configured ? "Key saved" : undefined}
          onChange={(event) => {
            setKey(event.currentTarget.value);
          }}
        />
      </label>
      <a href="https://app.tavily.com/" target="_blank" rel="noreferrer">
        Get a Tavily key
      </a>
      <div className="upload-drop-buttons">
        <button
          type="submit"
          className="dialog-button"
          aria-busy={saving === "save"}
          disabled={saving !== undefined || key.trim() === "" || configured === undefined}
        >
          Save key
        </button>
        {configured && (
          <button
            type="button"
            className="secondary outline dialog-button"
            aria-busy={saving === "remove"}
            disabled={saving !== undefined}
            onClick={() => void change("remove")}
          >
            Remove key
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p role="status" className={classOf(notes.note)}>
        {notes.note.text}
      </p>
    </form>
  );
}
