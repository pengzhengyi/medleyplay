/** @file The household's optional Tavily key for image searches. Only an admin changes it. */

import { useEffect, useRef, useState } from "react";

import { ApiError, api } from "../api";
import { classOf, useNote } from "../useNote";
import { useWords } from "../locale";

export function ImageSearchSettings() {
  const t = useWords();
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
    } catch (failure) {
      setError(keyError(failure, action));
    } finally {
      setSaving(undefined);
    }

    function keyError(failure: unknown, action: "save" | "remove"): string {
      if (failure instanceof ApiError) {
        const detail = failure.message;
        if (failure.status === 403 && detail === "Only an admin can change the picture search key.")
          return detail;
        if (
          action === "save" &&
          failure.status === 422 &&
          (detail === "A provider key must contain only ASCII characters." ||
            detail === "A key has no spaces or control characters." ||
            detail === "A key is from 4 to 512 characters.")
        )
          return detail;
      }
      return "Could not change the key. Try again.";
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
        {t(
          "Search for album covers and artist photos inside the editor with a household key. Searching Google Images needs no key.",
        )}
      </p>
      {(configured === false || editing) && (
        <>
          <label>
            {t("Tavily API key")}
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
            {t("Get a Tavily key")}
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
            {t("Change Key")}
          </button>
        ) : (
          <button
            type="submit"
            className="dialog-button"
            aria-busy={saving === "save"}
            disabled={saving !== undefined || key.trim() === "" || configured === undefined}
          >
            {t("Save key")}
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
            {t("Cancel")}
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
            {t("Remove Key")}
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {t(error)}
        </p>
      )}
      <p role="status" className={classOf(notes.note)}>
        {t(notes.note.text)}
      </p>
    </form>
  );
}
