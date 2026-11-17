/**
 * @file The covers of an album's releases MusicBrainz knows, to choose one from.
 *
 * Opened, it shows what was found before, or, never asked, asks MusicBrainz at once; while MusicBrainz
 * or an AI model is asked, it reads again every few seconds. With an AI set up, a model
 * is asked which release the household most likely has, and its pick is marked. Nothing
 * changes until a cover is chosen. Below them, an AI model may be asked for pictures of
 * the album on the web, to approve one.
 */

import { CircleNotchIcon, SparkleIcon } from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { type AlbumCovers, type CoverRelease, api, coverUrl } from "../api";
import { ImageLinks } from "./ImageLinks";

const READ_EVERY_MS = 2000;

/** Say why a request failed, in the server's words when it gave some. */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** Say what tells a release apart, in a few words: *1965, GB, 12″ Vinyl, 14 tracks*. */
function releaseAbout(release: CoverRelease): string {
  const tracks = release.tracks === null ? "" : `${String(release.tracks)} tracks`;
  return [release.date.slice(0, 4), release.country, release.format, tracks]
    .filter(Boolean)
    .join(", ");
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
  const [state, setState] = useState<AlbumCovers>();
  // Counts the reads asked for, so each asks the server again.
  const [reads, setReads] = useState(0);
  const [error, setError] = useState("");
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
    setState((was) => (was === undefined ? was : { ...was, finding: true, failure: null }));
    api.findAlbumCovers(album, artist).then(readAgain, (failure: unknown) => {
      setError(messageOf(failure));
      readAgain();
    });
  };
  const onRead = useEffectEvent((known: AlbumCovers) => {
    setState(known);
    // Never looked up, the album is looked up at once.
    if (!found.current && known.found_at === null && !known.finding && known.failure === null) {
      find();
    } else if (known.may_choose && !known.choosing && !chosen.current) {
      chosen.current = true;
      api.chooseAlbumCover(album, artist).then(readAgain, () => {
        // Without a pick, the covers are offered all the same.
      });
    }
  });
  useEffect(() => {
    let current = true;
    api.albumCovers(album, artist).then(
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
  }, [album, artist, reads]);
  useEffect(() => {
    if (state?.finding !== true && state?.choosing !== true) {
      return;
    }
    const timer = setTimeout(readAgain, READ_EVERY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  const covers = state?.covers ?? [];
  const finding = state === undefined || state.finding;
  const failure = error || state?.failure;
  const pick = state?.pick ?? null;
  return (
    <>
      <section className="cover-finder" aria-label="Covers on MusicBrainz">
        <div className="cover-finder-head">
          <h4>Covers on MusicBrainz</h4>
          {!finding && (
            <button type="button" className="link-button" onClick={find}>
              Look again
            </button>
          )}
        </div>
        {finding && state !== undefined && (
          <p className="cover-finder-note" role="status">
            <CircleNotchIcon weight="bold" className="spin" aria-hidden />
            {state.waiting
              ? "Waiting for Online to look on MusicBrainz…"
              : "Looking on MusicBrainz…"}
          </p>
        )}
        {failure && (
          <p className="cover-finder-note error" role="alert">
            {failure}
          </p>
        )}
        {!finding && !failure && covers.length === 0 && (
          <p className="cover-finder-note">MusicBrainz has no cover of this album.</p>
        )}
        {covers.length > 0 && (
          <ul className="cover-finder-grid">
            {covers.map(({ release, cover }) => {
              const picked = pick !== null && pick.release_id === release.release_id ? pick : null;
              const about = releaseAbout(release);
              const named = about === "" ? release.title : `${release.title}, ${about}`;
              return (
                <li key={release.release_id}>
                  <button
                    type="button"
                    className="cover-choice"
                    aria-pressed={cover === shown}
                    aria-label={`Use the cover of ${named}`}
                    title={picked === null ? named : `${picked.model} picked this: ${picked.why}`}
                    disabled={busy}
                    onClick={() => {
                      onUse(cover);
                    }}
                  >
                    <img src={coverUrl(cover)} alt="" loading="lazy" decoding="async" />
                    {picked !== null && (
                      <span className="cover-pick">
                        <SparkleIcon weight="fill" aria-hidden /> AI pick
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
            Asking the AI which fits…
          </p>
        )}
      </section>
      <ImageLinks
        pictured={{ kind: "album", album, artist }}
        shown={shown}
        busy={busy}
        onUse={onUse}
      />
    </>
  );
}
