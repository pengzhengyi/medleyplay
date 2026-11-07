/**
 * @file A note beside a control: a confirmation fades, while a refusal or a conflict stays.
 *
 * A confirmation such as *Saved.* says what just happened and needs no answer,
 * so it fades and clears after a few seconds. What the person must read or act
 * on stays until the next note.
 */

import { useEffect, useRef, useState } from "react";

/** How long a confirmation shows, its fade included. */
export const CONFIRMED_MS = 4000;
/** How long a confirmation takes to fade, at the end of `CONFIRMED_MS`. */
export const FADE_MS = 600;

/** The note shown: its text, `""` for none, and whether it is a refusal or fading. */
export interface Note {
  readonly text: string;
  readonly refused: boolean;
  readonly fading: boolean;
}

const QUIET: Note = { text: "", refused: false, fading: false };

/** A note, and the ways to change it. */
export interface Notes {
  readonly note: Note;
  /** Confirm what just happened, as *Saved.*; it fades and clears. */
  readonly confirm: (text: string) => void;
  /** Say what the person should read, as a conflict; it stays. `""` clears the note. */
  readonly tell: (text: string) => void;
  /** Say why something was refused; it stays. */
  readonly refuse: (text: string) => void;
}

/** Keep a note beside a control, fading each confirmation. */
export function useNote(): Notes {
  const [note, setNote] = useState<Note>(QUIET);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stop = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => stop, []);

  const stay = (text: string, refused: boolean) => {
    stop();
    setNote({ text, refused, fading: false });
  };
  return {
    note,
    confirm: (text) => {
      stay(text, false);
      timers.current = [
        setTimeout(() => {
          setNote({ text, refused: false, fading: true });
        }, CONFIRMED_MS - FADE_MS),
        setTimeout(() => {
          setNote(QUIET);
        }, CONFIRMED_MS),
      ];
    },
    tell: (text) => {
      stay(text, false);
    },
    refuse: (text) => {
      stay(text, true);
    },
  };
}

/** Return the classes of a note's element: `base`, then whether it is refused or fading. */
export function classOf(note: Note, base = "hint"): string {
  return [base, note.refused && "refused", note.fading && "fading"].filter(Boolean).join(" ");
}
