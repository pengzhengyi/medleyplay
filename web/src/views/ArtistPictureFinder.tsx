/**
 * @file The pictures Deezer has of the artists going by an artist's name, to choose one from.
 *
 * Opened, it shows what was found before, or, never asked, asks Deezer at once, as
 * `useArtistPictures` does. Deezer is asked only once the household turns it on in
 * Settings, and nothing changes until a picture is chosen.
 *
 * *Pick by AI* asks an AI model which picture is of the artist; *Refine* adds a note
 * saying which artist the listener means, sent with the next asking. The picture picked
 * is marked, says why on hover, and takes the focus, so Enter uses it.
 */

import { CircleNotchIcon, SparkleIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";

import { coverUrl } from "../api";
import { formatFans } from "../format";
import { useAiSetUp } from "./aiSetUp";
import { useArtistPictures } from "./useArtistPictures";

/**
 * The pictures Deezer has of the artist `artistId`; `shown` is the photo the artist shows
 * now, and `onUse` sets the one chosen.
 */
export function ArtistPictureFinder({
  artistId,
  shown,
  busy = false,
  onUse,
}: {
  readonly artistId: string;
  readonly shown: string | null | undefined;
  readonly busy?: boolean;
  readonly onUse: (cover: string) => void;
}) {
  const { state, error, find, choose } = useArtistPictures(artistId);
  // The note to the AI being written, while *Refine* is open.
  const [note, setNote] = useState<string>();
  const noteId = useId();
  const noAi = useAiSetUp();
  // The picture picked takes the focus once, when it is first shown.
  const picked = useRef<HTMLButtonElement>(null);
  const focusedPick = useRef<string | null>(null);
  const pick = state?.pick ?? null;
  useEffect(() => {
    if (pick !== null && pick.cover !== focusedPick.current) {
      focusedPick.current = pick.cover;
      picked.current?.focus();
    }
  }, [pick]);

  const pictures = state?.pictures ?? [];
  const off = state !== undefined && !state.may_find;
  const finding = state === undefined || state.finding;
  const choosing = state?.choosing === true;
  const failure = error || (state?.failure ?? state?.choice_failure);
  // An AI model is offered while one may be asked, or to say how to set one up.
  const aiOffered = !finding && pictures.length > 1 && (state.may_choose || noAi.missing);
  return (
    <section className="cover-finder" aria-label="Pictures on Deezer">
      <div className="cover-finder-head">
        <h4>Pictures on Deezer</h4>
        <span className="cover-finder-actions">
          {aiOffered && (
            <>
              <button
                type="button"
                className="link-button picture-ask"
                disabled={choosing}
                aria-disabled={noAi.missing}
                title={noAi.missing ? noAi.why : "Ask the AI which picture is of this artist"}
                onClick={() => {
                  choose(note ?? pick?.hint ?? "");
                }}
              >
                {choosing ? (
                  <CircleNotchIcon weight="bold" className="spin" aria-hidden />
                ) : (
                  <SparkleIcon aria-hidden />
                )}
                {choosing ? "Picking…" : "Pick by AI"}
              </button>
              <button
                type="button"
                className="link-button"
                aria-expanded={note !== undefined}
                aria-controls={noteId}
                onClick={() => {
                  setNote((now) => (now === undefined ? (pick?.hint ?? "") : undefined));
                }}
              >
                Refine
              </button>
            </>
          )}
          {!finding && !off && (
            <button type="button" className="link-button" onClick={find}>
              Look again
            </button>
          )}
        </span>
      </div>
      {aiOffered && note !== undefined && (
        <form
          id={noteId}
          className="picture-note"
          onSubmit={(event) => {
            event.preventDefault();
            choose(note);
          }}
        >
          <label className="visually-hidden" htmlFor={`${noteId}-text`}>
            Note for the AI
          </label>
          <input
            id={`${noteId}-text`}
            className="picture-note-text"
            type="text"
            value={note}
            maxLength={500}
            placeholder="Which artist you mean, such as “the Taiwanese singer”"
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <button type="submit" className="dialog-button" disabled={choosing}>
            Ask
          </button>
        </form>
      )}
      {off && (
        <p className="cover-finder-note">
          Deezer is off. An admin turns it on in Settings, under Deezer.
        </p>
      )}
      {finding && state !== undefined && (
        <p className="cover-finder-note" role="status">
          <CircleNotchIcon weight="bold" className="spin" aria-hidden />
          {state.waiting ? "Waiting for Online to look on Deezer…" : "Looking on Deezer…"}
        </p>
      )}
      {failure && (
        <p className="cover-finder-note error" role="alert">
          {failure}
        </p>
      )}
      {!off && !finding && !failure && pictures.length === 0 && (
        <p className="cover-finder-note">Deezer has no picture of this artist.</p>
      )}
      {pictures.length > 0 && (
        <ul className="cover-finder-grid">
          {pictures.map(({ name, fans, cover }) => {
            const about = [name, formatFans(fans)].filter(Boolean).join(", ");
            const isPick = pick?.cover === cover;
            return (
              <li key={cover}>
                <button
                  ref={isPick ? picked : undefined}
                  type="button"
                  className={isPick ? "cover-choice picked" : "cover-choice"}
                  aria-pressed={cover === shown}
                  aria-label={`Use the picture of ${about}${isPick ? ", the AI's pick" : ""}`}
                  title={pick !== null && isPick ? `${pick.model} picked this: ${pick.why}` : about}
                  disabled={busy}
                  onClick={() => {
                    onUse(cover);
                  }}
                >
                  <img src={coverUrl(cover, "medium")} alt="" loading="lazy" decoding="async" />
                  {isPick && (
                    <span className="cover-pick">
                      <SparkleIcon weight="fill" aria-hidden /> AI pick
                    </span>
                  )}
                  <span className="cover-choice-about">{name}</span>
                  {fans !== null && <span className="picture-fans">{formatFans(fans)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {pick !== null && !choosing && (
        <p className="cover-finder-note picture-pick-why">
          <SparkleIcon className="picture-pick-mark" aria-hidden />
          <span>
            {`${pick.model} picked it: ${pick.why}`}
            {pick.hint !== "" && (
              <span className="picture-pick-hint">{` You said “${pick.hint}”.`}</span>
            )}
          </span>
        </p>
      )}
    </section>
  );
}
