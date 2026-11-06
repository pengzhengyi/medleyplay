/**
 * @file The heart in an artist's or album's heading, which favorites it.
 *
 * When the Account already loves several of its songs, landing on its page the
 * first time suggests it: the heart beats three times and a short note says why,
 * then the note goes. Pointing at or focusing the heart keeps the note.
 */

import { HeartIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";

/** How long the note stays once nothing points at it. */
const NOTE_MS = 6000;
const SUGGESTED = "medleyplay.suggested";

/** Whether this browser already suggested the group `key` names. */
function suggestedBefore(key: string): boolean {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SUGGESTED) ?? "[]");
    return Array.isArray(saved) && saved.includes(key);
  } catch {
    return false;
  }
}

function rememberSuggested(key: string) {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SUGGESTED) ?? "[]");
    const keys = Array.isArray(saved) ? saved.filter((each) => typeof each === "string") : [];
    localStorage.setItem(SUGGESTED, JSON.stringify([...new Set([...keys, key])]));
  } catch {
    // Without storage, the suggestion may come again on a later visit.
  }
}

export function FavoriteHeart({
  kind,
  name,
  favorite,
  onChange,
  loved,
  suggestionKey,
}: {
  readonly kind: "artist" | "album";
  /** What the heart favorites, as its heading shows it. */
  readonly name: string;
  readonly favorite: boolean;
  readonly onChange: (favorite: boolean) => void;
  /** How many of its songs are favorites when that suggests favoriting it, else 0. */
  readonly loved: number;
  /** The Account and group, so each is suggested once, such as `7:artist:朴树`. */
  readonly suggestionKey: string;
}) {
  const noteId = useId();
  // Decided on landing: a heart given later, or songs loved later, don't bring it up.
  const [suggesting] = useState(() => loved > 0 && !favorite && !suggestedBefore(suggestionKey));
  const [noteShown, setNoteShown] = useState(suggesting);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const hideLater = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setNoteShown(false);
    }, NOTE_MS);
  };
  const keep = () => {
    clearTimeout(timer.current);
  };

  useEffect(() => {
    if (!suggesting) {
      return undefined;
    }
    rememberSuggested(suggestionKey);
    hideLater();
    return keep;
    // Once, on landing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showNote = noteShown && !favorite;
  return (
    <span
      className="favorite-group"
      onPointerEnter={showNote ? keep : undefined}
      onPointerLeave={showNote ? hideLater : undefined}
    >
      <button
        type="button"
        className={[
          "icon heart favorite-heart",
          favorite ? "on" : "",
          suggesting && !favorite ? "beat" : "",
        ].join(" ")}
        aria-label={`Favorite ${kind} ${name}`}
        aria-pressed={favorite}
        aria-describedby={showNote ? noteId : undefined}
        title={favorite ? "Favorite" : "Not a favorite"}
        onFocus={showNote ? keep : undefined}
        onBlur={showNote ? hideLater : undefined}
        onClick={() => {
          onChange(!favorite);
        }}
      >
        <HeartIcon weight={favorite ? "fill" : "regular"} aria-hidden />
      </button>
      <span role="status" className="favorite-note" id={noteId}>
        {showNote && `${String(loved)} songs you love`}
      </span>
    </span>
  );
}
