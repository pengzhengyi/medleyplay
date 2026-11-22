/**
 * @file A note to ask the AI with, opened beside an *Ask AI* button: the household's notes
 * for that kind of ask, each ticked to send, and more details typed, which this browser
 * remembers for the next time. Each note sent is a line of its own.
 */

import { SparkleIcon } from "@phosphor-icons/react";
import { useEffect, useId, useState } from "react";

import { type AiAsk, type AiNote, MAX_HINT, api } from "../api";
import { noteOf } from "../library/aiNote";

/** Where this browser keeps the details last typed for each ask. */
const REMEMBERED = "medleyplay.aiNote.";

/** What each ask's details field suggests typing. */
const EXAMPLES: Readonly<Record<AiAsk, string>> = {
  details: "It's Taylor Swift's 1989, the 2014 album",
  songs: "It's the 2007 concert, with 22 songs",
};

/** The notes the household offers for `ask`, to tick and send to the AI through `onAsk`. */
export function AiNotePanel({
  ask,
  onAsk,
  onClose,
}: {
  readonly ask: AiAsk;
  readonly onAsk: (note: string) => void;
  readonly onClose: () => void;
}) {
  const id = useId();
  const [offered, setOffered] = useState<readonly AiNote[] | undefined>(undefined);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const [details, setDetails] = useState(() => localStorage.getItem(REMEMBERED + ask) ?? "");
  useEffect(() => {
    let shown = true;
    api.settings().then(
      (settings) => {
        if (shown) {
          setOffered(settings.ai_notes.filter((note) => note.ask === ask));
        }
      },
      () => {
        // With the notes unread, the details can still be typed.
        if (shown) {
          setOffered([]);
        }
      },
    );
    return () => {
      shown = false;
    };
  }, [ask]);
  const note = noteOf(
    (offered ?? []).filter((each) => ticked.has(each.text)).map((each) => each.text),
    details,
  );
  const over = note.length > MAX_HINT;
  const submit = () => {
    if (over) {
      return;
    }
    localStorage.setItem(REMEMBERED + ask, details.trim());
    onAsk(note);
  };
  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      className="ai-note"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <p id={`${id}-title`} className="ai-note-title">
        Ask AI with a note
      </p>
      {offered === undefined ? (
        <p className="hint">Reading the household's notes…</p>
      ) : (
        offered.map((each) => (
          <label key={each.text} className="ai-note-choice">
            <input
              type="checkbox"
              checked={ticked.has(each.text)}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setTicked((before) => {
                  const after = new Set(before);
                  if (checked) {
                    after.add(each.text);
                  } else {
                    after.delete(each.text);
                  }
                  return after;
                });
              }}
            />
            <span>{each.text}</span>
          </label>
        ))
      )}
      <label htmlFor={`${id}-details`} className="detail-label">
        More details
      </label>
      <textarea
        id={`${id}-details`}
        className="detail-input ai-note-details"
        rows={2}
        value={details}
        placeholder={EXAMPLES[ask]}
        aria-describedby={`${id}-count`}
        // The panel opens to type the note at once; the notes to tick are a Shift+Tab away.
        autoFocus
        onChange={(event) => {
          setDetails(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="ai-note-foot">
        <small id={`${id}-count`} className={over ? "ai-note-count over" : "ai-note-count"}>
          {`${String(note.length)} of ${String(MAX_HINT)} characters`}
        </small>
        <button type="button" className="ai-note-ask" disabled={over} onClick={submit}>
          <SparkleIcon aria-hidden /> Ask AI
        </button>
      </div>
    </div>
  );
}
