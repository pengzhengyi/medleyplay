/**
 * @file The pictures Deezer has of an artist, read from the server, with a way to look
 * again, to ask an AI model which is of the artist, and to dismiss the one suggested.
 *
 * Read, an artist never looked up is looked up at once, once Deezer is on; and, when the
 * household has a model asked as soon as pictures are found, a model is asked, once.
 * While Deezer or a model is asked, it is read again every few seconds.
 */

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { type ArtistPictures, api } from "../api";
import { useAiSetUp } from "./aiSetUp";

const READ_EVERY_MS = 2000;

/** Say why a request failed, in the server's words when it gave some. */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * What is known of the pictures of the artist `artistId`, why a request failed, and a way
 * to look on Deezer again, to ask a model which is of the artist, with a note, and to
 * dismiss a picture suggested.
 */
export function useArtistPictures(artistId: string): {
  readonly state: ArtistPictures | undefined;
  readonly error: string;
  readonly choiceError: string;
  readonly readError: string;
  readonly retryRead: () => void;
  readonly find: () => void;
  readonly choose: (hint: string) => void;
  readonly dismiss: (cover: string) => void;
} {
  const [state, setState] = useState<ArtistPictures>();
  // Counts the reads asked for, so each asks the server again.
  const [reads, setReads] = useState(0);
  const [error, setError] = useState("");
  const [choiceError, setChoiceError] = useState("");
  const [readError, setReadError] = useState("");
  const noAi = useAiSetUp();
  // Deezer is looked to, and a model asked, once on its own; then only when asked to.
  const found = useRef(false);
  const asked = useRef(false);
  const readAgain = () => {
    setReads((count) => count + 1);
  };
  const find = () => {
    found.current = true;
    setError("");
    setChoiceError("");
    setState((was) => (was === undefined ? was : { ...was, finding: true, failure: null }));
    api.findArtistPictures(artistId).then(readAgain, (failure: unknown) => {
      setError(messageOf(failure));
      readAgain();
    });
  };
  const choose = (hint: string) => {
    asked.current = true;
    noAi.whenSetUp(() => {
      setChoiceError("");
      setState((was) =>
        was === undefined ? was : { ...was, choosing: true, choice_failure: null },
      );
      api.chooseArtistPicture(artistId, hint).then(readAgain, (failure: unknown) => {
        setChoiceError(messageOf(failure));
        readAgain();
      });
    });
  };
  const dismiss = (cover: string) => {
    setError("");
    setState((was) => (was === undefined ? was : { ...was, suggested: null }));
    api.dismissArtistPicture(artistId, cover).then(readAgain, (failure: unknown) => {
      setError(messageOf(failure));
      readAgain();
    });
  };
  const onRead = useEffectEvent((known: ArtistPictures) => {
    setState(known);
    if (
      known.may_find &&
      !found.current &&
      known.found_at === null &&
      !known.finding &&
      known.failure === null
    ) {
      find();
    } else if (
      known.auto_pick &&
      known.may_choose &&
      !asked.current &&
      known.pictures.length > 1 &&
      known.pick === null &&
      !known.choosing &&
      known.choice_failure === null
    ) {
      choose("");
    }
  });
  useEffect(() => {
    let current = true;
    api.artistPictures(artistId).then(
      (known) => {
        if (current) {
          setReadError("");
          onRead(known);
        }
      },
      (failure: unknown) => {
        if (current) {
          setReadError(messageOf(failure));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [artistId, reads]);
  useEffect(() => {
    if (readError !== "" || (state?.finding !== true && state?.choosing !== true)) {
      return;
    }
    const timer = setTimeout(readAgain, READ_EVERY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [readError, state]);
  const retryRead = () => {
    setReadError("");
    readAgain();
  };
  return { state, error, choiceError, readError, retryRead, find, choose, dismiss };
}
