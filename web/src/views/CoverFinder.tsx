/**
 * @file The covers of an album's releases MusicBrainz knows, to choose one from.
 *
 * Opened, it shows what was found before, or, never asked, asks MusicBrainz at once; while MusicBrainz
 * or an AI model is asked, it reads again every few seconds. With an AI set up, a model
 * is asked which release the household most likely has, and its pick is marked. Nothing
 * changes until a cover is chosen.
 */

import { CircleNotchIcon, SparkleIcon } from "@phosphor-icons/react";
import { type Words, useWords } from "../locale";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { type AlbumCovers, type CoverRelease, api, coverUrl } from "../api";

const READ_EVERY_MS = 2000;

/** Say why a request failed, in the server's words when it gave some. */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** Say what tells a release apart, in a few words: *1965, GB, 12″ Vinyl, 14 tracks*. */
function releaseAbout(release: CoverRelease, t: Words): string {
  const tracks = release.tracks === null ? "" : t("release_track_count", { count: release.tracks });
  return [release.date.slice(0, 4), release.country, release.format, tracks]
    .filter(Boolean)
    .join(t(", "));
}

/**
 * The covers of the album `album` by `artist`, its album artist or else its artist; `shown`
 * is the cover the album shows now, and `onUse` sets the one chosen.
 */
export function CoverFinder({
  album,
  artist,
  shown,
  busy = false,
  onUse,
}: {
  readonly album: string;
  readonly artist: string;
  readonly shown: string | undefined;
  readonly busy?: boolean;
  readonly onUse: (cover: string) => void;
}) {
  const t = useWords();
  const [state, setState] = useState<AlbumCovers>();
  // Counts the reads asked for, so each asks the server again.
  const [reads, setReads] = useState(0);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [choiceError, setChoiceError] = useState("");
  // MusicBrainz is asked once on opening, and a model once, for what was found.
  const found = useRef(false);
  const chosen = useRef(false);
  const readAgain = () => {
    setReads((count) => count + 1);
  };
  const find = () => {
    found.current = true;
    chosen.current = false;
    setError("");
    setChoiceError("");
    setState((was) =>
      was === undefined ? was : { ...was, finding: true, failure: null, choice_failure: null },
    );
    api.findAlbumCovers(album, artist).then(readAgain, (failure: unknown) => {
      setError(messageOf(failure));
      readAgain();
    });
  };
  const onRead = useEffectEvent((known: AlbumCovers) => {
    setState(known);
    // Never looked up, the album is looked up at once.
    if (
      known.may_find &&
      !found.current &&
      known.found_at === null &&
      !known.finding &&
      known.failure === null
    ) {
      find();
    } else if (known.may_choose && !known.choosing && !chosen.current) {
      chosen.current = true;
      api.chooseAlbumCover(album, artist).then(readAgain, (failure: unknown) => {
        setChoiceError(messageOf(failure));
      });
    }
  });
  useEffect(() => {
    let current = true;
    api.albumCovers(album, artist).then(
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
  }, [album, artist, reads]);
  useEffect(() => {
    if (readError !== "" || (state?.finding !== true && state?.choosing !== true)) {
      return;
    }
    const timer = setTimeout(readAgain, READ_EVERY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [readError, state]);

  const covers = state?.covers ?? [];
  const finding = state?.finding === true;
  const failure = error || state?.failure;
  const choiceFailure = choiceError || state?.choice_failure;
  const pick = state?.pick ?? null;
  return (
    <section className="cover-finder" aria-label={t("Covers on MusicBrainz")}>
      <div className="cover-finder-head">
        <h4>{t("Covers on MusicBrainz")}</h4>
        {!finding && readError === "" && state?.may_find === true && (
          <button type="button" className="link-button" onClick={find} disabled={busy}>
            {t("Look again")}
          </button>
        )}
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
          <button
            type="button"
            className="link-button"
            disabled={busy}
            onClick={() => {
              setReadError("");
              readAgain();
            }}
          >
            {t("Retry reading results")}
          </button>
        </>
      )}
      {state?.may_find === false && (
        <p className="cover-finder-note">{t("MusicBrainz cover search is unavailable.")}</p>
      )}
      {finding && (
        <p className="cover-finder-note" role="status">
          <CircleNotchIcon weight="bold" className="spin" aria-hidden />
          {t(
            state.waiting
              ? "Waiting for Online to look on MusicBrainz…"
              : "Looking on MusicBrainz…",
          )}
        </p>
      )}
      {failure && (
        <p className="cover-finder-note error" role="alert">
          {t("Could not find covers: {{detail}}", { detail: failure })}
        </p>
      )}
      {!finding &&
        !failure &&
        readError === "" &&
        state?.may_find === true &&
        covers.length === 0 && (
          <p className="cover-finder-note">{t("MusicBrainz has no cover of this album.")}</p>
        )}
      {covers.length > 0 && (
        <ul className="cover-finder-grid">
          {covers.map(({ release, cover }) => {
            const picked = pick !== null && pick.release_id === release.release_id ? pick : null;
            const about = releaseAbout(release, t);
            const named = about === "" ? release.title : [release.title, about].join(t(", "));
            return (
              <li key={release.release_id}>
                <button
                  type="button"
                  className="cover-choice"
                  aria-pressed={cover === shown}
                  aria-label={t("Use the cover of {{name}}", { name: named })}
                  title={
                    picked === null
                      ? named
                      : t("{{model}} picked this: {{reason}}", {
                          model: picked.model,
                          reason: picked.why,
                        })
                  }
                  disabled={busy}
                  onClick={() => {
                    onUse(cover);
                  }}
                >
                  <img src={coverUrl(cover, "medium")} alt="" loading="lazy" decoding="async" />
                  {picked !== null && (
                    <span className="cover-pick">
                      <SparkleIcon weight="fill" aria-hidden /> {t("AI pick")}
                    </span>
                  )}
                  <span className="cover-choice-about">{about || release.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {state?.choosing === true && (
        <p className="cover-finder-note" role="status">
          <CircleNotchIcon weight="bold" className="spin" aria-hidden />
          {t("Asking the AI which fits…")}
        </p>
      )}
      {choiceFailure && (
        <p className="cover-finder-note error" role="alert">
          {t("Could not get the AI's picture choice: {{detail}}", { detail: choiceFailure })}
        </p>
      )}
    </section>
  );
}
