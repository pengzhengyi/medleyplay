/**
 * @file The pictures Deezer has of the artists going by an artist's name, to choose one from.
 *
 * Opened, it shows what was found before, or, never asked, asks Deezer at once; while
 * Deezer is asked, it reads again every few seconds. Deezer is asked only once the
 * household turns it on in Settings, and nothing changes until a picture is chosen.
 */

import { CircleNotchIcon } from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { type ArtistPictures, api, coverUrl } from "../api";
import { formatFans } from "../format";

const READ_EVERY_MS = 2000;

/** Say why a request failed, in the server's words when it gave some. */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

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
  const [state, setState] = useState<ArtistPictures>();
  // Counts the reads asked for, so each asks the server again.
  const [reads, setReads] = useState(0);
  const [error, setError] = useState("");
  // Deezer is asked once on opening, never again unless asked to look again.
  const found = useRef(false);
  const readAgain = () => {
    setReads((count) => count + 1);
  };
  const find = () => {
    found.current = true;
    setError("");
    setState((was) => (was === undefined ? was : { ...was, finding: true, failure: null }));
    api.findArtistPictures(artistId).then(readAgain, (failure: unknown) => {
      setError(messageOf(failure));
      readAgain();
    });
  };
  const onRead = useEffectEvent((known: ArtistPictures) => {
    setState(known);
    // Never looked up, the artist is looked up at once, once Deezer is on.
    if (
      known.may_find &&
      !found.current &&
      known.found_at === null &&
      !known.finding &&
      known.failure === null
    ) {
      find();
    }
  });
  useEffect(() => {
    let current = true;
    api.artistPictures(artistId).then(
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
  }, [artistId, reads]);
  useEffect(() => {
    if (state?.finding !== true) {
      return;
    }
    const timer = setTimeout(readAgain, READ_EVERY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  const pictures = state?.pictures ?? [];
  const off = state !== undefined && !state.may_find;
  const finding = state === undefined || state.finding;
  const failure = error || state?.failure;
  return (
    <section className="cover-finder" aria-label="Pictures on Deezer">
      <div className="cover-finder-head">
        <h4>Pictures on Deezer</h4>
        {!finding && !off && (
          <button type="button" className="link-button" onClick={find}>
            Look again
          </button>
        )}
      </div>
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
            return (
              <li key={cover}>
                <button
                  type="button"
                  className="cover-choice"
                  aria-pressed={cover === shown}
                  aria-label={`Use the picture of ${about}`}
                  title={about}
                  disabled={busy}
                  onClick={() => {
                    onUse(cover);
                  }}
                >
                  <img src={coverUrl(cover)} alt="" loading="lazy" decoding="async" />
                  <span className="cover-choice-about">{name}</span>
                  {fans !== null && <span className="picture-fans">{formatFans(fans)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
