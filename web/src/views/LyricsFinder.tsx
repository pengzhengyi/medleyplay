/**
 * @file The songs the lyrics sites find of a title and artist, to take a song's lyrics from.
 *
 * Opened, it shows what was found before, or, never asked, looks at once by the song's
 * own title and artist; the household may look again by words of its own, as a video's
 * title rarely is the song's. While the sites are asked, it reads again every few
 * seconds. Each song found shows its site, album, length, kind, and first lines. Once
 * songs are found and an AI model is set up, one is asked which is the song, and its
 * pick is marked. Nothing changes until the household uses one and saves.
 */

import { CircleNotchIcon, SparkleIcon } from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

import { type LyricsFound, type LyricsOption, api } from "../api";
import { formatTime } from "../format";
import { LYRICS_SITE_NAMES, firstLinesOf } from "../lyrics";

const READ_EVERY_MS = 2000;

/** Say why a request failed, in the server's words when it gave some. */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** Say what tells a song found apart, in a few words: *LRCLIB, Re:Start, 4:20, Timed*. */
function aboutOf(option: LyricsOption): string {
  const kind = option.instrumental
    ? "Instrumental"
    : firstLinesOf(option.text, 1).length > 0 && /^\s*\[\d/mu.test(option.text)
      ? "Timed"
      : "Plain";
  const length = option.duration_ms === null ? "" : formatTime(option.duration_ms / 1000);
  return [LYRICS_SITE_NAMES[option.provider], option.album, length, kind]
    .filter(Boolean)
    .join(", ");
}

/**
 * The songs found for the song `trackId`, titled `title` by `artist` in the Library;
 * `onUse` takes the one chosen.
 */
export function LyricsFinder({
  trackId,
  title,
  artist,
  busy = false,
  onUse,
}: {
  readonly trackId: number;
  readonly title: string;
  readonly artist: string;
  readonly busy?: boolean;
  readonly onUse: (option: LyricsOption) => void;
}) {
  const titleId = useId();
  const artistId = useId();
  const [state, setState] = useState<LyricsFound>();
  // Counts the reads asked for, so each asks the server again.
  const [reads, setReads] = useState(0);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState({ title, artist });
  // The sites are asked once on opening, never looked for before.
  const asked = useRef(false);
  // An AI model is asked once of the songs each finding finds.
  const chosen = useRef(false);
  const readAgain = () => {
    setReads((count) => count + 1);
  };
  const find = (words: { readonly title: string; readonly artist: string }) => {
    asked.current = true;
    chosen.current = false;
    setError("");
    setState((was) => (was === undefined ? was : { ...was, finding: true, failure: null }));
    api
      .findLyrics(trackId, words.title.trim(), words.artist.trim())
      .then(readAgain, (failure: unknown) => {
        setError(messageOf(failure));
        readAgain();
      });
  };
  const onRead = useEffectEvent((known: LyricsFound) => {
    setState(known);
    if (known.found_at !== null && !asked.current && known.title !== "") {
      setAsking({ title: known.title, artist: known.artist });
    }
    // Never looked for, the song is looked for at once by its own words.
    if (!asked.current && known.found_at === null && !known.finding && known.failure === null) {
      find(asking);
    } else if (known.may_choose && !known.choosing && !chosen.current) {
      chosen.current = true;
      api.chooseLyrics(trackId).then(readAgain, () => {
        // Without a pick, the songs are offered all the same.
      });
    }
  });
  useEffect(() => {
    let current = true;
    api.lyricsFound(trackId).then(
      (known) => {
        if (current) {
          onRead(known);
        }
      },
      (failure: unknown) => {
        if (current) {
          setError(messageOf(failure));
        }
      },
    );
    return () => {
      current = false;
    };
  }, [trackId, reads]);
  useEffect(() => {
    if (state?.finding !== true && state?.choosing !== true) {
      return;
    }
    const timer = setTimeout(readAgain, READ_EVERY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  const options = state?.options ?? [];
  const finding = state === undefined || state.finding;
  const failure = error || state?.failure;
  const pick = state?.pick ?? null;
  return (
    <section className="lyrics-finder" aria-label="Find lyrics">
      <form
        className="lyrics-finder-ask"
        onSubmit={(event) => {
          event.preventDefault();
          if (asking.title.trim() !== "") {
            find(asking);
          }
        }}
      >
        <label className="lyrics-finder-label" htmlFor={titleId}>
          Title
        </label>
        <input
          id={titleId}
          className="lyrics-finder-input"
          type="text"
          value={asking.title}
          disabled={busy}
          onChange={(event) => {
            const typed = event.currentTarget.value;
            setAsking((was) => ({ ...was, title: typed }));
          }}
        />
        <label className="lyrics-finder-label" htmlFor={artistId}>
          Artist
        </label>
        <input
          id={artistId}
          className="lyrics-finder-input"
          type="text"
          value={asking.artist}
          disabled={busy}
          onChange={(event) => {
            const typed = event.currentTarget.value;
            setAsking((was) => ({ ...was, artist: typed }));
          }}
        />
        <button
          type="submit"
          className="dialog-button"
          aria-busy={finding && state !== undefined}
          disabled={busy || finding || asking.title.trim() === ""}
        >
          Find
        </button>
      </form>
      {finding && state !== undefined && (
        <p className="lyrics-finder-note" role="status">
          <CircleNotchIcon weight="bold" className="spin" aria-hidden />
          {state.waiting ? "Waiting for Online to look for lyrics…" : "Looking for lyrics…"}
        </p>
      )}
      {failure && (
        <p className="lyrics-finder-note error" role="alert">
          {failure}
        </p>
      )}
      {!finding && !failure && state.found_at !== null && options.length === 0 && (
        <p className="lyrics-finder-note">
          {state.artist === ""
            ? `Nothing found for “${state.title}”.`
            : `Nothing found for “${state.title}” by ${state.artist}.`}
        </p>
      )}
      {options.length > 0 && (
        <ul className="lyrics-found" aria-label="Lyrics found">
          {options.map((option, at) => {
            const named =
              option.artist === "" ? option.title : `${option.title} by ${option.artist}`;
            const picked = pick?.option === at ? pick : null;
            return (
              <li
                className="lyrics-found-item"
                // A site may find one song twice, as a remaster; each place is its own.
                key={`${option.provider}-${String(at)}`}
                aria-label={
                  picked === null
                    ? `${named}, ${aboutOf(option)}`
                    : `${named}, ${aboutOf(option)}, the AI's pick: ${picked.why}`
                }
              >
                <div className="lyrics-found-about">
                  <span className="lyrics-found-name lyrics-found-line">
                    {picked !== null && (
                      <span
                        className="lyrics-found-pick"
                        title={`${picked.model} picked this: ${picked.why}`}
                      >
                        <SparkleIcon weight="fill" aria-hidden />
                        AI pick
                      </span>
                    )}
                    <strong className="lyrics-found-title">{option.title}</strong>
                    {option.artist !== "" && (
                      <span className="lyrics-found-artist"> {option.artist}</span>
                    )}
                  </span>
                  <small className="lyrics-found-meta lyrics-found-line">{aboutOf(option)}</small>
                  {!option.instrumental && (
                    <span className="lyrics-found-lines lyrics-found-line">
                      {firstLinesOf(option.text).join(" ")}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="dialog-button"
                  disabled={busy}
                  title={`Use the lyrics of ${named}, found on ${LYRICS_SITE_NAMES[option.provider]}`}
                  onClick={() => {
                    onUse(option);
                  }}
                >
                  Use
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {state?.choosing === true && (
        <p className="lyrics-finder-note" role="status">
          <CircleNotchIcon weight="bold" className="spin" aria-hidden />
          Asking the AI which is this song…
        </p>
      )}
      {state?.choice_failure && (
        <p className="lyrics-finder-note error" role="alert">
          {state.choice_failure}
        </p>
      )}
    </section>
  );
}
