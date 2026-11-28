/**
 * @file Combines selected household notes and typed details for one AI request.
 */

import { SparkleIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";

import { type AiAsk, type AiNote, MAX_HINT, api } from "../api";
import { composing } from "../ime";
import { noteOf } from "../library/aiNote";
import { useFormattingLocale, useWords } from "../locale";

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
  const field = useRef<HTMLTextAreaElement>(null);
  const t = useWords();
  const number = new Intl.NumberFormat(useFormattingLocale());
  const [offered, setOffered] = useState<readonly AiNote[] | null | undefined>(undefined);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const [details, setDetails] = useState("");
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
          setOffered(null);
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
  const characters = Array.from(note).length;
  const over = characters > MAX_HINT;
  const submit = () => {
    if (over) {
      return;
    }
    onAsk(note);
    setDetails("");
  };
  const clear = () => {
    setDetails("");
    field.current?.focus();
  };
  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      className="ai-note"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (composing(event.nativeEvent)) return;
          event.preventDefault();
          onClose();
        }
      }}
    >
      <p id={`${id}-title`} className="ai-note-title">
        {t("Ask AI with a note")}
      </p>
      <p className="hint">
        {t(
          "The selected notes and any details you type go with this request. The details field clears after you send the request.",
        )}
      </p>
      {offered === undefined ? (
        <p className="hint" aria-busy="true">
          {t("Reading the household's notes…")}
        </p>
      ) : offered === null ? (
        <p className="hint" role="status">
          {t("Could not read the household's notes. You can still type details below.")}
        </p>
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
      <div className="ai-note-field-heading">
        <label htmlFor={`${id}-details`} className="detail-label">
          {t("More details")}
        </label>
        <button
          type="button"
          className="text ai-note-clear"
          aria-label={t("Clear details")}
          disabled={details === ""}
          onClick={clear}
        >
          {t("Clear")}
        </button>
      </div>
      <textarea
        ref={field}
        id={`${id}-details`}
        className="detail-input ai-note-details"
        rows={2}
        value={details}
        placeholder={t(EXAMPLES[ask])}
        aria-describedby={`${id}-count`}
        autoFocus
        onChange={(event) => {
          setDetails(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !composing(event.nativeEvent)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="ai-note-foot">
        <small id={`${id}-count`} className={over ? "ai-note-count over" : "ai-note-count"}>
          {t("{{used}} of {{limit}} characters", {
            used: number.format(characters),
            limit: number.format(MAX_HINT),
          })}
        </small>
        <button type="button" className="ai-note-ask" disabled={over} onClick={submit}>
          <SparkleIcon aria-hidden /> {t("Ask AI")}
        </button>
      </div>
    </div>
  );
}
