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
import { useFormattingLocale, useWords } from "../locale";
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
  const t = useWords();
  const locale = useFormattingLocale();
  const { state, error, choiceError, readError, retryRead, find, choose } =
    useArtistPictures(artistId);
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
  const finding = state?.finding === true;
  const choosing = state?.choosing === true;
  const failure = error || state?.failure;
  const choiceFailure = choiceError || state?.choice_failure;
  // An AI model is offered while one may be asked, or to say how to set one up.
  const aiOffered =
    !finding &&
    readError === "" &&
    pictures.length > 1 &&
    (state?.may_choose === true || noAi.missing);
  return (
    <section className="cover-finder" aria-label={t("Pictures on Deezer")}>
      <div className="cover-finder-head">
        <h4>{t("Pictures on Deezer")}</h4>
        <span className="cover-finder-actions">
          {aiOffered && (
            <>
              <button
                type="button"
                className="link-button picture-ask"
                disabled={busy || choosing}
                aria-disabled={noAi.missing}
                title={noAi.missing ? noAi.why : t("Ask the AI which picture is of this artist")}
                onClick={() => {
                  choose(note ?? pick?.hint ?? "");
                }}
              >
                {choosing ? (
                  <CircleNotchIcon weight="bold" className="spin" aria-hidden />
                ) : (
                  <SparkleIcon aria-hidden />
                )}
                {t(choosing ? "Picking…" : "Pick by AI")}
              </button>
              <button
                type="button"
                className="link-button"
                disabled={busy}
                aria-expanded={note !== undefined}
                aria-controls={noteId}
                onClick={() => {
                  setNote((now) => (now === undefined ? (pick?.hint ?? "") : undefined));
                }}
              >
                {t("Refine")}
              </button>
            </>
          )}
          {!finding && readError === "" && state?.may_find === true && (
            <button type="button" className="link-button" onClick={find} disabled={busy}>
              {t("Look again")}
            </button>
          )}
        </span>
      </div>
      {state === undefined && readError === "" && (
        <p role="status" aria-busy="true">
          {t("Reading picture search results…")}
        </p>
      )}
      {readError !== "" && (
        <>
          <p role="alert">
            {t("Could not read picture search results: {{detail}}", { detail: readError })}
          </p>
          <button type="button" className="link-button" disabled={busy} onClick={retryRead}>
            {t("Retry reading results")}
          </button>
        </>
      )}
      {aiOffered && note !== undefined && (
        <form
          id={noteId}
          className="picture-note"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && !choosing) choose(note);
          }}
        >
          <label className="visually-hidden" htmlFor={`${noteId}-text`}>
            {t("Note for the AI")}
          </label>
          <input
            id={`${noteId}-text`}
            className="picture-note-text"
            type="text"
            value={note}
            maxLength={500}
            placeholder={t("Which artist you mean, such as “the Taiwanese singer”")}
            disabled={busy}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <button type="submit" className="dialog-button" disabled={busy || choosing}>
            {t("Ask")}
          </button>
        </form>
      )}
      {off && (
        <p className="cover-finder-note">
          {t("Deezer is off. An admin turns it on in Settings, under Deezer.")}
        </p>
      )}
      {finding && (
        <p className="cover-finder-note" role="status">
          <CircleNotchIcon weight="bold" className="spin" aria-hidden />
          {t(state.waiting ? "Waiting for Online to look on Deezer…" : "Looking on Deezer…")}
        </p>
      )}
      {failure && (
        <p className="cover-finder-note error" role="alert">
          {t("Could not find artist pictures: {{detail}}", { detail: failure })}
        </p>
      )}
      {choiceFailure && (
        <p className="cover-finder-note error" role="alert">
          {t("Could not get the AI's picture choice: {{detail}}", { detail: choiceFailure })}
        </p>
      )}
      {state !== undefined &&
        !off &&
        !finding &&
        !failure &&
        readError === "" &&
        pictures.length === 0 && (
          <p className="cover-finder-note">{t("Deezer has no picture of this artist.")}</p>
        )}
      {pictures.length > 0 && (
        <ul className="cover-finder-grid">
          {pictures.map(({ name, fans, cover }) => {
            const following = formatFans(fans, t, locale);
            const about = [name, following].filter(Boolean).join(t(", "));
            const isPick = pick?.cover === cover;
            return (
              <li key={cover}>
                <button
                  ref={isPick ? picked : undefined}
                  type="button"
                  className={isPick ? "cover-choice picked" : "cover-choice"}
                  aria-pressed={cover === shown}
                  aria-label={t(
                    isPick
                      ? "Use the picture of {{name}}, the AI's pick"
                      : "Use the picture of {{name}}",
                    { name: about },
                  )}
                  title={
                    pick !== null && isPick
                      ? t("{{model}} picked this: {{reason}}", {
                          model: pick.model,
                          reason: pick.why,
                        })
                      : about
                  }
                  disabled={busy}
                  onClick={() => {
                    onUse(cover);
                  }}
                >
                  <img src={coverUrl(cover, "medium")} alt="" loading="lazy" decoding="async" />
                  {isPick && (
                    <span className="cover-pick">
                      <SparkleIcon weight="fill" aria-hidden /> {t("AI pick")}
                    </span>
                  )}
                  <span className="cover-choice-about">{name}</span>
                  {fans !== null && <span className="picture-fans">{following}</span>}
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
            {t("{{model}} picked it: {{reason}}", { model: pick.model, reason: pick.why })}
            {pick.hint !== "" && (
              <span className="picture-pick-hint">
                {t(" You said “{{hint}}”.", { hint: pick.hint })}
              </span>
            )}
          </span>
        </p>
      )}
    </section>
  );
}
