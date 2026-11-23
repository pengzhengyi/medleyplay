/** @file The household's optional Tavily key for image searches. Only an admin changes it. */

import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import { classOf, useNote } from "../useNote";

export function ImageSearchSettings() {
  const [configured, setConfigured] = useState<boolean>();
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState<"save" | "remove">();
  const [error, setError] = useState("");
  const keyInput = useRef<HTMLInputElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
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
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (configured && !editing ? changeButton : keyInput).current?.focus();
  }, [configured, editing]);
  const change = async (action: "save" | "remove") => {
    setSaving(action);
    setError("");
    try {
      if (action === "remove") await api.removeImageSearchKey();
      else await api.saveImageSearchKey(key.trim());
      moveFocus.current = true;
      setConfigured(action === "save");
      setKey("");
      setEditing(false);
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
        if (key.trim() && saving === undefined && configured !== undefined) void change("save");
      }}
    >
      <p className="hint">
        Search for album covers and artist photos inside the editor with a household key. Searching
        Google Images needs no key.
      </p>
      {(configured === false || editing) && (
        <>
          <label>
            Tavily API key
            <input
              ref={keyInput}
              type="password"
              autoComplete="off"
              value={key}
              disabled={saving !== undefined}
              onChange={(event) => {
                setKey(event.currentTarget.value);
              }}
            />
          </label>
          <a href="https://app.tavily.com/" target="_blank" rel="noreferrer">
            Get a Tavily key
          </a>
        </>
      )}
      <div className="key-actions">
        {configured && !editing ? (
          <button
            ref={changeButton}
            type="button"
            className="dialog-button"
            disabled={saving !== undefined}
            onClick={() => {
              moveFocus.current = true;
              setError("");
              setEditing(true);
            }}
          >
            Change Key
          </button>
        ) : (
          <button
            type="submit"
            className="dialog-button"
            aria-busy={saving === "save"}
            disabled={saving !== undefined || key.trim() === "" || configured === undefined}
          >
            Save key
          </button>
        )}
        {editing && (
          <button
            type="button"
            className="secondary outline dialog-button"
            disabled={saving !== undefined}
            onClick={() => {
              moveFocus.current = true;
              setKey("");
              setError("");
              setEditing(false);
            }}
          >
            Cancel
          </button>
        )}
        {configured && !editing && (
          <button
            type="button"
            className="outline dialog-button remove-key"
            aria-busy={saving === "remove"}
            disabled={saving !== undefined}
            onClick={() => void change("remove")}
          >
            Remove Key
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
